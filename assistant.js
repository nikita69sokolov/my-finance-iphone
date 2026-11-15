/* Local exchange with ChatGPT: aggregate export and strictly scoped budget proposals. */
(function (root) {
'use strict';
const F = root.FinanceInsights || (typeof require === 'function' ? require('./insights.js') : null);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = value => JSON.parse(JSON.stringify(value));
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sum = values => round(values.reduce((total, value) => total + Number(value), 0));
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && PERIOD.test(value.slice(0, 7)) && Number(value.slice(8)) > 0 && Number(value.slice(8)) <= F.days(value.slice(0, 7));
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Неверный формат: ' + label);
}
function keys(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(key => BLOCKED.has(key) || !allowed.includes(key))) throw new Error('Неподдерживаемые поля: ' + label);
}
function amount(value, label, nullable = false, positive = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || (positive && value <= 0) || Math.abs(round(value) - value) > 1e-7) throw new Error('Проверь сумму: ' + label);
  return round(value);
}
function text(value, label, maximum) {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('Проверь текст: ' + label);
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function fingerprint(state, month, asOf) {
  if (!root.crypto?.subtle) throw new Error('Открой приложение по HTTPS, чтобы подготовить данные помощнику.');
  const bytes = new TextEncoder().encode(canonical({state, month, asOf}));
  const hash = await root.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function planning(state, month) {
  const plan = F.normalizePlanning(state).budgetPlans[month] || {income: null, limit: null, savingsGoal: 0};
  return {month, ...plan, categoryLimits: F.limitsFor(state, month)};
}
async function createContext(input, month, asOf, appVersion, createdAt = new Date().toISOString()) {
  if (!PERIOD.test(month) || !validDate(asOf)) throw new Error('Некорректный период сводки');
  const state = clone(input), analysis = F.analyze(state, month, asOf);
  const dates = (state.transactions || []).filter(t => validDate(t.date) && t.date <= asOf && ['income', 'expense'].includes(t.type) && Number(t.amount) > 0).map(t => t.date).sort();
  const months = Array.from({length: 6}, (_, index) => {
    const period = F.shift(month, index - 5), a = F.analyze(state, period, asOf);
    const periodDates = dates.filter(date => date.startsWith(period));
    return {month: period, hasRecords: a.records > 0, records: a.records, firstRecordedDate: periodDates[0] || null, lastRecordedDate: periodDates.at(-1) || null,
      income: a.income, expense: a.expense, net: round(a.income - a.expense), expenseByCategory: a.byCategory};
  });
  const debts = (state.debts || []).map((d, index) => ({label: 'Кредит ' + (index + 1), kind: d.kind, balance: d.balance,
    rate: d.rateKnown === false ? null : d.rate, payment: d.payment, dueDay: d.dueDay, balanceDate: d.balanceDate || null,
    balanceIsProjected: !!d.balanceIsProjected,
    nextPayments: (d.schedule || []).filter(row => row.date >= asOf).slice(0, 3).map(row => ({date: row.date, payment: row.payment, principal: row.principal, interest: row.interest}))}));
  const subscriptions = (state.subscriptions || []).map((s, index) => ({label: 'Подписка ' + (index + 1), amount: s.amount, cycle: s.cycle,
    monthlyEquivalent: F.monthlySubscription(s), status: s.status, nextDate: s.nextDate || null}));
  const savings = (state.savings || []).map((s, index) => ({label: 'Накопления ' + (index + 1), kind: s.kind, balance: s.balance ?? null,
    rate: s.rate ?? null, balanceDate: s.balanceDate || null, maturity: s.maturity || null}));
  const context = {
    type: 'moi-finansy-assistant-context', version: 1, appVersion, createdAt, month, asOf, currency: 'RUB',
    snapshotId: await fingerprint(state, month, asOf),
    privacy: {mode: 'aggregates', transactionTitlesIncluded: false, accountDetailsIncluded: false, namesReplacedWithLabels: true},
    coverage: {firstRecordedDate: dates[0] || null, lastRecordedDate: dates.at(-1) || null, completeBankHistoryVerified: false,
      note: 'Это внесённые записи. Месяц без записей не означает нулевые расходы; полнота выписок не подтверждена.'},
    categories: (state.categories || []).filter(c => c.kind === 'expense' && !BLOCKED.has(c.id)).map(c => ({id: c.id, name: c.name})),
    months, planning: [planning(state, month), planning(state, F.shift(month, 1))],
    selected: {income: analysis.income, expense: analysis.expense, net: round(analysis.income - analysis.expense),
      totalLimit: analysis.totalLimit || null, remainingBudget: analysis.remaining, dailyBudgetAllowance: analysis.dailyAllowance,
      forecastExpense: analysis.forecast, forecastIsEstimate: analysis.canForecast, forecastExcludesUnrecordedFutureBills: true,
      previousComparableExpense: analysis.hasComparison ? analysis.previousExpense : null, changePercent: analysis.change,
      localLimitSuggestions: analysis.proposals, limitSuggestionMonths: analysis.historyMonths},
    obligations: {debts, subscriptions, monthlyDebtPayments: analysis.debtTotal, monthlySubscriptions: analysis.subscriptionTotal,
      note: 'Плановые платежи показаны отдельно. Не прибавляй их повторно к уже внесённым расходам.'},
    savings,
    responseContract: {type: 'moi-finansy-assistant-plan', version: 1,
      source: {snapshotId: null, month, asOf}, allowedMonths: [month, F.shift(month, 1)],
      allowedChanges: ['income', 'limit', 'savingsGoal', 'categoryLimits'],
      note: 'В ответе скопируй snapshotId из корня этого файла в source.snapshotId. Каждый бюджет содержит month и только изменяемые поля. Суммы — числа в рублях, до двух знаков после точки. Неизменяемые категории не перечисляй. Ответ проходит проверку и применяется только после просмотра.'}
  };
  context.responseContract.source.snapshotId = context.snapshotId;
  return context;
}
function parsePlan(raw) {
  if (typeof raw !== 'string' || raw.length > 256 * 1024) throw new Error('Ответ помощника должен быть текстом до 256 КБ.');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  try {return JSON.parse(cleaned);} catch (_) {throw new Error('Не удалось прочитать JSON. Выбери файл плана или вставь только JSON из ответа.');}
}
function validatePlan(input, state, asOf) {
  keys(input, ['type', 'version', 'source', 'summary', 'budgets'], 'ответ помощника');
  if (input.type !== 'moi-finansy-assistant-plan' || input.version !== 1) throw new Error('Нужен план помощника, а не сводка или резервная копия.');
  keys(input.source, ['snapshotId', 'month', 'asOf'], 'источник');
  const source = input.source;
  if (!/^sha256:[a-f0-9]{64}$/.test(source.snapshotId || '') || !PERIOD.test(source.month || '') || !validDate(source.asOf) || !validDate(asOf) || source.asOf > asOf) throw new Error('Некорректный источник плана. Подготовь новую сводку.');
  if (!Array.isArray(input.budgets) || input.budgets.length < 1 || input.budgets.length > 2) throw new Error('План должен содержать один или два месячных бюджета.');
  const allowed = new Set([source.month, F.shift(source.month, 1)]), seen = new Set();
  const categories = new Set((state.categories || []).filter(c => c.kind === 'expense' && !BLOCKED.has(c.id)).map(c => c.id));
  const budgets = input.budgets.map(b => {
    keys(b, ['month', 'income', 'limit', 'savingsGoal', 'categoryLimits', 'reason'], 'бюджет');
    if (!allowed.has(b.month) || seen.has(b.month)) throw new Error('Месяц плана не входит в сводку или указан повторно.');
    seen.add(b.month);
    const result = {month: b.month};
    if (own(b, 'income')) result.income = amount(b.income, 'план дохода', true);
    if (own(b, 'limit')) result.limit = amount(b.limit, 'общий лимит', true, true);
    if (own(b, 'savingsGoal')) result.savingsGoal = amount(b.savingsGoal, 'цель накоплений');
    if (own(b, 'reason')) result.reason = text(b.reason, 'обоснование', 600);
    if (own(b, 'categoryLimits')) {
      object(b.categoryLimits, 'лимиты категорий');
      if (Object.keys(b.categoryLimits).length > categories.size) throw new Error('Слишком много категорий');
      result.categoryLimits = Object.fromEntries(Object.entries(b.categoryLimits).map(([id, value]) => {
        if (BLOCKED.has(id) || !categories.has(id)) throw new Error('Неизвестная категория: ' + id);
        return [id, amount(value, 'лимит категории', false, true)];
      }));
    }
    if (!['income', 'limit', 'savingsGoal'].some(key => own(result, key)) && !Object.keys(result.categoryLimits || {}).length) throw new Error('В месячном бюджете нет предложенных изменений.');
    return result;
  });
  return {type: input.type, version: 1, source: {...source}, summary: own(input, 'summary') ? text(input.summary, 'краткий вывод', 1500) : '', budgets};
}
async function preparePlan(input, inputState, asOf) {
  const state = clone(inputState), plan = validatePlan(input, state, asOf);
  const token = await fingerprint(state, plan.source.month, plan.source.asOf);
  if (token !== plan.source.snapshotId) throw new Error('Данные изменились после подготовки сводки. Экспортируй новую сводку и запроси обновлённый план.');
  const next = clone(state), changes = [], warnings = [];
  next.budgetMonths = next.budgetMonths || {}; next.budgetPlans = next.budgetPlans || {};
  const labels = {income: 'План дохода', limit: 'Общий лимит', savingsGoal: 'Цель накоплений'};
  for (const b of plan.budgets) {
    const previous = planning(state, b.month), updated = {...previous};
    for (const key of Object.keys(labels)) if (own(b, key)) {
      updated[key] = b[key];
      if (previous[key] !== b[key]) changes.push({month: b.month, label: labels[key], before: previous[key], after: b[key]});
    }
    const limits = {...previous.categoryLimits};
    for (const [id, value] of Object.entries(b.categoryLimits || {})) {
      if (limits[id] !== value) changes.push({month: b.month, label: (state.categories || []).find(c => c.id === id).name, before: limits[id] ?? null, after: value});
      limits[id] = value;
    }
    if (own(b, 'categoryLimits')) next.budgetMonths[b.month] = limits;
    if (Object.keys(labels).some(key => own(b, key))) next.budgetPlans[b.month] = {income: updated.income, limit: updated.limit, savingsGoal: updated.savingsGoal};
    const total = updated.limit ?? sum(Object.values(limits));
    if (updated.income !== null && total + updated.savingsGoal > updated.income) warnings.push(b.month + ': расходы и накопления превышают план дохода.');
    if (updated.limit !== null && sum(Object.values(limits)) > updated.limit) warnings.push(b.month + ': сумма лимитов категорий выше общего лимита.');
    if (b.month < asOf.slice(0, 7)) warnings.push(b.month + ': меняется бюджет прошедшего месяца.');
  }
  if (!changes.length) throw new Error('Предложенные значения уже сохранены. Изменений нет.');
  return {plan, changes, warnings, budgetMonths: next.budgetMonths, budgetPlans: next.budgetPlans};
}
function prompt(context) {
  return 'Используй $moi-finansy-assistant. Проанализируй приложенную сводку «Мои Финансы» за ' + context.month + ' по состоянию на ' + context.asOf + '. ' +
    'Покажи основные расходы, возможности экономии и реалистичный бюджет. Отделяй факты от оценок и учитывай неполноту выписок. ' +
    'Переводы между своими счетами не являются расходами, плановые обязательства не добавляй повторно к факту. ' +
    'Если данных достаточно, создай файл moi-finansy-plan.json для загрузки в приложение по responseContract: ' +
    'type=moi-finansy-assistant-plan, version=1, source={snapshotId,month,asOf}, summary, budgets=[{month,income,limit,savingsGoal,categoryLimits,reason}]. ' +
    'Копируй source из responseContract; включай только нужные изменения и существующие id категорий. Если данных недостаточно, объясни, чего не хватает, и не выдумывай суммы.';
}
const api = {createContext, parsePlan, validatePlan, preparePlan, prompt};
root.FinanceAssistant = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
