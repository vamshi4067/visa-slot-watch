import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {inspectRecoveryHome,createRecoveryNavigator} from '../recovery.js';
const home='https://www.usvisascheduling.com/en-US/',calendar=home+'ofc-schedule/';
test('recovery accepts only a visible unique Schedule Appointment link to the same-origin calendar',()=>{
 const read=html=>inspectRecoveryHome(parseHTML('<html><body>'+html+'</body></html>').document,home,{isVisible:()=>true});
 assert.equal(read('<a href="/en-US/ofc-schedule/">Schedule Appointment</a>').url,calendar);
 for(const html of ['<a href="https://evil.example/en-US/ofc-schedule/">Schedule Appointment</a>','<a href="javascript:closeApplication()">Schedule Appointment</a>','<a href="/en-US/ofc-schedule/">Close Application and Start New Application</a>','<a href="/en-US/ofc-schedule/?token=private">Schedule Appointment</a>','<a href="/en-US/ofc-schedule/">Schedule Appointment</a><a href="/en-US/ofc-schedule/">Schedule Appointment</a>'])assert.notEqual(read(html).status,'ready');
 assert.equal(read('<p>Verify you are human</p>').status,'challenge');
});
test('navigator uses Home and the rendered schedule link, and stops on a generation guard',async()=>{
 let url=calendar;const navigations=[];
 const io={tab:async()=>({url,status:'complete'}),guard:async()=>{},navigate:async(id,next)=>{url=next;navigations.push(next);},home:async()=>({status:'ready',url:calendar}),inspect:async()=>({status:'empty',location:'HYDERABAD VAC',dates:[]})};
 const recover=createRecoveryNavigator(io);
 assert.equal((await recover(7,{stage:'home'},{generation:1,calendarURL:calendar})).nextStage,'calendar');
 assert.equal((await recover(7,{stage:'calendar'},{generation:1,calendarURL:calendar})).nextStage,'verify');
 assert.equal((await recover(7,{stage:'verify'},{generation:1,calendarURL:calendar})).status,'empty');
 assert.deepEqual(navigations,[home,calendar]);
 io.guard=async()=>{throw Error('Monitoring paused');};await assert.rejects(recover(7,{stage:'home'},{generation:1,calendarURL:calendar}),/paused/);assert.equal(navigations.length,2);
});

test('general recovery refreshes, checks for challenges, then reopens the rendered calendar link',async()=>{
 let url=calendar;const events=[];
 const io={guard:async()=>{},tab:async()=>({url,status:'complete'}),reload:async()=>events.push('refresh'),probe:async()=>({status:'error',code:'PSE0501'}),navigate:async(id,next)=>{events.push(next);url=next;},home:async()=>({status:'ready',url:calendar}),inspect:async()=>({status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC','MUMBAI VAC'],documentId:'new-document',dates:[]})};
 const recover=createRecoveryNavigator(io),context={generation:1,calendarURL:calendar};
 assert.equal((await recover(7,{stage:'refresh'},context)).nextStage,'home');
 assert.equal((await recover(7,{stage:'home'},context)).nextStage,'calendar');
 assert.equal((await recover(7,{stage:'calendar'},context)).nextStage,'verify');
 assert.equal((await recover(7,{stage:'verify'},context)).documentId,'new-document');
 assert.deepEqual(events,['refresh',home,calendar]);
 url=calendar;io.probe=async()=>({status:'challenge',reason:'Verify you are human'});
 assert.equal((await recover(7,{stage:'refresh'},context)).status,'challenge');assert.equal(events.length,3);
});
test('blank recovery uses only its previously verified calendar base, never another origin',async()=>{
 let url='about:blank';const navigations=[];
 const io={guard:async()=>{},tab:async()=>({url,status:'complete'}),navigate:async(id,next)=>navigations.push(next)};
 const recover=createRecoveryNavigator(io);
 assert.equal((await recover(7,{stage:'refresh'},{generation:1,calendarURL:calendar})).nextStage,'home');assert.deepEqual(navigations,[calendar]);
 url='https://evil.example/';assert.equal((await recover(7,{stage:'refresh'},{generation:1,calendarURL:calendar})).status,'unknown');assert.equal(navigations.length,1);
});

test('a challenge after refresh stops Home navigation and login redirects are not recovered',async()=>{
 let status='challenge',url=calendar;const events=[];
 const io={guard:async()=>{},tab:async()=>({url,status:'complete'}),probe:async()=>({status,reason:'Manual attention'}),navigate:async()=>events.push('navigate')};
 const recover=createRecoveryNavigator(io),context={generation:1,calendarURL:calendar};
 assert.equal((await recover(7,{stage:'home'},context)).status,'challenge');assert.equal(events.length,0);
 status='blocked';assert.equal((await recover(7,{stage:'refresh'},context)).status,'blocked');assert.equal(events.length,0);
 url='https://atlasauth.b2clogin.com/login';assert.equal((await recover(7,{stage:'refresh'},context)).status,'login');assert.equal(events.length,0);
});

test('pending same-origin login and verification stop before probing or refreshing',async()=>{
 for(const [path,status] of [['/cdn-cgi/challenge-platform/','challenge'],['/login','login'],['/en-US/account/login','login'],['/unrecognized-page','unknown']]){
  let calls=0;const recover=createRecoveryNavigator({guard:async()=>{},tab:async()=>({url:calendar,status:'loading',pendingUrl:new URL(path,home).href}),probe:async()=>{calls++;return {status:'empty'};},reload:async()=>{calls++;}});
  assert.equal((await recover(7,{stage:'refresh'},{generation:1,calendarURL:calendar})).status,status);assert.equal(calls,0);
 }
});
test('a bounded refresh timeout still reaches Home instead of retrying refresh forever',async()=>{
 const events=[];const recover=createRecoveryNavigator({guard:async()=>{},tab:async()=>({url:calendar,status:'loading',pendingUrl:calendar}),probe:async()=>({status:'loading',reason:'Calendar is still loading.'}),reload:async()=>{events.push('refresh');throw Error('Page loading timed out');},navigate:async(id,url)=>events.push(url)});
 assert.equal((await recover(7,{stage:'refresh'},{generation:1,calendarURL:calendar})).nextStage,'home');
 assert.equal((await recover(7,{stage:'home'},{generation:1,calendarURL:calendar})).nextStage,'calendar');assert.deepEqual(events,['refresh',home]);
});

test('human verification is observed without navigation, then recovery selects the first configured VAC',async()=>{
 let probe={status:'challenge'};
 const actions=[];
 const recover=createRecoveryNavigator({
  guard:async()=>{},tab:async()=>({url:calendar,status:'complete'}),
  probe:async()=>probe,navigate:async()=>actions.push('navigation'),reload:async()=>actions.push('reload'),
  inspect:async(id,request)=>{actions.push(request);return {status:'empty'};}
 });
 const context={generation:2,calendarURL:calendar,all:false};
 assert.equal((await recover(7,{stage:'human'},context)).status,'challenge');
 assert.deepEqual(actions,[]);
 probe={status:'empty',location:'MUMBAI VAC',locations:['MUMBAI VAC','HYDERABAD VAC']};
 assert.deepEqual(await recover(7,{stage:'human'},context),{nextStage:'home'});
 assert.deepEqual(actions,[]);
 await recover(7,{stage:'verify'},context);
 assert.deepEqual(actions,[{location:'HYDERABAD VAC',generation:2}]);
});

test('post-verification Home accepts query parameters and waits for the schedule link',async()=>{
 const url=home+'?__cf_chl_rt_tk=example';
 let html='<p>Loading menu</p>';
 const io={
  guard:async()=>{},tab:async()=>({url,status:'complete'}),
  home:async()=>inspectRecoveryHome(parseHTML('<html><body>'+html+'</body></html>').document,url,{isVisible:()=>true})
 };
 const recover=createRecoveryNavigator(io);
 const context={generation:1,calendarURL:calendar};
 assert.equal((await recover(7,{stage:'human'},context)).status,'challenge');
 html='<a href="/en-US/ofc-schedule/">Schedule Appointment</a>';
 assert.deepEqual(await recover(7,{stage:'human'},context),{nextStage:'calendar'});
});

test('fast reattachment waits for the VAC choices before attempting selection',async()=>{
 let probe={status:'loading',locations:[]};
 const selections=[];
 const recover=createRecoveryNavigator({
  guard:async()=>{},tab:async()=>({url:calendar,status:'complete'}),
  probe:async()=>probe,inspect:async(id,request)=>selections.push(request.location)
 });
 const context={generation:1,calendarURL:calendar};
 assert.deepEqual(await recover(7,{stage:'verify',fast:true},context),{nextStage:'verify',waitingForLoad:true});
 assert.deepEqual(selections,[]);
 probe={status:'unknown',code:'CALENDAR_UNREADABLE',locations:['HYDERABAD VAC']};
 await recover(7,{stage:'verify',fast:true},context);
 assert.deepEqual(selections,['HYDERABAD VAC']);
});
