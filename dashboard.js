/* Мои Финансы v1.5 — charts, monthly planning and reviewable suggestions. */
'use strict';
let dashboardChart = 'months';
function financeAnalysis(month = activeMonth) { return FinanceInsights.analyze(state, month, today()); }
function chartMoney(value) { return value >= 1000000 ? `${(value / 1000000).toLocaleString('ru-RU', {maximumFractionDigits: 1})} млн` : value >= 1000 ? `${(value / 1000).toLocaleString('ru-RU', {maximumFractionDigits: 1})} тыс.` : fmtShort.format(value); }
function chartGrid(max, x = 70, width = 484, top = 20, height = 160) {
  return [0, 0.5, 1].map(part => `<line class="chart-grid" x1="${x}" y1="${top + height * (1 - part)}" x2="${x + width}" y2="${top + height * (1 - part)}"/><text class="chart-axis" x="${x - 7}" y="${top + height * (1 - part) + 4}" text-anchor="end">${esc(chartMoney(max * part))}</text>`).join('');
}
function monthChart(data) {
  const max = Math.max(1, ...data.months.flatMap(m => [m.income, m.expense]));
  const monthName = month => new Date(`${month}-02T12:00:00`).toLocaleDateString('ru-RU', {month: 'short'}).replace('.', '');
  const bars = data.months.map((m, index) => {
    const x = 82 + index * 82, inHeight = m.income / max * 160, outHeight = m.expense / max * 160;
    return `<g><rect class="chart-income" x="${x}" y="${180 - inHeight}" width="24" height="${inHeight}" rx="5"/><rect class="chart-expense" x="${x + 28}" y="${180 - outHeight}" width="24" height="${outHeight}" rx="5"/>${!m.count ? `<text class="chart-axis" x="${x + 26}" y="170" text-anchor="middle">—</text>` : ''}<text class="chart-axis ${m.month === data.month ? 'chart-current' : ''}" x="${x + 26}" y="204" text-anchor="middle">${esc(monthName(m.month))}</text></g>`;
  }).join('');
  return `<svg class="finance-chart" viewBox="0 0 570 220" role="img" aria-label="Доходы и расходы по месяцам. Точные суммы доступны в таблице ниже.">${chartGrid(max)}${bars}</svg><div class="chart-key"><span><i class="dot income-dot"></i>Доходы</span><span><i class="dot expense-dot"></i>Расходы</span></div>
    <details class="chart-details"><summary>Суммы по месяцам</summary><div class="table-scroll"><table><caption class="sr-only">Доходы и расходы за шесть месяцев</caption><thead><tr><th scope="col">Месяц</th><th scope="col">Доходы</th><th scope="col">Расходы</th></tr></thead><tbody>${data.months.map(m => `<tr><th scope="row">${esc(monthLabel(m.month))}</th><td>${m.count ? money(m.income) : 'Нет данных'}</td><td>${m.count ? money(m.expense) : 'Нет данных'}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function dailyChart(data) {
  const max = Math.max(1, ...data.daily.flatMap(d => [d.actual || 0, d.previous || 0, d.plan || 0]));
  const x = day => 70 + (day - 1) / Math.max(1, data.dayCount - 1) * 484;
  const y = amount => 180 - amount / max * 160;
  const points = key => data.daily.filter(d => d[key] !== null).map(d => `${x(d.day).toFixed(2)},${y(d[key]).toFixed(2)}`).join(' ');
  const path = (key, cls) => points(key) ? `<polyline class="${cls}" points="${points(key)}"/>` : '';
  const last = data.daily.filter(d => d.actual !== null).at(-1);
  return `<svg class="finance-chart" viewBox="0 0 570 220" role="img" aria-label="Накопленные расходы по дням: текущий месяц, прошлый месяц и равномерный ориентир лимита.">${chartGrid(max)}${path('plan', 'chart-plan-line')}${path('previous', 'chart-previous-line')}${path('actual', 'chart-actual-line')}${last ? `<circle class="chart-last" cx="${x(last.day)}" cy="${y(last.actual)}" r="5"/>` : ''}${[1, 10, 20, data.dayCount].map(day => `<text class="chart-axis" x="${x(day)}" y="205" text-anchor="middle">${day}</text>`).join('')}</svg>
    <div class="chart-key"><span><i class="dot income-dot"></i>Этот месяц</span>${data.hasComparison ? '<span><i class="dot previous-dot"></i>Прошлый</span>' : ''}${data.totalLimit ? '<span><i class="dot plan-dot"></i>Ориентир лимита</span>' : ''}</div>
    <p class="chart-note">Расходы нарастающим итогом. ${data.totalLimit ? 'Пунктир — равномерное распределение лимита, а не график обязательных платежей.' : 'Задай лимит в бюджете, чтобы сравнить расходы с планом.'}</p>
    <details class="chart-details"><summary>Суммы по дням</summary><div class="table-scroll"><table><caption class="sr-only">Накопленные расходы и ориентир лимита</caption><thead><tr><th scope="col">День</th><th scope="col">Расходы</th><th scope="col">Накоплено</th><th scope="col">Ориентир</th></tr></thead><tbody>${data.daily.filter(d => d.actual !== null).map(d => `<tr><th scope="row">${d.day}</th><td>${money(d.amount)}</td><td>${money(d.actual)}</td><td>${d.plan === null ? '—' : money(d.plan)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function renderAnalytics(data, dailyOnly = false) {
  const mode = dailyOnly ? 'days' : dashboardChart;
  const hasData = dailyOnly ? data.records > 0 || data.totalLimit > 0 : data.months.some(m => m.count > 0);
  return `<section class="panel analytics-panel" aria-label="Графики финансов"><div class="analytics-heading"><div><div class="eyebrow">ДИНАМИКА</div><h2>${dailyOnly ? 'Расходы и план' : 'Деньги в движении'}</h2></div>${dailyOnly ? '' : `<div class="chart-tabs" role="group" aria-label="Период графика"><button type="button" data-action="chart-mode" data-value="months" aria-pressed="${mode === 'months'}">6 месяцев</button><button type="button" data-action="chart-mode" data-value="days" aria-pressed="${mode === 'days'}">По дням</button></div>`}</div>
    ${hasData ? (mode === 'months' ? monthChart(data) : dailyChart(data)) : `<div class="chart-empty"><span aria-hidden="true">▥</span><strong>Здесь будут твои графики</strong><p>Добавь операции или импортируй выписку. Расчёты появятся автоматически.</p><button class="secondary-btn" type="button" data-action="import-sber">Загрузить выписку</button></div>`}
    ${hasData && !dailyOnly && mode === 'months' ? `<p class="chart-note">${data.isCurrent ? 'Текущий месяц показан по ' + esc(dateView(data.asOf).replace(/\.$/, '')) + '. ' : ''}Месяцы без записей отмечены прочерком.</p>` : ''}</section>`;
}
function renderBudgetTeaser(data) {
  return `<button class="budget-teaser" type="button" data-action="view-budgets"><div class="teaser-icon" aria-hidden="true">◎</div><div><strong>${data.totalLimit ? (data.remaining >= 0 ? 'Осталось по плану ' : 'Сверх плана ') + short(Math.abs(data.remaining)) : 'Собери план на месяц'}</strong><span>${data.recommendations.length ? `Рекомендаций: ${data.recommendations.length} · посмотреть в бюджете` : 'Лимиты, прогноз и рекомендации по расходам'}</span></div><span aria-hidden="true">↗</span></button>`;
}
function renderRecommendations(data) {
  const icons = {danger: '!', warn: '↗', good: '↘', info: '◎'};
  return `<section id="budgetRecommendations" aria-label="Рекомендации по расходам">${sectionHeader('Что можно улучшить')}
    <p class="subtle">По операциям за ${esc(monthLabel(data.month).replace(/\.$/, ''))}. Переводы между своими счетами не считаются расходами.</p>
    ${data.recommendations.length ? `<div class="recommendation-list">${data.recommendations.map((r, index) => `<article class="recommendation ${r.tone}"><div class="recommendation-top"><span class="recommendation-icon" aria-hidden="true">${icons[r.tone]}</span><h3>${esc(r.title)}</h3></div><div class="recommendation-amount">${short(r.amount)}</div><p>${esc(r.text)}</p><button type="button" class="text-link" data-action="insight-action" data-index="${index}">${esc(r.label)} →</button></article>`).join('')}</div>` : `<div class="panel recommendation-empty"><strong>${data.records ? 'Явных отклонений пока нет' : 'Начнём с твоих данных'}</strong><p class="subtle">${data.records ? 'При новых операциях здесь появятся отклонения от лимитов и сценарии экономии. Можно начать с лимитов по истории.' : 'Загрузи выписку или добавь расходы. Рекомендации будут рассчитаны автоматически.'}</p><button class="secondary-btn" type="button" data-action="${data.records ? 'auto-budget' : 'import-sber'}">${data.records ? 'Предложить лимиты' : 'Загрузить выписку'}</button></div>`}
    <p class="chart-note">Сценарии экономии — ориентиры для планирования. Прогноз зависит от полноты записей и не учитывает ещё не внесённые обязательные платежи.</p></section>`;
}
function renderBudgetPage() {
  const data = financeAnalysis(), hasLimit = data.totalLimit > 0;
  const progress = hasLimit ? Math.min(100, data.expense / data.totalLimit * 100) : 0;
  const forecastLabel = data.isFuture ? 'Месяц ещё не начался' : data.isCurrent ? data.canForecast ? short(data.forecast) : 'Мало данных' : short(data.expense);
  const ownMonth = Object.prototype.hasOwnProperty.call(state.budgetMonths, activeMonth);
  return heading('Бюджет', 'ПЛАН, КОТОРЫЙ ПОМОГАЕТ', '<button class="secondary-btn" type="button" data-action="edit-month-plan">Мой план</button>') + monthBar() + `
    <section class="hero budget-hero"><div class="hero-label">${hasLimit ? 'План расходов на месяц' : 'Твой бюджет начинается с плана'}</div><div class="hero-value">${hasLimit ? short(data.totalLimit) : 'Задай ориентир'}</div><div class="hero-foot">${hasLimit ? (data.plan.limit !== null ? 'Общий лимит' : 'Сумма лимитов категорий') + ' · все расходы учтены в факте' : 'Укажи сумму или заполни категории по истории'}</div>${hasLimit ? `<div class="progress hero-progress" role="progressbar" aria-label="Использование общего лимита" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i class="${data.remaining < 0 ? 'over' : ''}" style="width:${progress}%"></i></div><div class="budget-hero-caption"><span>Потрачено ${short(data.expense)}</span><strong>${data.remaining >= 0 ? 'Осталось ' : 'Сверх плана '}${short(Math.abs(data.remaining))}</strong></div>` : '<button class="primary-btn small-top" type="button" data-action="edit-month-plan">Настроить план</button>'}</section>
    <div class="two-col"><div class="metric-card"><div class="metric-head">${data.isCurrent ? 'В день до конца месяца' : 'Расходы за месяц'}</div><div class="metric-value">${data.isCurrent ? data.dailyAllowance === null ? '—' : short(data.dailyAllowance) : short(data.expense)}</div><p class="chart-note">${data.isCurrent ? `На оставшиеся ${data.daysLeft} дн., включая сегодня` : 'Только записанные операции'}</p></div><div class="metric-card"><div class="metric-head">${data.isCurrent ? 'Прогноз расходов' : data.isFuture ? 'Факт расходов' : 'Доходы за месяц'}</div><div class="metric-value ${data.canForecast && hasLimit && data.forecast > data.totalLimit ? 'negative' : ''}">${data.isCurrent ? forecastLabel : data.isFuture ? '—' : short(data.income)}</div><p class="chart-note">${data.isCurrent ? data.canForecast ? 'При сохранении темпа переменных трат' : 'Нужно от 7 дней месяца и расходы на 3 датах' : data.isFuture ? 'Факт появится после начала месяца' : 'Без переводов между счетами'}</p></div></div>
    <div class="plan-summary"><div><span>Доход в плане</span><strong>${data.plan.income === null ? 'Не задан' : short(data.plan.income)}</strong></div><div><span>Цель накоплений</span><strong>${short(data.plan.savingsGoal)}</strong></div><button type="button" class="text-link" data-action="edit-month-plan">Изменить →</button></div>
    ${data.hasComparison ? `<div class="comparison-note ${data.change > 0 ? 'negative' : 'positive'}">${data.change > 0 ? '↗' : '↘'} Расходы ${data.change > 0 ? 'выше' : data.change < 0 ? 'ниже' : 'на уровне прошлого месяца'}${data.change === 0 ? '' : ` на ${Math.abs(data.change).toLocaleString('ru-RU')}%`} ${data.change === 0 ? '' : data.isCurrent ? 'к тем же датам прошлого месяца' : 'к предыдущему месяцу'}</div>` : ''}
    <div class="budget-tools"><button class="secondary-btn" type="button" data-action="auto-budget">✦ Заполнить по истории</button><button class="secondary-btn" type="button" data-action="add-budget">+ Категория</button><button class="text-link" type="button" data-action="copy-budget">Скопировать прошлый месяц</button></div>
    ${sectionHeader('Лимиты по категориям')}
    <div class="panel">${data.categoryRows.length ? data.categoryRows.map(row => {const c = getCategory(row.id); return `<div class="budget-row"><div class="budget-line"><span class="budget-name">${esc(c.icon)} ${esc(c.name)}</span><button type="button" class="text-link" data-action="edit-budget" data-id="${esc(row.id)}" aria-label="Изменить лимит: ${esc(c.name)}">Изменить</button></div><div class="budget-values"><strong>${short(row.spent)}</strong><span>из ${short(row.limit)}</span><b class="${row.percent >= 100 ? 'negative' : 'muted'}">${Math.round(row.percent)}%</b></div><div class="progress" role="progressbar" aria-label="${esc(c.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(row.percent))}"><i class="${row.percent >= 100 ? 'over' : row.percent >= 80 ? 'warn' : ''}" style="width:${Math.min(100, row.percent)}%"></i></div><div class="progress-caption"><span>${row.remaining < 0 ? 'Превышение ' : 'Осталось '}${short(Math.abs(row.remaining))}</span><span>${data.isCurrent && row.forecast !== null ? 'Прогноз ' + short(row.forecast) : ownMonth ? 'На этот месяц' : 'Базовый лимит'}</span></div></div>`;}).join('') : empty('◎', 'Добавь первые лимиты', 'Приложение предложит суммы по твоей истории. Их можно изменить перед сохранением.', 'Предложить лимиты', 'auto-budget')}</div>
    ${data.unbudgeted.length ? `<section class="panel unbudgeted-panel"><div class="budget-line"><h3>Без лимита</h3><strong>${short(data.unbudgetedTotal)}</strong></div><p class="chart-note">Эти расходы тоже уменьшают общий остаток по плану.</p>${data.unbudgeted.map(row => `<div class="unbudgeted-row"><span>${esc(getCategory(row.id).icon)} ${esc(getCategory(row.id).name)}</span><strong>${short(row.amount)}</strong><button class="text-link" type="button" data-action="edit-budget" data-id="${esc(row.id)}">Задать</button></div>`).join('')}</section>` : ''}
    ${renderAnalytics(data, true)}${renderRecommendations(data)}
    <p class="footnote">${data.records} операций за выбранный период. ${ownMonth ? 'Лимиты заданы отдельно на этот месяц.' : 'Используются базовые лимиты, повторяющиеся каждый месяц.'} ${data.debtTotal + data.subscriptionTotal > 0 ? `По текущим спискам кредиты — ${short(data.debtTotal)}/мес., подписки — ${short(data.subscriptionTotal)}/мес. Плановые платежи повторно в факт не добавляются.` : ''}</p>`;
}
function openMonthPlan() {
  const data = financeAnalysis();
  openModal('План на ' + monthLabel(activeMonth), `<form id="monthPlanForm" data-month="${activeMonth}"><p class="subtle">Настройки относятся только к выбранному месяцу.</p>${formField('limit', 'Общий лимит расходов, ₽', 'number', data.plan.limit ?? '', 'Пусто — сумма лимитов категорий')}${formField('income', 'Ожидаемый доход за весь месяц, ₽', 'number', data.plan.income ?? '', 'Необязательно')}${formField('savingsGoal', 'Хочу отложить за месяц, ₽', 'number', data.plan.savingsGoal || '', '0')}<p class="subtle">Общий лимит учитывает все расходы, включая категории без отдельного лимита. Ожидаемый доход и цель используются только для плана.</p><button class="primary-btn wide" type="submit">Сохранить план</button></form>`);
}
function openBudgetEditor(id, proposal = {}) {
  const month = proposal.month || activeMonth, limits = FinanceInsights.limitsFor(state, month);
  const selected = id || state.categories.find(c => c.kind === 'expense')?.id;
  const existing = limits[selected], suggested = proposal.limit;
  openModal(suggested !== undefined ? 'Проверить предложенный лимит' : existing ? 'Изменить лимит' : 'Новый лимит', `<form id="budgetForm" data-old-id="${existing ? esc(selected) : ''}" data-month="${month}"><div class="field"><label for="budgetCategory">Категория расходов</label><select name="category" id="budgetCategory">${catOptions('expense', selected)}</select></div>${formField('limit', 'Лимит, ₽', 'number', suggested ?? existing ?? '', 'Например, 20000', 'required')}<div class="field"><label for="budgetScope">Период</label><select id="budgetScope" name="scope"><option value="month">Только ${esc(monthLabel(month))}</option><option value="recurring">Каждый месяц · базовый лимит</option></select></div>${suggested !== undefined && existing ? `<div class="notice warn">На этот месяц уже задан лимит ${short(existing)}. Проверь предложенную сумму перед заменой.</div>` : ''}<p class="subtle">Базовые лимиты действуют в месяцах без отдельного плана категорий.</p><div class="form-actions"><button class="primary-btn" type="submit">Сохранить лимит</button>${existing ? `<button class="danger-btn" type="button" data-action="delete-budget" data-id="${esc(selected)}" data-month="${month}">Удалить на этот месяц</button>` : ''}</div></form>`);
  const updateDelete = () => {
    const button = $('[data-action="delete-budget"]', $('#budgetForm'));
    if (!button) return;
    const recurring = $('#budgetScope').value === 'recurring', category = $('#budgetCategory').value;
    button.dataset.scope = recurring ? 'recurring' : 'month'; button.dataset.id = category;
    button.textContent = recurring ? 'Удалить базовый лимит' : 'Удалить на этот месяц';
    button.hidden = !(recurring ? state.budgets[category] : limits[category]);
  };
  $('#budgetCategory').addEventListener('change', e => {$('#f-limit').value = ($('#budgetScope').value === 'recurring' ? state.budgets[e.target.value] : limits[e.target.value]) || ''; updateDelete();});
  $('#budgetScope').addEventListener('change', e => {$('#f-limit').value = (e.target.value === 'recurring' ? state.budgets[$('#budgetCategory').value] : limits[$('#budgetCategory').value]) || ''; updateDelete();});
}
function openAutoBudget(mode = 'history') {
  const data = financeAnalysis(), previous = FinanceInsights.limitsFor(state, FinanceInsights.shift(activeMonth, -1));
  const proposals = mode === 'copy' ? Object.entries(previous).map(([id, limit]) => ({id, limit, existing: data.limits[id]})) : data.proposals;
  const source = mode === 'copy' ? 'Лимиты предыдущего месяца.' : data.historyMonths.length ? `Средние расходы за месяцы с записями: ${data.historyMonths.map(m => monthLabel(m)).join(', ')}. Месяцы без записей пропущены.` : data.canForecast ? 'Ориентир по темпу текущего месяца. Проверь суммы: данные могут охватывать не весь период.' : 'Ориентир по расходам выбранного месяца.';
  if (!proposals.length) {openModal('Предложить лимиты', `<div class="notice">${mode === 'copy' ? 'В предыдущем месяце ещё нет лимитов.' : 'Пока недостаточно истории. Импортируй выписку за прошлый месяц или задай лимиты вручную.'}</div><button class="primary-btn wide small-top" type="button" data-action="add-budget">Задать лимит вручную</button>`); return;}
  openModal(mode === 'copy' ? 'Скопировать лимиты' : 'Лимиты по твоей истории', `<form id="autoBudgetForm" data-month="${activeMonth}"><p class="subtle">${esc(monthLabel(activeMonth).replace(/\.$/, ''))}. ${esc(source)} Полнота истории зависит от внесённых операций.</p><div class="notice">Уже заданные лимиты оставлены без отметки. Изменятся только выбранные категории.</div><div class="auto-budget-list">${proposals.map((p, index) => `<div class="auto-budget-row"><label class="checkbox-row" for="proposal-${index}"><input id="proposal-${index}" type="checkbox" name="category" value="${esc(p.id)}" ${p.existing ? '' : 'checked'}><span>${esc(getCategory(p.id).icon)} ${esc(getCategory(p.id).name)}${p.existing ? `<small>Сейчас ${short(p.existing)}</small>` : ''}</span></label><label class="sr-only" for="limit-${index}">Лимит: ${esc(getCategory(p.id).name)}</label><input id="limit-${index}" name="limit-${esc(p.id)}" aria-label="Лимит: ${esc(getCategory(p.id).name)}, рубли" type="number" inputmode="decimal" min="0.01" step="0.01" value="${p.limit}"></div>`).join('')}</div><p class="subtle">Лимиты только на этот месяц. Кредиты, здоровье, дети и продукты автоматически не сокращаются.</p><button class="primary-btn wide" type="submit">Применить выбранные лимиты</button></form>`);
}
async function persistPlanningChange(mutate) {
  const previous = {budgets: structuredCloneSafe(state.budgets), budgetMonths: structuredCloneSafe(state.budgetMonths), budgetPlans: structuredCloneSafe(state.budgetPlans)};
  try {mutate(); await saveState(); render();} catch (error) {Object.assign(state, previous); throw error;}
}
async function savePlanningForm(form, values) {
  const month = form.dataset.month || activeMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Проверь месяц плана');
  if (form.id === 'monthPlanForm') {
    const optional = key => String(values.get(key) || '').trim() === '' ? null : Number(values.get(key));
    const income = optional('income'), limit = optional('limit'), savingsGoal = optional('savingsGoal') ?? 0;
    if ([income, limit, savingsGoal].some(n => n !== null && (!Number.isFinite(n) || n < 0)) || limit !== null && limit < 0.01) throw new Error('Проверь суммы: лимит должен быть больше нуля');
    await persistPlanningChange(() => {state.budgetPlans[month] = {income, limit, savingsGoal};});
  } else if (form.id === 'autoBudgetForm') {
    const selected = values.getAll('category'), limits = {...FinanceInsights.limitsFor(state, month)};
    if (!selected.length) throw new Error('Выбери хотя бы одну категорию');
    for (const id of selected) {
      const value = Number(values.get('limit-' + id));
      if (!state.categories.some(c => c.id === id && c.kind === 'expense') || !Number.isFinite(value) || value < 0.01) throw new Error('Проверь выбранные категории и суммы');
      limits[id] = Math.round(value * 100) / 100;
    }
    await persistPlanningChange(() => {state.budgetMonths[month] = limits;});
  } else {
    const category = String(values.get('category')), limit = Number(values.get('limit')), scope = values.get('scope');
    if (!Number.isFinite(limit) || limit < 0.01 || !['month', 'recurring'].includes(scope) || !state.categories.some(c => c.id === category && c.kind === 'expense')) throw new Error('Укажи категорию и лимит больше нуля');
    const oldId = form.dataset.oldId;
    await persistPlanningChange(() => {
      const limits = scope === 'recurring' ? state.budgets : {...FinanceInsights.limitsFor(state, month)};
      if (oldId && oldId !== category) delete limits[oldId];
      limits[category] = Math.round(limit * 100) / 100;
      if (scope === 'month') state.budgetMonths[month] = limits;
    });
  }
  activeMonth = month; closeModal(); activateTab('budgets'); notify('План сохранён');
}
function handleInsight(index) {
  const recommendation = financeAnalysis().recommendations[Number(index)];
  if (!recommendation) return;
  if (recommendation.action === 'category') {transactionCategoryFilter = recommendation.category; transactionFilter = 'expense'; transactionSearch = ''; activateTab('transactions');}
  else if (recommendation.action === 'plan') openMonthPlan();
  else if (recommendation.action === 'autoplan') openAutoBudget();
  else if (recommendation.action === 'subscriptions') activateTab('subscriptions');
  else if (recommendation.action === 'proposal') openBudgetEditor(recommendation.category, {month: recommendation.targetMonth, limit: recommendation.target});
  else if (recommendation.action === 'daily') $('.analytics-panel')?.scrollIntoView({behavior: 'smooth', block: 'center'});
}
