/* Сбербанк: локальное чтение PDF, без API, логинов и платежных функций. */
'use strict';
(() => {
  const previousSettings=renderSettings;
  renderSettings=function(){
    const html=previousSettings();
    const start=html.indexOf('<div class="setting-card"><h3>Импорт операций</h3>');
    if(start<0)return html;
    const end=html.indexOf('</div>',start)+6;
    const card=String.raw`<div class="setting-card">
      <h3>Сбербанк · только чтение</h3>
      <p>В СберБанк Онлайн откройте «Выписки и справки» → получите выписку по карте в PDF → сохраните в «Файлы» на iPhone. Выберите файл здесь: он будет обработан на телефоне.</p>
      <div class="notice">Без логина, пароля и SMS. У приложения нет банковских API для переводов и платежей.</div>
      <button type="button" data-action="import-sber" class="primary-btn wide small-top">Загрузить PDF Сбербанка</button>
      <p class="subtle small-top">Распознавание PDF пока экспериментальное. Проверьте суммы, даты и тип каждой операции перед импортом. Сканы могут не распознаться.</p>
      </div>
      <div class="setting-card"><h3>Импорт CSV</h3>
      <p>Для Сбербанка, Т-Банка и других банков. Выберите CSV и проверьте сопоставление колонок.</p>
      <button type="button" data-action="import-csv" class="secondary-btn">Загрузить CSV</button></div>`;
    return html.slice(0,start)+card+html.slice(end).replace('Мои Финансы v1.0 · ₽','Мои Финансы v1.1 · ₽');
  };
  const previousHome=renderHome;
  renderHome=function(){
    return previousHome().replace('data-action="import-csv">Импорт CSV','data-action="import-sber">Сбер PDF');
  };
  const originalImportRow=importRow;
  importRow=function(row,columns,opts){
    const result=originalImportRow(row,columns,opts);
    if(result && importDraft?.mode==='sber-pdf')result.source='sber-pdf';
    return result;
  };
  document.body.insertAdjacentHTML('beforeend','<input id="sberPdfFile" type="file" accept=".pdf,application/pdf" hidden>');
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-action="import-sber"]'))document.getElementById('sberPdfFile').click();
  });
  document.getElementById('sberPdfFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    try{notify('Читаем выписку на iPhone');await readSberPdf(file);}
    catch(error){console.error('PDF import',error);notify(error.message||'Ошибка чтения PDF');}
  });
  let pdfPromise=null;
  async function pdfLib(){
    if(!pdfPromise)pdfPromise=import('./vendor/pdf.min.mjs').then(lib=>{
      lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',location.href).href;
      return lib;
    }).catch(e=>{pdfPromise=null;throw new Error('Не удалось загрузить модуль PDF. Проверьте интернет и обновите приложение.');});
    return pdfPromise;
  }
  function pageLines(items){
    const glyphs=items.filter(g=>g?.str?.trim() && Number.isFinite(g.transform?.[4]) && Number.isFinite(g.transform?.[5]))
      .map(g=>({text:g.str.trim(),x:g.transform[4],y:g.transform[5]}));
    glyphs.sort((a,b)=>b.y-a.y||a.x-b.x);
    const lines=[];
    for(const g of glyphs){
      let line=lines.find(x=>Math.abs(x.y-g.y)<2.6);
      if(!line){line={y:g.y,items:[]};lines.push(line);}
      line.items.push(g);
    }
    return lines.sort((a,b)=>b.y-a.y).map(l=>l.items.sort((a,b)=>a.x-b.x).map(g=>g.text).join(' ').replace(/\s+/g,' ').trim());
  }
  function parseSberLine(text){
    const dt=text.match(/(?:^|\s)(\d{2}[./-]\d{2}[./-]\d{4})(?=\s|$)/);
    if(!dt)return null;
    const date=parseBankDate(dt[1]);if(!date)return null;
    const rest=text.replace(/\b\d{2}[./-]\d{2}[./-]\d{4}\b/g,' ').replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g,' ');
    if(/^\s*(итого|остаток|всего|выписка|баланс|дата формирования)/i.test(rest))return null;
    const moneyExp=/(^|[\s(])([+\-−–]?\s*(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)[,.]\d{2})(?=$|[^\d,.])/g;
    const values=[...rest.matchAll(moneyExp)].map(m=>({raw:m[2],amount:numberFromText(m[2].replace(/[−–]/g,'-'))}))
      .filter(m=>m.amount!==null && m.amount!==0);
    if(!values.length)return null;
    const value=values.find(x=>/^[+\-−–]/.test(x.raw.trim()))||values[0];
    const income=/зачислен|поступлен|пополнен|возврат|зарплат|к[еэ]шб[еэ]к|внесени|процент на остаток/i.test(rest)||value.raw.trim().startsWith('+');
    const transfer=/перевод между своими|между своими счетами|собственных средств/i.test(rest);
    const kind=transfer?'Перевод между своими':income?'Поступление':'Списание';
    const title=rest.replace(moneyExp,' ').replace(/\b(RUB|RUR|рублей|РУБ)\b|₽/gi,' ').replace(/\s+/g,' ').trim().slice(0,180)||'Операция Сбербанка';
    const signed=(income?1:-1)*Math.abs(value.amount);
    return [date,title,signed.toFixed(2).replace('.',','),kind,title];
  }
  function parseSberRows(lines){
    const rows=[];let block='';let count=0;
    const flush=()=>{if(block){const row=parseSberLine(block);if(row)rows.push(row);}block='';count=0;};
    for(const line of lines){
      if(/^\s*\d{2}[./-]\d{2}[./-]\d{4}(?=\s|$)/.test(line)){flush();block=line;count=1;}
      else if(block&&count<5&&!/^\s*(итого|остаток|выписка|баланс|продолжение)/i.test(line)){block+=' '+line;count++;}
      else if(block)flush();
    }
    flush();return rows;
  }
  async function readSberPdf(file){
    if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')throw new Error('Выберите файл PDF');
    if(file.size>20*1024*1024)throw new Error('PDF должен быть меньше 20 МБ');
    const pdfjs=await pdfLib();
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
    let pdf=null;
    try{
      pdf=await task.promise;
      if(pdf.numPages>75)throw new Error('Слишком много страниц в PDF (максимум 75)');
      const rows=[];
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n);
        const content=await page.getTextContent();
        rows.push(...parseSberRows(pageLines(content.items)));
        page.cleanup();
      }
      if(!rows.length)throw new Error('В PDF не распознаны операции. Нужна текстовая выписка, а не скан.');
      importDraft={
        mode:'sber-pdf',
        filename:'sber-'+file.name,
        headers:['Дата операции','Описание','Сумма','Тип операции','Категория'],
        rows:rows.slice(0,10000)
      };
      csvPreview();
      document.getElementById('importPositive').value='expense';
      document.querySelector('#importForm .notice')?.insertAdjacentHTML('afterend',
        '<div class="notice warn small-top">PDF распознан автоматически. Сверьте результат с оригиналом — возможны ошибки в суммах и типах операций.</div>');
      notify('Найдено операций: '+rows.length);
    }catch(e){
      if(e?.name==='PasswordException')throw new Error('PDF защищён паролем. Сохраните незашифрованную выписку в СберБанк Онлайн.');
      throw e;
    }finally{await pdf?.destroy();}
  }
  // Re-render settings if initial application start has already completed.
  if(document.getElementById('app')?.childElementCount)render();
})();
