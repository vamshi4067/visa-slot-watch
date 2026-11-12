import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
test('popup keeps a dated location alert visible after a later empty result and safely renders text',async()=>{
 const {document,Event}=parseHTML(readFileSync(new URL('../popup.html',import.meta.url),'utf8'));
 let state={enabled:true,last:{status:'empty'},pendingSlotAlert:{location:'Hyderabad VAC <script>bad</script>',dates:['2027-01-15'],at:1792700000000},locations:[],history:{},notificationPermission:'granted'};
 const commands=[];
 globalThis.document=document;globalThis.chrome={runtime:{getManifest:()=>({version:'test'}),sendMessage:async message=>{commands.push(message);if(message.type==='slot-ack')state={...state,pendingSlotAlert:null};return {ok:true,state};}},storage:{onChanged:{addListener(){}}}};
 await import('../popup.js');await new Promise(r=>setImmediate(r));
 const banner=document.getElementById('slot-alert');assert.ok(banner,'Dedicated slot banner must exist');
 assert.equal(banner.hidden,false);assert.match(banner.textContent,/January 15, 2027/);assert.match(banner.textContent,/Hyderabad VAC/);assert.equal(banner.querySelector('script'),null);
 assert.equal(document.getElementById('badge').textContent,'Slots found');
 document.getElementById('slot-ack').dispatchEvent(new Event('click'));await new Promise(r=>setImmediate(r));
 assert.equal(banner.hidden,true);assert.ok(commands.some(x=>x.type==='slot-ack'));
 delete globalThis.chrome;delete globalThis.document;
});
