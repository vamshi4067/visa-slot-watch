import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../controller.js';
function setup(extra={}) {
  let saved={enabled:false,tabId:7,locations:['HYDERABAD VAC','MUMBAI VAC'],index:0,history:{},seen:{},interval:5,...extra};
  const effects={observations:[],notifications:[],whatsapps:[],delays:[],scheduled:0,cleared:0,reloads:0};
  const io={get:async()=>structuredClone(saved),set:async s=>{saved=structuredClone(s);},clearAlarm:async()=>effects.cleared++,schedule:async delay=>{effects.scheduled++;effects.delays.push(delay);},
    tab:async()=>({id:7,url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'}),
    inventory:async()=>({status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC','MUMBAI VAC']}),
    observe:async(id,loc)=>{effects.observations.push(loc);return {status:'empty',location:loc,dates:[],at:1,reason:'No Slots Available'};},
    notify:async(title,message)=>effects.notifications.push({title,message}),whatsapp:async report=>{effects.whatsapps.push(report);return {status:'accepted',at:Date.now()};}};
  return {io,effects,state:()=>saved,controller:createController(io)};
}
test('stopped checker never touches calendar',async()=>{
  const x=setup();await x.controller.tick(); assert.equal(x.effects.observations.length,0);
});
test('full sweep checks each location before restarting at Hyderabad',async()=>{
  const x=setup({enabled:true,all:true});await x.controller.tick();await x.controller.tick();await x.controller.tick();
  assert.deepEqual(x.effects.observations,['HYDERABAD VAC','MUMBAI VAC','HYDERABAD VAC']);
});
test('send one combined report only after all locations in a sweep',async()=>{
  const x=setup({enabled:true,all:true});await x.controller.tick();assert.equal(x.effects.whatsapps.length,0);assert.equal(x.effects.delays[0],0.5);
  await x.controller.tick();assert.equal(x.effects.whatsapps.length,1);assert.equal(x.effects.whatsapps[0].complete,true);
  assert.deepEqual(x.effects.whatsapps[0].locations.map(x=>[x.location,x.status]),[['HYDERABAD VAC','empty'],['MUMBAI VAC','empty']]);
});
test('completed sweep always produces one combined desktop alert with every location result',async()=>{
  const x=setup({enabled:true,all:true});await x.controller.tick();await x.controller.tick();
  const summary=x.effects.notifications.find(n=>n.title==='Visa Watch · sweep complete');
  assert.ok(summary);assert.match(summary.message,/HYDERABAD VAC: No Slots Available/);assert.match(summary.message,/MUMBAI VAC: No Slots Available/);
});
test('a service worker restart continues the unfinished sweep',async()=>{
  const x=setup({enabled:true,all:true});await x.controller.tick();await createController(x.io).tick();
  assert.deepEqual(x.effects.observations,['HYDERABAD VAC','MUMBAI VAC']);assert.equal(x.effects.whatsapps.length,1);
});
test('blocked sweep reports failed and unvisited locations without retry',async()=>{
  const x=setup({enabled:true,all:true,locations:['MUMBAI VAC','HYDERABAD VAC','NEW DELHI VAC']});
  const observe=x.io.observe;x.io.observe=async(id,loc)=>loc==='MUMBAI VAC'?{status:'blocked',location:loc,dates:[],reason:'Access denied'}:observe(id,loc);
  await x.controller.tick();await x.controller.tick();await x.controller.tick();
  assert.equal(x.state().enabled,false);assert.equal(x.effects.whatsapps.length,1);assert.equal(x.effects.whatsapps[0].complete,false);
  assert.deepEqual(x.effects.whatsapps[0].locations.map(x=>[x.location,x.status]),[['HYDERABAD VAC','empty'],['MUMBAI VAC','blocked'],['NEW DELHI VAC','not_checked']]);
});
test('blocked result stops scheduling and never retries',async()=>{
  const x=setup({enabled:true});x.io.observe=async()=>({status:'blocked',reason:'Access denied',location:'HYDERABAD VAC',dates:[],at:1});
  await x.controller.tick();await x.controller.tick();assert.equal(x.state().enabled,false);assert.ok(x.effects.cleared);assert.equal(x.state().last.status,'blocked');
});
test('alerts persist deduplication across controller restarts',async()=>{
  const x=setup({enabled:true});x.io.observe=async()=>({status:'available',location:'HYDERABAD VAC',dates:['2027-01-02'],at:1});
  await x.controller.tick();await createController(x.io).tick();assert.equal(x.effects.notifications.length,1);
});
test('wrong location never produces a slot alert',async()=>{
  const x=setup({enabled:true});x.io.observe=async()=>({status:'available',location:'MUMBAI VAC',dates:['2027-01-02']});
  await x.controller.tick();assert.equal(x.state().enabled,false);assert.equal(x.effects.notifications.filter(n=>/slots/i.test(n.title)).length,0);
});
test('persisted lock prevents a second worker from checking',async()=>{
  const x=setup({enabled:true,lease:Date.now()});await x.controller.tick();assert.equal(x.effects.observations.length,0);
});
test('stop during a running check suppresses later slot alert',async()=>{
  const x=setup({enabled:true});let release; x.io.observe=()=>new Promise(r=>{release=r;});
  const run=x.controller.tick();while(!release)await new Promise(r=>setTimeout(r,0));await x.controller.stop();release({status:'available',location:'HYDERABAD VAC',dates:['2027-01-02']});await run;
  assert.equal(x.effects.notifications.length,0);assert.equal(x.state().enabled,false);
});
test('notification failure pauses and preserves unalerted dates for resume',async()=>{
  const x=setup({enabled:true});x.io.observe=async()=>({status:'available',location:'HYDERABAD VAC',dates:['2027-01-02']});x.io.notify=async()=>{throw Error('Notifications disabled');};
  await x.controller.tick();assert.equal(x.state().enabled,false);assert.match(x.state().last.reason,/notification/i);assert.deepEqual(x.state().seen,{});
});
test('only the chosen calendar tab is attachable',async()=>{
  const x=setup();x.io.tab=async()=>({url:'https://example.com/'});await assert.rejects(x.controller.attach(9),/calendar/i);
});
test('stop cannot be undone by inventory from a pending start',async()=>{
  const x=setup();let release;x.io.inventory=()=>new Promise(r=>{release=r;});
  const starting=x.controller.start();while(!release)await new Promise(r=>setTimeout(r,0));
  await x.controller.stop();release({status:'empty',locations:['HYDERABAD VAC'],location:'HYDERABAD VAC'});
  await assert.rejects(starting,/paused/i);assert.equal(x.state().enabled,false);
});
test('each successful empty check sends a location and time receipt by default',async()=>{
  const x=setup({enabled:true});await x.controller.tick();await x.controller.tick();
  const receipts=x.effects.notifications.filter(n=>/no slots/i.test(n.title));
  assert.equal(receipts.length,2);
  assert.match(receipts[0].message,/HYDERABAD VAC/);
  assert.match(receipts[0].message,/Checked .+\d/);
  assert.match(receipts[0].message,/No Slots Available/);
});
test('empty check receipts can be disabled without stopping checks',async()=>{
  const x=setup({enabled:true,notifyEmpty:false});await x.controller.tick();
  assert.equal(x.effects.notifications.length,0);assert.equal(x.state().history['HYDERABAD VAC'].status,'empty');
});
test('pause during a no-slots notification cannot be undone by its completion',async()=>{
  const x=setup({enabled:true});let release;x.io.notify=()=>new Promise(r=>{release=r;});
  const running=x.controller.tick();while(!release)await new Promise(r=>setTimeout(r,0));
  await x.controller.stop();release();await running;assert.equal(x.state().enabled,false);
});
test('turning off desktop empty receipts does not suppress sweep whatsapps',async()=>{
  const x=setup({enabled:true,all:false,notifyEmpty:false});await x.controller.tick();
  assert.equal(x.effects.notifications.filter(n=>/no slots/i.test(n.title)).length,0);assert.equal(x.effects.whatsapps.length,1);
});
test('thrown page loading errors produce one partial report with unvisited coverage',async()=>{
  const x=setup({enabled:true,all:true,locations:['HYDERABAD VAC','MUMBAI VAC','NEW DELHI VAC']});
  const observe=x.io.observe;x.io.observe=async(id,loc)=>{if(loc==='MUMBAI VAC')throw Error('Page loading timed out');return observe(id,loc);};
  await x.controller.tick();await x.controller.tick();await x.controller.tick();
  assert.equal(x.effects.whatsapps.length,1);assert.equal(x.effects.whatsapps[0].complete,false);
  assert.deepEqual(x.effects.whatsapps[0].locations.map(r=>r.status),['empty','error','not_checked']);
});
test('failed whatsapp handoff records failure but does not pause later sweeps',async()=>{
  const x=setup({enabled:true,all:false});x.io.whatsapp=async report=>{x.effects.whatsapps.push(report);throw Error('Relay unavailable');};
  await x.controller.tick();assert.equal(x.effects.whatsapps.length,1);assert.equal(x.state().enabled,true);
  assert.equal(x.state().delivery.status,'failed');assert.equal(x.effects.delays[0],5);
});
test('pause during report persistence prevents later whatsapp handoff',async()=>{
  const x=setup({enabled:true,all:false});let release,held=false;const save=x.io.set;
  x.io.set=async s=>{await save(s);if(s.enabled&&s.lastSweep&&!held){held=true;await new Promise(r=>{release=r;});}};
  const running=x.controller.tick();while(!release)await new Promise(r=>setTimeout(r,0));
  await x.controller.stop();release();await running;assert.equal(x.effects.whatsapps.length,0);assert.equal(x.state().enabled,false);
});
test('a slow completed sweep waits the full interval after completion',async()=>{
  const x=setup({enabled:true,all:false,interval:2,cycle:{id:'slow-cycle',startedAt:Date.now()-600000,locations:['HYDERABAD VAC'],cursor:0,results:[]}});
  await x.controller.tick();assert.equal(x.effects.delays[0],2);assert.equal(x.state().cycle,null);
});
test('completed all-empty sweep sends one email summary independently of desktop alert settings',async()=>{
  const x=setup({enabled:true,notifyEmpty:false});x.effects.emails=[];x.io.email=async report=>{x.effects.emails.push(report);return {status:'sent',at:Date.now()};};
  await x.controller.tick();await x.controller.tick();
  assert.equal(x.effects.emails.length,1);assert.equal(x.effects.emails[0].complete,true);
  assert.deepEqual(x.effects.emails[0].locations.map(r=>r.status),['empty','empty']);
});
test('email failure is recorded without pausing checks or suppressing desktop summary',async()=>{
  const x=setup({enabled:true,all:false});x.io.email=async()=>{throw Error('Gmail unavailable');};
  await x.controller.tick();
  assert.equal(x.state().enabled,true);assert.ok(x.effects.scheduled>0);
  assert.ok(x.effects.notifications.some(n=>n.title==='Visa Watch · sweep complete'));
  assert.equal(x.state().emailDelivery.status,'failed');
  assert.match(x.state().emailDelivery.reason,/Gmail unavailable/);
});
test('incomplete sweep does not trigger email',async()=>{
  const x=setup({enabled:true,all:true,locations:['HYDERABAD VAC','MUMBAI VAC']});x.effects.emails=[];x.io.email=async report=>x.effects.emails.push(report);
  x.io.observe=async()=>({status:'blocked',location:'HYDERABAD VAC',dates:[],reason:'Access denied'});
  await x.controller.tick();assert.equal(x.effects.emails.length,0);
});
test('disabled email delivery does not create a failure status',async()=>{
  const x=setup({enabled:true,all:false});x.io.email=async()=>null;
  await x.controller.tick();
  assert.equal(x.state().emailDelivery,undefined);
});

test('new slot alerts persist until acknowledged and repeated dates do not alert again',async()=>{
 const x=setup({enabled:true,all:false});
 const calls=[];x.io.notify=async(...args)=>calls.push(args);
 x.io.observe=async()=>({status:'available',location:'HYDERABAD VAC',dates:['2027-01-15']});
 await x.controller.tick();
 const alert=calls.find(args=>args[2]?.kind==='slots');assert.ok(alert);
 assert.match(alert[1],/Visa slots available on January 15, 2027, at HYDERABAD VAC\./);
 assert.deepEqual(x.state().pendingSlotAlert.dates,['2027-01-15']);
 await createController(x.io).tick();assert.equal(calls.filter(args=>args[2]?.kind==='slots').length,1);
 x.io.observe=async()=>({status:'empty',location:'HYDERABAD VAC',dates:[]});
 await x.controller.tick();assert.deepEqual(x.state().pendingSlotAlert.dates,['2027-01-15']);
 await x.controller.acknowledgeSlotAlert();assert.equal(x.state().pendingSlotAlert,null);
 assert.deepEqual(x.state().seen['HYDERABAD VAC'],['2027-01-15']);
});

test('PSE0501 refreshes through Home and preserves alerts before a fresh Hyderabad-first sweep',async()=>{
 const x=setup({enabled:true,all:false,seen:{'HYDERABAD VAC':['2027-01-15']},pendingSlotAlert:{location:'HYDERABAD VAC',dates:['2027-01-15'],at:1}});
 const steps=[];x.io.observe=async()=>({status:'error',code:'PSE0501',reason:'Unable to load appointment days.',dates:[]});
 x.io.recover=async(id,recovery)=>{steps.push(recovery.stage);return recovery.stage==='refresh'?{nextStage:'home'}:recovery.stage==='home'?{nextStage:'calendar'}:recovery.stage==='calendar'?{nextStage:'verify'}:{status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC'],documentId:'latest-doc',dates:[]};};
 await x.controller.tick();assert.equal(x.state().enabled,true);assert.equal(x.state().recovery.stage,'refresh');assert.equal(x.effects.delays.at(-1),0.5);
 for(let i=0;i<4;i++){x.state().recovery.dueAt=0;await createController(x.io).tick();}
 assert.deepEqual(steps,['refresh','home','calendar','verify']);assert.equal(x.state().recovery,null);assert.equal(x.state().enabled,true);
 assert.deepEqual(x.state().seen['HYDERABAD VAC'],['2027-01-15']);assert.ok(x.state().pendingSlotAlert);assert.equal(x.state().documentId,'latest-doc');
 await createController(x.io).tick();assert.equal(x.state().enabled,true);assert.equal(x.state().recovery.stage,'refresh');
});
test('Pause cancels a queued recovery without navigating or restarting',async()=>{
 const x=setup({enabled:true,recoveryUsed:true,recovery:{stage:'home',dueAt:0}});let calls=0;x.io.recover=async()=>{calls++;return {nextStage:'calendar'};};
 await x.controller.stop();await x.controller.tick();assert.equal(calls,0);assert.equal(x.state().recovery,null);assert.equal(x.state().enabled,false);
});

test('queued recovery waits for human verification and resumes only after clearance',async()=>{
 const x=setup({enabled:true,calendarURL:'https://www.usvisascheduling.com/en-US/ofc-schedule/',recovery:{stage:'verify',dueAt:Date.now()+60000}});let calls=0;
 x.io.recover=async()=>{calls++;return {status:'challenge',reason:'Complete verification manually.'};};
 await x.controller.tick();assert.equal(calls,0);assert.equal(x.effects.observations.length,0);
 x.state().recovery.dueAt=0;await x.controller.tick();assert.equal(calls,1);assert.equal(x.state().enabled,true);assert.equal(x.state().recovery.stage,'human');assert.equal(x.state().last.status,'challenge');
 assert.equal(x.effects.notifications.filter(n=>n.title==='Human verification needed').length,1);
 assert.equal(x.effects.whatsapps.length,1);
 assert.equal(x.effects.whatsapps[0].type,'verification');
 x.state().recovery.dueAt=0;await x.controller.tick();
 assert.equal(x.effects.whatsapps.length,1);
 await x.controller.tick();assert.equal(calls,2);assert.equal(x.effects.observations.length,0);
 x.io.recover=async()=>({nextStage:'home'});
 x.state().recovery.dueAt=0;await x.controller.tick();assert.equal(x.state().recovery.stage,'home');
});
test('Pause during a recovery navigation suppresses all later recovery and sweep work',async()=>{
 const x=setup({enabled:true,recoveryUsed:true,recovery:{stage:'home',dueAt:0}});let release;
 x.io.recover=()=>new Promise(r=>{release=r;});const run=x.controller.tick();while(!release)await new Promise(r=>setTimeout(r,0));
 await x.controller.stop();release({nextStage:'calendar'});await run;await x.controller.tick();
 assert.equal(x.state().enabled,false);assert.equal(x.state().recovery,null);assert.equal(x.effects.observations.length,0);assert.equal(x.effects.scheduled,0);
});

test('dates found during recovery verification alert immediately and remain deduplicated',async()=>{
 const x=setup({enabled:true,recoveryUsed:true,recovery:{stage:'verify',dueAt:0}});const calls=[];
 x.io.notify=async(...args)=>calls.push(args);
 x.io.recover=async()=>({status:'available',location:'HYDERABAD VAC',locations:['HYDERABAD VAC'],documentId:'new-document',dates:['2027-01-15']});
 await x.controller.tick();assert.equal(x.state().enabled,true);
 assert.equal(calls.filter(args=>args[2]?.kind==='slots').length,1);
 assert.match(calls[0][1],/January 15, 2027, at HYDERABAD VAC/);
 assert.deepEqual(x.state().pendingSlotAlert.dates,['2027-01-15']);assert.deepEqual(x.state().seen['HYDERABAD VAC'],['2027-01-15']);
 x.io.observe=async()=>({status:'available',location:'HYDERABAD VAC',dates:['2027-01-15']});
 await x.controller.tick();assert.equal(calls.filter(args=>args[2]?.kind==='slots').length,1);
});

test('fresh reattachment replaces locations and document ID while preserving existing date alerts',async()=>{
 const seen={'HYDERABAD VAC':['2027-01-15']},pending={location:'HYDERABAD VAC',dates:['2027-01-15'],at:1};
 const x=setup({enabled:true,all:true,recovery:{stage:'verify',dueAt:0,startedAt:1},calendarURL:'https://www.usvisascheduling.com/en-US/ofc-schedule/',documentId:'old-document',seen,pendingSlotAlert:pending});
 x.io.recover=async()=>({status:'empty',location:'NEW DELHI VAC',locations:['NEW DELHI VAC','HYDERABAD VAC'],documentId:'new-document',dates:[]});
 await x.controller.tick();assert.equal(x.state().enabled,true);assert.equal(x.state().documentId,'new-document');assert.deepEqual(x.state().locations,['NEW DELHI VAC','HYDERABAD VAC']);assert.deepEqual(x.state().seen,seen);assert.deepEqual(x.state().pendingSlotAlert,pending);
 await x.controller.tick();assert.equal(x.effects.observations[0],'HYDERABAD VAC');
});

test('manual attention states and delivery errors never queue general calendar recovery',async()=>{
 for(const status of ['login','blocked']){
  const x=setup({enabled:true});let calls=0;x.io.recover=async()=>{calls++;};x.io.observe=async()=>({status,code:'PSE0501',reason:'Manual attention',dates:[]});
  await x.controller.tick();assert.equal(x.state().enabled,false);assert.equal(x.state().recovery,null);assert.equal(calls,0);
 }
 const x=setup({enabled:true});x.io.recover=async()=>{throw Error('Must not recover delivery errors');};x.io.notify=async()=>{throw Error('Notifications disabled');};
 await x.controller.tick();assert.equal(x.state().enabled,false);assert.equal(x.state().recovery,null);
});
test('a blank attached calendar queues recovery only with a known calendar base',async()=>{
 const x=setup({enabled:true,calendarURL:'https://www.usvisascheduling.com/en-US/ofc-schedule/'});x.io.tab=async()=>({url:'about:blank'});x.io.recover=async()=>({nextStage:'home'});
 await x.controller.tick();assert.equal(x.state().recovery.stage,'refresh');assert.equal(x.effects.observations.length,0);
 const y=setup({enabled:true});y.io.tab=x.io.tab;y.io.recover=x.io.recover;await y.controller.tick();assert.equal(y.state().enabled,false);assert.equal(y.state().recovery,null);
});
test('a recovery observation without a fresh document ID cannot replace the calendar attachment',async()=>{
 const x=setup({enabled:true,recovery:{stage:'verify',dueAt:0,startedAt:1},documentId:'old-document'});
 x.io.recover=async()=>({status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC'],dates:[]});
 await x.controller.tick();assert.equal(x.state().enabled,false);assert.equal(x.state().documentId,'old-document');assert.match(x.state().last.reason,/document/i);
});

test('an attached-tab verification wake skips the delay and continues through reattachment',async()=>{
 const x=setup({enabled:true,calendarURL:'https://www.usvisascheduling.com/en-US/ofc-schedule/',recovery:{stage:'human',dueAt:Date.now()+30000,humanDeadline:Date.now()+60000}});
 const wakes=[];x.io.wake=request=>wakes.push(request);
 x.io.recover=async()=>({nextStage:'home'});
 await x.controller.tick({tabId:99});assert.equal(x.state().recovery.stage,'human');
 await x.controller.tick({tabId:7});assert.equal(x.state().recovery.stage,'home');assert.equal(wakes.length,1);
 x.io.recover=async()=>({status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC'],documentId:'verified-document',dates:[]});
 await x.controller.tick(wakes.shift());
 assert.equal(x.state().recovery,null);
 assert.equal(wakes[0].documentId,'verified-document');
 await x.controller.stop();
 await x.controller.tick(wakes.shift());
 assert.equal(x.effects.observations.length,0);
});

test('slot alerts include the cutoff date, exclude later dates and deduplicate matching observations',async()=>{
 const x=setup({enabled:true,all:false,latestDate:'2027-01-15'});
 x.io.observe=async()=>({status:'available',location:'HYDERABAD VAC',dates:['2027-01-20','2027-01-15','2027-01-12','2027-01-12']});
 await x.controller.tick();
 await x.controller.tick();
 const alerts=x.effects.whatsapps.filter(report=>report.type==='slots');
 assert.equal(alerts.length,1);
 assert.equal(alerts[0].earliestDate,'2027-01-12');
 assert.equal(alerts[0].matchingCount,2);
 assert.deepEqual(x.state().pendingSlotAlert.dates,['2027-01-12','2027-01-15']);
 assert.deepEqual(x.state().seen['HYDERABAD VAC'],['2027-01-12','2027-01-15']);
 await x.controller.stop();
 assert.deepEqual(x.state().activity.map(({kind,count})=>[kind,count]),[['check',1],['match',2],['check',1],['pause',1]]);

 assert.ok(x.effects.whatsapps.some(report=>report.type==='sweep'&&report.locations[0].dates.includes('2027-01-20')));
});

test('first refresh is immediate and recovery timeouts can retry past the old hourly cap',async()=>{
 const x=setup({enabled:true,all:false,interval:5});
 const wakes=[];
 x.io.wake=request=>wakes.push(request);
 x.io.observe=async()=>({status:'error',code:'PSE0501',reason:'Calendar failed',location:'HYDERABAD VAC',dates:[]});
 x.io.recover=async(_tabId,recovery)=>{
  assert.equal(recovery.stage,'refresh');
  return {status:'loading',code:'CALENDAR_TIMEOUT',reason:'Calendar kept loading'};
 };
 await x.controller.tick();
 assert.equal(x.state().recovery.stage,'refresh');
 assert.equal(wakes.length,1);
 assert.ok(x.state().recovery.dueAt<=Date.now());
 await x.controller.tick(wakes[0]);
 for(let attempt=0;attempt<5;attempt++){
  assert.equal(x.state().enabled,true);
  assert.equal(wakes.length,1);
  assert.ok(x.state().recovery.dueAt>Date.now());
  assert.equal(x.effects.delays.at(-1),0.5);
  const restarted=createController(x.io);
  await restarted.tick();
  assert.equal(x.state().enabled,true);
  assert.ok(x.state().recovery.dueAt>Date.now());
  x.state().recovery.dueAt=0;
  await restarted.tick();
 }
 assert.equal(x.state().enabled,true);
});
