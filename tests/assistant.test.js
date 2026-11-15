'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {File} = require('node:buffer');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const F = require('../insights.js');
const A = require('../assistant.js');
const copy = v => JSON.parse(JSON.stringify(v));
function fixture() {
  return {version: 4, categories: [{id: 'food', name: 'Продукты', kind: 'expense'}, {id: 'shopping', name: 'Покупки', kind: 'expense'}, {id: 'salary', name: 'Зарплата', kind: 'income'}],
    transactions: [
      {id: '1', date: '2026-10-15', type: 'expense', category: 'food', amount: 1000, title: 'SECRET merchant', account: 'SECRET account', sourceRef: 'SECRET reference'},
      {id: '2', date: '2026-11-03', type: 'expense', category: 'shopping', amount: 0.1},
      {id: '3', date: '2026-11-05', type: 'expense', category: 'shopping', amount: 0.2},
      {id: '4', date: '2026-11-04', type: 'transfer', category: 'transfer', amount: 90000},
      {id: '5', date: '2026-11-02', type: 'income', category: 'salary', amount: 10000},
      {id: '6', date: '2026-11-30', type: 'expense', category: 'food', amount: 50000}],
    budgets: {food: 5000, shopping: 4000}, budgetMonths: {'2026-10': {food: 3000}}, budgetPlans: {},
    debts: [{name: 'SECRET debt', lender: 'SECRET bank', notes: 'SECRET notes', contractTail: '1234', kind: 'mortgage', balance: 20000, rateKnown: false, rate: 0, payment: 3000, dueDay: 20, balanceIsProjected: true, balanceDate: '2026-11-01', schedule: []}],
    subscriptions: [{name: 'SECRET subscription', notes: 'SECRET private', amount: 1200, cycle: 'yearly', status: 'active', nextDate: '2027-01-01'}],
    savings: [{name: 'SECRET saving', bank: 'SECRET bank', notes: 'SECRET note', kind: 'deposit', balance: null, rate: null, balanceDate: '', maturity: ''}]};
}
const context = s => A.createContext(s, '2026-11', '2026-11-15', '1.6.0', '2026-11-15T12:00:00Z');
function proposal(c, changes = {}) {return {type: 'moi-finansy-assistant-plan', version: 1, source: copy(c.responseContract.source), summary: 'План', budgets: [{month: '2026-12', categoryLimits: {shopping: 3500}, ...changes}]};}

test('export contains aggregates, not transaction descriptions, account data, bank names or notes', async () => {
  const s = fixture(), before = JSON.stringify(s), c = await context(s);
  assert.ok(!JSON.stringify(c).includes('SECRET'));
  assert.ok(!JSON.stringify(c).includes('1234'));
  assert.equal(JSON.stringify(s), before);
  assert.equal(c.type, 'moi-finansy-assistant-context');
  assert.match(c.snapshotId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(c.responseContract.source.snapshotId, c.snapshotId);
  assert.equal(c.obligations.debts[0].rate, null);
  assert.equal(c.obligations.debts[0].balanceIsProjected, true);
  assert.equal(c.savings[0].balance, null);
});
test('export preserves cents, excludes transfers and future facts, and keeps missing months unknown', async () => {
  const c = await context(fixture());
  assert.equal(c.selected.expense, 0.3); assert.equal(c.selected.income, 10000);
  assert.equal(c.obligations.monthlyDebtPayments, 3000); assert.equal(c.obligations.monthlySubscriptions, 100);
  assert.equal(c.months[0].hasRecords, false); assert.equal(c.coverage.completeBankHistoryVerified, false);
  assert.equal(c.coverage.lastRecordedDate, '2026-11-05');
  assert.equal(c.selected.forecastExpense, null);
});
test('a context fingerprint is stable across object-key order but changes for any financial change', async () => {
  const s = fixture(), c = await context(s);
  const reordered = Object.fromEntries(Object.entries(s).reverse());
  assert.equal((await context(reordered)).snapshotId, c.snapshotId);
  s.transactions[0].title = 'changed private title';
  assert.notEqual((await context(s)).snapshotId, c.snapshotId);
});
test('plan preview only changes selected-month planning and preserves facts and unmentioned limits', async () => {
  const s = fixture(), original = JSON.stringify(s), c = await context(s);
  const prepared = await A.preparePlan(proposal(c, {income: 10000, limit: 9000, savingsGoal: 1000}), s, '2026-11-15');
  assert.equal(JSON.stringify(s), original);
  assert.deepEqual(prepared.budgetMonths['2026-12'], {food: 5000, shopping: 3500});
  assert.deepEqual(prepared.budgetMonths['2026-10'], {food: 3000});
  assert.equal(prepared.budgetPlans['2026-12'].income, 10000);
  assert.equal(prepared.changes.length, 4); assert.equal(prepared.warnings.length, 0);
});
test('explicit null clears an optional plan field and zero remains valid for savings', async () => {
  const s = fixture(); s.budgetPlans['2026-12'] = {income: 12000, limit: 9000, savingsGoal: 1000};
  const c = await context(s), p = proposal(c, {income: null, limit: null, savingsGoal: 0});
  const prepared = await A.preparePlan(p, s, '2026-11-15');
  assert.deepEqual(prepared.budgetPlans['2026-12'], {income: null, limit: null, savingsGoal: 0});
});
test('a proposal is rejected after a new transaction, changed budget, or changed loan', async () => {
  const s = fixture(), c = await context(s), p = proposal(c);
  for (const mutate of [x => x.transactions.push({id: 'later', date: '2026-11-16', type: 'expense', amount: 1}), x => x.budgets.food++, x => x.debts[0].balance--]) {
    const updated = copy(s); mutate(updated);
    await assert.rejects(A.preparePlan(p, updated, '2026-11-16'), /изменились/);
  }
});
test('arbitrary writes, new categories, income categories and unsafe keys are refused', async () => {
  const s = fixture(), c = await context(s);
  const cases = [
    {...proposal(c), transactions: []},
    proposal(c, {debts: []}),
    proposal(c, {categoryLimits: {unknown: 5}}),
    proposal(c, {categoryLimits: {salary: 5}}),
    proposal(c, {categoryLimits: JSON.parse('{"__proto__":10}')}),
    {...proposal(c), source: {...c.responseContract.source, malicious: true}}
  ];
  for (const p of cases) await assert.rejects(A.preparePlan(p, s, '2026-11-15'));
  assert.equal({}.polluted, undefined);
});
test('negative, non-finite, string, boolean, excessive and sub-cent amounts are refused', async () => {
  const s = fixture(), c = await context(s);
  for (const value of [-1, Infinity, NaN, '3500', true, 1e12, 0.001, 0, null]) await assert.rejects(A.preparePlan(proposal(c, {categoryLimits: {shopping: value}}), s, '2026-11-15'), /сумму/);
});
test('response months must be unique and limited to the exported two-month window', async () => {
  const s = fixture(), c = await context(s);
  const repeated = proposal(c); repeated.budgets.push(copy(repeated.budgets[0]));
  await assert.rejects(A.preparePlan(repeated, s, '2026-11-15'), /повторно/);
  await assert.rejects(A.preparePlan(proposal(c, {month: '2027-01'}), s, '2026-11-15'), /Месяц/);
  const futureSource = proposal(c); futureSource.source.asOf = '2026-11-16';
  await assert.rejects(A.preparePlan(futureSource, s, '2026-11-15'), /источник/);
});
test('contradictory income, goals and category limits are displayed as warnings', async () => {
  const s = fixture(), c = await context(s);
  const prepared = await A.preparePlan(proposal(c, {income: 1000, limit: 2000, savingsGoal: 100}), s, '2026-11-15');
  assert.equal(prepared.warnings.length, 2);
});
test('snapshots, backups, empty plans and already-applied proposals cannot replace the local database', async () => {
  const s = fixture(), c = await context(s);
  for (const p of [c, {type: 'moi-finansy-encrypted-backup'}, proposal(c, {categoryLimits: {}}), proposal(c, {categoryLimits: {shopping: 4000}})]) await assert.rejects(A.preparePlan(p, s, '2026-11-15'));
  const prepared = await A.preparePlan(proposal(c), s, '2026-11-15');
  const changed = {...s, budgetMonths: prepared.budgetMonths, budgetPlans: prepared.budgetPlans};
  await assert.rejects(A.preparePlan(proposal(c), changed, '2026-11-15'), /изменились/);
});
test('JSON plans accept fenced text, reject prose and limit payload size', async () => {
  const c = await context(fixture()), p = proposal(c);
  assert.deepEqual(A.parsePlan('```json\n' + JSON.stringify(p) + '\n```'), p);
  assert.throws(() => A.parsePlan('Here is your plan: ' + JSON.stringify(p)), /JSON/);
  assert.throws(() => A.parsePlan(' '.repeat(256 * 1024 + 1)), /256/);
});

function appContext() {
  const ctx = vm.createContext({console, Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, TextEncoder, Uint8Array, File, crypto: webcrypto,
    navigator: {}, document: {querySelector: () => null, querySelectorAll: () => []}});
  for (const path of ['insights.js', 'dashboard.js', 'records.js', 'assistant.js', 'assistant-ui.js', 'records-ui.js', 'app.js']) {
    const code = fs.readFileSync(require.resolve('../' + path), 'utf8').replace(/start\(\)\.catch\([\s\S]*$/, '');
    vm.runInContext(code, ctx);
  }
  ctx.input = fixture();
  vm.runInContext("state = normalizeState(input); activeMonth = '2026-11'; today = () => '2026-11-15'; render = () => {}; closeModal = () => {}; activateTab = () => {}; notify = () => {}", ctx);
  return ctx;
}
test('the assistant view renders with escaped category text in proposal previews', async () => {
  const ctx = appContext();
  assert.match(vm.runInContext('renderAssistant()', ctx), /Подготовить сводку/);
  vm.runInContext("state.categories.find(c => c.id === 'shopping').name = '<img src=x onerror=alert(1)>'; openModal = (title, html) => {globalThis.modalHtml = html}", ctx);
  ctx.c = await vm.runInContext("FinanceAssistant.createContext(state, '2026-11', today(), APP_VERSION)", ctx);
  ctx.p = proposal(ctx.c, {reason: '<script>alert(1)</script>'});
  await vm.runInContext('previewAssistantPlan(JSON.stringify(p))', ctx);
  const html = ctx.modalHtml;
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
});
test('applying a validated plan preserves every recorded transaction, loan and saving', async () => {
  const ctx = appContext();
  const before = vm.runInContext('JSON.stringify({transactions: state.transactions, debts: state.debts, savings: state.savings, subscriptions: state.subscriptions, budgets: state.budgets})', ctx);
  ctx.c = await vm.runInContext("FinanceAssistant.createContext(state, '2026-11', today(), APP_VERSION)", ctx);
  ctx.p = proposal(ctx.c);
  vm.runInContext('assistantDraft = p; saveState = async () => {}', ctx);
  await vm.runInContext('applyAssistantPlan()', ctx);
  assert.equal(vm.runInContext("state.budgetMonths['2026-12'].shopping", ctx), 3500);
  assert.equal(vm.runInContext('JSON.stringify({transactions: state.transactions, debts: state.debts, savings: state.savings, subscriptions: state.subscriptions, budgets: state.budgets})', ctx), before);
  assert.equal(vm.runInContext('assistantDraft', ctx), null);
});
test('a failed write rolls all plan fields back and retains the proposal for retry', async () => {
  const ctx = appContext(), before = vm.runInContext('JSON.stringify(state)', ctx);
  ctx.c = await vm.runInContext("FinanceAssistant.createContext(state, '2026-11', today(), APP_VERSION)", ctx);
  ctx.p = proposal(ctx.c, {income: 12000});
  vm.runInContext("assistantDraft = p; saveState = async () => {throw new Error('storage full')}", ctx);
  await assert.rejects(vm.runInContext('applyAssistantPlan()', ctx), /storage full/);
  assert.equal(vm.runInContext('JSON.stringify(state)', ctx), before);
  assert.ok(vm.runInContext('assistantDraft', ctx));
});
test('a proposal modified after preview is checked again at the point of application', async () => {
  const ctx = appContext();
  ctx.c = await vm.runInContext("FinanceAssistant.createContext(state, '2026-11', today(), APP_VERSION)", ctx);
  ctx.p = proposal(ctx.c);
  vm.runInContext('assistantDraft = p; state.budgets.food = 6000; saveState = async () => {throw new Error("must not save")}', ctx);
  await assert.rejects(vm.runInContext('applyAssistantPlan()', ctx), /изменились/);
  assert.equal(vm.runInContext('state.budgets.food', ctx), 6000);
});
test('an in-place data edit while the final hash is computing prevents the write', async () => {
  const ctx = appContext();
  ctx.c = await vm.runInContext("FinanceAssistant.createContext(state, '2026-11', today(), APP_VERSION)", ctx);
  ctx.p = proposal(ctx.c);
  vm.runInContext("assistantDraft = p; const originalPrepare = FinanceAssistant.preparePlan; FinanceAssistant.preparePlan = async (...args) => {const prepared = await originalPrepare(...args); state.budgets.food = 7000; return prepared}; saveState = async () => {throw new Error('must not save')}", ctx);
  await assert.rejects(vm.runInContext('applyAssistantPlan()', ctx), /изменились/);
  assert.equal(vm.runInContext('state.budgets.food', ctx), 7000);
});
