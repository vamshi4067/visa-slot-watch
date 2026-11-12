import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {createDetectorInstaller} from '../detector.js';
test('an existing calendar document receives the detector without navigation and uses bridge-owned arming',async()=>{
 const {document}=parseHTML('<html><body></body></html>');const calls=[];
 let watch={enabled:true,tabId:7};
 const api={tabs:{get:async()=>({url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'})},storage:{local:{get:async()=>({watch})}},scripting:{executeScript:async details=>{
  calls.push(details);
  if(details.files)return [];
  const context=vm.createContext({document,chrome:api});
  // The bridge resolves the current paused state; the installer must not overwrite it.
  context[Symbol.for('visa-slot-watch.bridge.0.6.1')]={refresh:async()=>document.documentElement.setAttribute('data-visa-watch-armed','false')};
  return [{result:await vm.runInContext('('+details.func.toString()+')('+JSON.stringify(details.args[0])+')',context)}];
 }}};
 await createDetectorInstaller(api)(7);
 assert.deepEqual(calls.slice(0,2).map(x=>[x.world,x.files]),[['MAIN',['portal-alert.js']],['ISOLATED',['portal-bridge.js']]]);
 assert.equal(document.documentElement.getAttribute('data-visa-watch-armed'),'false');
 assert.ok(calls.every(x=>x.target.tabId===7));
});
test('detector installation refuses other pages before injecting anything',async()=>{
 let calls=0;const install=createDetectorInstaller({tabs:{get:async()=>({url:'https://example.com/'})},scripting:{executeScript:async()=>{calls++;}}});
 await assert.rejects(install(7),/calendar/i);assert.equal(calls,0);
});

test('missing document or failed detector installation stops inspection',async()=>{
 let calls=0;const api={tabs:{get:async()=>({url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'})},scripting:{executeScript:async details=>{calls++;return details.files?[]:[{result:{ready:false}}];}}};
 await assert.rejects(createDetectorInstaller(api)(7),/could not be installed/);assert.equal(calls,3);
});

test('a delayed pre-Pause reply cannot re-arm the installer document',async()=>{
 const {document}=parseHTML('<html><body></body></html>');const armReads=[],storageReads=[];let changed;
 const api={runtime:{sendMessage:()=>new Promise(resolve=>armReads.push(resolve))},storage:{local:{get:()=>new Promise(resolve=>storageReads.push(resolve))},onChanged:{addListener:fn=>{changed=fn;}}},tabs:{get:async()=>({url:'https://www.usvisascheduling.com/en-US/ofc-schedule/'})},scripting:{executeScript:async details=>{
  if(details.files)return [];
  return [{result:await vm.runInContext('('+details.func.toString()+')('+JSON.stringify(details.args[0])+')',context)}];
 }}};
 const context=vm.createContext({document,chrome:api,MutationObserver:class{observe(){}disconnect(){}}});
 const {readFileSync}=await import('node:fs');vm.runInContext(readFileSync(new URL('../portal-bridge.js',import.meta.url),'utf8'),context);
 armReads.shift()({armed:true});await new Promise(r=>setImmediate(r));
 const installing=createDetectorInstaller(api)(7);
 while(!storageReads.length&&!armReads.length)await new Promise(r=>setImmediate(r));
 const oldStorage=storageReads.shift(),oldArm=armReads.shift();
 changed({watch:{newValue:{enabled:false}}},'local');assert.equal(document.documentElement.getAttribute('data-visa-watch-armed'),'false');
 armReads.shift()({armed:false});await new Promise(r=>setImmediate(r));
 if(oldStorage)oldStorage({watch:{enabled:true,tabId:7}});if(oldArm)oldArm({armed:true});await installing;
 assert.equal(document.documentElement.getAttribute('data-visa-watch-armed'),'false');
});
