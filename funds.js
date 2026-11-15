/* Confirmed account balances and the current month's payment reserve. */
(function (root) {
'use strict';
const I = root.FinanceInsights || (typeof require === 'function' ? require('./insights.js') : null);
const cents = n => Math.round(n * 100);
const rubles = n => n / 100;
const validMoney = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9 && Math.abs(n - rubles(cents(n))) < 1e-8;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
  const day = Number(value.slice(8));
  return day > 0 && day <= I.days(value.slice(0, 7));
}
function cardSnapshot(value) {
  if (!value || !validDate(value.asOf) || !validMoney(value.balance)) return null;
  const card = {asOf: value.asOf, balance: value.balance};
  if (value.monthExpense !== undefined) {
    if (!validMoney(value.monthExpense) || value.monthExpense < 0) return null;
    card.monthExpense = value.monthExpense;
  }
  return card;
}
function checkCard(value, previous, today) {
  const card = cardSnapshot(value);
  if (!card || card.asOf > today) throw Error('Проверь сумму и дату сверки. Дата должна быть не позже сегодняшней.');
  if (previous && previous.asOf > card.asOf) throw Error('На карте уже сохранён более свежий остаток.');
  return card;
}
function readFile(input, previous, today) {
  const keys = ['type', 'version', 'asOf', 'balance', 'monthExpense'];
  if (input?.type !== 'moi-finansy-card-balance' || input.version !== 1 || Object.keys(input).some(k => !keys.includes(k))) {
    throw Error('Нужен файл остатка зарплатной карты для «Моих Финансов».');
  }
  return checkCard(input, previous, today);
}
function balances(state, asOf) {
  const saved = cardSnapshot(state.primaryCard);
  const card = saved && saved.asOf <= asOf ? saved : null;
  const savings = state.savings || [];
  const known = savings.filter(s => validMoney(s.balance) && s.balance >= 0 && (!s.balanceDate || s.balanceDate <= asOf));
  const sum = known.reduce((n, s) => n + cents(s.balance), 0);
  return {card, savingsBalance: known.length ? rubles(sum) : null, knownCount: known.length, accountCount: savings.length,
    knownTotal: card || known.length ? rubles(sum + (card ? cents(card.balance) : 0)) : null};
}
function dateInMonth(month, day) {
  return month + '-' + String(Math.min(day, I.days(month))).padStart(2, '0');
}
function subscriptionDates(sub, month) {
  const anchor = sub.nextDate;
  if (!validDate(anchor)) return null;
  if (anchor.slice(0, 7) > month) return [];
  if (sub.cycle === 'weekly') {
    const dayMs = 86400000, start = Date.parse(month + '-01'), base = Date.parse(anchor);
    const first = base + Math.max(0, Math.ceil((start - base) / (7 * dayMs))) * 7 * dayMs;
    const dates = [];
    for (let t = first; t < start + I.days(month) * dayMs; t += 7 * dayMs) dates.push(new Date(t).toISOString().slice(0, 10));
    return dates;
  }
  const step = {monthly: 1, quarterly: 3, yearly: 12}[sub.cycle];
  if (!step) return null;
  const index = iso => 12 * Number(iso.slice(0, 4)) + Number(iso.slice(5, 7));
  return (index(month) - index(anchor)) % step === 0 ? [dateInMonth(month, Number(anchor.slice(8)))] : [];
}
function monthBills(state, month) {
  const bills = [], missing = [];
  function add(category, record, date, amount) {
    if (!validMoney(amount) || amount <= 0) { missing.push(record.name); return; }
    bills.push({key: JSON.stringify([category, record.id, month, date, cents(amount)]), category, name: record.name, date, amount});
  }
  for (const debt of state.debts || []) {
    if (!(debt.balance > 0)) continue;
    const bankDate = debt.bankDetails?.nextPaymentDate;
    const rows = (debt.schedule || []).filter(r => validDate(r.date) && r.date.startsWith(month));
    if (validDate(bankDate) && bankDate.startsWith(month)) {
      add('credit', debt, bankDate, debt.payment);
      for (const row of rows.filter(r => r.date !== bankDate)) add('credit', debt, row.date, row.payment);
    } else if (rows.length) {
      for (const row of rows) add('credit', debt, row.date, row.payment);
    } else if (validDate(bankDate) && bankDate.slice(0, 7) > month) {
      continue;
    } else if (debt.schedule?.length) {
      // A historical schedule can end while the last confirmed principal is still positive.
      if (debt.schedule.every(row => row.date.slice(0, 7) < month)) missing.push(debt.name);
      continue;
    } else {
      const day = Number(debt.dueDay);
      add('credit', debt, Number.isInteger(day) && day >= 1 && day <= 31 ? dateInMonth(month, day) : '', debt.payment);
    }
  }
  for (const sub of state.subscriptions || []) {
    if (sub.status !== 'active') continue;
    const dates = subscriptionDates(sub, month);
    if (!dates) { missing.push(sub.name); continue; }
    for (const date of dates) add('subscriptions', sub, date, sub.amount);
  }
  return {bills: bills.sort((a, b) => (a.date || 'z').localeCompare(b.date || 'z')), missing};
}
function reserve(state, asOf) {
  const month = asOf.slice(0, 7), {bills, missing} = monthBills(state, month);
  const key = (cat, date, amount) => cat + '/' + date + '/' + cents(amount);
  const entries = new Map(), scheduled = new Map();
  for (const tx of state.transactions || []) {
    if (tx.type !== 'expense' || !['credit', 'subscriptions'].includes(tx.category) || !tx.date.startsWith(month) || tx.date > asOf) continue;
    const k = key(tx.category, tx.date, tx.amount);
    entries.set(k, (entries.get(k) || 0) + 1);
  }
  for (const b of bills) {
    const k = key(b.category, b.date, b.amount);
    scheduled.set(k, (scheduled.get(k) || 0) + 1);
  }
  let reserved = 0;
  for (const b of bills) {
    const k = key(b.category, b.date, b.amount);
    b.matched = scheduled.get(k) === 1 && entries.get(k) === 1;
    const choice = state.fundsChecks?.[b.key];
    b.paid = typeof choice === 'boolean' ? choice : b.matched;
    b.auto = b.matched && typeof choice !== 'boolean';
    if (!b.paid) reserved += cents(b.amount);
  }
  return {bills, missing, amount: rubles(reserved)};
}
const api = {cardSnapshot, checkCard, readFile, balances, reserve, validDate};
root.FinanceFunds = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
