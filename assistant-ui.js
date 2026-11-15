/* User-initiated, local file exchange. No model API or automatic upload. */
'use strict';
let assistantExport = null;
let assistantDraft = null;
let assistantBusy = false;
function renderAssistant() {
  const a = financeAnalysis();
  return heading('Помощник', 'ФИНАНСЫ И CHATGPT', '<button class="text-link" type="button" data-action="assistant-home">← Обзор</button>') + monthBar() + `
    <section class="hero assistant-hero"><span class="pill">Твоя подписка ChatGPT · без API</span><h2>Разберём расходы.<br>Составим план.</h2><p>Подготовь сводку, приложи её в ChatGPT и получи рекомендации. Готовый план можно вернуть сюда.</p></section>
    <div class="two-col"><div class="metric-card"><div class="metric-head">Доходы за месяц</div><div class="metric-value">${short(a.income)}</div></div><div class="metric-card"><div class="metric-head">Расходы за месяц</div><div class="metric-value">${short(a.expense)}</div></div></div>
    <div class="stack small-top">
      <section class="setting-card assistant-step"><span class="assistant-number">1</span><h3>Подготовить данные</h3><p>В сводке: история по категориям за 6 месяцев, планы на выбранный и следующий месяц, параметры кредитов, накоплений и подписок. Названия операций, счетов, банков, договоров и заметки не включаются. Кредиты и подписки обозначены номерами.</p><button class="primary-btn wide" type="button" data-action="assistant-export">Подготовить сводку</button></section>
      <section class="setting-card assistant-step"><span class="assistant-number">2</span><h3>Получить рекомендации</h3><p>Сохрани сводку в «Файлы» или открой меню «Поделиться». Затем прикрепи файл в этот чат ChatGPT и попроси анализ и план для «Моих Финансов».</p><a class="secondary-btn wide" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Открыть ChatGPT</a></section>
      <section class="setting-card assistant-step"><span class="assistant-number">3</span><h3>Вернуть данные в приложение</h3><p>Загрузи бюджетный план или файл кредита и накоплений из ответа ChatGPT. Программа сама определит тип файла и покажет изменения до сохранения.</p><button class="secondary-btn wide" type="button" data-action="assistant-import">Загрузить файл</button><button class="text-link wide" type="button" data-action="assistant-paste">Вставить текст</button></section>
      <section class="setting-card"><h3>Кредит и накопления из скриншотов</h3><p>Получи в ChatGPT файл с данными банка и загрузи его здесь. Выбери, создать новые записи или обновить существующие. Все суммы будут показаны до сохранения.</p><button class="secondary-btn wide" type="button" data-action="bank-records-import">Загрузить кредит и накопления</button></section>
    </div>
    <div class="notice small-top">Сводка содержит финансовые суммы и не зашифрована. Ты сам выбираешь, куда её отправить. Подготовка файла ничего не отправляет. Это анализ внесённых записей, а не доступ к банку или постоянная синхронизация.</div><p class="footnote">Версия ${APP_VERSION}</p><button class="secondary-btn wide" type="button" data-action="refresh-app">Обновить приложение</button>`;
}
function assistantDisplayAmount(value) {return value === null ? 'Не задано' : money(value);}
async function openAssistantExport() {
  const context = await FinanceAssistant.createContext(state, activeMonth, today(), APP_VERSION);
  const content = JSON.stringify(context, null, 2);
  const filename = `moi-finansy-context-${context.month}-${context.asOf}.json`;
  assistantExport = {context, content, filename, file: new File([content], filename, {type: 'application/json'})};
  const prompt = FinanceAssistant.prompt(context);
  openModal('Сводка для помощника', `<p class="subtle">${esc(monthLabel(context.month))} · по состоянию на ${esc(context.asOf)}</p>
    <div class="notice">Будут переданы агрегированные суммы, категории и параметры обязательств. Сводка не содержит названий операций, счетов, банков, договоров и заметок. Полнота истории не подтверждена.</div>
    <div class="assistant-facts small-top"><div><span>Доходы</span><strong>${money(context.selected.income)}</strong></div><div><span>Расходы</span><strong>${money(context.selected.expense)}</strong></div><div><span>История</span><strong>6 месяцев</strong></div><div><span>Размер файла</span><strong>${Math.ceil(assistantExport.file.size / 1024)} КБ</strong></div></div>
    <p class="subtle">Сохрани файл и прикрепи его в этот чат ChatGPT. Через «Поделиться» можно выбрать доступное приложение; список зависит от iPhone.</p>
    <div class="stack"><button class="primary-btn wide" type="button" data-action="assistant-share">Поделиться файлом</button><button class="secondary-btn wide" type="button" data-action="assistant-download">Сохранить файл</button></div>
    <label class="assistant-label" for="assistantPrompt">Запрос для ChatGPT</label><textarea class="assistant-text" id="assistantPrompt" rows="7" readonly>${esc(prompt)}</textarea>
    <button class="text-link wide" type="button" data-action="assistant-copy-prompt">Скопировать запрос</button>
    <details class="assistant-details"><summary>Посмотреть содержимое файла</summary><pre>${esc(content)}</pre></details>`);
}
function openAssistantPaste() {
  openModal('Вставить ответ помощника', `<p class="subtle">Вставь текст файла бюджетного плана или записей кредита и накоплений. Сначала проверим его и покажем изменения.</p><label class="assistant-label" for="assistantPlanText">Текст ответа</label><textarea class="assistant-text" id="assistantPlanText" rows="12" placeholder="Вставь JSON из ответа ChatGPT" spellcheck="false"></textarea><button class="primary-btn wide small-top" type="button" data-action="assistant-preview-paste">Проверить файл</button>`);
}
async function previewAssistantPlan(raw) {
  assistantDraft = null;
  const input = FinanceAssistant.parsePlan(raw);
  if(input?.type==='moi-finansy-bank-records'){await previewBankRecords(raw);return;}
  if(input?.type==='moi-finansy-assistant-context')throw new Error('Это сводка для анализа. Передай её в ChatGPT и загрузи сюда полученный план или файл записей.');
  if(input?.type==='moi-finansy-encrypted-backup')throw new Error('Это резервная копия. Открой «Настройки → Резервная копия → Восстановить».');
  if(input?.type!=='moi-finansy-assistant-plan')throw new Error('Выбери файл плана или записей кредита и накоплений из ответа ChatGPT.');
  let prepared;
  try {prepared = await FinanceAssistant.preparePlan(input, state, today());}
  catch(error){if(/Неподдерживаемые поля|Неверный формат/.test(error.message))throw new Error('Формат плана не подходит. Попроси ChatGPT подготовить файл плана для «Моих Финансов».');throw error;}
  assistantDraft = prepared.plan;
  const rows = prepared.changes.map(change => `<div class="assistant-change"><span>${esc(monthLabel(change.month))} · ${esc(change.label)}</span><div><span>${assistantDisplayAmount(change.before)}</span><b aria-hidden="true">→</b><strong>${assistantDisplayAmount(change.after)}</strong></div></div>`).join('');
  openModal('Проверить изменения', `<p class="subtle">Данные сводки: ${esc(prepared.plan.source.asOf)}. Изменений: ${prepared.changes.length}.</p>
    ${prepared.plan.summary ? `<div class="notice">${esc(prepared.plan.summary)}</div>` : ''}
    <div class="assistant-changes">${rows}</div>
    ${prepared.plan.budgets.filter(b => b.reason).map(b => `<p class="subtle"><strong>${esc(monthLabel(b.month))}:</strong> ${esc(b.reason)}</p>`).join('')}
    ${prepared.warnings.length ? `<div class="notice warn">${prepared.warnings.map(warning => esc(warning)).join('<br>')}</div>` : ''}
    <p class="subtle">Сохранятся только перечисленные планы и лимиты. Операции и фактические остатки останутся прежними.</p>
    <div class="form-actions"><button class="secondary-btn" type="button" data-action="assistant-cancel">Отмена</button><button class="primary-btn" type="button" data-action="assistant-apply">Применить план</button></div>`);
}
async function readAssistantPlanFile(file) {
  if (!file || file.size > 256 * 1024) throw new Error('Выбери файл ответа помощника до 256 КБ.');
  await previewAssistantPlan(await file.text());
}
async function applyAssistantPlan() {
  if (!assistantDraft) throw new Error('Сначала загрузи план и проверь изменения.');
  // Re-check immediately before writing, including changes made after preview.
  const previousState = JSON.stringify(state);
  const prepared = await FinanceAssistant.preparePlan(assistantDraft, state, today());
  if (JSON.stringify(state) !== previousState) throw new Error('Данные изменились. Проверь план заново.');
  await persistPlanningChange(() => {
    state.budgetMonths = prepared.budgetMonths;
    state.budgetPlans = prepared.budgetPlans;
  });
  activeMonth = prepared.plan.budgets[0].month;
  assistantDraft = null; assistantExport = null;
  closeModal(); activateTab('budgets'); notify('План помощника сохранён');
}
async function handleAssistantAction(action) {
  if (assistantBusy) return;
  assistantBusy = true;
  try {
    if (action === 'view-assistant') activateTab('assistant');
    else if (action === 'assistant-home') activateTab('home');
    else if (action === 'assistant-export') await openAssistantExport();
    else if (action === 'assistant-import') $('#assistantPlanFile').click();
    else if (action === 'assistant-paste') openAssistantPaste();
    else if (action === 'assistant-preview-paste') await previewAssistantPlan($('#assistantPlanText').value);
    else if (action === 'assistant-apply') await applyAssistantPlan();
    else if (action === 'assistant-cancel') {assistantDraft = null; closeModal();}
    else if (action === 'assistant-copy-prompt') {
      if (!assistantExport) return;
      const field = $('#assistantPrompt');
      if (navigator.clipboard?.writeText) {
        try {await navigator.clipboard.writeText(FinanceAssistant.prompt(assistantExport.context)); notify('Запрос скопирован. Прикрепи к нему файл сводки.');}
        catch (_) {field.focus(); field.select(); notify('Выделен запрос: скопируй его через меню iPhone.');}
      } else {field.focus(); field.select(); notify('Выделен запрос: скопируй его через меню iPhone.');}
    } else if (action === 'assistant-share' || action === 'assistant-download') {
      if (!assistantExport) throw new Error('Сначала подготовь сводку.');
      const {file, content, filename} = assistantExport;
      // Invoke share before any await, while the tap still has user activation.
      if (action === 'assistant-share' && navigator.share && navigator.canShare?.({files: [file]})) {
        try {await navigator.share({files: [file], title: 'Мои Финансы — сводка для ChatGPT'});}
        catch (error) {if (error.name === 'AbortError') return; downloadText(content, filename); notify('Меню недоступно. Сохрани файл и прикрепи в ChatGPT.');}
      } else {downloadText(content, filename); notify('Сохрани сводку в «Файлы» и прикрепи её в ChatGPT.');}
    }
  } catch (error) {notify(error.message || 'Не удалось выполнить действие помощника.');}
  finally {assistantBusy = false;}
}
