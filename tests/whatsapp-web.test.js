import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {inspectControls,textLength,recipientMatches,formatWebReport,runWebSender} from '../whatsapp-web.js';
function fixture({draft='',phone='+1 555 555 0101'}={}){
  const {document}=parseHTML(`<body><div id="main"><header><span dir="auto" title="Recipient">Recipient</span><button aria-label="Profile details"></button></header><div id="private-history"><div class="message">PRIVATE CONTENT MUST NEVER BE READ</div></div><footer><div role="textbox" contenteditable="true">${draft}</div><button aria-label="Send"></button></footer></div><aside data-testid="contact-info-drawer"><a href="tel:${phone}">Phone number</a></aside></body>`);
  for(const el of [document.body,document.querySelector('#main'),...document.querySelectorAll('#private-history,#private-history *')]){
    Object.defineProperty(el,'textContent',{get(){throw Error('Chat content read forbidden');}});
    Object.defineProperty(el,'innerText',{get(){throw Error('Chat content read forbidden');}});
  }
  return document;
}
test('only exact recipient metadata and compose controls are inspected',()=>{
  const s=inspectControls(fixture(),'15555550101',()=>true);assert.equal(s.status,'ready');assert.equal(s.recipientMatched,true);
  assert.ok(!JSON.stringify(s).includes('PRIVATE'));assert.ok(!JSON.stringify(s).includes('Recipient'));
});
test('a mismatching recipient is never treated as ready',()=>{
  assert.equal(inspectControls(fixture({phone:'+1 555 555 0199'}),'15555550101',()=>true).status,'recipient_unverified');
});
test('existing composer drafts are detected without reading their contents',()=>{
  const doc=fixture({draft:'PRIVATE DRAFT'}),composer=doc.querySelector('[contenteditable]');
  Object.defineProperty(composer,'textContent',{get(){throw Error('Draft read forbidden');}});
  assert.equal(textLength(composer),13);assert.equal(inspectControls(doc,'15555550101',()=>true).status,'draft');
});
test('phone-like message text or message tel links cannot verify a recipient',()=>{
  const doc=fixture();doc.querySelector('aside').remove();const history=doc.querySelector('#private-history');
  const link=doc.createElement('a');link.setAttribute('href','tel:+15555550101');history.append(link);
  assert.equal(recipientMatches(doc,'15555550101'),false);
});
test('unknown controls or absent recipient metadata fail closed',()=>{
  const doc=fixture();doc.querySelector('footer').remove();assert.notEqual(inspectControls(doc,'15555550101',()=>true).status,'ready');
});
test('non-text draft tokens are not treated as an empty composer',()=>{
  const doc=fixture();doc.querySelector('[contenteditable]').append(doc.createElement('img'));
  assert.equal(inspectControls(doc,'15555550101',()=>true).status,'draft');
});
test('hidden contact metadata cannot verify a different active recipient',()=>{
  const doc=fixture();doc.querySelector('aside').setAttribute('hidden','');
  assert.equal(recipientMatches(doc,'15555550101',el=>!el.closest('[hidden]')),false);
});
test('display names containing a phone number are not phone identity',()=>{
  const doc=fixture();doc.querySelector('aside').remove();doc.querySelector('header span').setAttribute('title','Friend 15555550101');
  assert.equal(recipientMatches(doc,'15555550101',()=>true),false);
});
test('the live-style Phone number label scopes only its adjacent value',()=>{
  const doc=fixture();doc.querySelector('aside').remove();
  const panel=doc.createElement('aside');panel.setAttribute('data-testid','chat-info-drawer');
  panel.innerHTML='<section><div data-testid="section-phone-number">Phone number</div><div>+1 (555) 555-0101</div></section><section data-testid="section-about">PRIVATE PROFILE DATA</section>';
  Object.defineProperty(panel.querySelector('[data-testid="section-about"]'),'textContent',{get(){throw Error('Unnecessary profile read');}});
  doc.body.append(panel);assert.equal(recipientMatches(doc,'15555550101',()=>true),true);
});
test('a same-length draft edit during the final guard prevents Send',async t=>{
  const doc=fixture(),composer=doc.querySelector('[contenteditable]');doc.querySelector('header span').setAttribute('title','+1 555 555 0101');
  for(const el of doc.querySelectorAll('*'))el.getClientRects=()=>[{}];
  composer.focus=()=>{};doc.execCommand=(_command,_ui,text)=>{composer.append(doc.createTextNode(text));return true;};
  let sends=0,calls=0;doc.querySelector('footer button').addEventListener('click',()=>sends++);
  const old={document:globalThis.document,location:globalThis.location,MutationObserver:globalThis.MutationObserver,chrome:globalThis.chrome};
  t.after(()=>{for(const [k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
  globalThis.document=doc;globalThis.location={origin:'https://web.whatsapp.com'};globalThis.MutationObserver=doc.defaultView.MutationObserver;
  globalThis.chrome={storage:{local:{get:async()=>{calls++;if(calls===2){const count=textLength(composer);composer.replaceChildren(doc.createTextNode('x'.repeat(count)));}return {watch:{enabled:true,generation:1},whatsapp:{enabled:true,number:'15555550101',tabId:7}};}}}};
  const result=await runWebSender({mode:'send',number:'15555550101',tabId:7,generation:1,text:'Visa Slot Watch TEST'});
  assert.equal(result.status,'draft_changed');assert.equal(sends,0);
});
test('app reports contain only structured observations and explicit incomplete coverage',()=>{
  const text=formatWebReport({type:'sweep',complete:false,finishedAt:2,locations:[{location:'HYDERABAD VAC',status:'empty',dates:[],at:1},{location:'MUMBAI VAC',status:'not_checked',dates:[],at:null}]});
  assert.match(text,/HYDERABAD VAC: No Slots Available/);assert.match(text,/MUMBAI VAC: Not checked/);assert.match(text,/INCOMPLETE/);
});

test('a chat switch during the first storage guard prevents insertion and Send',async t=>{
  const doc=fixture(),composer=doc.querySelector('[contenteditable]');doc.querySelector('header span').setAttribute('title','+1 555 555 0101');
  for(const el of doc.querySelectorAll('*'))el.getClientRects=()=>[{}];
  let inserts=0,sends=0;composer.focus=()=>{};doc.execCommand=()=>{inserts++;return true;};
  doc.querySelector('footer button').addEventListener('click',()=>sends++);
  const old={document:globalThis.document,location:globalThis.location,MutationObserver:globalThis.MutationObserver,chrome:globalThis.chrome};
  t.after(()=>{for(const [k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
  globalThis.document=doc;globalThis.location={origin:'https://web.whatsapp.com'};globalThis.MutationObserver=doc.defaultView.MutationObserver;
  globalThis.chrome={storage:{local:{get:async()=>{doc.querySelector('header span').setAttribute('title','Different recipient');return {watch:{enabled:true,generation:1},whatsapp:{enabled:true,number:'15555550101',tabId:7}};}}}};
  const result=await runWebSender({mode:'send',number:'15555550101',tabId:7,generation:1,text:'Visa Slot Watch TEST'});
  assert.equal(result.status,'recipient_changed');assert.equal(inserts,0);assert.equal(sends,0);
});

test('a delayed WhatsApp render still submits the test once',async t=>{
  const doc=fixture(),composer=doc.querySelector('[contenteditable]'),send=doc.querySelector('footer button');
  doc.querySelector('header span').setAttribute('title','+1 555 555 0101');
  for(const el of doc.querySelectorAll('*'))el.getClientRects=()=>[{}];
  send.hidden=true;
  composer.focus=()=>{};
  doc.execCommand=(_command,_ui,text)=>{
    setTimeout(()=>{composer.append(doc.createTextNode(text));send.hidden=false;},20);
    return true;
  };
  let sends=0;
  send.addEventListener('click',()=>{sends++;composer.replaceChildren();});
  const old={document:globalThis.document,location:globalThis.location,MutationObserver:globalThis.MutationObserver,chrome:globalThis.chrome};
  t.after(()=>{for(const [k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
  globalThis.document=doc;globalThis.location={origin:'https://web.whatsapp.com'};globalThis.MutationObserver=doc.defaultView.MutationObserver;
  globalThis.chrome={storage:{local:{get:async()=>({watch:{enabled:true,generation:1},whatsapp:{enabled:true,number:'15555550101',tabId:7}})}}};
  const result=await runWebSender({mode:'send',number:'15555550101',tabId:7,generation:1,text:'Visa Slot Watch TEST'});
  assert.equal(result.status,'submitted');
  assert.equal(sends,1);
});
