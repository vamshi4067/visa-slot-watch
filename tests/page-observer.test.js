import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarObserver} from '../page-observer.js';
const url='https://www.usvisascheduling.com/en-US/ofc-schedule/';
function fixture(){
 const f={page:{url,status:'complete'},events:[],inspections:0,reloads:0};
 f.io={tab:async()=>f.page,guard:async()=>{},reload:async()=>{f.reloads++;},inventory:async()=>({status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC']}),inspect:async()=>{f.inspections++;return {status:'empty',location:'HYDERABAD VAC',dates:[]};},record:async event=>f.events.push(event),now:()=>100};
 f.run=()=>createCalendarObserver(f.io)(7,'HYDERABAD VAC',{generation:1});return f;
}
test('a reload redirect to Atlas is login, never a failed injection or no-slots report',async()=>{
 const f=fixture();f.io.reload=async()=>{f.page={url:'https://atlasauth.b2clogin.com/policy/authorize?state=private-token&nonce=private-nonce',status:'complete'};};
 const r=await f.run();assert.equal(r.status,'login');assert.equal(f.inspections,0);
 const data=JSON.stringify(f.events);assert.doesNotMatch(data,/private-token|private-nonce|authorize|b2clogin/);assert.ok(f.events.some(e=>e.page==='sign_in'&&e.stage==='after_reload'));
});
test('blank or browser-error document is distinguished from logout and never injected',async()=>{
 for(const value of ['about:blank','chrome-error://chromewebdata/']){
 const f=fixture();f.io.reload=async()=>{f.page={url:value,status:'complete'};};
 const r=await f.run();assert.equal(r.status,'error');assert.match(r.reason,/blank|browser/i);assert.equal(f.inspections,0);
 }
});
test('rendered blank calendar fails safely with a stage-specific explanation',async()=>{
 const f=fixture();f.io.inspect=async()=>({status:'unknown',reason:'Calendar or OFC Post could not be identified.',location:'',dates:[]});
 const r=await f.run();assert.equal(r.status,'unknown');assert.match(r.reason,/After calendar reload/);assert.equal(f.reloads,1);assert.ok(f.events.some(e=>e.stage==='observe_result'&&e.status==='unknown'));
});
test('a still-pending navigation is not inspected and not called logout',async()=>{
 const f=fixture();f.io.reload=async()=>{f.page={url,status:'loading',pendingUrl:'https://www.usvisascheduling.com/en-US/ofc-schedule/'};};
 const r=await f.run();assert.equal(r.status,'loading');assert.equal(f.inspections,0);
});
test('location changes and healthy observations preserve freshness and cancellation guards',async()=>{
 const f=fixture();f.io.inventory=async()=>({status:'empty',location:'MUMBAI VAC'});let guards=0;f.io.guard=async()=>guards++;
 assert.equal((await f.run()).status,'empty');assert.equal(f.reloads,0);assert.equal(f.inspections,1);assert.ok(guards>=2);
 const g=fixture();g.io.guard=async()=>{throw Error('Monitoring paused.');};await assert.rejects(g.run(),/paused/);assert.equal(g.reloads,0);assert.equal(g.inspections,0);
});
test('the second reload becoming an error cannot become a successful second sweep',async()=>{
 const f=fixture();assert.equal((await f.run()).status,'empty');
 f.io.reload=async()=>{f.page={url:'about:blank',status:'complete'};};
 const second=await f.run();assert.equal(second.status,'error');assert.equal(f.inspections,1);
});
