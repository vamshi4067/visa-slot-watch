import test from 'node:test';
import assert from 'node:assert/strict';
import {speakAlert} from '../voice-alert.js';

test('voice alerts select a local English system voice and queue speech',async()=>{
 const spoken=[];
 const tts={
  getVoices:async()=>[
   {voiceName:'Network',lang:'en-US',remote:true},
   {voiceName:'Extension',lang:'en-US',extensionId:'external'},
   {voiceName:'System',lang:'en-IN',remote:false}
  ],
  speak:async(...args)=>spoken.push(args)
 };
 await speakAlert(tts,'Visa slots available on January 15, 2027, at Hyderabad VAC.');
 assert.deepEqual(spoken,[['Visa slots available on January 15, 2027, at Hyderabad VAC.',{
  voiceName:'System',lang:'en-IN',enqueue:true
 }]]);
 tts.getVoices=async()=>[{voiceName:'Network',lang:'en-US',remote:true}];
 await assert.rejects(speakAlert(tts,'Human verification needed.'),/local English voice/);
 assert.equal(spoken.length,1);
});
