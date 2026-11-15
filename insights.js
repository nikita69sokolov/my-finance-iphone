/* Мои Финансы v1.5 — local analytics. No network, private data or dependencies. */
(function (root) {
'use strict';
const FLEXIBLE = new Set(['shopping', 'leisure', 'transport', 'services']);
const FIXED = new Set(['credit', 'subscriptions', 'home']);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = list => round(list.reduce((total, n) => total + n, 0));
const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;
function shift(month, offset) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function days(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}
function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const month = value.slice(0, 7), day = Number(value.slice(8));
  return PERIOD.test(month) && day > 0 && day <= days(month);
}
function cleanLimits(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([key, value]) =>
    !['__proto__', 'prototype', 'constructor'].includes(key) && positive(value)
  ).map(([key, value]) => [key, round(Number(value))]));
}
function limitsFor(state, month) {
  const own = Object.prototype.hasOwnProperty.call(state.budgetMonths || {}, month);
  const source = own ? state.budgetMonths[month] : state.budgets;
  const categories = new Set((state.categories || []).filter(c => c.kind === 'expense').map(c => c.id));
  return Object.fromEntries(Object.entries(cleanLimits(source)).filter(([id]) => categories.has(id)));
}
function normalizePlanning(input) {
  const budgetMonths = {}, budgetPlans = {};
  for (const [month, limits] of Object.entries(input.budgetMonths || {})) {
    if (PERIOD.test(month) && limits && typeof limits === 'object' && !Array.isArray(limits)) budgetMonths[month] = cleanLimits(limits);
  }
  for (const [month, plan] of Object.entries(input.budgetPlans || {})) {
    if (!PERIOD.test(month) || !plan || typeof plan !== 'object') continue;
    const optional = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0 ? round(Number(value)) : null;
    budgetPlans[month] = {income: optional(plan.income), limit: positive(plan.limit) ? round(Number(plan.limit)) : null, savingsGoal: optional(plan.savingsGoal) ?? 0};
  }
  return {budgetMonths, budgetPlans};
}
function monthlySubscription(subscription) {
  return round(Number(subscription.amount || 0) * ({weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12}[subscription.cycle] || 1));
}
function analyze(state, month, asOf) {
  if (!PERIOD.test(month) || !isDate(asOf)) throw new Error('Некорректный период анализа');
  const currentMonth = asOf.slice(0, 7), isCurrent = month === currentMonth, isFuture = month > currentMonth;
  const dayCount = days(month), elapsed = isFuture ? 0 : isCurrent ? Number(asOf.slice(8)) : dayCount;
  const all = (state.transactions || []).filter(t => t && isDate(t.date) && t.date <= asOf && ['expense', 'income'].includes(t.type) && positive(t.amount));
  const records = all.filter(t => t.date.startsWith(month));
  const expenses = records.filter(t => t.type === 'expense'), incomes = records.filter(t => t.type === 'income');
  const expense = sum(expenses.map(t => Number(t.amount))), income = sum(incomes.map(t => Number(t.amount)));
  const totals = list => {
    const grouped = new Map();
    for (const t of list) grouped.set(t.category, round((grouped.get(t.category) || 0) + Number(t.amount)));
    return Object.fromEntries(grouped);
  };
  const byCategory = totals(expenses), limits = limitsFor(state, month);
  const plan = normalizePlanning(state).budgetPlans[month] || {income: null, limit: null, savingsGoal: 0};
  const categoryLimit = sum(Object.values(limits)), totalLimit = plan.limit ?? categoryLimit;
  const remaining = totalLimit > 0 ? round(totalLimit - expense) : null;
  const daysLeft = isCurrent ? dayCount - elapsed + 1 : 0;
  const expenseDays = new Set(expenses.map(t => t.date)).size;
  const canForecast = isCurrent && elapsed >= 7 && expenseDays >= 3;
  const forecastByCategory = Object.fromEntries(Object.entries(byCategory).map(([id, value]) =>
    [id, round(FIXED.has(id) || !canForecast ? value : value / elapsed * dayCount)]));
  const forecast = isFuture ? null : !isCurrent ? expense : canForecast ? sum(Object.values(forecastByCategory)) : null;
  const previousMonth = shift(month, -1), comparisonDay = isCurrent ? Math.min(elapsed, days(previousMonth)) : days(previousMonth);
  const previousRecords = all.filter(t => t.date.startsWith(previousMonth) && Number(t.date.slice(8)) <= comparisonDay);
  const previousExpenses = previousRecords.filter(t => t.type === 'expense');
  const previousExpense = sum(previousExpenses.map(t => Number(t.amount))), previousByCategory = totals(previousExpenses);
  const hasComparison = !isFuture && expenses.length > 0 && previousExpenses.length > 0;
  const change = hasComparison && previousExpense > 0 ? round((expense / previousExpense - 1) * 100) : null;
  const months = Array.from({length: 6}, (_, index) => {
    const period = shift(month, index - 5), list = all.filter(t => t.date.startsWith(period));
    return {month: period, income: sum(list.filter(t => t.type === 'income').map(t => Number(t.amount))), expense: sum(list.filter(t => t.type === 'expense').map(t => Number(t.amount))), count: list.length};
  });
  const daily = []; let running = 0, previousRunning = 0;
  const dailyExpenses = new Map(), previousDaily = new Map();
  for (const t of expenses) {const day = Number(t.date.slice(8)); dailyExpenses.set(day, round((dailyExpenses.get(day) || 0) + Number(t.amount)));}
  for (const t of previousExpenses) {const day = Number(t.date.slice(8)); previousDaily.set(day, round((previousDaily.get(day) || 0) + Number(t.amount)));}
  for (let day = 1; day <= dayCount; day++) {
    running = round(running + (dailyExpenses.get(day) || 0));
    previousRunning = round(previousRunning + (previousDaily.get(day) || 0));
    daily.push({day, amount: day <= elapsed ? dailyExpenses.get(day) || 0 : null, actual: day <= elapsed ? running : null,
      previous: hasComparison && day <= comparisonDay ? previousRunning : null, plan: totalLimit > 0 ? round(totalLimit * day / dayCount) : null});
  }
  // Use at most three prior months with recorded data; missing months are never treated as zero spending.
  const historyMonths = [...new Set(all.map(t => t.date.slice(0, 7)).filter(m => m < month && m < currentMonth))].sort().reverse().slice(0, 3);
  const historyTotals = historyMonths.map(period => totals(all.filter(t => t.date.startsWith(period) && t.type === 'expense')));
  const proposalBase = historyTotals.length ? historyTotals : canForecast ? [forecastByCategory] : !isCurrent && !isFuture && expenses.length ? [byCategory] : [];
  const proposalSource = historyTotals.length ? 'history' : canForecast ? 'forecast' : 'selected';
  const proposalIds = [...new Set(proposalBase.flatMap(map => Object.keys(map)))];
  const proposals = proposalIds.filter(id => (state.categories || []).some(c => c.id === id && c.kind === 'expense')).map(id => {
    const average = sum(proposalBase.map(map => map[id] || 0)) / proposalBase.length;
    return {id, limit: Math.max(100, Math.ceil(average / 100) * 100), base: round(average), existing: limits[id] || null, source: proposalSource};
  }).filter(p => p.base > 0).sort((a, b) => b.limit - a.limit);
  const categoryRows = Object.keys(limits).map(id => {
    const spent = byCategory[id] || 0, limit = limits[id];
    return {id, spent, limit, remaining: round(limit - spent), forecast: canForecast ? forecastByCategory[id] || 0 : null, percent: round(spent / limit * 100)};
  }).sort((a, b) => b.percent - a.percent);
  const unbudgeted = Object.entries(byCategory).filter(([id]) => !limits[id]).map(([id, amount]) => ({id, amount})).sort((a, b) => b.amount - a.amount);
  const subscriptions = (state.subscriptions || []).filter(s => s.status === 'active' && positive(s.amount));
  const subscriptionTotal = sum(subscriptions.map(monthlySubscription));
  const debtTotal = sum((state.debts || []).filter(d => positive(d.balance)).map(d => Math.max(0, Number(d.payment) || 0)));
  const categoryName = id => (state.categories || []).find(c => c.id === id)?.name || 'Без категории';
  const recommendations = [];
  for (const row of categoryRows.filter(r => r.spent > r.limit).slice(0, 3)) {
    recommendations.push({kind: 'over', tone: 'danger', title: `Превышен лимит: ${categoryName(row.id)}`, amount: round(row.spent - row.limit),
      text: 'Столько потрачено сверх лимита. Сверь операции с планом. Если расходы обязательные, пересмотри лимит и другие категории.', action: 'category', category: row.id, label: 'Посмотреть расходы'});
  }
  if (canForecast && totalLimit > 0 && forecast > totalLimit && expense <= totalLimit) recommendations.push({kind: 'forecast', tone: 'warn', title: 'Текущий темп выше плана', amount: round(forecast - totalLimit), text: 'Возможное превышение к концу месяца, если темп переменных расходов сохранится. Проверь крупные категории.', action: 'daily', label: 'Посмотреть график'});
  if (plan.income !== null && totalLimit > plan.income - plan.savingsGoal) recommendations.push({kind: 'plan', tone: 'warn', title: 'План не оставляет сумму на цель', amount: round(totalLimit + plan.savingsGoal - plan.income), text: 'На столько расходы и цель накоплений вместе превышают доход, указанный в плане.', action: 'plan', label: 'Изменить план'});
  if (unbudgeted.length) recommendations.push({kind: 'unbudgeted', tone: 'info', title: 'Расходы без лимитов', amount: sum(unbudgeted.map(c => c.amount)), text: `Категорий без лимита: ${unbudgeted.length}. Эти расходы уже включены в общий факт. Можно заполнить лимиты по истории.`, action: 'autoplan', label: 'Предложить лимиты'});
  const flexibleBase = canForecast ? forecastByCategory : !isCurrent && !isFuture ? byCategory : null;
  const savingScenarios = flexibleBase ? Object.entries(flexibleBase).filter(([id, amount]) => FLEXIBLE.has(id) && amount >= 1000).map(([id, amount]) => ({id, base: amount, saving: round(amount * 0.1), target: round(amount * 0.9)})).sort((a, b) => b.saving - a.saving) : [];
  for (const scenario of savingScenarios.slice(0, 2)) recommendations.push({kind: 'saving', tone: 'good', title: `${categoryName(scenario.id)}: сценарий −10%`, amount: scenario.saving,
    text: `Возможная экономия за месяц относительно ${canForecast ? 'оценки текущего темпа' : 'зафиксированных расходов'}. Предложение для следующего месяца; решение о покупках остаётся за тобой.`,
    action: 'proposal', category: scenario.id, target: scenario.target, targetMonth: shift(month, 1), label: 'Проверить лимит на следующий месяц'});
  if (hasComparison) {
    const increases = Object.entries(byCategory).filter(([id, value]) => FLEXIBLE.has(id) && previousByCategory[id] > 0 && value - previousByCategory[id] >= 1000 && value > previousByCategory[id] * 1.2).sort((a, b) => (b[1] - previousByCategory[b[0]]) - (a[1] - previousByCategory[a[0]]));
    if (increases.length) {const [id, value] = increases[0]; recommendations.push({kind: 'growth', tone: 'info', title: `Выросли расходы: ${categoryName(id)}`, amount: round(value - previousByCategory[id]), text: `Рост к ${isCurrent ? 'тем же датам' : 'полному месяцу'} предыдущего месяца. Проверь, какие покупки дали разницу.`, action: 'category', category: id, label: 'Посмотреть операции'});}
  }
  if (subscriptionTotal > 0 && !isFuture) recommendations.push({kind: 'subscriptions', tone: 'info', title: 'Проверь регулярные подписки', amount: subscriptionTotal, text: `В месяц по активному списку (${subscriptions.length}). Открой список и проверь, какими сервисами пользуешься. Это план, он не прибавляется к фактическим расходам.`, action: 'subscriptions', label: 'Проверить подписки'});
  if ((byCategory['other-expense'] || 0) > 0 && byCategory['other-expense'] >= expense * 0.15) recommendations.push({kind: 'classification', tone: 'info', title: 'Уточни категорию «Прочее»', amount: byCategory['other-expense'], text: 'Значительная часть расходов не распределена. Уточнение категорий сделает план и рекомендации полезнее.', action: 'category', category: 'other-expense', label: 'Разобрать операции'});
  return {month, asOf, isCurrent, isFuture, elapsed, dayCount, daysLeft, records: records.length, expenseDays, expense, income,
    byCategory, limits, plan, totalLimit, categoryLimit, remaining, dailyAllowance: remaining !== null && daysLeft ? round(Math.max(0, remaining) / daysLeft) : null,
    canForecast, forecast, previousMonth, previousExpense, comparisonDay, hasComparison, change, months, daily, historyMonths,
    proposals, categoryRows, unbudgeted, unbudgetedTotal: sum(unbudgeted.map(c => c.amount)), recommendations, subscriptionTotal, debtTotal,
    scenarioSaving: sum(savingScenarios.map(s => s.saving))};
}
const api = {analyze, limitsFor, normalizePlanning, cleanLimits, monthlySubscription, shift, days};
root.FinanceInsights = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
