/* Мои Финансы — parsers for text PDF documents, entirely on-device.
   This file contains no user records, credentials, bank endpoints or trackers. */
(function(root){
'use strict';
const RUB = '(?:[+\u2212\-]?\\s*(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})*|\\d+)[,.]\\d{2})';
const DATE = '(\\d{2}[./-]\\d{2}[./-]\\d{4})';
const MONEY_RE = new RegExp('^'+RUB+'$');
const OP_RE = new RegExp('^\\s*'+DATE+'\\s+(\\d{2}:\\d{2})\\s+(.+?)\\s+('+RUB+')\\s+('+RUB+')\\s*$');
const DESC_RE = new RegExp('^\\s*'+DATE+'\\s+(\\d{5,7})\\s+(.*)$');
const MORTGAGE_RE = new RegExp('^\\s*(\\d{1,4})\\s+'+DATE+'\\s+('+RUB+')\\s+('+RUB+')\\s+('+RUB+')\\s+('+RUB+')\\s*$');
function norm(v){return String(v??'').replace(/[\u00a0\u202f\u2009]/g,' ').replace(/[−–]/g,'-').replace(/\s+/g,' ').trim();}
function amount(v){if(!MONEY_RE.test(norm(v)))return null;const n=Number(norm(v).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;}
function r2(n){return Math.round((n+Number.EPSILON)*100)/100;}
function date(v){const m=String(v).match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);if(!m)return null;const dd=+m[1],mm=+m[2],yy=+m[3];const d=new Date(Date.UTC(yy,mm-1,dd));return d.getUTCDate()===dd&&d.getUTCMonth()===mm-1&&d.getUTCFullYear()===yy?`${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`:null;}
function cardPdfSummary(lines){
  let start='',end='',open=null,close=null,credits=null,debits=null;
  for(const raw of lines.slice(0,110)){const s=norm(raw);let m;
    if((m=/За период\s+(\d\d\.\d\d\.\d{4})\s*[—-]\s*(\d\d\.\d\d\.\d{4})/i.exec(s))){start=date(m[1]);end=date(m[2]);}
    if((m=/Остаток на\s+(\d\d\.\d\d\.\d{4})\s+(.+)$/i.exec(s))){const n=amount(m[2]);if(n!==null){if(date(m[1])===start)open=n;else if(date(m[1])===end)close=n;else if(open===null)open=n;else close=n;}}
    if((m=/^Пополнение\s+(.+)$/i.exec(s)))credits=amount(m[1]);
    if((m=/^Списание\s+(.+)$/i.exec(s)))debits=amount(m[1]);
  }
  return {from:start,to:end,opening:open,closing:close,income:credits,expense:debits};
}
function movementDetail(desc,category,positive){
 const text=norm(desc+' '+category);
 const topup=/KOPILKA\s+KARTA[-–]?VKLAD|КОПИЛКА.*КАРТА.*ВКЛАД/i.test(text);
 const withdrawal=/SBERBANK\s+ONL@IN\s+VKLAD[-–]?KARTA|ВКЛАД[-–]?КАРТА/i.test(text);
 const knownOwn=/между\s+своими|собственн\w*\s+средств/i.test(text);
 const savingsFlow=topup&&!positive?1:withdrawal&&positive?-1:0;
 return {isTransfer:!!savingsFlow||knownOwn,savingsFlow};
}
function parseStatementPages(pages){
 const source=Array.isArray(pages)?pages:[];if(!source.length)throw Error('Файл не содержит страниц.');
 const summary=cardPdfSummary(source[0]);const rows=[];let lost=0,previous=null;
 function flush(){if(!previous)return;const row=previous;previous=null;
   const detail=norm(row.description);const action=movementDetail(detail,row.category,row.signed>0);
   row.title=detail||row.category||'Операция Сбербанка';row.isTransfer=action.isTransfer;row.savingsFlow=action.savingsFlow;
   row.uniqueKey=[row.date,row.time,row.auth||'',row.amount.toFixed(2),row.balance.toFixed(2)].join('|');
   rows.push(row);
 }
 for(let pi=0;pi<source.length;pi++){
   const lines=source[pi];if(!Array.isArray(lines))continue;
   for(const raw of lines){const s=norm(raw);if(!s)continue;
     const op=OP_RE.exec(s);
     if(op){flush();const dt=date(op[1]),sum=amount(op[4]),balance=amount(op[5]);
       if(dt===null||sum===null||balance===null){lost++;continue;}
       previous={date:dt,time:op[2],category:norm(op[3]),amount:Math.abs(sum),signed:sum>0&&/^\s*\+/.test(op[4])?Math.abs(sum):-Math.abs(sum),balance,description:'',auth:'',processingDate:'',page:pi+1};continue;
     }
     const desc=DESC_RE.exec(s);
     if(previous&&desc&&date(desc[1])!==null){previous.processingDate=date(desc[1]);previous.auth=desc[2];previous.description=norm((previous.description+' '+desc[3]));continue;}
     if(previous && previous.description && !/^Страница \d+|^Продолжение на|^Для проверки|^Действителен|^Выписка по|^ДАТА ОПЕРАЦИИ|^КАТЕГОРИЯ|^СУММА В|^ОСТАТОК СРЕДСТВ|^Расшифровка|^Дата обработки|^Сумма в валюте|^В валюте сч[её]та|^и код авторизации|^Остаток на|^Пополнение|^Списание|^ПАО Сбербанк|^\*|^\d+\s+www\./i.test(s)){
       if(previous.description.length<350&&!/^\d{2}\.\d{2}\.\d{4}\s+/.test(s) && !/^\d{1,6}$/.test(s))previous.description=norm(previous.description+' '+s);
     }
   }
 }
 flush();
 const income=r2(rows.reduce((s,r)=>s+(r.signed>0?r.amount:0),0)),expense=r2(rows.reduce((s,r)=>s+(r.signed<0?r.amount:0),0));
 const reconciled=summary.income!==null&&summary.expense!==null&&summary.opening!==null&&summary.closing!==null;
 const countsMatch=reconciled&&Math.abs(income-summary.income)<0.015&&Math.abs(expense-summary.expense)<0.015&&Math.abs(r2(summary.opening+summary.income-summary.expense)-summary.closing)<0.015;
 const complete=countsMatch&&lost===0;
 return {rows,summary,totals:{income,expense,net:r2(income-expense)},complete,reconciled,invalidRows:lost,pages:source.length};
}
function parseMortgagePages(pages,asOf){
 const all=(Array.isArray(pages)?pages:[]).flat().map(norm);if(!all.some(l=>/ГРАФИК\s+ПЛАТЕЖЕЙ/i.test(l)))throw Error('Это не похоже на график платежей.');
 const found=new Map();let issues=0;
 for(const s of all){const m=MORTGAGE_RE.exec(s);if(!m)continue;
   const n=+m[1],day=date(m[2]);const vals=[m[3],m[4],m[5],m[6]].map(amount);
   if(!day||vals.some(x=>x===null)){issues++;continue;}
   const [principal,interest,payment,balance]=vals;
   if(principal<0||interest<0||payment<0||balance<0||Math.abs(r2(principal+interest-payment))>0.02){issues++;continue;}
   const existing=found.get(n);if(existing&&existing.date!==day){issues++;continue;}
   found.set(n,{index:n,date:day,principal,interest,payment,balance});
 }
 const rows=[...found.values()].sort((a,b)=>a.index-b.index);
 if(rows.length<3)throw Error('Не удалось прочитать строки графика платежей.');
 for(let i=1;i<rows.length;i++){
   if(rows[i].index!==rows[i-1].index+1)issues++;
   if(Math.abs(r2(rows[i-1].balance-rows[i].principal-rows[i].balance))>0.03)issues++;
 }
 const now=/^\d{4}-\d\d-\d\d$/.test(asOf||'')?asOf:new Date().toISOString().slice(0,10);
 const past=rows.filter(r=>r.date<=now).at(-1)||rows[0];
 const future=rows.find(r=>r.date>now)||null;
 let last4='';
 for(let i=0;i<Math.min(all.length,90);i++){
  if(/Кредитный договор/i.test(all[i])){const line=all.slice(i,i+3).join(' ');const m=/Кредитный договор\s*([0-9 \-]{7,35})/i.exec(line);if(m){const digits=m[1].replace(/\D/g,'');if(digits.length>=7){last4=digits.slice(-4);break;}}}
 }
 const docDate=all.map(line=>date(line)).find(Boolean)||'';
 // Important: 'Полная стоимость кредита' (ПСК) is NOT the contractual interest rate.
 return {rows,count:rows.length,issues,complete:issues===0&&rows[0].index===1&&rows.at(-1).balance===0,
   kind:'mortgage',bank:'Сбербанк',last4,
   balance:past.balance,balanceDate:past.date,balanceIsProjected:true,
   dueDay:future?Number(future.date.slice(8,10)):Number(rows[1].date.slice(8,10)),
   payment:future?.payment??0,next:future,
   originalBalance:rows[0].balance,last:rows.at(-1),documentDate:docDate};
}
const api={norm,amount,date,parseStatementPages,parseMortgagePages};
root.FinanceV14=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);