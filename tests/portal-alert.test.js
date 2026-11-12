import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {readSnapshot} from '../adapter.js';
import {classify} from '../core.js';
test('only the armed PSE0501 available-days alert is handled; unrelated alerts remain native',()=>{
 const {document}=parseHTML('<html><body></body></html>');const native=[];
 const window={alert:message=>native.push(message)};
 vm.runInNewContext(readFileSync(new URL('../portal-alert.js',import.meta.url),'utf8'),{window,document});
 const message='Unable to load appointment available days at this time. Please contact support with error code PSE0501 if further assistance is needed.';
 window.alert(message);assert.equal(native.length,1);
 document.documentElement.setAttribute('data-visa-watch-armed','true');window.alert(message);
 assert.equal(native.length,1);assert.equal(document.documentElement.getAttribute('data-visa-watch-error'),'PSE0501');
 window.alert('Another error PSE0501');window.alert('Unable to load appointment available days at this time. PSE0502');assert.equal(native.length,3);
 const snapshot=readSnapshot(document,'https://www.usvisascheduling.com/en-US/ofc-schedule/',{isVisible:()=>true,ready:true});
 const result=classify({...snapshot,calendar:true,location:'HYDERABAD VAC',dates:['2027-01-15'],text:'No Slots Available'});
 assert.equal(result.status,'error');assert.equal(result.code,'PSE0501');assert.deepEqual(result.dates,[]);
});

test('the bridge disarms immediately on Pause and ignores an older arming response',async()=>{
 const {document}=parseHTML('<html><body></body></html>');let listener;const requests=[];
 const chrome={runtime:{sendMessage:()=>new Promise(resolve=>requests.push(resolve))},storage:{onChanged:{addListener:fn=>{listener=fn;}}}};
 vm.runInNewContext(readFileSync(new URL('../portal-bridge.js',import.meta.url),'utf8'),{document,chrome,MutationObserver:class{observe(){}disconnect(){}}});
 requests.shift()({armed:true});await new Promise(r=>setImmediate(r));assert.equal(document.documentElement.getAttribute('data-visa-watch-armed'),'true');
 listener({watch:{newValue:{enabled:true}}},'local');const stale=requests.shift();
 listener({watch:{newValue:{enabled:false}}},'local');assert.equal(document.documentElement.getAttribute('data-visa-watch-armed'),'false');
 const latest=requests.shift();latest({armed:false});stale({armed:true});await new Promise(r=>setImmediate(r));
 assert.equal(document.documentElement.getAttribute('data-visa-watch-armed'),'false');
});

test('reinstalling on an existing tab does not stack alert wrappers or bridge listeners',()=>{
 const {document}=parseHTML('<html><body></body></html>');let listeners=0;
 const window={alert:()=>{}};
 const main=vm.createContext({window,document});const hook=readFileSync(new URL('../portal-alert.js',import.meta.url),'utf8');
 vm.runInContext(hook,main);const first=window.alert;vm.runInContext(hook,main);assert.equal(window.alert,first);
 const bridge=vm.createContext({document,chrome:{runtime:{sendMessage:async()=>({armed:false})},storage:{onChanged:{addListener(){listeners++;}}}},MutationObserver:class{observe(){}disconnect(){}}});
 const source=readFileSync(new URL('../portal-bridge.js',import.meta.url),'utf8');vm.runInContext(source,bridge);vm.runInContext(source,bridge);assert.equal(listeners,1);
});
