/* The funds page always uses today's balances, independently of the Overview month. */
'use strict';
function fundsDate(iso) {
  return iso ? iso.split('-').reverse().join('.') : 'дата не указана';
}
function fundsAccountRow(label, detail, amount) {
  return `<div class="funds-row"><div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div><b>${amount === null ? 'Не указан' : money(amount)}</b></div>`;
}
function fundsAdvice(data) {
  const items = [];
  const flex = ['shopping', 'leisure'].filter(id => data.byCategory[id] || data.limits[id]);
  flex.sort((a, b) => (data.byCategory[b] || 0) - (data.byCategory[a] || 0));
  if (flex.length) {
    const id = flex[0], name = getCategory(id).name, spent = data.byCategory[id] || 0, limit = data.limits[id];
    const room = limit ? Math.round((limit - spent) * 100) / 100 : null;
    const text = room === null
      ? `Учтено ${money(spent)}. Если в следующем сопоставимом периоде потратить на 10% меньше, можно сохранить около ${money(Math.round(spent * 10) / 100)}. Проверь, какие траты можно отложить.`
      : room > 0 ? `До конца месяца в лимите остаётся ${money(room)}. Уже потрачено ${money(spent)} из ${money(limit)}.`
      : `Месячный лимит ${money(limit)} исчерпан. Если следующая трата может подождать, перенеси её на следующий месяц.`;
    items.push([name, text, id]);
  }
  const other = data.byCategory['other-expense'] || 0;
  if (other > 0 && other >= data.expense * 0.15)
    items.push(['Разобрать «Прочее»', `${money(other)} расходов собраны в одной категории. Проверь самые крупные записи, чтобы увидеть, какие траты можно отложить.`, 'other-expense']);
  if (!items.length) return '<p class="subtle">Внеси расходы на покупки или досуг. Здесь появятся подсказки по записанным суммам и лимитам.</p>';
  return items.map(([title, text, id]) => `<div class="funds-tip"><strong>${esc(title)}</strong><p>${esc(text)}</p><button type="button" class="text-link" data-action="funds-category" data-id="${esc(id)}">Посмотреть операции →</button></div>`).join('');
}
function renderFunds() {
  const date = today(), month = date.slice(0, 7), data = FinanceInsights.analyze(state, month, date);
  const balances = FinanceFunds.balances(state, date), {card} = balances, reserve = FinanceFunds.reserve(state, date);
  const hasSavings = state.savings.length > 0;
  const coverage = !card || balances.knownCount < balances.accountCount ? 'Сумма известных остатков' : 'Карта и подтверждённые накопления';
  const currentCard = card?.asOf === date;
  const remainder = currentCard && !reserve.missing.length ? (Math.round(card.balance * 100) - Math.round(reserve.amount * 100)) / 100 : null;
  const savingsRows = state.savings.map(s => fundsAccountRow(s.name, s.balanceDate ? 'Сверка ' + fundsDate(s.balanceDate) : 'Дата сверки не указана', s.balanceDate > date ? null : s.balance)).join('');
  const billRows = reserve.bills.map(b => {
    const status = b.auto ? 'Совпало с расходом по дате и сумме' : b.paid ? 'Оплата отмечена' : b.date && b.date < date ? 'Дата прошла · проверь списание' : 'В резерве';
    return `<label class="funds-bill"><input type="checkbox" data-action="funds-check" data-key="${esc(b.key)}" ${b.paid ? 'checked' : ''}><span><strong>${esc(b.name)}</strong><small>${esc(fundsDate(b.date))} · ${esc(status)}</small></span><b>${money(b.amount)}</b></label>`;
  }).join('');
  return heading('Мои средства', 'ОСТАТКИ НА СЧЕТАХ') + `
    <section class="hero funds-hero"><div class="hero-label">Всего средств</div><div class="hero-value">${balances.knownTotal === null ? '—' : money(balances.knownTotal)}</div><div class="hero-foot">${esc(coverage)} · по датам сверки ниже</div></section>
    <section class="setting-card funds-card"><h2>Зарплатная карта</h2>
      ${fundsAccountRow('Остаток на карте', card ? 'По данным банка на ' + fundsDate(card.asOf) : 'Нужна первая сверка с банком', card?.balance ?? null)}
      ${card?.monthExpense !== undefined ? `<p class="subtle">Расходы по этому счёту, по данным банка на ${esc(fundsDate(card.asOf))}: ${money(card.monthExpense)} за месяц.</p>` : ''}
      <div class="funds-actions"><button type="button" class="primary-btn" data-action="funds-edit">${card ? 'Сверить остаток' : 'Указать остаток'}</button><button type="button" class="secondary-btn" data-action="funds-import">Загрузить остаток</button></div></section>
    <section class="setting-card funds-card"><div class="section-header"><h2>Вклады и накопления</h2><button type="button" class="text-link" data-action="view-savings">Открыть →</button></div>
      ${hasSavings ? savingsRows : '<p class="subtle">Вклады пока не добавлены.</p>'}
      ${hasSavings ? fundsAccountRow('Итого по вкладам', `Известны остатки: ${balances.knownCount} из ${balances.accountCount}`, balances.savingsBalance) : ''}</section>
    <section class="setting-card funds-card"><h2>Что оставить на платежи</h2><p class="subtle">По кредитам и активным подпискам за ${esc(monthLabel(month).toLowerCase())}</p>
      ${reserve.bills.length ? fundsAccountRow('Резерв на платежи', 'До конца месяца по внесённым обязательствам', reserve.amount) : '<p class="subtle">Платежей с известной суммой и сроком на этот месяц пока нет.</p>'}
      ${billRows ? `<details class="funds-details"><summary>Платежи и отметки (${reserve.bills.length})</summary><p class="subtle">Отметь уже списанные платежи. Отметка меняет только резерв. Галочку по совпавшей операции можно снять.</p>${billRows}</details>` : ''}
      ${reserve.missing.length ? `<p class="notice warn">Уточни дату или сумму платежа: ${esc(reserve.missing.join(', '))}.</p>` : ''}
      ${remainder !== null && reserve.bills.length ? fundsAccountRow(remainder < 0 ? 'Не хватает на карте' : 'На карте после резерва', 'Если оставшиеся платежи пройдут с этой карты. До бытовых расходов.', Math.abs(remainder)) : ''}
      ${!currentCard ? '<p class="subtle">Сверь остаток карты на сегодня, чтобы рассчитать сумму после платежей.</p>' : ''}</section>
    <section class="setting-card funds-card"><div class="section-header"><h2>Как удержаться в бюджете</h2><button type="button" class="text-link" data-action="funds-budget">Бюджет →</button></div>
      ${fundsAdvice(data)}<p class="subtle">По операциям и лимитам за ${esc(monthLabel(month).toLowerCase())}. Точность зависит от полноты записей.</p></section>`;
}
function openFundsCard(snapshot) {
  const card = snapshot || state.primaryCard;
  const amountInput = (name, label, value, required) => formField(name, label, 'text', value ?? '', '0,00', 'inputmode="decimal" maxlength="22" ' + (required ? 'required' : ''));
  openModal(snapshot ? 'Проверить остаток карты' : 'Сверить зарплатную карту', `<form id="fundsCardForm">
    ${amountInput('balance', 'Остаток зарплатной карты, ₽', card?.balance, true)}
    ${formField('asOf', 'Дата остатка в банке', 'date', snapshot?.asOf || today(), '', `max="${today()}" required`)}
    <details class="funds-details" ${snapshot?.monthExpense !== undefined ? 'open' : ''}><summary>Расходы по данным банка · необязательно</summary>
    ${amountInput('monthExpense', 'Расходы с начала месяца на дату сверки, ₽', snapshot?.monthExpense ?? (card?.asOf === today() ? card?.monthExpense : null), false)}</details>
    <p class="subtle">Сохрани банковский остаток на указанную дату. Вклады появятся отдельной строкой; доходы и расходы месяца считаются по операциям.</p>
    <button class="primary-btn wide" type="submit">Сохранить остаток</button></form>`);
}
function parseFundsAmount(value) {
  const text = String(value ?? '').trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return /^-?\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
}
async function persistFundsField(key, value) {
  const existed = Object.hasOwn(state, key), previous = state[key];
  try { state[key] = value; await saveState(); }
  catch (error) { if (existed) state[key] = previous; else delete state[key]; throw error; }
}
async function saveFundsCard(data) {
  const value = {balance: parseFundsAmount(data.get('balance')), asOf: String(data.get('asOf'))};
  if (String(data.get('monthExpense') || '').trim()) value.monthExpense = parseFundsAmount(data.get('monthExpense'));
  const card = FinanceFunds.checkCard(value, state.primaryCard, today());
  await persistFundsField('primaryCard', card);
  closeModal(); activateTab('funds'); notify('Остаток карты сохранён');
}
async function setFundsCheck(button) {
  const bill = FinanceFunds.reserve(state, today()).bills.find(b => b.key === button.dataset.key);
  if (!bill) return;
  const checks = {...state.fundsChecks};
  if (bill.matched === button.checked) delete checks[bill.key]; else checks[bill.key] = button.checked;
  await persistFundsField('fundsChecks', checks);
  render();
  const list = $('#app .funds-details');
  if (list) {
    list.open = true;
    Array.from(list.querySelectorAll('input')).find(input => input.dataset.key === bill.key)?.focus({preventScroll: true});
  }
}
