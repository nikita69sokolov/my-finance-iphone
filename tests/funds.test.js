'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../funds.js');
const date = '2027-04-15';
const file = {type:'moi-finansy-card-balance', version:1, asOf:date, balance:1000.55, monthExpense:72};
const debt = {id:'d', name:'Sample', balance:300, payment:35.17, dueDay:23};
function ui() {
  const ctx = vm.createContext({console, Intl, Date, Math, document:{querySelector:()=>null,querySelectorAll:()=>[]}});
  for (const name of ['insights','dashboard','records','funds','funds-ui','assistant','assistant-ui','records-ui','app']) {
    vm.runInContext(fs.readFileSync(require.resolve('../'+name+'.js'),'utf8').replace(/start\(\)\.catch\([\s\S]*$/, ''),ctx);
  }
  vm.runInContext("today=()=>'2027-04-15'; openModal=(title,html)=>{globalThis.preview=html}; activateTab=() => {}; closeModal=()=>{}; notify=()=>{}; saveState=async()=>{}",ctx);
  return ctx;
}
test('confirmed funds count each recorded account once, preserve unknowns and zero, and ignore turnover',()=>{
  const state={primaryCard:file,savings:[{balance:20.05,bankDetails:{expectedInterest:5}},{balance:null}],
    transactions:[{type:'transfer',amount:100},{type:'income',amount:800}]};
  assert.equal(F.balances(state,date).knownTotal,1020.60);
  assert.equal(F.balances(state,date).knownCount,1);
  assert.equal(F.balances({savings:[{balance:null}]},date).knownTotal,null);
  assert.equal(F.balances({primaryCard:{balance:0,asOf:date}},date).knownTotal,0);
  assert.equal(F.balances({primaryCard:file,savings:[{balance:10,balanceDate:date}]},'2027-04-14').knownTotal,null);
});
test('card imports validate date, fields and precision and reject older observations',()=>{
  for(const patch of [{balance:''},{balance:2.347},{asOf:'2027-02-30'},{asOf:'2027-04-16'},{monthExpense:-1},{transactions:[]}]){
    assert.throws(()=>F.readFile({...file,...patch},null,date));
  }
  assert.throws(()=>F.readFile({...file,asOf:'2027-04-01'},file,date),/свежий/);
  assert.equal(F.readFile({...file,balance:-2.15},null,date).balance,-2.15);
});
test('reserve uses dated instalments and actual subscription cycles; bank and schedule cannot duplicate the same bill',()=>{
  const state={debts:[{...debt,schedule:[{date:'2027-04-23',payment:40}],bankDetails:{nextPaymentDate:'2027-04-23'}}],
    subscriptions:[
      {id:'w',name:'Weekly',status:'active',amount:2,cycle:'weekly',nextDate:'2027-04-02'},
      {id:'y',name:'Yearly',status:'active',amount:10,cycle:'yearly',nextDate:'2026-03-04'},
      {id:'p',status:'paused',amount:99,cycle:'monthly',nextDate:date},
      {id:'u',name:'Unknown date',status:'active',amount:10,cycle:'monthly',nextDate:''}]};
  const result=F.reserve(state,date);
  assert.equal(result.amount,45.17); assert.equal(result.bills.length,6);
  assert.deepEqual(result.missing,['Unknown date']);
  assert.equal(F.reserve({debts:[{...debt,bankDetails:{nextPaymentDate:'2027-05-11'}}]},date).amount,0);
});
test('a payment matched once is not reserved again, ambiguous matches need review and transfers are excluded',()=>{
  const d={...debt,dueDay:10},tx={category:'credit',type:'expense',date:'2027-04-10',amount:d.payment};
  const state={debts:[d],transactions:[{...tx,type:'transfer'}]};
  assert.equal(F.reserve(state,date).amount,d.payment);
  state.transactions.push(tx);
  const paid=F.reserve(state,date);assert.equal(paid.amount,0);assert.ok(paid.bills[0].matched);
  state.fundsChecks={[paid.bills[0].key]:false};assert.equal(F.reserve(state,date).amount,d.payment);
  delete state.fundsChecks;
  state.debts.push({...d,id:'d2'});assert.equal(F.reserve(state,date).amount,70.34);
});
test('the same card file can be previewed and re-imported without income entries; backups retain it and failed saves roll back',async()=>{
  const c=ui();c.payload=file;
  await vm.runInContext("readAssistantPlanFile({size:160,text:async()=>JSON.stringify(payload)})",c);
  assert.match(c.preview,/Сохранить остаток/);assert.equal(vm.runInContext('state.primaryCard',c),undefined);
  c.form=new Map([['balance','1 000,55'],['asOf',date],['monthExpense','72']]);
  await vm.runInContext('saveFundsCard(form);',c);await vm.runInContext('saveFundsCard(form);',c);
  assert.equal(vm.runInContext('normalizeState(state).primaryCard.balance',c),1000.55);
  assert.equal(vm.runInContext('state.transactions.length',c),0);
  assert.match(vm.runInContext('renderFunds()',c),/Зарплатная карта/);
  c.form.set('balance','3');
  await assert.rejects(vm.runInContext("saveState=async()=>{throw Error('full')};saveFundsCard(form)",c),/full/);
  assert.equal(vm.runInContext('state.primaryCard.balance',c),1000.55);
});
