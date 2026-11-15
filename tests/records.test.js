'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {File} = require('node:buffer');
const R = require('../records.js');
const A = require('../assistant.js');
const copy = value => JSON.parse(JSON.stringify(value));
const asOf = '2026-11-15';
function data() {
  return {type: 'moi-finansy-bank-records', version: 1, asOf, note: 'Synthetic test only',
    debts: [{id: 'debt-fixture-1', name: 'Test loan', kind: 'loan', lender: 'Test Bank', balance: 10000, rate: 12, payment: 1100, dueDay: 25, balanceDate: asOf,
      bankDetails: {asOf, dateBasis: 'upload', totalDebt: 10200, accruedInterest: 200, nextPaymentDate: '2026-11-25', nextPrincipal: 900, nextInterest: 200}}],
    savings: [{id: 'saving-fixture-1', name: 'Test saving', kind: 'savings', bank: 'Test Bank', balance: 2000, rate: 5, balanceDate: asOf,
      bankDetails: {asOf, earnedInterest: 30, expectedInterest: 10, interestPaymentDate: '2026-12-11', bonusRatePoints: 1, bonusStartDate: '2026-12-05', bonusSpendRemaining: 2000, bonusSpendTarget: 10000}}]};
}
function state() {return {version: 4, transactions: [{id: 'tx', date: asOf, type: 'expense', category: 'food', amount: 100}], categories: [{id: 'food', name: 'Food', kind: 'expense'}], budgets: {food: 300}, budgetMonths: {}, budgetPlans: {}, debts: [], savings: [], subscriptions: []};}
function targets(p) {return Object.fromEntries(['debts','savings'].flatMap(key => p[key].map(row => [key + ':' + row.id, 'new'])));}

test('observed balances, accrued interest and future income stay separate; no transaction is invented', () => {
  const s = state(), before = JSON.stringify(s), p = data(), merged = R.merge(p, s, targets(p), asOf);
  assert.equal(JSON.stringify(s), before);
  assert.equal(merged.debts[0].balance, 10000); assert.equal(merged.debts[0].bankDetails.totalDebt, 10200);
  assert.equal(merged.savings[0].balance, 2000); assert.equal(merged.savings[0].rate, 5);
  assert.equal(merged.savings[0].bankDetails.expectedInterest, 10);
  assert.deepEqual(merged.debts[0].schedule, []);
  assert.equal(s.transactions.length, 1); assert.deepEqual(s.budgets, {food: 300});
});
test('identity matching defaults to an update; ambiguous existing entries require a choice', () => {
  const item = data().debts[0];
  assert.equal(R.suggestedTarget(item, []), 'new');
  assert.equal(R.suggestedTarget(item, [{...item, id: 'existing'}]), 'existing');
  assert.equal(R.suggestedTarget(item, [{...item, id: 'one'}, {...item, id: 'two'}]), '');
  assert.equal(R.suggestedTarget(item, [{...item, id: 'other', name: 'Another loan'}]), '');
});
test('re-importing updates the original record and cannot create a duplicate id', () => {
  const p = data(), s = state(), first = R.merge(p, s, targets(p), asOf);
  Object.assign(s, first);
  assert.throws(() => R.merge(p, s, targets(p), asOf), /уже есть/);
  const update = {'debts:debt-fixture-1': 'debt-fixture-1', 'savings:saving-fixture-1': 'saving-fixture-1'};
  const second = R.merge(p, s, update, asOf);
  assert.equal(second.debts.length, 1); assert.equal(second.savings.length, 1);
});
test('updating a selected record preserves its id, notes, schedule and other financial records', () => {
  const p = data(), s = state();
  s.debts = [{...p.debts[0], id: 'old', notes: 'Keep this', schedule: [{date: '2027-01-01', payment: 1, principal: 1, interest: 0, balance: 0}]}, {id: 'untouched', name: 'Other loan', balance: 500}];
  s.savings = [{...p.savings[0], id: 'old-saving', maturity: '2027-12-31', notes: 'Keep saving note'}];
  const merged = R.merge(p, s, {'debts:debt-fixture-1': 'old', 'savings:saving-fixture-1': 'old-saving'}, asOf);
  assert.equal(merged.debts[0].id, 'old'); assert.equal(merged.debts[0].notes, 'Keep this'); assert.equal(merged.debts[0].schedule.length, 1);
  assert.deepEqual(merged.debts[1], s.debts[1]); assert.equal(merged.savings[0].maturity, '2027-12-31');
  assert.equal(merged.savings[0].notes, 'Keep saving note');
});
test('more recent observations cannot be overwritten with an older screenshot', () => {
  const p = data(), s = state(); s.debts = [{...p.debts[0], balanceDate: '2026-11-16'}];
  assert.throws(() => R.merge(p, s, {'debts:debt-fixture-1': 'debt-fixture-1', 'savings:saving-fixture-1': 'new'}, '2026-11-16'), /свежий/);
});
test('all records must have explicit destinations and two inputs cannot overwrite the same entry', () => {
  const p = data(), s = state(); assert.throws(() => R.merge(p, s, {}, asOf), /Выбери/);
  p.debts.push({...p.debts[0], id: 'second-fixture'}); s.debts = [{...p.debts[0], id: 'target'}];
  assert.throws(() => R.merge(p, s, {'debts:debt-fixture-1': 'target', 'debts:second-fixture': 'target', 'savings:saving-fixture-1': 'new'}, asOf), /Две записи/);
});
test('mismatched principal totals and payment components are rejected rather than silently changed', () => {
  const p = data(); p.debts[0].bankDetails.totalDebt = 12000;
  assert.throws(() => R.validate(p, asOf), /Общий долг/);
  p.debts[0].bankDetails.totalDebt = 10200; p.debts[0].bankDetails.nextInterest = 201;
  assert.throws(() => R.validate(p, asOf), /платежа/);
});
test('arbitrary writes, invalid money, invalid dates and duplicate ids fail validation', () => {
  const cases = [p => {p.transactions = [];}, p => {p.debts[0].balance = '10000';}, p => {p.debts[0].rate = Infinity;},
    p => {p.savings[0].balance = -1;}, p => {p.asOf = '2026-11-31';}, p => {p.debts[0].balanceDate = '2026-11-14';},
    p => {p.savings[0].bankDetails.interestPaymentDate = '2026-02-30';}, p => {p.savings[0].id = p.debts[0].id;},
    p => {p.savings[0].bankDetails.bonusSpendRemaining = 10001;}, p => {p.debts[0].bankDetails.privateName = 'must not pass';},
    p => {p.debts[0].dueDay = 32;}, p => {p.savings[0].kind = 'anything';}];
  for (const change of cases) {const p = data(); change(p); assert.throws(() => R.validate(p, asOf));}
  const p = data(); p.asOf = '2026-11-16'; assert.throws(() => R.validate(p, asOf), /дату/);
});
test('sanitization exposes only known numeric observations, preserves zero and does not share notes', async () => {
  const raw = {asOf, totalDebt: 10200, accruedInterest: 200, privateName: 'SECRET', notes: 'SECRET', bad: 'SECRET'};
  assert.deepEqual(R.cleanDetails(raw, 'debt'), {asOf, totalDebt: 10200, accruedInterest: 200});
  assert.equal(R.cleanDetails({asOf, earnedInterest: 0}, 'saving').earnedInterest, 0);
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const s = state(), p = data(); s.debts = p.debts; s.savings = p.savings;
  s.debts[0].bankDetails = raw;
  const context = await A.createContext(s, '2026-11', asOf, 'test');
  assert.equal(context.obligations.debts[0].bankDetails.totalDebt, 10200);
  assert.equal(context.savings[0].bankDetails.expectedInterest, 10);
  assert.ok(!JSON.stringify(context).includes('SECRET'));
});

function appContext() {
  const ctx = vm.createContext({console, Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, TextEncoder, Uint8Array, File, crypto: webcrypto,
    navigator: {}, document: {querySelector: () => null, querySelectorAll: () => []}});
  for (const path of ['insights.js', 'dashboard.js', 'records.js', 'funds.js', 'funds-ui.js', 'assistant.js', 'assistant-ui.js', 'records-ui.js', 'app.js']) vm.runInContext(fs.readFileSync(require.resolve('../' + path), 'utf8').replace(/start\(\)\.catch\([\s\S]*$/, ''), ctx);
  ctx.input = state(); ctx.payload = data();
  vm.runInContext("state = normalizeState(input); today = () => '2026-11-15'; render = () => {}; closeModal = () => {}; activateTab = () => {}; notify = () => {}; openModal = (title, html) => {globalThis.modalHtml = html}", ctx);
  return ctx;
}
test('screenshot observations survive normalization and encrypted-backup state round trips', () => {
  const ctx = appContext();
  const result = vm.runInContext('normalizeState({...state, debts: payload.debts, savings: payload.savings})', ctx);
  assert.equal(result.debts[0].balance, 10000); assert.equal(result.debts[0].bankDetails.accruedInterest, 200);
  assert.equal(result.savings[0].bankDetails.expectedInterest, 10); assert.equal(result.savings[0].rate, 5);
});
test('import preview escapes names and notes; saving does not change transactions or planning', async () => {
  const ctx = appContext(); ctx.payload.debts[0].name = '<script>alert(1)</script>';
  const before = vm.runInContext('JSON.stringify({transactions: state.transactions, budgets: state.budgets, budgetMonths: state.budgetMonths, budgetPlans: state.budgetPlans})', ctx);
  await vm.runInContext('previewBankRecords(JSON.stringify(payload))', ctx);
  assert.ok(ctx.modalHtml.includes('&lt;script&gt;')); assert.ok(!ctx.modalHtml.includes('<script>'));
  ctx.targets = targets(ctx.payload);
  vm.runInContext('saveState = async () => {}', ctx);
  await vm.runInContext('applyBankRecords(targets)', ctx);
  assert.equal(vm.runInContext('state.debts.length', ctx), 1); assert.equal(vm.runInContext('state.savings.length', ctx), 1);
  assert.equal(vm.runInContext('JSON.stringify({transactions: state.transactions, budgets: state.budgets, budgetMonths: state.budgetMonths, budgetPlans: state.budgetPlans})', ctx), before);
  const html = vm.runInContext('renderDebts()+renderSavings()', ctx);
  assert.ok(html.includes('Всего задолженность на дату снимка')); assert.ok(html.includes('Уже заработано по данным банка'));
  assert.ok(html.includes('По скриншоту ближайший платёж')); assert.ok(!html.includes('<script>'));
});
test('cancel or stale preview cannot modify the local records', async () => {
  const ctx = appContext(); await vm.runInContext('previewBankRecords(JSON.stringify(payload))', ctx);
  vm.runInContext('state.budgets.food = 400', ctx); ctx.targets = targets(ctx.payload);
  await assert.rejects(vm.runInContext('applyBankRecords(targets)', ctx), /изменились/);
  assert.equal(vm.runInContext('state.debts.length', ctx), 0);
  await vm.runInContext("handleBankRecordsAction('bank-records-cancel')", ctx);
  assert.equal(vm.runInContext('bankRecordsDraft', ctx), null);
});
test('a failed records save rolls both collections back without losing any existing item', async () => {
  const ctx = appContext(), before = vm.runInContext('JSON.stringify(state)', ctx);
  await vm.runInContext('previewBankRecords(JSON.stringify(payload))', ctx); ctx.targets = targets(ctx.payload);
  vm.runInContext("saveState = async () => {throw new Error('storage full')}", ctx);
  await assert.rejects(vm.runInContext('applyBankRecords(targets)', ctx), /storage full/);
  assert.equal(vm.runInContext('JSON.stringify(state)', ctx), before);
});
test('only an unexpired and matching next payment is used for the live debt card', () => {
  const ctx = appContext();
  assert.equal(vm.runInContext('bankNextPayment(payload.debts[0]).interest', ctx), 200);
  vm.runInContext("payload.debts[0].balanceDate = '2026-11-16'", ctx);
  assert.equal(vm.runInContext('bankNextPayment(payload.debts[0])', ctx), null);
});
