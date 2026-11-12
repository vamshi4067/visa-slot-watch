import test from 'node:test';
import assert from 'node:assert/strict';
const event=()=>({handlers:[],addListener(fn){this.handlers.push(fn);},removeListener(fn){this.handlers=this.handlers.filter(x=>x!==fn);}});
test('pause during browser preflight prevents pending reload and location injection',async()=>{
  let watch={tabId:7,locations:['HYDERABAD VAC'],history:{},seen:{},enabled:false,index:0,interval:5,generation:0};
  const storage={};const effects={reloads:0,locations:0,notificationIds:[],authRequests:[],emailRequests:[]};
  let inventories=0,release;
  globalThis.chrome={
    storage:{onChanged:event(),local:{get:async keys=>{const all={...storage,watch:structuredClone(watch)};if(typeof keys==='string')return {[keys]:all[keys]};if(Array.isArray(keys))return Object.fromEntries(keys.map(key=>[key,all[key]]));return all;},set:async data=>{if(data.watch)watch=structuredClone(data.watch);for(const [key,value] of Object.entries(data))if(key!=='watch')storage[key]=structuredClone(value);}}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    scripting:{executeScript:async details=>{
      if(details.files)return [];
      if(typeof details.args?.[0]==='number')return [{result:{ready:true}}];
      if(details.args[0].mode==='inventory'){
        inventories++;if(inventories===2)await new Promise(r=>{release=r;});
        return [{result:{status:'empty',location:'HYDERABAD VAC',locations:['HYDERABAD VAC'],dates:[]}}];
      }
      effects.locations++;return [{result:{status:'empty',location:'HYDERABAD VAC',dates:[]}}];
    }},
    alarms:{onAlarm:event(),get:async()=>null,create:async()=>{},clear:async()=>{}},
    tabs:{get:async()=>({id:7,url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'}),reload:async()=>{effects.reloads++;},onUpdated:event(),onRemoved:event()},
    notifications:{getPermissionLevel:async()=>'granted',create:async id=>{effects.notificationIds.push(id);},onClicked:event()},
    identity:{getAuthToken:async details=>{effects.authRequests.push(details);return {token:'test-access-token'};}},
    runtime:{id:'fixture-extension',onMessage:event(),onStartup:event(),onInstalled:event()}
  };
  const oldFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{effects.emailRequests.push({url,options});return {ok:true,status:200};};
  await import('../background.js');
  const send=(type,extra={})=>new Promise(resolve=>chrome.runtime.onMessage.handlers[0]({type,...extra},{id:'fixture-extension'},resolve));
  const starting=send('start');while(!release)await new Promise(r=>setTimeout(r,0));
  assert.equal((await send('stop')).ok,true);release();await starting;
  await send('test');await send('test');
  assert.equal(effects.notificationIds.length,2);assert.notEqual(effects.notificationIds[0],effects.notificationIds[1]);
  assert.equal(watch.enabled,false);assert.equal(effects.reloads,0);assert.equal(effects.locations,0);
  const arm=sender=>new Promise(resolve=>{const accepted=chrome.runtime.onMessage.handlers[0]({type:'calendar-arm'},sender,resolve);if(!accepted)resolve({armed:false});});
  const pageSender={id:'fixture-extension',tab:{id:7},frameId:0,url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'};
  assert.equal((await arm(pageSender)).armed,false);
  watch.enabled=true;
  assert.equal((await arm(pageSender)).armed,true);
  assert.equal((await arm({...pageSender,tab:{id:99}})).armed,false);
  assert.equal((await arm({...pageSender,frameId:1})).armed,false);
  assert.equal((await arm({...pageSender,url:'https://evil.example/'})).armed,false);
  assert.equal(chrome.runtime.onMessage.handlers[0]({type:'start'},pageSender,()=>{}),false);
  watch.delivery={status:'accepted',at:1};
  await chrome.runtime.onInstalled.handlers[0]({reason:'update',previousVersion:'0.3.0'});
  assert.equal(watch.enabled,false);assert.equal(watch.delivery,null);
  assert.equal((await send('email-settings',{enabled:true,to:'recipient@example.com'})).ok,true);
  assert.equal((await send('email-connect')).ok,true);
  assert.equal(storage.email.connected,true);assert.deepEqual(effects.authRequests,[{interactive:true}]);
  const sent=await send('email-test');assert.equal(sent.ok,true);assert.equal(sent.state.emailDelivery.status,'sent');
  assert.equal(effects.emailRequests.length,1);assert.equal(effects.emailRequests[0].url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  const message=JSON.parse(effects.emailRequests[0].options.body);assert.equal(typeof message.raw,'string');
  assert.equal(effects.authRequests.length,2);assert.ok(effects.authRequests.every(x=>x.interactive===true));
  globalThis.fetch=oldFetch;delete globalThis.chrome;
});
