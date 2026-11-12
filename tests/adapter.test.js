import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {readSnapshot, freshResultMutation} from '../adapter.js';
import {classify} from '../core.js';
const url='https://www.usvisascheduling.com/en-US/ofc-schedule/';
function page(body) {
  const {document}=parseHTML(`<html><body><main><h1>Applicant Schedule OFC Appointment:</h1><label for="post">OFC Post</label><select id="post"><option value="hyd" selected>HYDERABAD VAC</option><option value="mum">MUMBAI VAC</option></select>${body}</main></body></html>`);
  const select=document.querySelector('select'); Object.defineProperty(select,'selectedIndex',{value:0});
  return readSnapshot(document,url,{isVisible:el=>!el.closest('[hidden]'),ready:true});
}
test('native labeled OFC select and empty state are read without applicant data',()=>{
  const s=page('<h2>Calendar</h2><p>No Slots Available</p><p>PRIVATE APPLICANT NAME</p>');
  assert.equal(s.location,'HYDERABAD VAC'); assert.equal(classify(s).status,'empty');
  assert.deepEqual(s.locations,['HYDERABAD VAC','MUMBAI VAC']);
  assert.ok(!JSON.stringify(s).includes('PRIVATE APPLICANT NAME'));
});
test('datepicker only extracts enabled dated cells, not arbitrary page dates',()=>{
  const s=page('<h2>Calendar</h2><a data-date="2027-01-01">Unrelated date</a><div class="ui-datepicker"><table><tr><td data-year="2027" data-month="1"><a>3</a></td><td class="ui-datepicker-unselectable" data-year="2027" data-month="1"><span>4</span></td><td aria-disabled="true" data-year="2027" data-month="1"><a>5</a></td></tr></table></div>');
  assert.deepEqual(s.dates,['2027-02-03']); assert.equal(classify(s).status,'available');
});
test('hidden empty marker cannot conceal available dates',()=>{
  const s=page('<h2>Calendar</h2><p hidden>No Slots Available</p><div class="datepicker"><button data-date="2027-03-04">4</button></div>');
  assert.equal(classify(s).status,'available');
});
test('generic fullcalendar day labels do not prove availability',()=>{
  assert.equal(classify(page('<h2>Calendar</h2><div class="fc"><a data-date="2027-03-04">4</a></div>')).status,'unknown');
});
test('blocking and CAPTCHA win over stale calendar text',()=>{
  assert.equal(classify(page('<h2>Calendar</h2><p>No Slots Available</p><h1>Access Denied</h1>')).status,'blocked');
  assert.equal(classify(page('<h2>Calendar</h2><p>No Slots Available</p><iframe title="reCAPTCHA challenge"></iframe>')).status,'challenge');
});
test('visible busy indicators prevent empty classification',()=>{
  assert.equal(classify(page('<h2>Calendar</h2><p>No Slots Available</p><div aria-busy="true">Loading...</div>')).status,'loading');
});
test('unrelated ancestor changes never certify stale results as fresh',()=>{
  const {document}=parseHTML('<body><main><select id="post"></select><p>No Slots Available</p><div class="ui-datepicker"><td data-month="1" data-year="2027"><a>3</a></td></div></main></body>');
  const post=document.querySelector('select');
  for(const target of [document.body,document.querySelector('main'),document.querySelector('.ui-datepicker')])assert.equal(freshResultMutation({type:'attributes',target,addedNodes:[],removedNodes:[]},post),false);
  assert.equal(freshResultMutation({type:'childList',target:document.querySelector('main'),addedNodes:[],removedNodes:[document.querySelector('.ui-datepicker')]},post),false);
  assert.equal(freshResultMutation({type:'childList',target:document.querySelector('main'),addedNodes:[document.querySelector('.ui-datepicker')],removedNodes:[]},post),true);
});
test('calendar loading labels and headers cannot make old dates fresh',()=>{
  const {document}=parseHTML('<body><select></select><div class="ui-datepicker"><span>Loading appointments…</span><table><tr><td data-month="1" data-year="2027"><a>3</a></td></tr></table></div></body>');
  assert.equal(freshResultMutation({type:'characterData',target:document.querySelector('span').firstChild},document.querySelector('select')),false);
});
test('a loading label anywhere in the calendar wins over stale empty text',()=>{
  assert.equal(classify(page('<h2>Calendar</h2><p>No Slots Available</p><div class="ui-datepicker"><span>Loading appointments…</span></div>')).status,'loading');
});

test('stable recovery inspection returns the freshly rendered VAC list for reattachment',async()=>{
 const {inspectPage}=await import('../adapter.js');
 const {document}=parseHTML('<html><body><h1>Applicant Schedule OFC Appointment</h1><h2>Calendar</h2><label for="post">OFC Post</label><select id="post"><option value="hyd" selected>HYDERABAD VAC</option><option value="del">NEW DELHI VAC</option></select><p>No Slots Available</p></body></html>');
 Object.defineProperty(document,'readyState',{value:'complete'});Object.defineProperty(document.querySelector('select'),'selectedIndex',{value:0});
 globalThis.document=document;globalThis.location={href:url};
 try{const result=await inspectPage({mode:'recovery'});assert.equal(result.status,'empty');assert.deepEqual(result.locations,['HYDERABAD VAC','NEW DELHI VAC']);}
 finally{delete globalThis.document;delete globalThis.location;}
});
