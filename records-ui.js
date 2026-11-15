'use strict';
let bankRecordsDraft = null;
let bankRecordsBusy = false;
function bankNextPayment(record) {
  const d = record.bankDetails;
  if (!d || d.asOf !== record.balanceDate || !d.nextPaymentDate || d.nextPaymentDate < today() || d.nextPrincipal === undefined || d.nextInterest === undefined || Math.round(d.nextPrincipal * 100) + Math.round(d.nextInterest * 100) !== Math.round(record.payment * 100)) return null;
  return {date: d.nextPaymentDate, principal: d.nextPrincipal, interest: d.nextInterest, payment: record.payment};
}
function bankRecordRows(record, kind) {
  const detail = record.bankDetails;
  const lines = kind === 'debt'
    ? [['Основной долг', money(record.balance)], ['Ставка', record.rate + '% годовых'], ['Ближайший платёж', money(record.payment) + (detail?.nextPaymentDate ? ' · ' + detail.nextPaymentDate : '')]]
    : [['Фактический остаток', money(record.balance)], ['Ставка', record.rate + '% годовых']];
  if (detail) {
    const amounts = kind === 'debt' ? [['totalDebt', 'Всего задолженность на дату снимка'], ['accruedInterest', 'Начисленные проценты'], ['nextPrincipal', 'В ближайшем платеже: основной долг'], ['nextInterest', 'В ближайшем платеже: проценты']]
      : [['earnedInterest', 'Уже заработано по данным банка'], ['expectedInterest', 'Ожидаемые проценты, оценка банка']];
    for (const [key, label] of amounts) if (detail[key] !== undefined) lines.push([label, money(detail[key])]);
    if (detail.interestPaymentDate) lines.push(['Дата ожидаемой выплаты', detail.interestPaymentDate]);
    if (detail.bonusRatePoints !== undefined) lines.push(['Условная надбавка', '+' + detail.bonusRatePoints + ' п.п.' + (detail.bonusStartDate ? ' с ' + detail.bonusStartDate : '')]);
    if (detail.bonusSpendRemaining !== undefined) lines.push(['Для надбавки: ещё покупок по условию банка', money(detail.bonusSpendRemaining)]);
    if (detail.bonusSpendTarget !== undefined) lines.push(['Порог покупок по условию банка', money(detail.bonusSpendTarget)]);
  }
  return lines.map(([label, value]) => `<div class="bank-record-line"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}
function renderBankObservation(record, kind) {
  if (!record.bankDetails) return '';
  return `<details class="bank-observation"><summary>Данные из банка · ${esc(record.bankDetails.asOf)}</summary>${bankRecordRows(record, kind)}<p class="subtle">${record.bankDetails.dateBasis === 'upload' ? 'Дата фиксации и год дат определены по загрузке скриншота. ' : ''}${kind === 'debt' ? 'Это снимок задолженности; будущие остатки не пересчитываются автоматически.' : 'Ожидаемые проценты и условная надбавка не прибавлены к остатку или доходам.'}</p></details>`;
}
async function previewBankRecords(raw) {
  const input = FinanceAssistant.parsePlan(raw);
  const payload = FinanceRecords.validate(input, today());
  bankRecordsDraft = {payload: input, baseState: JSON.stringify(state)};
  const cards = [];
  for (const [collection, kind, label] of [['debts', 'debt', 'Кредит'], ['savings', 'saving', 'Накопления']]) {
    payload[collection].forEach((record, index) => {
      const list = state[collection], selected = FinanceRecords.suggestedTarget(record, list);
      const options = [['', 'Выбери действие'], ['new', 'Добавить как новую запись'], ...list.map(old => [old.id, 'Обновить: ' + old.name + ' · ' + (old.balance === null ? 'остаток неизвестен' : money(old.balance))])];
      cards.push(`<section class="setting-card"><h3>${esc(label)} · ${esc(record.name)}</h3>${bankRecordRows(record, kind)}<div class="field small-top"><label for="bank-target-${collection}-${index}">Куда сохранить</label><select id="bank-target-${collection}-${index}" data-bank-collection="${collection}" data-bank-id="${esc(record.id)}">${options.map(([value, title]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></div></section>`);
    });
  }
  openModal('Кредит и накопления из файла', `<div class="notice">Данные на ${esc(payload.asOf)}. ${esc(payload.note)} Сравни суммы и выбери, добавить запись или обновить существующую.</div><div class="stack small-top">${cards.join('')}</div><p class="subtle">Это сведения об остатках и условиях, а не новые расходы или доходы. Остальные записи и бюджеты сохраняются.</p><div class="form-actions"><button class="secondary-btn" type="button" data-action="bank-records-cancel">Отмена</button><button class="primary-btn" type="button" data-action="bank-records-apply">Сохранить записи</button></div>`);
}
async function applyBankRecords(targets) {
  if (!bankRecordsDraft) throw new Error('Сначала загрузи файл записей.');
  if (JSON.stringify(state) !== bankRecordsDraft.baseState) throw new Error('Данные изменились после просмотра. Загрузи файл ещё раз.');
  const merged = FinanceRecords.merge(bankRecordsDraft.payload, state, targets, today());
  const previous = {debts: state.debts, savings: state.savings};
  try {state.debts = merged.debts; state.savings = merged.savings; await saveState();}
  catch (error) {Object.assign(state, previous); throw error;}
  bankRecordsDraft = null;
  closeModal(); activateTab(merged.changes.some(change => change.collection === 'debts') ? 'debts' : 'savings');
  notify('Сохранено записей: ' + merged.changes.length);
}
async function handleBankRecordsAction(action) {
  if (bankRecordsBusy) return;
  bankRecordsBusy = true;
  try {
    if (action === 'bank-records-import') $('#bankRecordsFile').click();
    else if (action === 'bank-records-cancel') {bankRecordsDraft = null; closeModal();}
    else if (action === 'bank-records-apply') {
      const targets = Object.fromEntries($$('[data-bank-collection]').map(select => [select.dataset.bankCollection + ':' + select.dataset.bankId, select.value]));
      await applyBankRecords(targets);
    }
  } catch (error) {notify(error.message || 'Не удалось сохранить записи.');}
  finally {bankRecordsBusy = false;}
}
