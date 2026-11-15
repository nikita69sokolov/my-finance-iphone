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
  {id:'subscriptions',name:'Подписки',icon:'🔁',color:'#b2a5fa',kind:'expense'},
  {id:'services',name:'Связь и услуги',icon:'📱',color:'#a9accb',kind:'expense'},
  {id:'other-expense',name:'Прочее',icon:'📦',color:'#8393a6',kind:'expense'},
  {id:'salary',name:'Зарплата',icon:'💼',color:'#6ddcb6',kind:'income'},
  {id:'additional',name:'Доп. доход',icon:'💰',color:'#87cbb2',kind:'income'},
  {id:'refund',name:'Возвраты',icon:'↩️',color:'#9bdad0',kind:'income'},
  {id:'other-income',name:'Другие поступления',icon:'✨',color:'#c4d3b3',kind:'income'},
  {id:'transfer',name:'Перевод между счетами',icon:'↔️',color:'#8393a6',kind:'transfer'}
];
const APP_VERSION = '1.5.0';
const DEFAULT_STATE = () => ({version:4,transactions:[],budgets:{},budgetMonths:{},budgetPlans:{},debts:[],subscriptions:[],savings:[],categories:structuredCloneSafe(CATEGORY_DEFAULTS)});
let state = DEFAULT_STATE();
let db = null;
let storageFallback = false;
let activeTab = 'home';
let activeMonth = monthNow();
let transactionFilter = 'all';
let transactionSearch = '';
let transactionCategoryFilter = '';
let importDraft = null;
let subscriptionCandidatesHidden = false;
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
  if(!input || typeof input!=='object' || !Array.isArray(input.transactions) || !Array.isArray(input.debts) || !input.budgets || typeof input.budgets!=='object' || Array.isArray(input.budgets)) throw new Error('Неверный формат резервной копии');
  const cats=Array.isArray(input.categories)?input.categories:CATEGORY_DEFAULTS;
  const keptCats=cats.filter(c=>c && typeof c.id==='string' && typeof c.name==='string' && ['expense','income','transfer'].includes(c.kind)).slice(0,150);
  for(const cat of CATEGORY_DEFAULTS){if(!keptCats.some(c=>c.id===cat.id))keptCats.push(structuredCloneSafe(cat));}
  return {
    version:4,
    ...FinanceInsights.normalizePlanning(input),
    categories:keptCats,
    transactions:input.transactions.filter(x=>x && typeof x.date==='string' && ['expense','income','transfer'].includes(x.type) && Number.isFinite(Number(x.amount))).slice(0,100000).map(x=>({id:String(x.id||uid()),type:x.type,date:x.date,title:String(x.title||'Операция').slice(0,250),amount:Math.abs(Number(x.amount)),category:String(x.category||'other-expense'),account:String(x.account||'').slice(0,80),source:String(x.source||'manual').slice(0,80),sourceRef:String(x.sourceRef||'').slice(0,180),bankCategory:String(x.bankCategory||'').slice(0,100),transactionTime:String(x.transactionTime||'').slice(0,8),savingsFlow:[-1,1].includes(Number(x.savingsFlow))?Number(x.savingsFlow):0,savingsId:String(x.savingsId||'').slice(0,100)})),
    debts:input.debts.filter(x=>x && typeof x.name==='string').slice(0,100).map(x=>({
      id:String(x.id||uid()),name:x.name.slice(0,100),kind:['mortgage','loan','creditcard','other'].includes(x.kind)?x.kind:'loan',
      lender:String(x.lender||'').slice(0,100),balance:Math.max(0,validNumber(x.balance)),rate:Math.max(0,validNumber(x.rate)),
      payment:Math.max(0,validNumber(x.payment)),dueDay:Math.min(31,Math.max(0,Number(x.dueDay)||0)),
      balanceDate:parseBankDate(x.balanceDate)||'',notes:String(x.notes||'').slice(0,350),
       contractTail:/^\d{4}$/.test(String(x.contractTail||''))?String(x.contractTail):'',source:String(x.source||'manual').slice(0,40),balanceIsProjected:!!x.balanceIsProjected,rateKnown:x.rateKnown!==false,schedule:Array.isArray(x.schedule)?x.schedule.slice(0,1000).filter(r=>r&&parseBankDate(r.date)&&['principal','interest','payment','balance'].every(k=>Number.isFinite(Number(r[k]))&&Number(r[k])>=0)).map(r=>({date:parseBankDate(r.date),principal:Number(r.principal),interest:Number(r.interest),payment:Number(r.payment),balance:Number(r.balance)})):[]
    })),
    savings:(Array.isArray(input.savings)?input.savings:[]).filter(x=>x&&typeof x.name==='string').slice(0,50).map(x=>({id:String(x.id||uid()),name:String(x.name).slice(0,100),bank:String(x.bank||'').slice(0,100),kind:['deposit','savings','kopilka'].includes(x.kind)?x.kind:'deposit',balance:x.balance===null||x.balance===undefined||x.balance===''?null:Math.max(0,validNumber(x.balance)),rate:x.rate===null||x.rate===undefined||x.rate===''?null:Math.min(100,Math.max(0,validNumber(x.rate))),balanceDate:parseBankDate(x.balanceDate)||'',maturity:parseBankDate(x.maturity)||'',notes:String(x.notes||'').slice(0,200),source:String(x.source||'manual').slice(0,60)})),
    subscriptions:(Array.isArray(input.subscriptions)?input.subscriptions:[]).filter(x=>x&&typeof x.name==='string').slice(0,250).map(x=>({
      id:String(x.id||uid()),name:x.name.slice(0,120),amount:Math.max(0,validNumber(x.amount)),
      cycle:['weekly','monthly','quarterly','yearly'].includes(x.cycle)?x.cycle:'monthly',
      nextDate:parseBankDate(x.nextDate)||'',
      status:['active','paused','cancelled'].includes(x.status)?x.status:'active',
      source:x.source==='statement'?'statement':'manual',
      matchKey:String(x.matchKey||'').slice(0,120), notes:String(x.notes||'').slice(0,250)
    })),
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
  const analysis=financeAnalysis();const {income,expense}=analysis;const net=income-expense;
  const byCat=Object.entries(analysis.byCategory).map(([id,amount])=>({id,amount,category:getCategory(id)})).sort((a,b)=>b.amount-a.amount);
  let progress=0;const segment=byCat.slice(0,5).map((c,i)=>{const start=progress;progress+=100*c.amount/Math.max(expense,1);return {c,start,finish:progress,color:c.category.color};});
  const debtDue=state.debts.filter(d=>d.balance>0).reduce((a,d)=>a+d.payment,0);
  const subDue=state.subscriptions.filter(x=>x.status==='active').reduce((a,x)=>a+subscriptionMonthly(x),0);
  const gradient=segment.length?`conic-gradient(${segment.map(s=>`${s.color} ${s.start.toFixed(2)}% ${s.finish.toFixed(2)}%`).join(',')}${progress<100?`, #536e83 ${progress.toFixed(2)}% 100%`:''})`:'conic-gradient(#2a4152 0 100%)';
  const legend=byCat.slice(0,4).map(c=>`<div class="legend-row"><span class="legend-label"><i class="dot" style="background:${esc(c.category.color)}"></i>${esc(c.category.name)}</span><b class="legend-value">${Math.round(c.amount/Math.max(expense,1)*100)}%</b></div>`).join('');
  return heading('Обзор')+monthBar()+`
  <section class="hero"><div class="hero-label">Чистый итог за месяц</div><div class="hero-value">${net>=0?'+':'−'}${money(Math.abs(net))}</div><span class="pill">${net>=0?'↗ Доходы выше расходов':'↘ Расходы выше доходов'}</span><div class="hero-foot small-top">Разница между доходами и расходами, не баланс банковского счёта</div></section>
  <div class="two-col"><div class="metric-card"><div class="metric-head"><span class="metric-symbol in">↙</span>Доходы</div><div class="metric-value">${short(income)}</div></div><div class="metric-card"><div class="metric-head"><span class="metric-symbol out">↗</span>Расходы</div><div class="metric-value">${short(expense)}</div></div></div>
  ${renderAnalytics(analysis)}
  ${renderBudgetTeaser(analysis)}
  ${sectionHeader('Куда уходят деньги',byCat.length?'Все операции':'','view-transactions')}
  <div class="panel">${byCat.length?`<div class="chart-wrap"><div class="donut" role="img" aria-label="Расходы по категориям" style="background:${gradient}"><div class="donut-center"><div><b>${short(expense)}</b><span>всего расходов</span></div></div></div><div class="legend">${legend}</div></div>`:empty('◔','Категории появятся здесь','Когда добавите расходы, покажем их распределение.')}</div>
  ${sectionHeader('Регулярные обязательства')}
  <div class="two-col"><div class="metric-card"><div class="metric-head">🏦 Кредиты и ипотека</div><div class="metric-value">${short(debtDue)}</div><button class="text-link" type="button" data-action="view-debts">Платежи →</button></div><div class="metric-card"><div class="metric-head">🔁 Подписки</div><div class="metric-value">${short(subDue)}</div><button class="text-link" type="button" data-action="view-subscriptions">Открыть →</button></div></div>
  <p class="subtle">Плановые суммы за месяц. Уже проведённые списания в разделе расходов повторно не прибавляются.</p>
  ${sectionHeader('Последние операции','Посмотреть все','view-transactions')}
  ${txList(monthTx().sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id))),4)}
  <div class="form-actions small-top"><button type="button" class="primary-btn wide" data-action="add-tx">+ Новая операция</button><button type="button" class="secondary-btn" data-action="import-sber">Сбер PDF</button></div>`;
}
function renderTransactions(){
  let all=monthTx().sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)));
  if(transactionFilter!=='all')all=all.filter(x=>x.type===transactionFilter);
  if(transactionCategoryFilter)all=all.filter(x=>x.category===transactionCategoryFilter);
  if(transactionSearch){const search=transactionSearch.toLocaleLowerCase('ru-RU');all=all.filter(x=>`${x.title} ${x.account} ${getCategory(x.category).name} ${x.amount}`.toLocaleLowerCase('ru-RU').includes(search));}
  return heading('Операции','ИСТОРИЯ',`<button class="secondary-btn" data-action="import-csv">Импорт</button>`)+monthBar()+`${transactionCategoryFilter?`<button class="category-filter" type="button" data-action="clear-category-filter">${esc(getCategory(transactionCategoryFilter).name)} <span aria-hidden="true">✕</span><span class="sr-only">Сбросить категорию</span></button>`:''}<input id="transactionSearch" type="search" class="search-input" placeholder="Поиск по операциям" autocomplete="off" value="${esc(transactionSearch)}" aria-label="Поиск операций"><div class="filter-row">${[['all','Все'],['expense','Расходы'],['income','Доходы'],['transfer','Переводы']].map(([id,name])=>`<button class="filter ${transactionFilter===id?'active':''}" type="button" data-action="filter" data-value="${id}">${name}</button>`).join('')}</div><p class="subtle">Найдено: ${all.length} · ${money(all.filter(x=>x.type==='expense').reduce((n,x)=>n+x.amount,0))} расходов</p>${txList(all)}<button type="button" data-action="add-tx" class="primary-btn wide small-top">+ Добавить операцию</button>`;
}
function renderBudgets(){
  return renderBudgetPage();
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
// Scheduled amounts are separate from bank transactions. Never double-count them as actual expenses.
function dueDateForDay(day, after=today()){
 if(!day)return '';
 const [y,m,d]=after.split('-').map(Number);
 const get=(yy,mm)=>{const last=new Date(yy,mm,0).getDate();return `${yy}-${String(mm).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;};
 const current=get(y,m);if(current>=after)return current;
 const next=new Date(y,m,1);return get(next.getFullYear(),next.getMonth()+1);
}
function daysBetween(a,b){return Math.round((new Date(`${b}T12:00:00Z`)-new Date(`${a}T12:00:00Z`))/86400000);}
function subscriptionMonthly(s){return s.amount*({weekly:52/12,monthly:1,quarterly:1/3,yearly:1/12}[s.cycle]||1);}
function addCycleDate(iso,cycle){
 const [y,m,d]=iso.split('-').map(Number);
 if(cycle==='weekly'){const q=new Date(Date.UTC(y,m-1,d+7));return q.toISOString().slice(0,10);}
 const incr={monthly:1,quarterly:3,yearly:12}[cycle]||1;
 const base=new Date(Date.UTC(y,m-1+incr,1));const last=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate();
 return `${base.getUTCFullYear()}-${String(base.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
}
function nextAfter(last,cycle){let date=addCycleDate(last,cycle);for(let i=0;i<150&&date<today();i++)date=addCycleDate(date,cycle);return date;}
function scheduledStatus(date){if(!date)return 'Дата не задана';const days=daysBetween(today(),date);return days<0?'Требует проверки':days===0?'Сегодня':days<=7?`Через ${days} дн.`:dateView(date);}
function renderDebts(){
 const active=state.debts.filter(d=>d.balance>0);
 const total=active.reduce((n,d)=>n+d.balance,0),payments=active.reduce((n,d)=>n+d.payment,0);
  const monthlyInterest=active.reduce((n,d)=>{const future=d.schedule?.find(x=>x.date>=today());return n+(future?.interest??(d.rateKnown!==false?d.balance*d.rate/1200:0));},0);
 return heading('Кредиты и ипотека','ДОЛГОВАЯ НАГРУЗКА',`<button class="secondary-btn" data-action="add-debt">+ Добавить</button>`)+`
 <div class="form-actions small-top"><button type="button" data-action="import-debt-sber" class="secondary-btn wide">Распознать кредит из PDF Сбербанка</button></div>
  <div class="hero"><div class="hero-label">Общий остаток долга</div><div class="hero-value">${short(total)}</div><div class="hero-foot">Платежи в месяц: ${short(payments)} · Из них проценты ≈ ${short(monthlyInterest)}</div></div>
  <div class="notice warn small-top">Данные графика показывают ПЛАН, а не фактическую задолженность. Импорт кредитных PDF только на iPhone; приложение не проводит платежи и не входит в банк.</div>
 ${sectionHeader('Мои обязательства')}
 ${state.debts.length?state.debts.map(d=>{const due=dueDateForDay(d.dueDay);const nextRow=d.schedule?.find(x=>x.date>=today());const interest=nextRow?.interest??(d.rateKnown!==false?d.balance*d.rate/1200:null);return `<div class="debt-card"><div class="budget-line"><div class="debt-name">${d.kind==='mortgage'?'🏠 ':d.kind==='creditcard'?'💳 ':'🏦 '}${esc(d.name)}</div><button type="button" class="text-link" data-action="edit-debt" data-id="${esc(d.id)}">Изменить</button></div><div class="subtle">${esc(d.lender||'Банк не указан')} ${d.dueDay?'· Платёж '+d.dueDay+'-го числа':''}</div><div class="debt-total">${money(d.balance)}</div>${d.balanceIsProjected?'<p class="subtle">Расчётный остаток по графику (не подтверждён банком)</p>':''}<div class="debt-stats"><div><small>Ставка</small><strong>${d.rateKnown===false?'Не указана':d.rate+'% годовых'}</strong></div><div><small>Платёж</small><strong>${money(d.payment)}</strong></div></div><p class="subtle">${due?'Следующий плановый платёж: '+dateView(due)+' ('+scheduledStatus(due)+')':'Укажите день платежа'} · ${d.schedule?.length?'График до '+esc(d.schedule.at(-1).date):esc(debtForecast(d))}</p><p class="subtle">${nextRow?'По графику следующий платёж: тело '+money(nextRow.principal)+', проценты '+money(nextRow.interest)+'.':interest===null?'Для расчёта процентов нужна ставка.':'Проценты за условный месяц ≈ '+money(interest)+'.'} ${d.balanceDate?(d.balanceIsProjected?'Расчётный остаток по графику на ':'Остаток проверен ')+dateView(d.balanceDate)+'.':''}</p>${d.notes?`<p class="subtle">${esc(d.notes)}</p>`:''}</div>`;}).join(''):empty('▤','Нет кредитов','Добавьте ипотеку или потребительский кредит: остаток, ставку, сумму и день платежа.','Добавить кредит','add-debt')}
 <p class="footnote">Прогноз приблизительный: без изменения ставок, страховок, комиссий и досрочного погашения. Для точных платежей сверяйтесь с графиком банка.</p>`;
}
const KNOWN_SUBSCRIPTIONS=[
 [/apple\.com\/bill|apple services|itunes|icloud/,'Apple / iCloud'],
 [/яндекс\s*(плюс|plus)|yandex\s*(plus|music)|ya\.plus/,'Яндекс Плюс'],
 [/sberprime|сберпрайм/,'СберПрайм'],
 [/t[\s-]?bank\s*pro|т[\s-]?банк\s*про|тинькофф\s*про/,'Т-Банк Pro'],
 [/chatgpt|openai/,'ChatGPT'],
 [/telegram\s*premium|телеграм\s*премиум/,'Telegram Premium'],
 [/youtube\s*premium|ютуб\s*премиум/,'YouTube Premium'],
 [/google\s*one/,'Google One'],[/netflix/,'Netflix'],[/spotify/,'Spotify'],
 [/kinopoisk|кинопоиск/,'Кинопоиск'],[/okko|окко/,'Okko'],
 [/(?:^|\W)ivi(?:\W|$)|иви/,'Иви'],[/wink|винк/,'Wink'],
 [/kion|кион/,'Kion'],[/megogo|мегого/,'Megogo'],
 [/vk\s*(music|музыка)|вк\s*музыка/,'Музыка'],
 [/ozon\s*premium|озон\s*премиум/,'Ozon Premium']
];
function subMerchant(text){
 const s=String(text||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
 for(const [re,name] of KNOWN_SUBSCRIPTIONS){if(re.test(s))return {key:name.toLowerCase(),name,known:true};}
 // Remove common bank operation prefixes and terminal IDs; generic merchants remain candidates only.
 const cleaned=s.replace(/(?:оплата|покупка|списание|безналичная|операция|payment|purchase|card|карта|pos|online|услуги|перевод)\s*/g,' ').replace(/\d{4,}|\*+/g,' ').replace(/[^а-яa-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 if(cleaned.length<5)return null;
 const key=cleaned.split(' ').slice(0,3).join(' ').slice(0,60);
 return {key,name:key.replace(/^./,ch=>ch.toUpperCase()),known:false};
}
function proposedSubscriptions(){
 const groups=new Map();
 for(const tx of state.transactions){
  if(tx.type!=='expense'||!(tx.amount>0)||tx.amount>100000||!parseBankDate(tx.date)||tx.category==='credit'||tx.category==='transfer')continue;
  const m=subMerchant(tx.title);if(!m)continue;
  const k=m.key;if(!groups.has(k))groups.set(k,{...m,transactions:[]});groups.get(k).transactions.push(tx);
 }
 const active=state.subscriptions.filter(x=>x.status!=='cancelled');const candidates=[];
 for(const group of groups.values()){
  if(active.some(s=>s.matchKey===group.key||s.name.toLowerCase()===group.name.toLowerCase()))continue;
  const rows=group.transactions.sort((a,b)=>a.date.localeCompare(b.date));if(rows.length<2)continue;
  const cycles=[['weekly',5,10],['monthly',25,38],['quarterly',80,103],['yearly',335,398]];
  let best=null;
  for(let i=1;i<rows.length;i++){
   const a=rows[i-1],b=rows[i],gap=daysBetween(a.date,b.date),diff=Math.abs(a.amount-b.amount)/Math.max(a.amount,b.amount);
   if(gap<=0||diff>0.20)continue;
   const hit=cycles.find(([,min,max])=>gap>=min&&gap<=max);
   if(hit)best={a,b,cycle:hit[0],gap};
  }
  if(!best)continue;
  const last=rows[rows.length-1];const relevant=rows.filter(r=>Math.abs(r.amount-last.amount)/Math.max(r.amount,last.amount)<0.20);
  if(relevant.length<2)continue;
  candidates.push({key:group.key,name:group.name,amount:last.amount,cycle:best.cycle,lastDate:last.date,nextDate:nextAfter(last.date,best.cycle),known:group.known,occurrences:rows.length});
 }
 return candidates.sort((a,b)=>Number(b.known)-Number(a.known)||b.occurrences-a.occurrences).slice(0,40);
}
const CYCLE_LABEL={weekly:'неделю',monthly:'месяц',quarterly:'3 месяца',yearly:'год'};
function renderSubscriptions(){
 const active=state.subscriptions.filter(x=>x.status==='active');const monthly=active.reduce((a,x)=>a+subscriptionMonthly(x),0);
 const candidates=proposedSubscriptions();
 return heading('Подписки','РЕГУЛЯРНЫЕ СПИСАНИЯ',`<button class="secondary-btn" type="button" data-action="add-subscription">+ Добавить</button>`)+`
 <div class="hero"><div class="hero-label">Активные подписки · эквивалент за месяц</div><div class="hero-value">${short(monthly)}</div><div class="hero-foot">≈ ${short(monthly*12)} в год · Подписок: ${active.length}</div></div>
 <div class="notice small-top">Мы ищем повторяющиеся списания в выписках, которые вы импортировали. Это предположения — проверьте, что платежи действительно относятся к подписке. Apple ID и другие аккаунты напрямую не читаются.</div>
 ${sectionHeader('Мои подписки')}
 ${state.subscriptions.length?state.subscriptions.map(s=>`<div class="debt-card"><div class="budget-line"><div class="debt-name">🔁 ${esc(s.name)}</div><button class="text-link" type="button" data-action="edit-subscription" data-id="${esc(s.id)}">Изменить</button></div><div class="debt-total">${money(s.amount)} <span class="subtle">/ ${esc(CYCLE_LABEL[s.cycle])}</span></div><div class="subtle">${s.status==='active'?'Активна':s.status==='paused'?'На паузе':'Отменена'} · ${s.source==='statement'?'По выписке':'Добавлена вручную'} · ${s.nextDate?'Ожидаемое списание: '+dateView(s.nextDate)+' ('+scheduledStatus(s.nextDate)+')':'Дата списания неизвестна'}</div>${s.notes?`<p class="subtle">${esc(s.notes)}</p>`:''}</div>`).join(''):empty('◴','Список пуст','Добавьте подписку вручную или проверьте кандидатов, найденных по банковским выпискам.','Добавить подписку','add-subscription')}
 ${sectionHeader('Найдено по банковским операциям')}
 <div class="panel">${candidates.length?`<p class="subtle">Возможные подписки: ${candidates.length}. Каждое списание нужно подтвердить.</p>${candidates.map((c,i)=>`<div class="suggestion-row"><div><strong>${esc(c.name)}</strong><div class="subtle">${money(c.amount)} / ${esc(CYCLE_LABEL[c.cycle])} · ${c.occurrences} списания · предположительная следующая дата: ${dateView(c.nextDate)}</div></div><button class="secondary-btn" data-action="confirm-subscription" data-index="${i}">Проверить</button></div>`).join('')}`:empty('✓','Кандидатов пока нет','Загрузите банковские выписки за 2–3 месяца. Подписка может не обнаружиться, если списания нерегулярны или банк скрывает название сервиса.')}</div>
 <div class="setting-card small-top"><h3>Подписки Apple ID</h3><p>На iPhone откройте «Настройки» → своё имя → «Подписки». Там виден официальный список и стоимость. Добавьте нужные подписки сюда вручную: веб-приложение не может самостоятельно прочитать чужие покупки из Apple ID. Оплата через Apple может объединять разные покупки.</p></div>
 <p class="footnote">Плановая сумма не добавляется к реальным расходам автоматически. Список кандидатов формируется локально, никакой отправки операций на сервер нет.</p>`;
}
function renderSettings(){
 return heading('Настройки','ДАННЫЕ И ПРИВАТНОСТЬ')+`
 <div class="stack"><div class="notice">Ваши записи хранятся локально на устройстве. Мы не отправляем суммы, выписки или пароли в GitHub и сторонние сервисы.</div>
 <div class="setting-card"><h3>Сбербанк · только чтение</h3><p>Откройте СберБанк Онлайн → «Выписки и справки» → получите выписку по карте/счёту в PDF → сохраните в «Файлы» на iPhone. Мы прочитаем документ прямо на телефоне, покажем результат перед импортом и не будем подключаться к банковскому аккаунту.</p><div class="notice">Без входа в банк, SMS и кодов подтверждения. Переводы, платежи и управление счетами технически отсутствуют.</div><button type="button" data-action="import-sber" class="primary-btn wide small-top">Загрузить выписку Сбербанка (все страницы)</button><p class="subtle small-top">Распознавание текстовых PDF — предварительная версия. Внимательно проверьте даты, направления и суммы. Сканированные PDF могут не прочитаться.</p></div>
 <div class="setting-card"><h3>Кредиты и ипотека · PDF Сбербанка</h3><p>В СберБанк Онлайн открой кредит → «О кредите» → «График» или закажи справку о задолженности в «Выписки и справки». Сохрани PDF в «Файлы» и загрузи здесь: приложение заполнит найденные параметры и предложит обновить существующий кредит либо создать новый.</p><button type="button" data-action="import-debt-sber" class="secondary-btn wide">Распознать кредит или ипотеку</button><p class="subtle small-top">Файл остаётся на iPhone. Проверяй числа: в разных справках есть не все показатели. Сканированные документы и PDF с паролем могут не распознаться.</p></div>
    <div class="setting-card"><h3>Вклады и накопления</h3><p>Отдельная вкладка «Вклад»: история переводов в Копилку, фактический остаток (после подтверждения в банке), ставка и срок.</p><button type="button" class="secondary-btn" data-action="view-savings">Открыть вклады</button></div>
  <div class="setting-card"><h3>Импорт CSV</h3><p>Для Сбербанка, Т-Банка и других банков: загрузите CSV-файл. Выберите колонки и проверьте операции перед сохранением.</p><button type="button" data-action="import-csv" class="secondary-btn">Загрузить CSV</button></div>
 <div class="setting-card"><h3>Резервная копия</h3><p>Сохраните зашифрованную копию всех операций, бюджетов, кредитов и подписок в «Файлы». Пароль нужен для восстановления — мы его не храним.</p><button type="button" data-action="export-backup" class="secondary-btn">Создать копию</button><button type="button" data-action="restore-backup" class="secondary-btn">Восстановить</button></div>
 <div class="setting-card"><h3>Установка на iPhone</h3><p>Откройте опубликованную ссылку в Safari → «Поделиться» → «На экран Домой» → «Открывать как веб-приложение». После первого запуска основные функции работают без интернета.</p></div>
 <div class="setting-card"><h3>Статистика</h3><p>Операций: ${state.transactions.length}. Лимитов в выбранном месяце: ${Object.keys(FinanceInsights.limitsFor(state,activeMonth)).length}. Кредитов: ${state.debts.length}. Подписок: ${state.subscriptions.length}.</p><button type="button" class="danger-btn" data-action="clear-all">Удалить все данные</button></div>
 <div class="footnote">Мои Финансы v${APP_VERSION} · ₽ · Без рекламы и отслеживания. Чтобы не потерять записи, регулярно сохраняйте резервную копию в безопасном месте. Публикация кода приложения не публикует ваши финансовые операции.</div></div>`;
}
function render(){
 const pages={home:renderHome,transactions:renderTransactions,budgets:renderBudgets,debts:renderDebts,savings:renderSavings,subscriptions:renderSubscriptions,settings:renderSettings};
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
 openBudgetEditor(id);
}
function openDebt(id){
 const debt=state.debts.find(d=>d.id===id);
 openModal(debt?'Редактировать обязательство':'Добавить кредит или ипотеку',`<form id="debtForm" data-id="${esc(id||'')}"><div class="field"><label for="debtKind">Тип обязательства</label><select id="debtKind" name="kind">${[['loan','Потребительский кредит'],['mortgage','Ипотека'],['creditcard','Кредитная карта'],['other','Другой долг']].map(([value,label])=>`<option value="${value}" ${debt?.kind===value?'selected':''}>${label}</option>`).join('')}</select></div>${formField('name','Название','text',debt?.name||'','Например, ипотека Сбербанка','required maxlength="100"')}${formField('lender','Банк','text',debt?.lender||'','Сбербанк или Т-Банк','maxlength="100"')}${formField('balance','Текущий остаток основного долга, ₽','number',debt?.balance??'','','required')}<div class="form-grid">${formField('rate','Ставка, % годовых','number',debt?.rate??'','','required')}${formField('payment','Обязательный платёж, ₽','number',debt?.payment??'','','required')}</div><div class="form-grid">${formField('dueDay','День платежа (1–31)','number',debt?.dueDay||'','','min="1" max="31" step="1"')}${formField('balanceDate','Дата проверки остатка','date',debt?.balanceDate||today())}</div>${formField('notes','Заметка','text',debt?.notes||'','Например, страховка отдельно','maxlength="350"')}<div class="notice warn">Плановый платёж не уменьшает остаток сам по себе. Обновляйте остаток по банку, чтобы не показывать выдуманные данные.</div><div class="form-actions"><button type="submit" class="primary-btn">Сохранить</button>${debt?`<button type="button" class="danger-btn" data-action="delete-debt" data-id="${esc(id)}">Удалить</button>`:''}</div></form>`);
}
function openSubscription(id,proposal){
 const s=id?state.subscriptions.find(x=>x.id===id):null;
 const c=proposal||{};
 openModal(s?'Редактировать подписку':proposal?'Подтвердить найденную подписку':'Добавить подписку',`<form id="subscriptionForm" data-id="${esc(id||'')}" data-key="${esc(s?.matchKey||c.key||'')}" data-source="${esc(s?.source|| (proposal?'statement':'manual'))}">${formField('name','Название сервиса','text',s?.name||c.name||'','Например, Яндекс Плюс','required maxlength="120"')}${formField('amount','Цена одного списания, ₽','number',s?.amount??c.amount??'','','required')}<div class="field"><label for="subscriptionCycle">Как часто списывают</label><select name="cycle" id="subscriptionCycle">${Object.entries(CYCLE_LABEL).map(([value,label])=>`<option value="${value}" ${(s?.cycle||c.cycle||'monthly')===value?'selected':''}>Раз в ${label}</option>`).join('')}</select></div>${formField('nextDate','Следующее ожидаемое списание','date',s?.nextDate||c.nextDate||'')}<div class="field"><label for="subscriptionStatus">Статус</label><select id="subscriptionStatus" name="status">${[['active','Активна'],['paused','Приостановлена'],['cancelled','Отменена']].map(([value,label])=>`<option value="${value}" ${(s?.status||'active')===value?'selected':''}>${label}</option>`).join('')}</select></div>${formField('notes','Комментарий','text',s?.notes||'','Тариф или способ оплаты','maxlength="250"')}<div class="notice">Проверьте цену и дату. Данные найдены по банковским списаниям и могут относиться к обычным покупкам. Мы не отменяем и не оплачиваем подписки.</div><div class="form-actions"><button type="submit" class="primary-btn">Сохранить подписку</button>${s?`<button type="button" data-action="delete-subscription" data-id="${esc(id)}" class="danger-btn">Удалить</button>`:''}</div></form>`);
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
 const tests=[[/супермар|продукт|пятероч|магнит|перекрест|лента|дикси|food|grocery/,'food'],[/авто|азс|заправ|бенз|топлив|нефт|лукойл/,'auto'],[/жкх|коммунал|газпром межрегион|электрич|водоканал|аренд|дом/,'home'],[/аптек|лекар|медиц|клиник|health/,'health'],[/детск|игруш|школ|садик|дети/,'children'],[/такси|яндекс go|метро|автобус|transport/,'transport'],[/интернет|связь|мтс|мегафон|билайн|мобильн/,'services'],[/кредит|ипотек|погашен/,'credit'],[/apple\.com|itunes|icloud|яндекс плюс|yandex plus|сберпрайм|sberprime|openai|chatgpt|telegram premium|netflix|spotify|youtube premium|google one|kinopoisk|кинопоиск|okko|kion/,'subscriptions'],[/ресторан|кафе|кино|развлечен|досуг/,'leisure'],[/маркетплейс|ozon|озон|wildberries|вайлдберриз|одежд|покупк/,'shopping']];
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
 return {id:uid(),type,amount:Math.abs(amount),date,title:title.slice(0,250),category:type==='transfer'?'transfer':importCategory(catSource,type),account:opts.account,source:opts.source||'csv'};
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
 openModal('Импорт выписки',`<form id="importForm"><div class="notice">${importDraft.mode==='sber-pdf'?'Сбербанк · PDF (только чтение)':'CSV'} · Файл «${esc(filename)}» · ${rows.length} строк. Проверьте распознанные даты, суммы и типы операций перед загрузкой.</div>${importDraft.mode==='sber-pdf'?'<div class="notice warn small-top">Результат распознавания PDF может содержать неточности. Если найдено подозрительно мало операций, ничего не импортируйте.</div>':''}<div class="small-top">${selectColumn('Дата *','date',headers,fields.date)}${selectColumn('Описание','title',headers,fields.title)}${selectColumn('Сумма (со знаком)','amount',headers,fields.amount)}<div class="form-grid">${selectColumn('Расход, отдельная колонка','debit',headers,fields.debit)}${selectColumn('Приход, отдельная колонка','credit',headers,fields.credit)}</div><div class="form-grid">${selectColumn('Тип операции','type',headers,fields.type)}${selectColumn('Категория банка','category',headers,fields.category)}</div>${formField('account','Название счёта / банка','text',bank,'Название банка','required maxlength="80"')}<div class="field"><label>Если сумма положительная и тип неясен</label><select id="importPositive"><option value="expense">Считать расходом</option><option value="income">Считать доходом</option></select></div><div class="field"><label>Тип импорта</label><select id="importForce"><option value="auto">Определить автоматически</option><option value="expense">Все операции — расходы</option><option value="income">Все операции — доходы</option><option value="transfer">Все операции — переводы</option></select></div><p class="subtle">Отрицательные суммы обычно считаются расходами, положительные — по выбранному правилу. Верните неверно определённую операцию через редактирование.</p><button type="button" class="secondary-btn wide" data-action="preview-import">Проверить первые операции</button><div id="importPreview" class="import-preview"><p class="subtle">Нажмите «Проверить первые операции».</p></div><button type="submit" class="primary-btn wide">Импортировать операции</button></div></form>`);
}
function readImportMapping(){
 const fields=['date','title','amount','debit','credit','type','category'];const columns={};for(const key of fields)columns[key]=Number($(`#col-${key}`).value);
 if(columns.date<0||columns.amount<0&&(columns.credit<0&&columns.debit<0))throw new Error('Выберите колонку даты и суммы (либо списание/приход)');
 const opts={account:$('#f-account').value.trim()||'Банк',positiveType:$('#importPositive').value,forceType:$('#importForce').value,source:importDraft.mode==='sber-pdf'?'sber-pdf':'csv'};
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
 importDraft={headers,rows,filename:file.name,mode:'csv'};csvPreview();
}
// Sber PDF import v1.1. PDF.js files are vendored in /vendor by GitHub Actions.
// No bank authentication or banking network endpoints are used.
let pdfJsPromise;
async function pdfJs(){
 if(!pdfJsPromise)pdfJsPromise=import('./vendor/pdf.min.mjs').then(lib=>{
  lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',location.href).href;
  return lib;
 }).catch(err=>{pdfJsPromise=null;throw new Error('Модуль чтения PDF ещё не опубликован или недоступен. Обновите приложение при наличии интернета.');});
 return pdfJsPromise;
}
function pdfTextLines(items){
 const glyphs=items.filter(it=>it?.str?.trim() && Array.isArray(it.transform) && Number.isFinite(it.transform[4]) && Number.isFinite(it.transform[5])).map(it=>({s:it.str.trim(),x:it.transform[4],y:it.transform[5]}));
 glyphs.sort((a,b)=>b.y-a.y||a.x-b.x);
 const lines=[];
 for(const g of glyphs){let line=lines.find(l=>Math.abs(l.y-g.y)<2.6);if(!line){line={y:g.y,parts:[]};lines.push(line);}line.parts.push(g);}
 return lines.sort((a,b)=>b.y-a.y).map(line=>line.parts.sort((a,b)=>a.x-b.x).map(p=>p.s).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
}
function pdfSberTransaction(group){
 // A transaction normally begins with a transaction date, followed by description and amounts.
 const dateMatch=group.match(/(?:^|\s)(\d{2}[./-]\d{2}[./-]\d{4})(?=\s|$)/);
 if(!dateMatch)return null;
 const date=parseBankDate(dateMatch[1]);if(!date)return null;
 const rest=group.replace(/\b\d{2}[./-]\d{2}[./-]\d{4}\b/g,' ').replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g,' ');
 if(/^\s*(?:итого|остаток|всего|сумма по|дата формирования|выписка)/i.test(rest))return null;
 // Ignore year/month/date and integer totals: accept monetary values with two fractional digits only.
 const amounts=[...rest.matchAll(/(^|[\s(])([+\-−–]?\s*(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)[,.]\d{2})(?=$|[^\d,.])/g)].map(m=>({raw:m[2],whole:m[0],n:numberFromText(m[2].replace(/[−–]/g,'-'))})).filter(a=>a.n!==null && a.n!==0);
 if(!amounts.length)return null;
 const selected=amounts.find(a=>/^[+\-−–]/.test(a.raw.trim()))||amounts[0];
 const positive=selected.n>0;
 const isIncome=/зачислен|поступлен|пополнен|возврат|зарплат|к[еэ]шб[еэ]к|процент на остаток|внесени/i.test(rest) || selected.raw.trim().startsWith('+');
 const isTransfer=/перевод между своими|между своими счетами|перевод собственных средств/i.test(rest);
 let type=isTransfer?'Перевод между своими':isIncome?'Поступление':(!positive?'Списание':/оплат|покупк|комисси|списан|перевод|снят/i.test(rest)?'Списание':'Не определено');
 // For amount without minus, Sber often presents spending as unsigned; default to expense but show review.
 let title=rest.replace(/(^|[\s(])([+\-−–]?\s*(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)[,.]\d{2})(?=$|[^\d,.])/g,' ').replace(/\b(?:RUB|RUR|РУБ|рублей)\b|₽/ig,' ').replace(/\s+/g,' ').trim();
 if(title.length<3)title='Операция Сбербанка';
 title=title.slice(0,180);
 const signed=(type==='Поступление'?Math.abs(selected.n):type==='Списание'?-Math.abs(selected.n):selected.n);
 return [date,title,signed.toFixed(2).replace('.',','),type,title];
}
function pdfSberRows(lines){
 const out=[];let group='';let fragments=0;
 const flush=()=>{if(!group)return;const row=pdfSberTransaction(group);if(row)out.push(row);group='';fragments=0;};
 for(const line of lines){
  const beginsDate=/^\s*\d{2}[./-]\d{2}[./-]\d{4}(?=\s|$)/.test(line);
  if(beginsDate){flush();group=line;fragments=1;}
  else if(group && fragments<5 && !/^\s*(?:итого|остаток|продолжение|выписка|баланс|номер документа)/i.test(line)) {group+=' '+line;fragments++;}
  else if(group){flush();}
 }
 flush();return out;
}
async function handleSberPdf(file){
 if(!/\.pdf$/i.test(file.name) && file.type!=='application/pdf')throw new Error('Выберите PDF-выписку Сбербанка');
 if(file.size>20*1024*1024)throw new Error('Для PDF максимальный размер 20 МБ');
 const lib=await pdfJs();
 const bytes=new Uint8Array(await file.arrayBuffer());
 const task=lib.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true,stopAtErrors:false});
 let documentPdf;
 try{
  documentPdf=await task.promise;
  if(documentPdf.numPages>75)throw new Error('В PDF слишком много страниц (максимум 75)');
  const rows=[];
  for(let pageNo=1;pageNo<=documentPdf.numPages;pageNo++){
   const page=await documentPdf.getPage(pageNo);
   const text=await page.getTextContent();
   rows.push(...pdfSberRows(pdfTextLines(text.items)));
   page.cleanup();
  }
  if(!rows.length)throw new Error('Не найдены операции. Убедитесь, что это PDF-выписка с текстом, а не скан.');
  importDraft={mode:'sber-pdf',headers:['Дата операции','Описание','Сумма','Тип операции','Категория'],rows:rows.slice(0,10000),filename:file.name};
  csvPreview();
  $('#importPositive').value='expense';
  notify('Предварительно распознано операций: '+rows.length);
 }catch(e){
  if(e?.name==='PasswordException')throw new Error('PDF защищён паролем. Сохраните незашифрованную выписку в СберБанк Онлайн.');
  throw e;
 }finally{await documentPdf?.destroy();}
}
// Credit/mortgage document reader v1.3: on-device PDF parsing, no bank API or uploads.
const creditPdf = (() => {
  let draft = null;
  const amountRx = /(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{4,11}|\d{1,3})(?:[,.]\d{1,2})?/g;
  const clean = value => String(value || '').replace(/[\u00a0\u202f]/g, ' ').replace(/[−–]/g, '-').replace(/\s+/g, ' ').trim();
  function dateIn(value) {
    const s = String(value || '');
    const ru = s.match(/(?:^|[^\d])(\d{2})[./-](\d{2})[./-](\d{4})(?!\d)/);
    const iso = s.match(/(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/);
    let y, m, d;
    if (ru) { d=+ru[1]; m=+ru[2]; y=+ru[3]; }
    else if (iso) { y=+iso[1]; m=+iso[2]; d=+iso[3]; }
    else return '';
    const check = new Date(Date.UTC(y, m-1, d));
    return y >= 2000 && y <= 2100 && check.getUTCFullYear() === y && check.getUTCMonth() === m-1 && check.getUTCDate() === d
      ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : '';
  }
  function amountIn(value) {
    const s = clean(value).replace(/\d{2}[./-]\d{2}[./-]\d{4}/g, ' ');
    for (const m of s.matchAll(amountRx)) {
      const raw=m[0], n=Number(raw.replace(/ /g,'').replace(',','.'));
      const after=s.slice(m.index+raw.length,m.index+raw.length+20);
      const currency=/руб|₽/i.test(after);
      const grouped=/\d \d{3}/.test(raw), decimals=/[,.]\d{1,2}$/.test(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1e11) continue;
      if (!grouped && !decimals && !currency && n < 10000 && n !== 0) continue;
      return n;
    }
    return null;
  }
  function labelledAmount(lines, patterns) {
    for (const pattern of patterns) {
      for (let i=0; i<lines.length; i++) {
        const match=pattern.exec(lines[i]);
        if (!match) continue;
        const suffix=lines[i].slice(match.index+match[0].length).replace(/^[\s:—-]+/,'');
        const same=amountIn(suffix);
        if (same!==null) return same;
        const next=lines[i+1] || '';
        if (next.length < 85 && !/договор|адрес|банк|сч[её]т|номер|дата выдачи/i.test(next)) {
          const n=amountIn(next); if (n!==null) return n;
        }
      }
    }
    return null;
  }
  function labelledRate(lines) {
    for (let i=0;i<lines.length;i++) {
      const match=/(?:процентная\s+ставка|ставка\s+по\s+кредиту|годовая\s+ставка|ставка\s+процентов)/i.exec(lines[i]);
      if (!match) continue;
      for (const line of [lines[i].slice(match.index+match[0].length),lines[i+1] || '']) {
        const m=line.match(/(\d{1,2}(?:[.,]\d{1,3})?)\s*%/);
        if (m) { const n=Number(m[1].replace(',','.')); if(n>=0 && n<=100) return n; }
      }
    }
    return null;
  }
  function paymentFromSchedule(lines) {
    const start=lines.findIndex(line=>/график\s+платеж|дата\s+платежа/i.test(line));
    if (start<0) return null;
    const results=[];
    for(let i=start+1;i<Math.min(lines.length,start+400);i++) {
      const match=lines[i].match(/^\s*(\d{2}[./-]\d{2}[./-]\d{4})\s+(.+)$/);
      if(!match) continue;
      const date=dateIn(match[1]), amount=amountIn(match[2]);
      if(date && date>=today() && amount!==null && amount>0 && amount<1e8) results.push({date,amount});
    }
    results.sort((a,b)=>a.date.localeCompare(b.date));
    return results[0] || null;
  }
  function parse(lines) {
    lines=lines.map(clean).filter(Boolean);
    const preview=lines.slice(0,130).join(' ');
    if (!/кредит|ипотек|задолженн|ссудн|займ/i.test(preview))
      throw new Error('Это не похоже на кредитный документ. Выберите справку о задолженности либо график платежей Сбербанка.');
    const mortgage=/ипоте(?:к|ч)|жилищн[а-яё]*\s+кредит|кредит\s+на\s+(?:приобретение|покупку)\s+(?:жилья|недвижимости|квартиры)/i.test(preview);
    // A loan's original amount or total with accrued interest is NOT the outstanding principal.
    const principal=labelledAmount(lines,[
      /остаток\s+(?:непогашенн[а-яё]*\s+)?основн[а-яё]*\s+долга/i,
      /задолженн[а-яё]*\s+по\s+основн[а-яё]*\s+долгу/i,
      /остаток\s+ссудн[а-яё]*\s+задолженн[а-яё]*/i,
      /ссудная\s+задолженн[а-яё]*/i
    ]);
    const total=labelledAmount(lines,[/общая\s+задолженн[а-яё]*/i,/всего\s+задолженн[а-яё]*/i]);
    const original=labelledAmount(lines,[/первоначальн[а-яё]*\s+сумм[а-яё]*\s+кредит[а-яё]*/i,/сумма\s+кредита/i]);
    const payment=labelledAmount(lines,[
      /размер\s+(?:ежемесячн[а-яё]*|аннуитетн[а-яё]*|очередн[а-яё]*|планов[а-яё]*)\s+платежа/i,
      /сумма\s+(?:ежемесячн[а-яё]*|очередн[а-яё]*|ближайш[а-яё]*)\s+платежа/i,
      /ежемесячный\s+плат[её]ж/i,
      /ближайший\s+плат[её]ж/i
    ]);
    const rate=labelledRate(lines),next=paymentFromSchedule(lines);
    let dueDay=next ? Number(next.date.slice(8,10)) : null;
    if(!dueDay) {
      for(let i=0;i<lines.length;i++) {
        if(!/(?:дата|день)\s+(?:ежемесячн[а-яё]*\s+|очередн[а-яё]*\s+|планов[а-яё]*\s+)?платежа|плат[её]ж\s+\d{1,2}\s+числа/i.test(lines[i])) continue;
        const date=dateIn(lines[i]) || dateIn(lines[i+1] || '');
        if(date) {dueDay=Number(date.slice(8,10));break;}
        const m=lines[i].match(/(?:платежа|плат[её]ж)\s*(?:каждого\s+месяца\s+)?(?:[:—-]\s*)?(\d{1,2})(?:-го|\s+числа|$)/i);
        if(m && +m[1]>=1 && +m[1]<=31) {dueDay=+m[1];break;}
      }
    }
    let balanceDate='';
    for(const line of lines.slice(0,100)) {
      if(/по\s+состоянию\s+на|остаток\s+(?:долга|задолженности)\s+на\s+дату/i.test(line)) {
        balanceDate=dateIn(line); if(balanceDate) break;
      }
    }
    let contractTail='';
    for(const line of lines.slice(0,90)) {
      const m=line.match(/(?:кредитн[а-яё]*\s+договор[а-яё]*|договор[а-яё]*\s+кредит[а-яё]*|договор[а-яё]*)\s*(?:№|номер|N)\s*([0-9\- ]{8,38})/i);
      if(m) {const digits=m[1].replace(/\D/g,'');if(digits.length>=8) {contractTail=digits.slice(-4);break;}}
    }
    const found={kind:mortgage?'mortgage':'loan',name:mortgage?'Ипотека Сбербанка':'Кредит Сбербанка',
      balance:principal,rate,payment:payment??next?.amount??null,dueDay:dueDay??null,
      balanceDate,contractTail,originalAmount:original,totalDebt:total,paymentDate:next?.date||''};
    if([found.balance,found.rate,found.payment,found.dueDay].every(v=>v===null))
      throw new Error('В PDF не удалось распознать остаток, ставку или платежи. Выберите справку или график платежей с текстом.');
    return found;
  }
  function show(info,filename) {
    draft=info;
    const candidates=state.debts.filter(d=>/сбер/i.test(d.lender) || (info.contractTail && d.contractTail===info.contractTail));
    const exact=info.contractTail?candidates.filter(d=>d.contractTail===info.contractTail):[];
    const likely=exact.length===1?exact[0]:(candidates.length===1&&candidates[0].kind===info.kind?candidates[0]:null);
    const fmt=v=>v===null||v===undefined?'':String(v);
    const identified=[
      ['Остаток основного долга',info.balance===null?'не найден':money(info.balance)],
      ['Ставка',info.rate===null?'не найдена':String(info.rate)+' %'],
      ['Ежемесячный платёж',info.payment===null?'не найден':money(info.payment)],
      ['День платежа',info.dueDay===null?'не найден':String(info.dueDay)],
      ['Дата остатка',info.balanceDate||'не найдена']
    ];
    const detail=identified.map(([label,value])=>`<div class="budget-line"><span class="subtle">${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    const targets=`<option value="">Создать новый кредит</option>`+state.debts.map(d=>`<option value="${esc(d.id)}" ${d.id===likely?.id?'selected':''}>Обновить: ${esc(d.name)} (${esc(d.lender||'банк')})</option>`).join('');
    const kinds=[['mortgage','Ипотека'],['loan','Потребительский кредит'],['creditcard','Кредитная карта'],['other','Другой долг']].map(([v,t])=>`<option value="${v}" ${v===info.kind?'selected':''}>${t}</option>`).join('');
    const caution=info.balance===null?'<div class="notice warn">Остаток основного долга не найден. Общая задолженность может включать проценты и штрафы. Для нового кредита укажи остаток вручную либо открой справку о задолженности.</div>':'';
    const total=info.totalDebt!==null?`<p class="subtle">Справочно: общая задолженность ${money(info.totalDebt)} — не подставлена в основной долг.</p>`:'';
    const original=info.originalAmount!==null?`<p class="subtle">Первоначальная сумма кредита: ${money(info.originalAmount)} — не подставлена в остаток.</p>`:'';
    openModal('Сбербанк · распознавание кредита',`<form id="creditPdfForm">
      <div class="notice">Документ «${esc(filename)}» прочитан на iPhone. Это предварительное распознавание, а не синхронизация с банком. Проверь цифры перед сохранением.</div>
      <div class="setting-card small-top">${detail}${total}${original}${info.contractTail?`<p class="subtle">Номер договора оканчивается на ••••${esc(info.contractTail)}</p>`:''}</div>
      ${caution}
      <div class="field"><label for="creditImportTarget">Что сделать с кредитом?</label><select id="creditImportTarget" name="target">${targets}</select></div>
      <div class="field"><label for="creditImportKind">Вид кредита</label><select id="creditImportKind" name="kind">${kinds}</select></div>
      ${formField('creditImportName','Название (для нового кредита)','text',info.name,'','maxlength="100"')}
      <div class="form-grid">${formField('creditImportBalance','Остаток основного долга, ₽','number',fmt(info.balance))}${formField('creditImportRate','Ставка, %','number',fmt(info.rate))}</div>
      <div class="form-grid">${formField('creditImportPayment','Платёж, ₽','number',fmt(info.payment))}${formField('creditImportDay','День платежа (1–31)','number',fmt(info.dueDay))}</div>
      ${formField('creditImportBalanceDate','Дата сведений об остатке','date',info.balanceDate)}
      <div class="notice warn">Пустое поле при обновлении не меняет прежнее значение. Для нового кредита требуется остаток основного долга. Документ может быть устаревшим; наступление даты платежа не подтверждает оплату.</div>
      <div class="form-actions"><button type="submit" class="primary-btn wide">Проверил — сохранить кредит</button></div>
    </form>`);
  }
  async function read(file) {
    if(!file || (!/\.pdf$/i.test(file.name) && file.type!=='application/pdf')) throw new Error('Нужен PDF-документ Сбербанка.');
    if(file.size>20*1024*1024) throw new Error('Максимальный размер PDF — 20 МБ.');
    const lib=await pdfJs();
    const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true,stopAtErrors:false});
    let doc;
    try {
      doc=await task.promise;
      if(doc.numPages>75) throw new Error('В документе больше 75 страниц.');
      const lines=[];
      for(let n=1;n<=doc.numPages;n++) {
        const page=await doc.getPage(n),text=await page.getTextContent();
        lines.push(...pdfTextLines(text.items));page.cleanup();
      }
      if(!lines.length) throw new Error('В PDF нет текстового слоя. Сканированную справку пока нельзя распознать.');
      show(parse(lines),file.name);
    } catch(e) {
      if(e?.name==='PasswordException') throw new Error('PDF защищён паролем. Выбери документ, доступный для чтения.');
      throw e;
    } finally {await doc?.destroy();}
  }
  async function save(form) {
    if(!draft) throw new Error('Нужно заново загрузить документ.');
    const data=new FormData(form),id=String(data.get('target')||'');
    const existing=id?state.debts.find(d=>d.id===id):null;
    if(id&&!existing) throw new Error('Выбранный кредит не найден.');
    const value=k=>String(data.get(k)||'').trim();
    function numeric(k) {
      const raw=value(k);if(!raw)return null;
      const n=Number(raw.replace(',','.'));if(!Number.isFinite(n)||n<0) throw new Error('Проверь числовые значения.');
      return n;
    }
    const balance=numeric('creditImportBalance'),rate=numeric('creditImportRate'),payment=numeric('creditImportPayment'),day=numeric('creditImportDay');
    if(!existing&&balance===null) throw new Error('Для нового кредита укажи остаток основного долга из справки.');
    if((balance!==null&&balance>1e11)||(rate!==null&&rate>100)||(payment!==null&&payment>1e8)) throw new Error('Сумма или ставка выходит за допустимые пределы.');
    if(day!==null&&(!Number.isInteger(day)||day<1||day>31)) throw new Error('День платежа должен быть от 1 до 31.');
    const date=value('creditImportBalanceDate');
    if(date&&!dateIn(date)) throw new Error('Неверная дата сведений об остатке.');
    if(existing&&balance!==null&&existing.balanceDate&&date&&date<existing.balanceDate) throw new Error('Справка старше сохранённых данных. Не перезаписывай актуальный остаток старым.');
    if(existing?.contractTail&&draft.contractTail&&existing.contractTail!==draft.contractTail) throw new Error('Последние цифры договора не совпадают. Выбери правильный кредит.');
    const kind=value('kind'),name=value('creditImportName');
    if(!['mortgage','loan','creditcard','other'].includes(kind)||!name) throw new Error('Укажи название и вид кредита.');
    const debt={id:existing?.id||uid(),name:existing?.name||name.slice(0,100),kind,
      lender:'Сбербанк',balance:balance??existing?.balance??0,rate:rate??existing?.rate??0,
      payment:payment??existing?.payment??0,dueDay:day??existing?.dueDay??0,
      balanceDate:date||existing?.balanceDate||'',
      notes:existing?.notes||'Импорт из кредитного документа Сбербанка. Поля проверены вручную.',
      contractTail:draft.contractTail||existing?.contractTail||'',source:'sber-document'};
    if(existing) Object.assign(existing,debt); else state.debts.push(debt);
    await commit();draft=null;closeModal();activateTab('debts');notify(existing?'Кредит обновлён из PDF':'Кредит добавлен из PDF');
  }
  return {read,save,parse};
})();

/* v1.4: reliable, audited Sber PDF import, mortgage schedule, savings tab.
   Bank documents remain on the iPhone; this code never uploads documents. */
let statementV14Draft = null;
let mortgageV14Draft = null;
function savingsMovements(savingId=''){
 const all=state.transactions.filter(t=>t.savingsFlow&&(!savingId||t.savingsId===savingId));
 const added=all.filter(t=>t.savingsFlow>0).reduce((s,t)=>s+t.amount,0);
 const removed=all.filter(t=>t.savingsFlow<0).reduce((s,t)=>s+t.amount,0);
 return {all,added,removed,net:added-removed};
}
function renderSavings(){
 const verified=state.savings.filter(s=>s.balance!==null),sum=verified.reduce((a,s)=>a+s.balance,0);
 const all=savingsMovements(),monthly=all.all.filter(t=>t.date.startsWith(activeMonth));
 const monthlyAdded=monthly.filter(t=>t.savingsFlow>0).reduce((a,t)=>a+t.amount,0);
 const monthlyRemoved=monthly.filter(t=>t.savingsFlow<0).reduce((a,t)=>a+t.amount,0);
 return heading('Вклады и накопления','МОИ СБЕРЕЖЕНИЯ',`<button class="secondary-btn" data-action="add-saving">+ Вклад</button>`)+`
  <div class="hero"><div class="hero-label">Подтверждённые остатки вкладов</div><div class="hero-value">${verified.length?money(sum):'Нет сведений'}</div><div class="hero-foot">${verified.length} из ${state.savings.length} вкладов с указанным остатком</div></div>
  <div class="notice warn small-top">Выписка по карте показывает переводы в накопления, но НЕ показывает фактический текущий остаток вклада. Укажите его из СберБанк Онлайн или импортируйте отдельную выписку вклада, когда она будет поддерживаться. Неподтверждённые остатки не суммируются.</div>
  ${monthBar()}
  <div class="two-col"><div class="metric-card"><div class="metric-head">Отложено за месяц</div><div class="metric-value">${short(monthlyAdded)}</div></div><div class="metric-card"><div class="metric-head">Снято с накоплений</div><div class="metric-value">${short(monthlyRemoved)}</div></div></div>
  ${sectionHeader('Мои вклады')}
  ${state.savings.length?state.savings.map(s=>{const a=savingsMovements(s.id);return `<div class="debt-card"><div class="budget-line"><div class="debt-name">🏦 ${esc(s.name)}</div><button class="text-link" data-action="edit-saving" data-id="${esc(s.id)}">Изменить</button></div><p class="subtle">${esc(s.bank||'Банк не указан')} · ${esc(s.kind==='deposit'?'Вклад':s.kind==='kopilka'?'Копилка':'Накопительный счёт')}</p><div class="debt-total">${s.balance===null?'Остаток неизвестен':money(s.balance)}</div><div class="debt-stats"><div><small>Ставка</small><strong>${s.rate===null?'Не указана':s.rate+' %'}</strong></div><div><small>Операций найдено</small><strong>${a.all.length}</strong></div></div><p class="subtle">Переводы в накопления по загруженным выпискам: +${money(a.added)} / −${money(a.removed)}. Это не баланс вклада.</p>${s.balanceDate?`<p class="subtle">Остаток подтверждён: ${esc(s.balanceDate)}</p>`:''}${s.maturity?`<p class="subtle">Срок размещения до: ${esc(s.maturity)}</p>`:''}</div>`;}).join(''):empty('🏦','Вкладов пока нет','Добавьте вклад или загрузите PDF-выписку Сбербанка с операциями Копилки.','Добавить вклад','add-saving')}
  <p class="footnote">Накопления и движения между своими счетами не являются потребительскими расходами. Проценты по вкладу программа не начисляет без банковских данных.</p>`;
}
function openSaving(id){
 const s=state.savings.find(x=>x.id===id);
 openModal(s?'Изменить вклад':'Добавить вклад / накопления',`<form id="savingForm" data-id="${esc(id||'')}">
 ${formField('name','Название','text',s?.name||'','Например, Копилка Сбербанка','required maxlength="100"')}
 ${formField('bank','Банк','text',s?.bank||'Сбербанк','','maxlength="100"')}
 <div class="field"><label for="savingKind">Тип накоплений</label><select id="savingKind" name="kind">${[['deposit','Вклад'],['savings','Накопительный счёт'],['kopilka','Копилка']].map(([v,l])=>`<option value="${v}" ${s?.kind===v?'selected':''}>${l}</option>`).join('')}</select></div>
 <div class="form-grid">${formField('balance','Фактический остаток из банка, ₽','number',s?.balance??'','Необязательно')}${formField('rate','Ставка, %','number',s?.rate??'','Необязательно')}</div>
 <div class="form-grid">${formField('balanceDate','Дата проверки остатка','date',s?.balanceDate||'')}${formField('maturity','Окончание срока вклада','date',s?.maturity||'')}</div>
 ${formField('notes','Заметки','text',s?.notes||'','','maxlength="200"')}
 <div class="notice">Оставьте остаток пустым, если ещё не проверили его в банке. Переводы с карты сами по себе не подтверждают баланс вклада.</div>
 <div class="form-actions"><button type="submit" class="primary-btn">Сохранить</button>${s?`<button type="button" class="danger-btn" data-action="delete-saving" data-id="${esc(s.id)}">Удалить</button>`:''}</div></form>`);
}
async function readAllPdfLines(file,maxPages=90){
 if(!file||(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'))throw Error('Выберите PDF-файл.');
 if(file.size>25*1024*1024)throw Error('PDF должен быть не больше 25 МБ.');
 const lib=await pdfJs();const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true,stopAtErrors:false});let doc;
 try{doc=await task.promise;if(doc.numPages>maxPages)throw Error('В PDF слишком много страниц.');
   const pages=[];for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i),content=await page.getTextContent({disableNormalization:false});
    pages.push(pdfTextLines(content.items));page.cleanup();
    if(i%10===0)notify(`Обработано страниц: ${i} из ${doc.numPages}`);
   }return pages;
 }catch(e){if(e?.name==='PasswordException')throw Error('PDF защищён паролем.');throw e;}
 finally{await doc?.destroy();}
}
function categoryBankRow(r,type){
 if(r.isTransfer)return 'transfer';
 if(/BRANCH\s+KARTA[- ]CREDIT|погашен\w*\s+(?:кредит|ипотек)|ссудн\w*\s+сч[её]т/i.test(r.title))return 'credit';
 if(/выдача наличных|банкомат/i.test(r.category+' '+r.title))return 'other-expense';
 return importCategory(`${r.category} ${r.title}`,type);
}
function intoTxV14(r,savingId){
 const type=r.isTransfer?'transfer':r.signed>0?'income':'expense';
 return {id:uid(),type,amount:r.amount,date:r.date,title:r.title.slice(0,250),category:categoryBankRow(r,type),
  account:'Сбербанк · карта',source:'sber-pdf-v14',sourceRef:r.uniqueKey,
  savingsFlow:r.savingsFlow||0,savingsId:r.savingsFlow?savingId:'',transactionTime:r.time||'',
  bankCategory:r.category.slice(0,100)};
}
function openBankImportV14(data,filename){
 statementV14Draft=data;
 const s=data.summary,matched=data.complete,old=state.transactions.filter(x=>x.source==='sber-pdf'&&(!s.from||x.date>=s.from)&&(!s.to||x.date<=s.to));
 const contributions=data.rows.filter(r=>r.savingsFlow>0).length,withdrawals=data.rows.filter(r=>r.savingsFlow<0).length;
 const preview=data.rows.slice(0,6).map(r=>`<p>${esc(r.date)} · ${esc(r.category)} · ${esc(r.title.slice(0,50))} · ${r.signed>0?'+':'−'}${money(r.amount)}</p>`).join('');
 const box=matched?'<div class="notice">Сверка с контрольными суммами банка пройдена. Все операции в PDF учтены.</div>':`<div class="notice warn">ПОЛНОТА НЕ ПОДТВЕРЖДЕНА: сумма распознанных операций не совпала с итогами PDF либо итоги отсутствуют. Проверь документ или импортируй с отдельным подтверждением.</div>`;
 openModal('Сбербанк — проверка всей выписки',`<form id="sberFullImportForm">
 <div class="notice">Файл: ${esc(filename)}. Обработано ${data.pages} страниц; распознано <strong>${data.rows.length}</strong> операций.</div>
 ${box}
 <div class="setting-card small-top"><div class="budget-line"><span>Поступления по PDF</span><strong>${money(data.totals.income)}</strong></div><div class="budget-line"><span>Списания по PDF</span><strong>${money(data.totals.expense)}</strong></div>${s.income!==null?`<p class="subtle">Банк: поступления ${money(s.income)}, списания ${money(s.expense)}.</p>`:''}${s.closing!==null?`<p class="subtle">Остаток КАРТЫ на ${esc(s.to||'дату выписки')}: ${money(s.closing)} (не остаток вклада).</p>`:''}</div>
 <p class="subtle">Из них найдено переводов в Копилку: ${contributions}; возвратов из накоплений: ${withdrawals}. Они будут отнесены к внутренним переводам.</p>
 <div class="field"><label for="savingImportLink">К какому вкладу отнести переводы?</label><select id="savingImportLink" name="savingId"><option value="auto">Создать/использовать «Копилка Сбербанка»</option>${state.savings.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
 <div class="setting-card small-top"><strong>Примеры распознанных строк</strong>${preview}</div>
 ${old.length?`<label class="checkbox-row"><input name="replaceOld" type="checkbox"> Заменить ${old.length} старых операций импорта PDF Сбербанка за этот период (ручные записи не трогаем)</label>`:''}
 ${!matched?'<label class="checkbox-row"><input name="acceptIncomplete" type="checkbox" required> Я понимаю, что выписка не прошла контрольную сверку, и всё равно хочу импортировать</label>':''}
 <div class="notice warn">Импорт выполняется локально. Перед заменой ранее загруженных операций рекомендуется создать зашифрованную резервную копию. Повторный импорт этой версии пропускает совпавшие операции.</div>
 <div class="form-actions"><button type="submit" class="primary-btn wide">Проверил — импортировать ${data.rows.length} операций</button></div></form>`);
}
async function handleBankPdfV14(file){const pages=await readAllPdfLines(file);const result=FinanceV14.parseStatementPages(pages);if(!result.rows.length)throw Error('Операции не найдены.');openBankImportV14(result,file.name);}
async function saveBankImportV14(form){
 const draft=statementV14Draft;if(!draft)throw Error('Загрузите выписку заново.');
 const data=new FormData(form);if(!draft.complete&&data.get('acceptIncomplete')!=='on')throw Error('Подтвердите неполную сверку.');
 const replace=data.get('replaceOld')==='on';const s=draft.summary;
 const old=state.transactions.filter(x=>x.source==='sber-pdf'&&(!s.from||x.date>=s.from)&&(!s.to||x.date<=s.to));
 if(replace&&old.length&&!confirm(`Удалить ${old.length} операций предыдущего PDF-импорта Сбербанка за выбранный период и заменить их новым разбором? Ручные записи останутся.`))return;
 let sid=String(data.get('savingId')||'auto');
 if(sid==='auto'){
  let account=state.savings.find(x=>x.source==='sber-import'&&x.bank==='Сбербанк');
  if(!account&&draft.rows.some(r=>r.savingsFlow)){
   account={id:uid(),name:'Копилка Сбербанка',bank:'Сбербанк',kind:'kopilka',balance:null,rate:null,balanceDate:'',maturity:'',notes:'Создано по переводам из выписки карты; баланс вклада пока не подтверждён.',source:'sber-import'};
   state.savings.push(account);
  }sid=account?.id||'';
 }
 if(replace){const ids=new Set(old.map(x=>x.id));state.transactions=state.transactions.filter(x=>!ids.has(x.id));}
 const seen=new Set(state.transactions.map(x=>x.sourceRef).filter(Boolean));let added=0,dups=0;
 for(const r of draft.rows){if(seen.has(r.uniqueKey)){dups++;continue;}state.transactions.push(intoTxV14(r,sid));seen.add(r.uniqueKey);added++;}
 await commit();statementV14Draft=null;closeModal();activateTab('transactions');notify(`Добавлено ${added}; повторов пропущено ${dups}${replace?`; заменено старых ${old.length}`:''}`);
}
function openMortgageV14(info,filename){
 mortgageV14Draft=info;
 const candidates=state.debts.filter(d=>d.kind==='mortgage'&&/сбер/i.test(d.lender||''));
 const exact=info.last4?candidates.find(d=>d.contractTail===info.last4):null;
 const target=exact||(candidates.length===1?candidates[0]:null);
 const opts=`<option value="">Создать новую ипотеку</option>`+state.debts.filter(d=>d.kind==='mortgage'||d.lender==='Сбербанк').map(d=>`<option value="${esc(d.id)}" ${d.id===target?.id?'selected':''}>Обновить ${esc(d.name)}</option>`).join('');
 const next=info.next;
 const future=info.rows.filter(x=>x.date>today()).slice(0,3);
 const table=future.map(x=>`<div class="budget-line"><span>${esc(x.date)}</span><strong>${money(x.payment)}</strong></div>`).join('');
 openModal('Сбербанк — ипотечный график',`<form id="mortgageScheduleForm"><div class="notice">PDF «${esc(filename)}»: распознано ${info.count} строк, график до ${esc(info.last.date)}. Проверено: разбиение платежей на основной долг и проценты.</div>
 ${info.issues?`<div class="notice warn">В таблице обнаружены несоответствия: ${info.issues}. Перед сохранением сверьте их с оригиналом.</div>`:''}
 <div class="setting-card small-top"><div class="budget-line"><span>Расчётный остаток ПО ГРАФИКУ на ${esc(info.balanceDate)}</span><strong>${money(info.balance)}</strong></div><div class="budget-line"><span>Следующий платёж ${next?esc(next.date):'—'}</span><strong>${next?money(next.payment):'—'}</strong></div>${next?`<p class="subtle">Из него основной долг ${money(next.principal)}; проценты ${money(next.interest)}.</p>`:''}<strong>Ближайшие платежи</strong>${table}</div>
 <div class="notice warn">Это ПЛАН, а не подтверждённый остаток. «Полная стоимость кредита» (ПСК) в шапке документа не равна договорной процентной ставке — поэтому ставку не проставляем по ПСК.</div>
 <div class="field"><label for="mortgageTarget">Кредит для обновления</label><select id="mortgageTarget" name="target">${opts}</select></div>
 ${formField('mortgageName','Название','text',target?.name||'Ипотека Сбербанка','','required maxlength="100"')}
 <label class="checkbox-row"><input type="checkbox" name="useProjected" ${!target||target.balanceIsProjected?'checked':''}> Использовать расчётный остаток из графика (иначе сохранить фактический остаток уже внесённого кредита)</label>
 <div class="form-actions"><button type="submit" class="primary-btn wide">Сохранить график ипотеки</button></div></form>`);
}
async function handleMortgageDocumentV14(file){
 const pages=await readAllPdfLines(file);
 if(pages.flat().some(s=>/ГРАФИК\s+ПЛАТЕЖЕЙ/i.test(s))){const result=FinanceV14.parseMortgagePages(pages,today());openMortgageV14(result,file.name);}
 else await creditPdf.read(file);
}
async function saveMortgageV14(form){
 const info=mortgageV14Draft;if(!info)throw Error('График нужно загрузить повторно.');
 const data=new FormData(form),id=String(data.get('target')||''),existing=id?state.debts.find(x=>x.id===id):null;
 if(id&&!existing)throw Error('Выбранная ипотека не найдена.');
 const useProjected=data.get('useProjected')==='on';
 if(existing?.contractTail&&info.last4&&existing.contractTail!==info.last4)throw Error('Номер договора не совпадает. Выберите правильную ипотеку.');
 const name=String(data.get('mortgageName')||'').trim();if(!name)throw Error('Укажите название ипотеки.');
 const debt=existing||{id:uid(),kind:'mortgage',name:name.slice(0,100),lender:'Сбербанк',rate:0,rateKnown:false,notes:'Импортировано из графика платежей',source:'sber-schedule',balance:0,payment:0,dueDay:24,balanceDate:''};
 const fresh=!!existing && existing.balanceDate && existing.balanceDate>info.balanceDate && !existing.balanceIsProjected;
 if(useProjected&&fresh&&!confirm('Указанный в банке остаток новее расчётной даты графика. Перезаписать его расчётным значением?'))return;
 debt.kind='mortgage';debt.lender='Сбербанк';debt.payment=info.next?.payment??debt.payment;debt.dueDay=info.dueDay;
 debt.schedule=info.rows.map(x=>({date:x.date,principal:x.principal,interest:x.interest,payment:x.payment,balance:x.balance}));
 debt.contractTail=debt.contractTail||info.last4||'';
 if(useProjected){debt.balance=info.balance;debt.balanceDate=info.balanceDate;debt.balanceIsProjected=true;}
 if(!existing&&!useProjected){debt.balance=0;debt.balanceDate='';debt.balanceIsProjected=false;}
 if(!existing)state.debts.push(debt);
 await commit();mortgageV14Draft=null;closeModal();activateTab('debts');notify(existing?'График ипотеки обновлён':'Ипотека добавлена из графика');
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
 const form=event.target;if(!['transactionForm','budgetForm','monthPlanForm','autoBudgetForm','debtForm','subscriptionForm','importForm','creditPdfForm','mortgageScheduleForm','sberFullImportForm','savingForm','exportForm','restoreForm'].includes(form.id))return;
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
  }else if(['budgetForm','monthPlanForm','autoBudgetForm'].includes(form.id)){
   await savePlanningForm(form,data);
  }else if(form.id==='debtForm'){
   const name=String(data.get('name')||'').trim(),balance=Number(data.get('balance')),rate=Number(data.get('rate')),payment=Number(data.get('payment'));
   if(!name||[balance,rate,payment].some(n=>!Number.isFinite(n)||n<0))throw new Error('Проверьте данные кредита');
   const dueDay=Number(data.get('dueDay')||0);
   if(dueDay && (!Number.isInteger(dueDay)||dueDay<1||dueDay>31))throw new Error('День платежа должен быть от 1 до 31');
   const kind=String(data.get('kind')||'loan');if(!['mortgage','loan','creditcard','other'].includes(kind))throw new Error('Неизвестный тип кредита');
   const existing=state.debts.find(x=>x.id===form.dataset.id);const debt={id:existing?.id||uid(),name,kind,lender:String(data.get('lender')||'').slice(0,100),balance,rate,payment,dueDay,balanceDate:parseBankDate(data.get('balanceDate'))||'',notes:String(data.get('notes')||'').slice(0,350),contractTail:existing?.contractTail||'',source:existing?.source||'manual',rateKnown:true,balanceIsProjected:false,schedule:existing?.schedule||[]};
   if(existing)Object.assign(existing,debt);else state.debts.push(debt);
   await commit();closeModal();notify('Кредит сохранён');
  }else if(form.id==='creditPdfForm'){
    await creditPdf.save(form);
   }else if(form.id==='mortgageScheduleForm'){
    await saveMortgageV14(form);
   }else if(form.id==='sberFullImportForm'){
    await saveBankImportV14(form);
   }else if(form.id==='savingForm'){
    const value=k=>String(data.get(k)||'').trim();const name=value('name');if(!name)throw Error('Укажите название вклада.');
    const bal=value('balance'),rate=value('rate');const n=bal?Number(bal.replace(',','.')):null,r=rate?Number(rate.replace(',','.')):null;
    if(n!==null&&(!Number.isFinite(n)||n<0)||r!==null&&(!Number.isFinite(r)||r<0||r>100))throw Error('Проверьте остаток и ставку.');
    const due=value('maturity'),checked=value('balanceDate');if(due&&!parseBankDate(due)||checked&&!parseBankDate(checked))throw Error('Проверьте даты.');
    const existing=state.savings.find(x=>x.id===form.dataset.id);const saving={id:existing?.id||uid(),name:name.slice(0,100),bank:value('bank').slice(0,100),kind:value('kind'),balance:n,rate:r,balanceDate:checked,maturity:due,notes:value('notes').slice(0,200),source:existing?.source||'manual'};
    if(existing)Object.assign(existing,saving);else state.savings.push(saving);await commit();closeModal();notify('Вклад сохранён');
   }else if(form.id==='subscriptionForm'){
   const name=String(data.get('name')||'').trim(),amount=Number(data.get('amount')),cycle=String(data.get('cycle')),status=String(data.get('status'));
   if(!name||!(amount>0)||!Number.isFinite(amount)||!CYCLE_LABEL[cycle]||!['active','paused','cancelled'].includes(status))throw new Error('Проверьте название, цену и период');
   const nextDate=String(data.get('nextDate')||'');if(nextDate&&!parseBankDate(nextDate))throw new Error('Укажите корректную дату');
   const existing=state.subscriptions.find(x=>x.id===form.dataset.id);
   const subscription={id:existing?.id||uid(),name:name.slice(0,120),amount,cycle,nextDate,status,source:form.dataset.source==='statement'?'statement':'manual',matchKey:String(form.dataset.key||'').slice(0,120),notes:String(data.get('notes')||'').slice(0,250)};
   if(existing)Object.assign(existing,subscription);else state.subscriptions.push(subscription);
   await commit();closeModal();notify('Подписка сохранена');
  }else if(form.id==='importForm'){
   const incoming=collectImport();if(!incoming.length)throw new Error('Не удалось найти подходящие операции. Проверьте колонки и формат дат.');
   // Count duplicates rather than collapsing two identical legitimate purchases on one day.
   const oldCounts=new Map();for(const tx of state.transactions){const key=fingerprint(tx);oldCounts.set(key,(oldCounts.get(key)||0)+1);}
   const incomingCounts=new Map();let skipped=0;
   for(const tx of incoming){const key=fingerprint(tx);const seen=(incomingCounts.get(key)||0)+1;incomingCounts.set(key,seen);
    if(seen <= (oldCounts.get(key)||0)){skipped++;continue;}state.transactions.push(tx);}
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
 else if(action==='edit-month-plan')openMonthPlan();
 else if(action==='view-budgets')activateTab('budgets');
 else if(action==='auto-budget')openAutoBudget();
 else if(action==='copy-budget')openAutoBudget('copy');
 else if(action==='insight-action')handleInsight(b.dataset.index);
 else if(action==='chart-mode'){dashboardChart=b.dataset.value==='days'?'days':'months';render();}
 else if(action==='clear-category-filter'){transactionCategoryFilter='';render();}
 else if(action==='add-debt')openDebt();
  else if(action==='import-debt-sber')$('#sberDebtPdfFile').click();
 else if(action==='view-debts')activateTab('debts');
 else if(action==='view-savings')activateTab('savings');
 else if(action==='add-saving')openSaving();
 else if(action==='edit-saving')openSaving(id);
 else if(action==='view-subscriptions')activateTab('subscriptions');
 else if(action==='add-subscription')openSubscription();
 else if(action==='edit-subscription')openSubscription(id);
 else if(action==='confirm-subscription'){const candidate=proposedSubscriptions()[Number(b.dataset.index)];if(candidate)openSubscription('',candidate);}
 else if(action==='edit-debt')openDebt(id);
 else if(action==='view-transactions'){transactionCategoryFilter='';activateTab('transactions');}
 else if(action==='filter'){transactionFilter=b.dataset.value;render();}
 else if(action==='tx-type'){
   const kind=b.dataset.value;$('#transactionType').value=kind;$$('.type-toggle button').forEach(btn=>btn.classList.toggle('active',btn.dataset.value===kind));
   $('#transactionCategory').innerHTML=catOptions(kind);
 }
 else if(action==='delete-tx'||action==='delete-budget'||action==='delete-debt'||action==='delete-subscription'||action==='delete-saving'){
   if(!confirm('Удалить эту запись?'))return;
   if(action==='delete-tx')state.transactions=state.transactions.filter(x=>x.id!==id);
   if(action==='delete-budget'){
     try{const month=b.dataset.month||activeMonth;await persistPlanningChange(()=>{if(b.dataset.scope==='recurring'){delete state.budgets[id];return;}const limits={...FinanceInsights.limitsFor(state,month)};delete limits[id];state.budgetMonths[month]=limits;});closeModal();notify(b.dataset.scope==='recurring'?'Базовый лимит удалён':'Лимит удалён на выбранный месяц');}
     catch(error){notify('Не удалось сохранить изменение');}
     return;
   }
   if(action==='delete-debt')state.debts=state.debts.filter(x=>x.id!==id);
   if(action==='delete-subscription')state.subscriptions=state.subscriptions.filter(x=>x.id!==id);
   if(action==='delete-saving')state.savings=state.savings.filter(x=>x.id!==id);
   await commit();closeModal();notify('Запись удалена');
 }
 else if(action==='import-csv'){$('#csvFile').click();}
 else if(action==='import-sber'){$('#sberPdfFile').click();}
 else if(action==='preview-import'){
   try{const tx=collectImport(),preview=tx.slice(0,7).map(x=>`<p>${esc(x.date)} · ${esc(x.title)} · ${x.type==='income'?'+':x.type==='expense'?'−':'↔'}${money(x.amount)}</p>`).join('');$('#importPreview').innerHTML=`<div class="subtle">Распознано ${tx.length} операций из ${importDraft.rows.length} строк:</div>${preview||'<p>Нет распознанных строк — проверьте колонки</p>'}`;}
   catch(e){notify(e.message);}
 }
 else if(action==='export-backup')openExport();
 else if(action==='restore-backup')$('#backupFile').click();
 else if(action==='clear-all'){
   if(!confirm('Удалить все операции, вклады, кредиты, подписки и бюджеты с этого iPhone? Действие необратимо.'))return;
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
 $('#sberPdfFile').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{notify('Читаем PDF на iPhone — без отправки на сервер');await handleBankPdfV14(file);}catch(e){console.error(e);notify(e?.message||'Ошибка чтения PDF');}
 });
 $('#sberDebtPdfFile').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;
   try{notify('Читаем кредитный PDF на iPhone');await handleMortgageDocumentV14(file);}catch(e){console.error(e);notify(e?.message||'Не удалось прочитать кредитный PDF');}
  });
  $('#backupFile').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)openRestore(file);});
 if(storageFallback)notify('Доступно только резервное локальное хранение. Делайте копии чаще.');
 if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW registration failed',e));
}
start().catch(e=>{console.error(e);$('#app').innerHTML=`<div class="notice warn">Ошибка запуска. Попробуйте обновить страницу. Если проблема повторится, не удаляйте приложение, чтобы сохранить данные.</div>`;});
