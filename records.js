/* Import explicit bank observations without changing transactions or budget plans. */
(function (root) {
'use strict';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = value => JSON.parse(JSON.stringify(value));
const blocked = new Set(['__proto__', 'constructor', 'prototype']);
const detailFields = {
  debt: {money: ['totalDebt', 'accruedInterest', 'nextPrincipal', 'nextInterest'], dates: ['nextPaymentDate']},
  saving: {money: ['earnedInterest', 'expectedInterest', 'bonusSpendRemaining', 'bonusSpendTarget'], dates: ['interestPaymentDate', 'bonusStartDate']}
};
function isObject(value) {return value && typeof value === 'object' && !Array.isArray(value);}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function money(value, max = 1e10) {return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;}
function checkKeys(value, allowed, label) {
  if (!isObject(value) || Object.keys(value).some(key => blocked.has(key) || !allowed.includes(key))) throw new Error('Неверные поля: ' + label);
}
function string(value, maximum, label, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error('Проверь поле: ' + label);
  return value.trim();
}
function cleanDetails(input, kind) {
  if (!isObject(input) || !date(input.asOf) || !detailFields[kind]) return null;
  const schema = detailFields[kind], out = {asOf: input.asOf};
  if (['upload', 'document'].includes(input.dateBasis)) out.dateBasis = input.dateBasis;
  for (const key of schema.money) if (money(input[key])) out[key] = input[key];
  for (const key of schema.dates) if (date(input[key])) out[key] = input[key];
  if (kind === 'saving' && money(input.bonusRatePoints, 100)) out.bonusRatePoints = input.bonusRatePoints;
  return out;
}
function validDetails(input, kind, record, asOf) {
  const schema = detailFields[kind];
  checkKeys(input, ['asOf', 'dateBasis', ...schema.money, ...schema.dates, ...(kind === 'saving' ? ['bonusRatePoints'] : [])], 'данные банка');
  if (input.asOf !== asOf || !date(input.asOf) || (own(input, 'dateBasis') && !['upload', 'document'].includes(input.dateBasis))) throw new Error('Проверь дату данных банка.');
  for (const key of schema.money) if (own(input, key) && !money(input[key])) throw new Error('Проверь сумму: ' + key);
  for (const key of schema.dates) if (own(input, key) && (!date(input[key]) || input[key] < asOf)) throw new Error('Проверь дату: ' + key);
  if (own(input, 'bonusRatePoints') && !money(input.bonusRatePoints, 100)) throw new Error('Проверь надбавку к ставке.');
  if (kind === 'debt') {
    if (own(input, 'totalDebt') && own(input, 'accruedInterest') && Math.round(input.totalDebt * 100) !== Math.round(record.balance * 100) + Math.round(input.accruedInterest * 100)) throw new Error('Общий долг не совпадает с основным долгом и начисленными процентами.');
    if (own(input, 'nextPrincipal') && own(input, 'nextInterest') && Math.round(record.payment * 100) !== Math.round(input.nextPrincipal * 100) + Math.round(input.nextInterest * 100)) throw new Error('Состав ближайшего платежа не совпадает с его суммой.');
  }
  if (kind === 'saving' && own(input, 'bonusSpendRemaining') && own(input, 'bonusSpendTarget') && input.bonusSpendRemaining > input.bonusSpendTarget) throw new Error('Остаток покупок больше цели условия.');
  return cleanDetails(input, kind);
}
function validate(input, asOf) {
  checkKeys(input, ['type', 'version', 'asOf', 'note', 'debts', 'savings'], 'файл записей');
  if (input.type !== 'moi-finansy-bank-records' || input.version !== 1) throw new Error('Нужен файл записей кредита или накоплений.');
  if (!date(asOf) || !date(input.asOf) || input.asOf > asOf) throw new Error('Проверь дату файла записей.');
  if (!Array.isArray(input.debts) || !Array.isArray(input.savings) || input.debts.length > 10 || input.savings.length > 10 || !input.debts.length && !input.savings.length) throw new Error('В файле должно быть от 1 до 20 записей.');
  const seen = new Set();
  function record(item, kind) {
    const isDebt = kind === 'debt';
    const common = ['id', 'name', 'kind', 'balance', 'rate', 'balanceDate', 'notes', 'bankDetails'];
    checkKeys(item, [...common, ...(isDebt ? ['lender', 'payment', 'dueDay'] : ['bank', 'maturity'])], 'запись');
    const id = string(item.id, 100, 'идентификатор');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,99}$/.test(id) || seen.has(id)) throw new Error('Неверный или повторный идентификатор записи.');
    seen.add(id);
    if (!money(item.balance) || !money(item.rate, isDebt ? 1000 : 100)) throw new Error('Проверь остаток и ставку.');
    if (item.balanceDate !== input.asOf) throw new Error('Дата проверки остатка должна совпадать с датой файла.');
    const out = {id, name: string(item.name, 100, 'название'), kind: item.kind, balance: item.balance, rate: item.rate, balanceDate: item.balanceDate, source: 'screenshot'};
    if (isDebt) {
      if (!['loan', 'mortgage', 'creditcard', 'other'].includes(item.kind) || !money(item.payment) || !Number.isInteger(item.dueDay) || item.dueDay < 0 || item.dueDay > 31) throw new Error('Проверь вид кредита, платёж и день оплаты.');
      Object.assign(out, {lender: string(item.lender, 100, 'банк', true), payment: item.payment, dueDay: item.dueDay, rateKnown: true, balanceIsProjected: false});
    } else {
      if (!['deposit', 'savings', 'kopilka'].includes(item.kind)) throw new Error('Неизвестный тип накоплений.');
      out.bank = string(item.bank, 100, 'банк', true);
      if (own(item, 'maturity')) {if (item.maturity !== '' && !date(item.maturity)) throw new Error('Проверь окончание срока вклада.'); out.maturity = item.maturity;}
    }
    if (own(item, 'notes')) out.notes = string(item.notes, isDebt ? 350 : 200, 'заметки', true);
    if (own(item, 'bankDetails')) out.bankDetails = validDetails(item.bankDetails, kind, item, input.asOf);
    return out;
  }
  return {type: input.type, version: 1, asOf: input.asOf, note: own(input, 'note') ? string(input.note, 600, 'описание', true) : '',
    debts: input.debts.map(item => record(item, 'debt')), savings: input.savings.map(item => record(item, 'saving'))};
}
function suggestedTarget(item, list) {
  const byId = list.find(old => old.id === item.id); if (byId) return byId.id;
  const bank = value => String(value || '').toLowerCase().replace(/\s+/g, '').replace(/сбербанк/g, 'сбер');
  const matches = list.filter(old => old.kind === item.kind && String(old.name).trim().toLowerCase() === item.name.toLowerCase() && bank(old.bank || old.lender) === bank(item.bank || item.lender));
  if (matches.length === 1) return matches[0].id;
  return list.length ? '' : 'new';
}
function merge(payload, inputState, targets, asOf) {
  const validated = validate(payload, asOf), state = clone(inputState), changes = [], used = new Set();
  for (const [collection, kind, maximum] of [['debts', 'debt', 100], ['savings', 'saving', 50]]) {
    state[collection] = state[collection] || [];
    for (const incoming of validated[collection]) {
      const key = collection + ':' + incoming.id;
      const target = targets?.[key];
      if (!target) throw new Error('Выбери новую или существующую запись для каждого пункта.');
      if (used.has(collection + ':' + target) && target !== 'new') throw new Error('Две записи нельзя записать в один и тот же пункт.');
      used.add(collection + ':' + target);
      const existing = target === 'new' ? null : state[collection].find(old => old.id === target);
      if (target !== 'new' && !existing) throw new Error('Выбранная запись уже не существует. Загрузи файл ещё раз.');
      if (!existing && state[collection].some(old => old.id === incoming.id)) throw new Error('Эта запись уже есть. Выбери её для обновления.');
      if (existing?.balanceDate && existing.balanceDate > incoming.balanceDate) throw new Error('В программе уже есть более свежий остаток. Старый снимок не заменит его.');
      const updated = {...(existing || (kind === 'debt' ? {contractTail: '', schedule: []} : {maturity: '', notes: ''})), ...incoming, id: existing?.id || incoming.id};
      if (existing) Object.assign(existing, updated);
      else {if (state[collection].length >= maximum) throw new Error('Достигнут предел количества записей.'); state[collection].push(updated);}
      changes.push({collection, name: incoming.name, action: existing ? 'update' : 'add'});
    }
  }
  return {debts: state.debts, savings: state.savings, changes};
}
root.FinanceRecords = {cleanDetails, validate, suggestedTarget, merge};
if (typeof module !== 'undefined' && module.exports) module.exports = root.FinanceRecords;
})(typeof globalThis !== 'undefined' ? globalThis : this);
