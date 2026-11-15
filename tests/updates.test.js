'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {File} = require('node:buffer');
const U = require('../updates.js');
const base = 'https://example.test/my-finance-iphone/';

test('manual update checks the worker without its HTTP cache and navigates within the same app', async () => {
  const calls = [];
  const environment = {navigator: {onLine: true, serviceWorker: {register: async (url, options) => {calls.push({url, options}); return {update: async () => calls.push('update')};}}},
    location: {protocol: 'https:', href: base + '?old=1', replace: url => calls.push(url)}};
  await U.refresh(environment, '1.6.2');
  assert.deepEqual(calls[0], {url: './sw.js', options: {updateViaCache: 'none'}}); assert.equal(calls[1], 'update');
  const destination = new URL(calls[2]);
  assert.equal(destination.origin, new URL(base).origin); assert.equal(destination.pathname, '/my-finance-iphone/');
  assert.equal(destination.searchParams.get('v'), '1.6.2'); assert.equal(destination.searchParams.has('old'), false);
  assert.equal(destination.searchParams.has('refresh'), true);
});
test('failed or offline updates do not navigate, clear storage, or hide the failure', async () => {
  let navigated = false;
  const e = {navigator: {onLine: false}, location: {protocol: 'https:', href: base, replace: () => {navigated = true;}}};
  await assert.rejects(U.refresh(e, '1.6.2'), /интернет/);
  e.navigator = {onLine: true, serviceWorker: {register: async () => ({update: async () => {throw new Error('network unavailable');}})}};
  await assert.rejects(U.refresh(e, '1.6.2'), /network unavailable/); assert.equal(navigated, false);
});
test('an installed worker is activated before navigation; a redundant installation fails', async () => {
  const listeners = new Set();
  const worker = {state: 'installed', addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    postMessage: message => {assert.equal(message.type, 'ACTIVATE_UPDATE'); worker.state = 'activated'; for (const fn of [...listeners]) fn();}};
  await U.waitForActivation(worker); assert.equal(listeners.size, 0);
  worker.state = 'redundant'; await assert.rejects(U.waitForActivation(worker), /Не удалось/);
});
test('foreground checks are throttled and update messages never reload an open form automatically', async () => {
  const events = {}, visibility = {}, focus = {}; let checks = 0, notices = 0;
  const e = {location: {protocol: 'https:'}, navigator: {onLine: true, serviceWorker: {register: async () => ({update: async () => {checks++;}}), addEventListener: (type, fn) => {events[type] = fn;}}},
    document: {visibilityState: 'visible', addEventListener: (type, fn) => {visibility[type] = fn;}}, window: {addEventListener: (type, fn) => {focus[type] = fn;}}};
  await U.monitor(e, '1.6.2', () => notices++);
  focus.focus(); visibility.visibilitychange(); assert.equal(checks, 1);
  events.message({data: {type: 'APP_UPDATED', version: '1.6.2'}}); assert.equal(notices, 0);
  events.message({data: {type: 'APP_UPDATED', version: '1.6.3'}}); assert.equal(notices, 1);
});

function workerContext(network) {
  const handlers = {}, entries = new Map(), deleted = [], messages = [], pending = [];
  const key = request => new URL(typeof request === 'string' ? request : request.url, base).href;
  const cache = {addAll: async () => {}, put: async (request, response) => entries.set(key(request), await response.text())};
  const context = vm.createContext({URL, Response, AbortController, setTimeout, clearTimeout,
    self: {location: {origin: new URL(base).origin, href: base + 'sw.js'}, addEventListener: (name, fn) => {handlers[name] = fn;}, skipWaiting: async () => {},
      clients: {claim: async () => {}, matchAll: async () => [{postMessage: message => messages.push(message)}]}},
    caches: {open: async () => cache, match: async request => entries.has(key(request)) ? new Response(entries.get(key(request))) : undefined,
      keys: async () => ['my-finance-shell-v1.6.1','my-finance-shell-v1.6.2','other-app-data'], delete: async name => {deleted.push(name);}},
    fetch: network});
  vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'), context);
  const fetchEvent = async request => {
    let response;
    handlers.fetch({request: {method: 'GET', cache: 'default', mode: 'navigate', ...request}, respondWith: promise => {response = Promise.resolve(promise);}, waitUntil: p => pending.push(p)});
    const value = response ? await response : undefined;
    await Promise.all(pending); return value;
  };
  return {handlers, entries, deleted, messages, fetchEvent};
}
test('online navigation loads fresh HTML even when an old page is cached', async () => {
  const w = workerContext(async (_, options) => {assert.equal(options.cache, 'no-cache'); return new Response('new shell');});
  w.entries.set(base, 'old shell');
  const response = await w.fetchEvent({url: base});
  assert.equal(await response.text(), 'new shell'); assert.equal(w.entries.get(base+'index.html'), 'new shell');
  assert.equal([...w.entries.keys()].some(url => url.includes('refresh=')), false);
});
test('offline navigation retains a usable shell and an unrelated document cannot replace it', async () => {
  const w = workerContext(async () => {throw new Error('offline');});
  w.entries.set(base+'index.html', 'offline shell');
  assert.equal(await (await w.fetchEvent({url: base+'?refresh=123'})).text(), 'offline shell');
  assert.equal(await w.fetchEvent({url: base+'README.md'}), undefined);
  assert.equal(w.entries.get(base+'index.html'), 'offline shell');
});
test('worker activation removes only old shell caches and notifies existing pages without navigating them', async () => {
  const w = workerContext(async () => new Response('ok')); let complete;
  w.handlers.activate({waitUntil: p => {complete = p;}}); await complete;
  assert.deepEqual(w.deleted, ['my-finance-shell-v1.6.1']);
  assert.equal(w.messages[0].version, '1.6.2');
});

function appContext() {
  const ctx = vm.createContext({console, Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, TextEncoder, Uint8Array, File, crypto: webcrypto,
    navigator: {}, document: {querySelector: () => null, querySelectorAll: () => []}});
  for (const path of ['insights.js','dashboard.js','records.js','assistant.js','assistant-ui.js','records-ui.js','updates.js','app.js']) vm.runInContext(fs.readFileSync(require.resolve('../'+path),'utf8').replace(/start\(\)\.catch\([\s\S]*$/,''), ctx);
  vm.runInContext("today=()=> '2026-11-15'; openModal=(title,html)=>{globalThis.preview={title,html}}",ctx);
  return ctx;
}
test('the same import control accepts bank records and never routes them to the budget-plan validator', async () => {
  const ctx = appContext();
  ctx.raw = JSON.stringify({type:'moi-finansy-bank-records',version:1,asOf:'2026-11-15',debts:[{id:'example-loan',name:'Example',kind:'loan',lender:'Example Bank',balance:1000,rate:10,payment:100,dueDay:20,balanceDate:'2026-11-15'}],savings:[]});
  await vm.runInContext('readAssistantPlanFile({size:raw.length,text:async()=>raw})',ctx);
  assert.equal(ctx.preview.title,'Кредит и накопления из файла'); assert.ok(ctx.preview.html.includes('Сохранить записи'));
  assert.ok(vm.runInContext('bankRecordsDraft !== null && assistantDraft === null',ctx));
  assert.equal(vm.runInContext('state.debts.length',ctx),0);
});
test('wrong file types give useful guidance and do not leak internal validator field names', async () => {
  const ctx = appContext();
  await assert.rejects(vm.runInContext("previewAssistantPlan(JSON.stringify({type:'moi-finansy-assistant-context'}))",ctx), /сводка для анализа/);
  await assert.rejects(vm.runInContext("previewAssistantPlan(JSON.stringify({type:'moi-finansy-encrypted-backup'}))",ctx), /резервная копия/);
  await assert.rejects(vm.runInContext("previewAssistantPlan('null')",ctx), /Выбери файл/);
  assert.equal(vm.runInContext('state.debts.length',ctx),0);
});
test('the published HTML, scripts, and offline precache use a coherent version', () => {
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8'), worker=fs.readFileSync(require.resolve('../sw.js'),'utf8');
  const appVersion=fs.readFileSync(require.resolve('../app.js'),'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
  assert.ok(html.includes('name="application-version" content="'+appVersion+'"'));
  for(const match of html.matchAll(/(?:src|href)="(\.\/[^\"]+\?v=([^\"]+))"/g)){
    assert.equal(match[2],appVersion); assert.ok(worker.includes("'"+match[1]+"'"),match[1]);
    assert.ok(fs.existsSync(require.resolve('../'+match[1].slice(2).split('?')[0])));
  }
});
