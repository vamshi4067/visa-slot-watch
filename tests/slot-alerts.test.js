import test from 'node:test';
import assert from 'node:assert/strict';
import {slotMessage,createAlertDelivery} from '../slot-alerts.js';
test('slot wording uses date-only values without timezone shifts and identifies the VAC',()=>{
 assert.equal(slotMessage('Hyderabad VAC',['2027-01-15']),'Visa slots available on January 15, 2027, at Hyderabad VAC.');
 assert.match(slotMessage('Mumbai VAC',['2027-01-16','2027-01-15','2027-01-15']),/January 15, 2027 and January 16, 2027, at Mumbai VAC/);
 assert.throws(()=>slotMessage('Mumbai VAC',['2027-02-30']));
});
test('slot notifications speak; muting and audio failures preserve visual delivery',async()=>{
 const visual=[],sounds=[];let muted=false;
 const deliver=createAlertDelivery({visual:async(...args)=>visual.push(args),muted:async()=>muted,sound:async(text)=>{sounds.push(text);throw Error('Audio unavailable');}});
 await deliver('Slots available','Dates',{kind:'slots'});
 assert.equal(visual.length,1);assert.deepEqual(sounds,['Dates']);
 muted=true;await deliver('Slots available','Dates',{kind:'slots'});
 muted=false;await deliver('Sweep complete','No slots');
 assert.equal(visual.length,3);assert.deepEqual(sounds,['Dates']);
});

test('human verification speaks even with slot sounds muted and desktop alerts disabled',async()=>{
 const sounds=[];
 const deliver=createAlertDelivery({
  visual:async()=>{throw Error('Desktop alerts disabled');},
  muted:async()=>true,
  sound:async(text)=>{sounds.push(text); }
 });
 await assert.rejects(deliver('Human verification needed','Open the visa tab.',{kind:'verification'}),/Desktop alerts disabled/);
 assert.deepEqual(sounds,['Human verification needed. Open the visa tab to continue monitoring.']);
});
