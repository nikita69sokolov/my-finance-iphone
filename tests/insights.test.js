'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../insights.js');
const categories = ['food', 'home', 'health', 'children', 'credit', 'shopping', 'leisure', 'transport', 'subscriptions', 'services', 'other-expense'].map(id => ({id, name: id, kind: 'expense'}));
categories.push({id: 'salary', name: 'salary', kind: 'income'});
function state(extra = {}) {return {version: 3, categories, transactions: [], budgets: {}, budgetMonths: {}, budgetPlans: {}, debts: [], subscriptions: [], savings: [], ...extra};}
function tx(date, amount, category = 'food', type = 'expense') {return {id: date + category + amount, date, amount, category, type, title: 'Test operation'};}
const analyze = s => F.analyze(s, '2026-11', '2026-11-15');

test('all expenses reduce the total budget, including categories without limits; own transfers are excluded', () => {
  const data = analyze(state({budgets: {food: 1000}, transactions: [tx('2026-11-01', 300), tx('2026-11-02', 200, 'shopping'), tx('2026-11-03', 9000, 'transfer', 'transfer'), tx('2026-11-03', 4000, 'salary', 'income')]}));
  assert.equal(data.expense, 500); assert.equal(data.income, 4000); assert.equal(data.remaining, 500); assert.equal(data.unbudgetedTotal, 200);
  assert.equal(data.records, 3); assert.equal(data.categoryRows[0].spent, 300);
});
test('a monthly total cap takes priority over category totals', () => {
  const data = analyze(state({budgets: {food: 1000}, budgetPlans: {'2026-11': {limit: 700, income: 800, savingsGoal: 200}}, transactions: [tx('2026-11-02', 900)]}));
  assert.equal(data.totalLimit, 700); assert.equal(data.remaining, -200); assert.equal(data.dailyAllowance, 0);
  assert.ok(data.recommendations.some(r => r.kind === 'plan' && r.amount === 100));
});
test('per-month budgets preserve legacy defaults and an explicit empty month', () => {
  const s = state({budgets: {food: 1500}, budgetMonths: {'2026-11': {food: 900}, '2026-12': {}}});
  assert.deepEqual(F.limitsFor(s, '2026-10'), {food: 1500}); assert.deepEqual(F.limitsFor(s, '2026-11'), {food: 900}); assert.deepEqual(F.limitsFor(s, '2026-12'), {});
  assert.deepEqual(s.budgets, {food: 1500});
});
test('normalization preserves valid plans, clears invalid values, and accepts old backups', () => {
  assert.deepEqual(F.normalizePlanning({}), {budgetMonths: {}, budgetPlans: {}});
  const p = F.normalizePlanning({budgetMonths: {'2026-11': {food: 125.55, wrong: Infinity, negative: -1}, invalid: {food: 5}}, budgetPlans: {'2026-11': {income: 0, limit: 0, savingsGoal: 55.5}, invalid: {income: 5}}});
  assert.deepEqual(p, {budgetMonths: {'2026-11': {food: 125.55}}, budgetPlans: {'2026-11': {income: 0, limit: null, savingsGoal: 55.5}}});
});
test('forecasts require enough calendar days and expense dates; empty and future periods stay unknown', () => {
  assert.equal(analyze(state()).forecast, null);
  assert.equal(analyze(state({transactions: [tx('2026-11-14', 100)]})).forecast, null);
  assert.equal(F.analyze(state({transactions: [tx('2026-11-01', 100), tx('2026-11-02', 100), tx('2026-11-03', 100)]}), '2026-11', '2026-11-06').forecast, null);
  const future = F.analyze(state({transactions: [tx('2026-12-01', 500)]}), '2026-12', '2026-11-15');
  assert.equal(future.forecast, null); assert.equal(future.expense, 0); assert.equal(future.dailyAllowance, null); assert.equal(future.recommendations.length, 0);
});
test('forecasts do not multiply already recorded fixed payments by remaining days', () => {
  const data = analyze(state({transactions: [tx('2026-11-01', 1000, 'shopping'), tx('2026-11-07', 1000, 'shopping'), tx('2026-11-15', 1000, 'shopping'), tx('2026-11-04', 20000, 'credit'), tx('2026-11-02', 5000, 'home'), tx('2026-11-09', 500, 'subscriptions')]}));
  assert.equal(data.forecast, 31500); assert.equal(data.expense, 28500); assert.equal(data.forecastByCategory, undefined);
});
test('historical months show facts rather than forecasts and future-dated entries are excluded', () => {
  const s = state({transactions: [tx('2026-10-31', 200), tx('2026-11-30', 5000), tx('2026-11-15', 100), tx('2026-11-99', 999)]});
  assert.equal(analyze(s).expense, 100); assert.equal(F.analyze(s, '2026-10', '2026-11-15').forecast, 200);
});
test('comparison uses the same dates, and leap-year February is valid', () => {
  const d = analyze(state({transactions: [tx('2026-11-15', 200), tx('2026-10-15', 100), tx('2026-10-31', 5000)]}));
  assert.equal(d.previousExpense, 100); assert.equal(d.change, 100);
  assert.equal(F.analyze(state({transactions: [tx('2024-02-29', 500), tx('2024-02-30', 100)]}), '2024-02', '2024-03-15').expense, 500);
});
test('missing months do not become zero-cost months or distort suggested limits', () => {
  const d = analyze(state({transactions: [tx('2026-09-10', 1000), tx('2026-10-10', 3000)]}));
  assert.equal(d.proposals.find(p => p.id === 'food').limit, 2000); assert.equal(d.historyMonths.length, 2);
  assert.equal(d.months.find(m => m.month === '2026-08').count, 0);
});
test('savings scenarios use flexible categories and do not reduce health, family, loans or food', () => {
  const s = state({transactions: ['food', 'health', 'children', 'credit', 'shopping', 'leisure'].map(id => tx('2026-10-10', 10000, id))});
  const d = F.analyze(s, '2026-10', '2026-11-15'), scenarios = d.recommendations.filter(r => r.kind === 'saving');
  assert.deepEqual(scenarios.map(r => r.category).sort(), ['leisure', 'shopping']);
  assert.ok(scenarios.every(r => r.amount === 1000 && r.target === 9000 && r.targetMonth === '2026-11'));
});
test('subscription plans and debt plans are never added again to recorded spending', () => {
  const d = analyze(state({transactions: [tx('2026-11-10', 100, 'subscriptions')], subscriptions: [{amount: 1200, cycle: 'yearly', status: 'active'}, {amount: 400, cycle: 'monthly', status: 'cancelled'}], debts: [{balance: 50000, payment: 4000}]}));
  assert.equal(d.subscriptionTotal, 100); assert.equal(d.debtTotal, 4000); assert.equal(d.expense, 100);
});
test('currency calculations keep cents, and analysis never mutates the stored data', () => {
  const s = state({transactions: [tx('2026-11-01', 0.1), tx('2026-11-02', 0.2)], budgets: {food: 1}}), before = JSON.stringify(s);
  assert.equal(analyze(s).expense, 0.3); assert.equal(analyze(s).remaining, 0.7); assert.equal(JSON.stringify(s), before);
});

function appContext() {
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8').replace(/start\(\)\.catch\([\s\S]*$/, '');
  const context = vm.createContext({console, Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, FinanceInsights: F, globalThis: {}, document: {querySelector: () => null, querySelectorAll: () => []}});
  vm.runInContext(fs.readFileSync(require.resolve('../dashboard.js'), 'utf8'), context);
  vm.runInContext(source, context);
  return context;
}
test('v1.4 app backups migrate without losing operations, loans, subscriptions, savings or base budgets', () => {
  const context = appContext();
  const old = state({transactions: [tx('2026-11-01', 120)], budgets: {food: 500}, savings: [{id: 's', name: 'Deposit', balance: 5000, balanceDate: '2026-11-01'}], debts: [{id: 'd', name: 'Loan', balance: 1000, payment: 100}], subscriptions: [{id: 'sub', name: 'Test', amount: 100}]});
  context.input = old;
  const result = vm.runInContext('normalizeState(input)', context);
  assert.equal(result.version, 4); assert.equal(result.transactions.length, 1); assert.equal(result.debts[0].balance, 1000); assert.equal(result.savings[0].balance, 5000); assert.equal(result.subscriptions.length, 1); assert.equal(result.budgets.food, 500);
  assert.equal(Object.keys(result.budgetMonths).length, 0);
});
test('updated app preserves per-month budgets and goals through normalization for backup restore', () => {
  const context = appContext(); context.input = state({budgetMonths: {'2026-11': {shopping: 1500}}, budgetPlans: {'2026-11': {income: 10000, limit: 8000, savingsGoal: 2000}}});
  const result = vm.runInContext('normalizeState(input)', context);
  assert.equal(result.budgetMonths['2026-11'].shopping, 1500); assert.equal(result.budgetPlans['2026-11'].savingsGoal, 2000);
});
test('rendering budgets and charts works with empty and populated data and escapes text', () => {
  const context = appContext();
  assert.match(vm.runInContext('renderBudgets()', context), /Твой бюджет начинается/);
  context.input = state({transactions: [tx('2026-11-01', 500)], categories: [...categories, {id: 'unsafe', name: '<img src=x onerror=alert(1)>', kind: 'expense'}], budgets: {unsafe: 100}});
  vm.runInContext("state = normalizeState(input); activeMonth = '2026-11'", context);
  const html = vm.runInContext('renderBudgets() + renderHome()', context);
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x')); assert.ok(!/NaN|Infinity/.test(html));
});
test('a failed plan save rolls changes back and keeps the prior budget', async () => {
  const context = appContext();
  vm.runInContext("state.budgets.food = 500; saveState = async () => {throw new Error('disk full')}; render = () => {}", context);
  await assert.rejects(vm.runInContext("persistPlanningChange(() => {state.budgets.food = 1; state.budgetMonths['2026-11'] = {food: 1}})", context), /disk full/);
  assert.equal(vm.runInContext('state.budgets.food', context), 500); assert.equal(vm.runInContext('Object.keys(state.budgetMonths).length', context), 0);
});
test('applying an auto plan changes only checked categories in the selected month', async () => {
  const context = appContext();
  vm.runInContext("state.budgets = {food: 500, shopping: 700}; state.budgetMonths['2026-10'] = {food: 300}; saveState = async () => {}; render = () => {}; closeModal = () => {}; activateTab = () => {}; notify = () => {}", context);
  context.form = {id: 'autoBudgetForm', dataset: {month: '2026-11'}};
  context.values = {getAll: () => ['food'], get: key => key === 'limit-food' ? '600' : null};
  await vm.runInContext('savePlanningForm(form, values)', context);
  assert.equal(vm.runInContext("state.budgetMonths['2026-11'].food", context), 600);
  assert.equal(vm.runInContext("state.budgetMonths['2026-11'].shopping", context), 700);
  assert.equal(vm.runInContext("state.budgetMonths['2026-10'].food", context), 300);
  assert.equal(vm.runInContext('state.budgets.food', context), 500);
});
test('rejecting an invalid proposed amount leaves the budget unchanged', async () => {
  const context = appContext();
  context.form = {id: 'budgetForm', dataset: {month: '2026-11'}};
  context.values = new Map([['category', 'food'], ['limit', 'Infinity'], ['scope', 'month']]);
  await assert.rejects(vm.runInContext('savePlanningForm(form, values)', context), /лимит/);
  assert.equal(vm.runInContext('Object.keys(state.budgetMonths).length', context), 0);
});
