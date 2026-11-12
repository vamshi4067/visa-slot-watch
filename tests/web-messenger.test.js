import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebMessenger} from '../whatsapp-client.js';
const report={type:'test',id:'test-1'};
function setup(extra={}){
  let journal={pending:null,sent:[]};let calls=0;
  const io={settings:async()=>({mode:'web',enabled:true,number:'15555550101',tabId:7,...extra}),journal:async()=>structuredClone(journal),save:async value=>{journal=structuredClone(value);},tab:async()=>({url:'https://web.whatsapp.com/'}),submit:async()=>{calls++;return {status:'submitted'};}};
  return {io,messenger:createWebMessenger(io),calls:()=>calls,journal:()=>journal};
}
test('disabled messenger never touches WhatsApp',async()=>{const x=setup({enabled:false});assert.equal((await x.messenger.send(report)).status,'not_configured');assert.equal(x.calls(),0);});
test('submitted report IDs prevent duplicate sends across worker restarts',async()=>{const x=setup();await x.messenger.send(report);await createWebMessenger(x.io).send(report);assert.equal(x.calls(),1);});
test('ambiguous send leaves a persisted lock and is never retried',async()=>{const x=setup();x.io.submit=async()=>{throw Error('Browser disconnected');};await assert.rejects(x.messenger.send(report));assert.equal(x.journal().pending,'test-1');await assert.rejects(createWebMessenger(x.io).send(report),/interrupted/i);});
test('safe pre-send refusal clears lock but never sends',async()=>{const x=setup();x.io.submit=async()=>({status:'recipient_unverified'});await assert.rejects(x.messenger.send(report),/recipient/i);assert.equal(x.journal().pending,null);});
test('a closed or wrong-domain tab cannot receive reports',async()=>{const x=setup();x.io.tab=async()=>({url:'https://example.com/'});await assert.rejects(x.messenger.send(report));assert.equal(x.calls(),0);});

test('turning off summaries leaves verification and manual test alerts available',async()=>{
 const x=setup({alerts:{sweep:false,verification:true}});
 assert.equal((await x.messenger.send({type:'sweep',id:'sweep-1'})).status,'filtered');
 assert.equal(x.calls(),0);
 assert.equal((await x.messenger.send({type:'verification',id:'verification-1'})).status,'submitted');
 assert.equal((await x.messenger.send(report)).status,'submitted');
 assert.equal(x.calls(),2);
});
