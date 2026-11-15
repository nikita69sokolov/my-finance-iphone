/* Мои Финансы — local-first PWA. No analytics, bank credentials, or network requests. */
'use strict';
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const CATEGORY_DEFAULTS = [
  {id:'food',name:'Продукты',icon:'🛒',color:'#65dfbb',kind:'expense'},
  {id:'home',name:'Дом и ЖКХ',icon:'🏠',color:'#88bfff',kind:'expense'},
  {id:'auto',name:'Автомобиль',icon:'🚘',color:'#eda06c',kind:'expense'},
  {id:'transport',name:'Транспорт',icon:'🚕',color:'#e1c178',kind:'expense'},
  {id:'children',name:'Дети и семья',icon:'👨‍👩‍👧',color:'#cf9cf7',kind:'expense'},
  {id:'health',name:'Здоровье',icon:'💊',color:'#f38f99',kind:'expense'},
  {id:'shopping',name:'Покупки',icon:'🛍️',color:'#bd9dea',kind:'expense'},
  {id:'leisure',name:'Досуг',icon:'🎬',color:'#8bcfe8',kind:'expense'},
  {id:'credit',name:'Кредиты и ипотека',icon:'🏦',color:'#f1b979',kind:'expense'},
  {id:'services',name:'Связь и услуги',icon:'📱',color:'#a9accb',kind:'expense'},
  {id:'other-expense',name:'Прочее',icon:'📦',color:'#8393a6',kind:'expense'},
  {id:'salary',name:'Зарплата',icon:'💼',color:'#6ddcb6',kind:'income'},
  {id:'additional',name:'Доп. доход',icon:'💰',color:'#87cbb2',kind:'income'},
  {id:'refund',name:'Возвраты',icon:'↩️',color:'#9bdad0',kind:'income'},
  {id:'other-income',name:'Другие поступления',icon:'✨',color:'#c4d3b3',kind:'income'},
  {id:'transfer',name:'Перевод между счетами',icon:'↔️',color:'#8393a6',kind:'transfer'}
];
const DEFAULT_STATE = () => ({version:1,transactions:[],budgets:{},debts:[],categories:structuredCloneSafe(CATEGORY_DEFAULTS)});
let state = DEFAULT_STATE();
let db = null;
let storageFallback = false;
let activeTab = 'home';
let activeMonth = monthNow();
let transactionFilter = 'all';
let transactionSearch = '';
let importDraft = null;
let isBusy = false;
const fmtRub = new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2});
const fmtShort = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
const fmtDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'});
const fmtMonth = new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
function structuredCloneSafe(v){return JSON.parse(JSON.stringify(v));}
function monthNow(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function esc(s=''){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(n){return fmtRub.format(Number(n)||0).replace(/\s?₽/,' ₽');}
function short(n){return fmtShort.format(Number(n)||0)+' ₽';}
function validNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function monthLabel(m){const [y,n]=m.split('-').map(Number);return fmtMonth.format(new Date(y,n-1,1));}
function monthShift(m,delta){const [y,n]=m.split('-').map(Number);const d=new Date(y,n-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function dateView(value){const d=new Date(`${value}T12:00:00`);return Number.isNaN(d.getTime())?value:fmtDate.format(d);}
function getCategory(id){return state.categories.find(c=>c.id===id) || {name:'Без категории',icon:'📄',color:'#8393a6',kind:'expense'};}
function catOptions(kind, selected){return state.categories.filter(c=>c.kind===kind).map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('');}
function normalizeState(input){
  if(!input || typeof input!=='object' || !Array.isArray(input.transactions) || !Array.isArray(input.debts) || typeof input.budgets!=='object') throw new Error('Неверный формат резервной копии');
  const cats=Array.isArray(input.categories)?input.categories:CATEGORY_DEFAULTS;
  return {
    version:1,
    categories:cats.filter(c=>c && typeof c.id==='string' && typeof c.name==='string' && ['expense','income','transfer'].includes(c.kind)).slice(0,150),
    transactions:input.transactions.filter(x=>x && typeof x.date==='string' && ['expense','income','transfer'].includes(x.type) && Number.isFinite(Number(x.amount))).slice(0,100000).map(x=>({id:String(x.id||uid()),type:x.type,date:x.date,title:String(x.title||'Операция').slice(0,250),amount:Math.abs(Number(x.amount)),category:String(x.category||'other-expense'),account:String(x.account||'').slice(0,80),source:String(x.source||'manual').slice(0,80)})),
    debts:input.debts.filter(x=>x && typeof x.name==='string').slice(0,100).map(x=>({id:String(x.id||uid()),name:x.name.slice(0,100),balance:Math.max(0,validNumber(x.balance)),rate:Math.max(0,validNumber(x.rate)),payment:Math.max(0,validNumber(x.payment))})),
    budgets:Object.fromEntries(Object.entries(input.budgets).filter(([k,v])=>typeof k==='string' && Number.isFinite(Number(v)) && Number(v)>0).map(([k,v])=>[k,Number(v)]))
  };
}
function uid(){return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;}
async function initStorage(){
  if(!('indexedDB' in window)){storageFallback=true;return;}
  try{
    db=await new Promise((resolve,reject)=>{const req=indexedDB.open('moi-finansy-db',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('kv'))req.result.createObjectStore('kv');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  }catch(e){storageFallback=true;console.warn('IndexedDB unavailable',e);}
}
async function loadState(){
  try{
    let found;
    if(storageFallback){found=JSON.parse(localStorage.getItem('moi-finansy-state')||'null');}
    else found=await new Promise((resolve,reject)=>{const req=db.transaction('kv','readonly').objectStore('kv').get('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    if(found)state=normalizeState(found);
  }catch(e){console.error('Could not load data',e);notify('Не удалось прочитать локальные данные');}
}
async function saveState(){
  if(storageFallback){localStorage.setItem('moi-finansy-state',JSON.stringify(state));return;}
  await new Promise((resolve,reject)=>{const tr=db.transaction('kv','readwrite');tr.objectStore('kv').put(structuredCloneSafe(state),'state');tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);});
}
async function commit(){try{await saveState();render();}catch(e){console.error(e);notify('Ошибка сохранения. Экспортируйте резервную копию.');}}
function monthTx(){return state.transactions.filter(x=>x.date.startsWith(activeMonth));}
function sumType(items,type){return items.filter(x=>x.type===type).reduce((a,x)=>a+x.amount,0);}
function monthTotals(){const a=monthTx();return {income:sumType(a,'income'),expense:sumType(a,'expense')};}
function totalsByCategory(){const map={};for(const tx of monthTx().filter(x=>x.type==='expense'))map[tx.category]=(map[tx.category]||0)+tx.amount;return Object.entries(map).map(([id,amount])=>({category:getCategory(id),id,amount})).sort((a,b)=>b.amount-a.amount);}
function monthBar(){return `<div class="month-control"><button class="chevron-btn" type="button" data-action="month-prev" aria-label="Предыдущий месяц">‹</button><div class="month-display">${esc(monthLabel(activeMonth))}</div><button class="chevron-btn" type="button" data-action="month-next" aria-label="Следующий месяц">›</button></div>`;}
function heading(title,kicker='ВАШИ ФИНАНСЫ',action=''){return `<div class="section-top"><div><div class="eyebrow">${esc(kicker)}</div><h1 class="page-title">${esc(title)}</h1></div>${action}</div>`;}
function sectionHeader(title,link='',action=''){return `<div class="section-header"><h2>${esc(title)}</h2>${link?`<button type="button" class="text-link" data-action="${action}">${esc(link)} →</button>`:''}</div>`;}
function empty(icon,title,description,button='',action=''){return `<div class="empty-state"><div class="empty-icon">${icon}</div><strong>${esc(title)}</strong><p>${esc(description)}</p>${button?`<button type="button" data-action="${esc(action)}" class="secondary-btn">${esc(button)}</button>`:''}</div>`;}
function txList(items,limit=1000){
  if(!items.length)return empty('↗','Операций пока нет','Добавьте первую запись или загрузите банковскую выписку.','Добавить операцию','add-tx');
  return `<div class="trans-list">${items.slice(0,limit).map(tx=>{const c=getCategory(tx.category);return `<div class="trans-row"><div class="cat-icon" aria-hidden="true">${esc(c.icon)}</div><div class="trans-info"><div class="trans-title">${esc(tx.title)}</div><div class="trans-meta">${dateView(tx.date)} · ${esc(c.name)}${tx.account?' · '+esc(tx.account):''}</div></div><div class="trans-amount ${tx.type==='income'?'positive':tx.type==='expense'?'negative':''}">${tx.type==='income'?'+':tx.type==='expense'?'−':''}${money(tx.amount)}</div><button class="trans-edit" data-action="edit-tx" data-id="${esc(tx.id)}" aria-label="Редактировать операцию">⋯</button></div>`;}).join('')}</div>`;
}
function renderHome(){
  const {income,expense}=monthTotals();const net=income-expense;
  const byCat=totalsByCategory();
  let progress=0;const segment=byCat.slice(0,5).map((c,i)=>{const start=progress;progress+=100*c.amount/Math.max(expense,1);return {c,start,finish:progress,color:c.category.color};});
  const gradient=segment.length?`conic-gradient(${segment.map(s=>`${s.color} ${s.start.toFixed(2)}% ${s.finish.toFixed(2)}%`).join(',')}${progress<100?`, #536e83 ${progress.toFixed(2)}% 100%`:''})`:'conic-gradient(#2a4152 0 100%)';
  const legend=byCat.slice(0,4).map(c=>`<div class="legend-row"><span class="legend-label"><i class="dot" style="background:${esc(c.category.color)}"></i>${esc(c.category.name)}</span><b class="legend-value">${Math.round(c.amount/Math.max(expense,1)*100)}%</b></div>`).join('');
  return heading('Обзор')+monthBar()+`
  <section class="hero"><div class="hero-label">Чистый итог за месяц</div><div class="hero-value">${net>=0?'+':'−'}${money(Math.abs(net))}</div><span class="pill">${net>=0?'↗ Доходы выше расходов':'↘ Расходы выше доходов'}</span><div class="hero-foot small-top">Разница между доходами и расходами, не баланс банковского счёта</div></section>
  <div class="two-col"><div class="metric-card"><div class="metric-head"><span class="metric-symbol in">↙</span>Доходы</div><div class="metric-value">${short(income)}</div></div><div class="metric-card"><div class="metric-head"><span class="metric-symbol out">↗</span>Расходы</div><div class="metric-value">${short(expense)}</div></div></div>
  ${sectionHeader('Куда уходят деньги',byCat.length?'Все операции':'','view-transactions')}
  <div class="panel">${byCat.length?`<div class="chart-wrap"><div class="donut" role="img" aria-label="Расходы по категориям" style="background:${gradient}"><div class="donut-center"><div><b>${short(expense)}</b><span>всего расходов</span></div></div></div><div class="legend">${legend}</div></div>`:empty('◔','Категории появятся здесь','Когда добавите расходы, покажем их распределение.')}</div>
  ${sectionHeader('Последние операции','Посмотреть все','view-transactions')}
  ${txList(monthTx().sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id))),4)}
  <div class="form-actions small-top"><button type="button" class="primary-btn wide" data-action="add-tx">+ Новая операция</button><button type="button" class="secondary-btn" data-action="import-csv">Импорт CSV</button></div>`;
}
function renderTransactions(){
  let all=monthTx().sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)));
  if(transactionFilter!=='all')all=all.filter(x=>x.type===transactionFilter);
  if(transactionSearch){const search=transactionSearch.toLocaleLowerCase('ru-RU');all=all.filter(x=>`${x.title} ${x.account} ${getCategory(x.category).name} ${x.amount}`.toLocaleLowerCase('ru-RU').includes(search));}
  return heading('Операции','ИСТОРИЯ',`<button class="secondary-btn" data-action="import-csv">Импорт</button>`)+monthBar()+`<input id="transactionSearch" type="search" class="search-input" placeholder="Поиск по операциям" autocomplete="off" value="${esc(transactionSearch)}" aria-label="Поиск операций"><div class="filter-row">${[['all','Все'],['expense','Расходы'],['income','Доходы'],['transfer','Переводы']].map(([id,name])=>`<button class="filter ${transactionFilter===id?'active':''}" type="button" data-action="filter" data-value="${id}">${name}</button>`).join('')}</div><p class="subtle">Найдено: ${all.length} · ${money(all.filter(x=>x.type==='expense').reduce((n,x)=>n+x.amount,0))} расходов</p>${txList(all)}<button type="button" data-action="add-tx" class="primary-btn wide small-top">+ Добавить операцию</button>`;
}
function renderBudgets(){
  const byCat=Object.fromEntries(totalsByCategory().map(x=>[x.id,x.amount]));
  const budgets=Object.entries(state.budgets).filter(([k,v])=>validNumber(v)>0&&getCategory(k).kind==='expense');
  const total=budgets.reduce((n,[k,v])=>n+v,0);
  const spent=budgets.reduce((n,[k,v])=>n+(byCat[k]||0),0);
  return heading('Бюджеты','ПЛАН И ФАКТ',`<button class="secondary-btn" data-action="add-budget">+ Лимит</button>`)+monthBar()+`<div class="hero"><div class="hero-label">Бюджет на месяц</div><div class="hero-value">${short(total)}</div><div class="hero-foot">Использовано ${short(spent)} · Осталось ${short(total-spent)}</div></div>${sectionHeader('Лимиты по категориям')}
  <div class="panel">${budgets.length?budgets.map(([id,limit])=>{const c=getCategory(id),v=byCat[id]||0,p=100*v/limit;return `<div class="budget-row"><div class="budget-line"><span class="budget-name">${esc(c.icon)} ${esc(c.name)}</span><button type="button" data-action="edit-budget" data-id="${esc(id)}" class="text-link">Изменить</button></div><div class="progress"><i class="${p>=100?'over':p>=80?'warn':''}" style="width:${Math.max(0,Math.min(100,p))}%"></i></div><div class="progress-caption"><span>Потрачено ${short(v)}</span><span>${Math.round(p)}% из ${short(limit)}</span></div></div>`;}).join(''):empty('◎','Лимитов пока нет','Задайте бюджет для продуктов, дома, автомобиля или любой другой категории.','Создать лимит','add-budget')}</div><p class="footnote">Лимиты повторяются каждый месяц. Расходы считаются по дате операции.</p>`;
}
function debtForecast(d){
 const balance=d.balance,p=d.payment,rate=d.rate/1200;
 if(!balance)return 'Погашен';
 if(!p)return 'Укажите платёж';
 if(rate>0 && p<=balance*rate)return 'Платёж не покрывает проценты';
 const months=rate===0?Math.ceil(balance/p):Math.ceil(-Math.log(1-balance*rate/p)/Math.log(1+rate));
 if(!Number.isFinite(months)||months>1200)return 'Срок не рассчитан';
 return `≈ ${months} мес. до закрытия`;
}
function renderDebts(){
 const total=state.debts.reduce((n,d)=>n+d.balance,0);
 return heading('Кредиты','ДОЛГОВАЯ НАГРУЗКА',`<button class="secondary-btn" data-action="add-debt">+ Кредит</button>`)+`<div class="hero"><div class="hero-label">Остаток задолженности</div><div class="hero-value">${short(total)}</div><div class="hero-foot">Плановые платежи в месяц: ${short(state.debts.reduce((n,d)=>n+d.payment,0))}</div></div>${sectionHeader('Мои обязательства')}${state.debts.length?state.debts.map(d=>`<div class="debt-card"><div class="budget-line"><div class="debt-name">${esc(d.name)}</div><button type="button" class="text-link" data-action="edit-debt" data-id="${esc(d.id)}">Изменить</button></div><div class="debt-total">${money(d.balance)}</div><div class="debt-stats"><div><small>Ставка</small><strong>${fmtShort.format(d.rate)}% годовых</strong></div><div><small>Платёж в месяц</small><strong>${money(d.payment)}</strong></div></div><p class="subtle">${esc(debtForecast(d))}</p></div>`).join(''):empty('▤','Добавьте кредит','Запишите остаток долга, процентную ставку и ежемесячный платёж.','Добавить кредит','add-debt')}<p class="footnote">Оценка срока погашения приблизительная, без изменения ставки, комиссий и дополнительных платежей. Введите новый остаток после платежа самостоятельно.</p>`;
}
function renderSettings(){
 return heading('Настройки','ДАННЫЕ И ПРИВАТНОСТЬ')+`
 <div class="stack"><div class="notice">Ваши записи хранятся локально на устройстве. Мы не отправляем суммы, выписки или пароли в GitHub и сторонние сервисы.</div>
 <div class="setting-card"><h3>Импорт операций</h3><p>Загрузите CSV-выписку из приложения банка или «Файлов» iPhone. Можно вручную выбрать колонки и проверить операции перед импортом. PDF и XLSX пока не поддерживаются.</p><button type="button" data-action="import-csv" class="secondary-btn">Загрузить CSV</button></div>
 <div class="setting-card"><h3>Резервная копия</h3><p>Сохраните зашифрованную копию всех операций, бюджетов и кредитов в «Файлы». Пароль нужен для восстановления — мы его не храним.</p><button type="button" data-action="export-backup" class="secondary-btn">Создать копию</button><button type="button" data-action="restore-backup" class="secondary-btn">Восстановить</button></div>
 <div class="setting-card"><h3>Установка на iPhone</h3><p>Откройте опубликованную ссылку в Safari → «Поделиться» → «На экран Домой» → «Открывать как веб-приложение». После первого запуска основные функции работают без интернета.</p></div>
 <div class="setting-card"><h3>Статистика</h3><p>Операций: ${state.transactions.length}. Активных лимитов: ${Object.keys(state.budgets).length}. Кредитов: ${state.debts.length}.</p><button type="button" class="danger-btn" data-action="clear-all">Удалить все данные</button></div>
 <div class="footnote">Мои Финансы v1.0 · ₽ · Без рекламы и аналитики. Чтобы не потерять записи, регулярно сохраняйте резервную копию в безопасном месте. Публикация кода приложения не публикует ваши финансовые операции.</div></div>`;
}
function render(){
 const pages={home:renderHome,transactions:renderTransactions,budgets:renderBudgets,debts:renderDebts,settings:renderSettings};
 $('#app').innerHTML=(pages[activeTab]||renderHome)();
 $$('.nav-btn').forEach(button=>{button.classList.toggle('active',button.dataset.tab===activeTab);button.setAttribute('aria-current',button.dataset.tab===activeTab?'page':'false');});
}
function openModal(title,content){$('#sheetTitle').textContent=title;$('#sheetBody').innerHTML=content;$('#modalBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';}
function closeModal(){$('#modalBackdrop').classList.add('hidden');$('#sheetBody').innerHTML='';document.body.style.overflow='';}
let toastTimer;
function notify(message){const el=$('#toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3200);}
function activateTab(tab){activeTab=tab;render();window.scrollTo(0,0);}
function formField(name,label,type='text',value='',placeholder='',extra=''){return `<div class="field"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${esc(name)}" type="${type}" ${type==='number'?'min="0" step="0.01" inputmode="decimal"':''} value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}></div>`;}
function openTx(id){
 const tx=id?state.transactions.find(x=>x.id===id):null;const kind=tx?.type||'expense';
 const contents=`<form id="transactionForm" data-id="${esc(id||'')}"><div class="type-toggle" role="group" aria-label="Тип операции">${[['expense','Расход'],['income','Доход'],['transfer','Перевод']].map(([k,label])=>`<button type="button" data-action="tx-type" data-value="${k}" class="${kind===k?'active':''}">${label}</button>`).join('')}</div><input type="hidden" name="type" id="transactionType" value="${kind}">${formField('amount','Сумма, ₽','number',tx?.amount||'','0.00','required')}${formField('title','Название','text',tx?.title||'','Например, продукты','required maxlength="250"')}<div class="form-grid">${formField('date','Дата','date',tx?.date||today(),'','required')}<div class="field"><label for="transactionCategory">Категория</label><select name="category" id="transactionCategory">${catOptions(kind,tx?.category)}</select></div></div>${formField('account','Счёт или банк','text',tx?.account||'','Сбербанк, Т-Банк, наличные','maxlength="80"')}<div class="form-actions"><button type="submit" class="primary-btn">${tx?'Сохранить':'Добавить'}</button>${tx?`<button type="button" class="danger-btn" data-action="delete-tx" data-id="${esc(tx.id)}">Удалить</button>`:''}</div></form>`;
 openModal(tx?'Редактировать операцию':'Новая операция',contents);
}
function openBudget(id){
 const selected=id||state.categories.find(c=>c.kind==='expense')?.id;
 const budget=state.budgets[selected]||'';
 openModal(id?'Изменить лимит':'Новый бюджет',`<form id="budgetForm" data-old-id="${esc(id||'')}"><div class="field"><label>Категория расходов</label><select name="category" id="budgetCategory">${catOptions('expense',selected)}</select></div>${formField('limit','Лимит в месяц, ₽','number',budget,'Например, 20000','required')}<p class="subtle">Один и тот же лимит используется каждый месяц.</p><div class="form-actions"><button type="submit" class="primary-btn">Сохранить</button>${id?`<button type="button" data-action="delete-budget" data-id="${esc(id)}" class="danger-btn">Удалить</button>`:''}</div></form>`);
 $('#budgetCategory').addEventListener('change',event=>{$('#f-limit').value=state.budgets[event.target.value]||'';});
}
function openDebt(id){
 const debt=state.debts.find(d=>d.id===id);
 openModal(debt?'Изменить кредит':'Добавить кредит',`<form id="debtForm" data-id="${esc(id||'')}">${formField('name','Название кредита','text',debt?.name||'','Например, ипотека','required maxlength="100"')}${formField('balance','Остаток основного долга, ₽','number',debt?.balance??'','','required')}<div class="form-grid">${formField('rate','Ставка, % годовых','number',debt?.rate??'','','required')}${formField('payment','Платёж в месяц, ₽','number',debt?.payment??'','','required')}</div><div class="notice warn">Это справочник по долгам, а не связь с банком. Остаток нужно обновлять после платежей.</div><div class="form-actions"><button type="submit" class="primary-btn">Сохранить</button>${debt?`<button type="button" class="danger-btn" data-action="delete-debt" data-id="${esc(id)}">Удалить</button>`:''}</div></form>`);
}
function parseCsv(text,delim){
 const rows=[];let row=[],value='',inside=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(inside&&text[i+1]==='"'){value+='"';i++;}else inside=!inside;}
  else if(c===delim&&!inside){row.push(value.trim());value='';}
  else if((c==='\n'||c==='\r')&&!inside){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value.trim());value='';if(row.some(x=>x!==''))rows.push(row);row=[];}
  else value+=c;
 }
 row.push(value.trim());if(row.some(x=>x!==''))rows.push(row);
 return rows;
}
function detectDelim(text){
 const firstLine=text.split(/\r?\n/).filter(x=>x.trim()).slice(0,5).join('\n');
 return [';','\t',','].map(d=>[d,parseCsv(firstLine,d)[0]?.length||0]).sort((a,b)=>b[1]-a[1])[0][0];
}
function normalizedHeader(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]/gi,'');}
function headerGuess(headers,patterns,used=[]){const pairs=headers.map((h,i)=>[normalizedHeader(h),i]).filter(([,i])=>!used.includes(i));for(const pattern of patterns){const exact=pairs.find(([h])=>h===normalizedHeader(pattern));if(exact)return exact[1];}for(const pattern of patterns){const part=pairs.find(([h])=>h.includes(normalizedHeader(pattern)));if(part)return part[1];}return -1;}
function numberFromText(input){
 let s=String(input??'').trim().replace(/[\s\u00A0\u202F₽$€]/g,'').replace(/(RUB|RUR)/gi,'');
 const minus=/^\(.*\)$/.test(s)||s.startsWith('-')||s.endsWith('-');
 s=s.replace(/[()\-+]/g,'');const commas=s.lastIndexOf(','),dots=s.lastIndexOf('.');
 if(commas>=0&&dots>=0){if(commas>dots)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
 else if(commas>=0)s=s.replace(',','.');
 else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');
 if(!/^\d+(\.\d+)?$/.test(s))return null;
 const n=Number(s)*(minus?-1:1);return Number.isFinite(n)&&Math.abs(n)<1e12?n:null;
}
function parseBankDate(value){
 const s=String(value??'').trim();let yyyy,mm,dd;
 let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
 if(m){yyyy=+m[1];mm=+m[2];dd=+m[3];}
 else {m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);if(m){dd=+m[1];mm=+m[2];yyyy=+m[3];}}
 if(!m&&/^\d{5}(\.\d+)?$/.test(s)){const d=new Date(Date.UTC(1899,11,30)+Number(s)*86400000);yyyy=d.getUTCFullYear();mm=d.getUTCMonth()+1;dd=d.getUTCDate();}
 if(!yyyy||yyyy<2000||yyyy>2100||!mm||mm>12||!dd||dd>31)return null;
 const d=new Date(yyyy,mm-1,dd);if(d.getFullYear()!==yyyy||d.getMonth()+1!==mm||d.getDate()!==dd)return null;
 return `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
function importCategory(value,type='expense'){
 if(type==='income')return /возврат|refund/i.test(value)?'refund':/зарплат|salary|payroll/i.test(value)?'salary':'additional';
 const s=String(value).toLocaleLowerCase('ru-RU');
 const tests=[[/супермар|продукт|пятероч|магнит|перекрест|лента|дикси|food|grocery/,'food'],[/авто|азс|заправ|бенз|топлив|нефт|лукойл/,'auto'],[/жкх|коммунал|газпром межрегион|электрич|водоканал|аренд|дом/,'home'],[/аптек|лекар|медиц|клиник|health/,'health'],[/детск|игруш|школ|садик|дети/,'children'],[/такси|яндекс go|метро|автобус|transport/,'transport'],[/интернет|связь|мтс|мегафон|билайн|мобильн/,'services'],[/кредит|ипотек|погашен/,'credit'],[/ресторан|кафе|кино|развлечен|досуг/,'leisure'],[/маркетплейс|ozon|озон|wildberries|вайлдберриз|одежд|покупк/,'shopping']];
 for(const [pattern,id] of tests)if(pattern.test(s))return id;
 return 'other-expense';
}
function importRow(row,columns,opts){
 const val=id=>columns[id]>=0?String(row[columns[id]]??'').trim():'';
 const date=parseBankDate(val('date'));if(!date)return null;
 const raw=numberFromText(val('amount'));
 const debit=numberFromText(val('debit'));
 const credit=numberFromText(val('credit'));
 let amount=raw;let type=opts.positiveType;
 if(columns.debit>=0||columns.credit>=0){
  if(credit!==null&&credit!==0){amount=Math.abs(credit);type='income';}
  else if(debit!==null&&debit!==0){amount=Math.abs(debit);type='expense';}
  else if(raw===null||raw===0)return null;
 }
 if(amount===null||amount===0)return null;
 if(amount<0)type='expense';
 const marker=`${val('type')} ${val('category')}`.toLocaleLowerCase('ru-RU');
 if(/перевод между своими|между своими счетами|собственным счетам/.test(marker))type='transfer';
 else if(/возврат|зачислен|поступлен|пополнен|зарплат|cashback|кэшбэк|кешбэк/.test(marker))type='income';
 else if(/списан|покупк|оплат|расход|сняти|удержан|комисси/.test(marker))type='expense';
 if(opts.forceType!=='auto')type=opts.forceType;
 const title=val('title')||val('category')||'Операция по выписке';
 const catSource=val('category')+' '+title;
 return {id:uid(),type,amount:Math.abs(amount),date,title:title.slice(0,250),category:type==='transfer'?'transfer':importCategory(catSource,type),account:opts.account,source:'csv'};
}
function csvColumns(headers){const used=[];const get=(key,terms)=>{const idx=headerGuess(headers,terms,used);if(idx>=0)used.push(idx);return idx;};return {
  date:get('date',['датаоперации','датаплатежа','дататранзакции','датапроведения','дата','date','datetime','time']),
  title:get('title',['описаниеоперации','описание','назначениеплатежа','детали','торговаяточка','контрагент','description','merchant','details','операция']),
  amount:get('amount',['суммаоперации','суммаплатежа','сумма','amount','итого','sum']),
  debit:get('debit',['списание','расход','debit','outflow']),
  credit:get('credit',['зачисление','приход','credit','inflow']),
  type:get('type',['типоперации','видоперации','тип','type','status']),
  category:get('category',['категорияоперации','категория','category','mcc'])
 };}
function selectColumn(label,key,headers,selected){return `<div class="field"><label for="col-${esc(key)}">${esc(label)}</label><select id="col-${esc(key)}" name="${esc(key)}"><option value="-1">Не использовать</option>${headers.map((h,i)=>`<option value="${i}" ${i===selected?'selected':''}>${esc(h||`Колонка ${i+1}`)}</option>`).join('')}</select></div>`;}
function csvPreview(){
 if(!importDraft)return;
 const {rows,headers,filename}=importDraft;const fields=csvColumns(headers);
 const bank=/tinkoff|тиньк|t-bank|т-банк/i.test(filename)?'Т-Банк':/sber|сбер/i.test(filename)?'Сбербанк':'Банк';
 openModal('Импорт выписки',`<form id="importForm"><div class="notice">Файл «${esc(filename)}» · ${rows.length} строк. Проверьте сопоставление колонок перед загрузкой.</div><div class="small-top">${selectColumn('Дата *','date',headers,fields.date)}${selectColumn('Описание','title',headers,fields.title)}${selectColumn('Сумма (со знаком)','amount',headers,fields.amount)}<div class="form-grid">${selectColumn('Расход, отдельная колонка','debit',headers,fields.debit)}${selectColumn('Приход, отдельная колонка','credit',headers,fields.credit)}</div><div class="form-grid">${selectColumn('Тип операции','type',headers,fields.type)}${selectColumn('Категория банка','category',headers,fields.category)}</div>${formField('account','Название счёта / банка','text',bank,'Название банка','required maxlength="80"')}<div class="field"><label>Если сумма положительная и тип неясен</label><select id="importPositive"><option value="expense">Считать расходом</option><option value="income">Считать доходом</option></select></div><div class="field"><label>Тип импорта</label><select id="importForce"><option value="auto">Определить автоматически</option><option value="expense">Все операции — расходы</option><option value="income">Все операции — доходы</option><option value="transfer">Все операции — переводы</option></select></div><p class="subtle">Отрицательные суммы обычно считаются расходами, положительные — по выбранному правилу. Верните неверно определённую операцию через редактирование.</p><button type="button" class="secondary-btn wide" data-action="preview-import">Проверить первые операции</button><div id="importPreview" class="import-preview"><p class="subtle">Нажмите «Проверить первые операции».</p></div><button type="submit" class="primary-btn wide">Импортировать операции</button></div></form>`);
}
function readImportMapping(){
 const fields=['date','title','amount','debit','credit','type','category'];const columns={};for(const key of fields)columns[key]=Number($(`#col-${key}`).value);
 if(columns.date<0||columns.amount<0&&(columns.credit<0&&columns.debit<0))throw new Error('Выберите колонку даты и суммы (либо списание/приход)');
 const opts={account:$('#f-account').value.trim()||'Банк',positiveType:$('#importPositive').value,forceType:$('#importForce').value};
 return {columns,opts};
}
function collectImport(){const {columns,opts}=readImportMapping();return importDraft.rows.map(row=>importRow(row,columns,opts)).filter(Boolean);}
function fingerprint(tx){return [tx.type,tx.date,tx.amount.toFixed(2),tx.title.trim().toLocaleLowerCase('ru-RU'),tx.account.trim().toLocaleLowerCase('ru-RU')].join('~');}
async function handleCsv(file){
 if(!file)return;
 if(file.size>15*1024*1024)throw new Error('Максимальный размер CSV: 15 МБ');
 const buf=await file.arrayBuffer();let content;
 try{content=new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch{content=new TextDecoder('windows-1251').decode(buf);}
 content=content.replace(/^\uFEFF/,'');
 const delim=detectDelim(content);const data=parseCsv(content,delim);
 if(data.length<2)throw new Error('В файле не найдена таблица с операциями');
 const headers=data[0];const rows=data.slice(1,100001);
 if(rows.length<1)throw new Error('В выписке нет операций');
 importDraft={headers,rows,filename:file.name};csvPreview();
}
function toB64(uint8){let str='';const size=8192;for(let i=0;i<uint8.length;i+=size)str+=String.fromCharCode(...uint8.subarray(i,i+size));return btoa(str);}
function fromB64(s){const raw=atob(s);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function keyForPassword(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encryptBackup(password){
 const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));const key=await keyForPassword(password,salt);const data=new TextEncoder().encode(JSON.stringify(state));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data));
 return {type:'moi-finansy-encrypted-backup',version:1,created:new Date().toISOString(),kdf:'PBKDF2-SHA256',iterations:250000,algorithm:'AES-256-GCM',salt:toB64(salt),iv:toB64(iv),data:toB64(ciphertext)};
}
async function decryptBackup(payload,password){
 if(payload.type!=='moi-finansy-encrypted-backup'||payload.version!==1)throw new Error('Неподдерживаемый формат копии');
 const key=await keyForPassword(password,fromB64(payload.salt));
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(payload.iv)},key,fromB64(payload.data));
 return normalizeState(JSON.parse(new TextDecoder().decode(plaintext)));
}
function downloadText(text,filename){const blob=new Blob([text],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function openExport(){
 if(!crypto?.subtle){notify('Шифрование недоступно. Откройте приложение по HTTPS.');return;}
 openModal('Резервная копия',`<form id="exportForm"><div class="notice">Резервная копия будет зашифрована паролем по AES-256-GCM. Сохраните её в приложении «Файлы» в надёжном месте.</div><div class="small-top">${formField('password','Придумайте пароль для копии','password','','Не менее 8 символов','required minlength="8" autocomplete="new-password"')}${formField('confirm','Повторите пароль','password','','Подтвердите пароль','required minlength="8" autocomplete="new-password"')}<p class="subtle">Если забудете пароль, восстановить эту копию будет невозможно.</p><button type="submit" class="primary-btn wide">Скачать зашифрованную копию</button></div></form>`);
}
function openRestore(file){
 if(!file)return;
 openModal('Восстановить данные',`<form id="restoreForm"><div class="notice warn">Восстановление заменит текущие данные приложения содержимым копии. Рекомендуем предварительно сохранить текущую копию.</div><div class="small-top"><p class="subtle">Файл: ${esc(file.name)}</p>${formField('password','Пароль резервной копии','password','','Введите пароль','required')}<button type="submit" class="primary-btn wide">Восстановить данные</button></div></form>`);
 $('#restoreForm')._file=file;
}
async function restoreFromFile(file,password){
 if(file.size>50*1024*1024)throw new Error('Слишком большой файл');
 const payload=JSON.parse(await file.text());return decryptBackup(payload,password);
}
function setBusy(b){isBusy=b;$$('.sheet button[type=submit]').forEach(x=>x.disabled=b);}
async function handleSubmit(event){
 const form=event.target;if(!['transactionForm','budgetForm','debtForm','importForm','exportForm','restoreForm'].includes(form.id))return;
 event.preventDefault();if(isBusy)return;setBusy(true);
 try{
  const data=new FormData(form);
  if(form.id==='transactionForm'){
   const type=data.get('type');const amount=Number(data.get('amount'));const title=String(data.get('title')||'').trim();const date=data.get('date');
   if(!['income','expense','transfer'].includes(type)||!(amount>0)||!title||!parseBankDate(date))throw new Error('Проверьте сумму, название и дату');
   const existing=state.transactions.find(x=>x.id===form.dataset.id);
   const tx={id:existing?.id||uid(),type,amount,title,date,category:data.get('category')||'other-expense',account:String(data.get('account')||'').trim(),source:existing?.source||'manual'};
   if(existing)Object.assign(existing,tx);else state.transactions.push(tx);
   await commit();closeModal();notify('Операция сохранена');
  }else if(form.id==='budgetForm'){
   const category=String(data.get('category'));const limit=Number(data.get('limit'));
   if(!(limit>0)||!state.categories.some(c=>c.id===category&&c.kind==='expense'))throw new Error('Укажите категорию и лимит больше нуля');
   if(form.dataset.oldId&&form.dataset.oldId!==category)delete state.budgets[form.dataset.oldId];
   state.budgets[category]=limit;await commit();closeModal();notify('Лимит установлен');
  }else if(form.id==='debtForm'){
   const name=String(data.get('name')||'').trim(),balance=Number(data.get('balance')),rate=Number(data.get('rate')),payment=Number(data.get('payment'));
   if(!name||[balance,rate,payment].some(n=>!Number.isFinite(n)||n<0))throw new Error('Проверьте данные кредита');
   const existing=state.debts.find(x=>x.id===form.dataset.id);const debt={id:existing?.id||uid(),name,balance,rate,payment};
   if(existing)Object.assign(existing,debt);else state.debts.push(debt);
   await commit();closeModal();notify('Кредит сохранён');
  }else if(form.id==='importForm'){
   const incoming=collectImport();if(!incoming.length)throw new Error('Не удалось найти подходящие операции. Проверьте колонки и формат дат.');
   const existing=new Set(state.transactions.map(fingerprint));let skipped=0;
   for(const tx of incoming){const fingerprintValue=fingerprint(tx);if(existing.has(fingerprintValue)){skipped++;continue;}existing.add(fingerprintValue);state.transactions.push(tx);}
   await commit();closeModal();const added=incoming.length-skipped;notify(`Импортировано: ${added}; совпадений пропущено: ${skipped}`);activeTab='transactions';render();
   importDraft=null;
  }else if(form.id==='exportForm'){
   const pass=String(data.get('password')||''),confirmPass=String(data.get('confirm')||'');
   if(pass.length<8||pass!==confirmPass)throw new Error('Пароль должен содержать 8+ символов и совпадать в обоих полях');
   const backup=await encryptBackup(pass);downloadText(JSON.stringify(backup),`moi-finansy-${today()}.mfinance`);closeModal();notify('Зашифрованная копия подготовлена');
  }else if(form.id==='restoreForm'){
   const restored=await restoreFromFile(form._file,String(data.get('password')||''));
   if(!confirm('Заменить все существующие данные содержимым резервной копии?'))return;
   const previous=state;state=restored;
   try{await saveState();}catch(e){state=previous;throw e;}
   activeMonth=monthNow();closeModal();render();notify('Резервная копия восстановлена');
  }
 }catch(e){console.error(e);notify(e instanceof DOMException?'Неверный пароль или повреждённая копия':(e.message||'Ошибка'));}
 finally{setBusy(false);}
}
async function handleAction(event){
 const b=event.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action, id=b.dataset.id;
 if(action==='month-prev'||action==='month-next'){activeMonth=monthShift(activeMonth,action==='month-prev'?-1:1);render();}
 else if(action==='add-tx')openTx();
 else if(action==='edit-tx')openTx(id);
 else if(action==='add-budget')openBudget();
 else if(action==='edit-budget')openBudget(id);
 else if(action==='add-debt')openDebt();
 else if(action==='edit-debt')openDebt(id);
 else if(action==='view-transactions')activateTab('transactions');
 else if(action==='filter'){transactionFilter=b.dataset.value;render();}
 else if(action==='tx-type'){
   const kind=b.dataset.value;$('#transactionType').value=kind;$$('.type-toggle button').forEach(btn=>btn.classList.toggle('active',btn.dataset.value===kind));
   $('#transactionCategory').innerHTML=catOptions(kind);
 }
 else if(action==='delete-tx'||action==='delete-budget'||action==='delete-debt'){
   if(!confirm('Удалить эту запись?'))return;
   if(action==='delete-tx')state.transactions=state.transactions.filter(x=>x.id!==id);
   if(action==='delete-budget')delete state.budgets[id];
   if(action==='delete-debt')state.debts=state.debts.filter(x=>x.id!==id);
   await commit();closeModal();notify('Запись удалена');
 }
 else if(action==='import-csv'){$('#csvFile').click();}
 else if(action==='preview-import'){
   try{const tx=collectImport(),preview=tx.slice(0,7).map(x=>`<p>${esc(x.date)} · ${esc(x.title)} · ${x.type==='income'?'+':x.type==='expense'?'−':'↔'}${money(x.amount)}</p>`).join('');$('#importPreview').innerHTML=`<div class="subtle">Распознано ${tx.length} операций из ${importDraft.rows.length} строк:</div>${preview||'<p>Нет распознанных строк — проверьте колонки</p>'}`;}
   catch(e){notify(e.message);}
 }
 else if(action==='export-backup')openExport();
 else if(action==='restore-backup')$('#backupFile').click();
 else if(action==='clear-all'){
   if(!confirm('Удалить все операции, кредиты и бюджеты с этого iPhone? Действие необратимо.'))return;
   if(!confirm('Подтвердите удаление ВСЕХ финансовых записей.'))return;
   state=DEFAULT_STATE();await commit();notify('Локальные данные удалены');
 }
}
async function start(){
 await initStorage();await loadState();render();
 $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));
 $('#topAdd').addEventListener('click',()=>openTx());
 document.addEventListener('click',handleAction);
 document.addEventListener('submit',handleSubmit);
 $('#closeModal').addEventListener('click',closeModal);
 $('#modalBackdrop').addEventListener('click',event=>{if(event.target===$('#modalBackdrop'))closeModal();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();});
 $('#app').addEventListener('input',event=>{if(event.target.id==='transactionSearch'){
  transactionSearch=event.target.value;const position=event.target.selectionStart;render();const input=$('#transactionSearch');input.focus();input.setSelectionRange(position,position);
 }});
 $('#csvFile').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(file)try{await handleCsv(file);}catch(e){notify(e.message||'Не удалось прочитать файл');}});
 $('#backupFile').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)openRestore(file);});
 if(storageFallback)notify('Доступно только резервное локальное хранение. Делайте копии чаще.');
 if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW registration failed',e));
}
start().catch(e=>{console.error(e);$('#app').innerHTML=`<div class="notice warn">Ошибка запуска. Попробуйте обновить страницу. Если проблема повторится, не удаляйте приложение, чтобы сохранить данные.</div>`;});