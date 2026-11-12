import test from 'node:test';
import assert from 'node:assert/strict';
import {createGmailSender,encodeRawEmail,validEmailAddress} from '../email.js';

test('validates a single recipient email address',()=>{
  assert.equal(validEmailAddress('recipient@example.com'),true);
  assert.equal(validEmailAddress('not-an-email'),false);
  assert.equal(validEmailAddress('a..b@example.com'),false);
  assert.equal(validEmailAddress('a@example.com\r\nBcc:other@example.com'),false);
});

test('encodes a UTF-8 message into Gmail base64url raw format',()=>{
  const raw=encodeRawEmail({to:'recipient@example.com',subject:'Visa Slot Watch report',body:'HYDERABAD VAC: No Slots Available · 2026-10-22'});
  assert.match(raw,/^[A-Za-z0-9_-]+$/);
  const decoded=Buffer.from(raw.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
  assert.match(decoded,/To: recipient@example\.com/);
  const body=decoded.split('\r\n\r\n').at(-1);
  assert.equal(Buffer.from(body,'base64').toString('utf8'),'HYDERABAD VAC: No Slots Available · 2026-10-22');
});

test('sends only a Gmail messages.send request with the supplied token',async()=>{
  let request;
  const send=createGmailSender({getToken:async()=> 'access-token',fetchImpl:async(...args)=>{request=args;return {ok:true,status:200};}});
  const result=await send({to:'recipient@example.com',subject:'Visa Slot Watch report',body:'All locations checked.'});
  assert.equal(result.status,'sent');
  assert.equal(request[0],'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(request[1].method,'POST');
  assert.equal(request[1].headers.Authorization,'Bearer access-token');
  const payload=JSON.parse(request[1].body);
  assert.deepEqual(Object.keys(payload),['raw']);
  assert.equal(typeof payload.raw,'string');
});

test('reports Gmail API rejection without retrying',async()=>{
  let calls=0;
  const send=createGmailSender({getToken:async()=> 'access-token',fetchImpl:async()=>{calls++;return {ok:false,status:403};}});
  await assert.rejects(send({to:'recipient@example.com',subject:'Visa Slot Watch report',body:'Summary'}),/Gmail API rejected the send \(403\)/);
  assert.equal(calls,1);
});

test('formats a sweep from rendered location statuses and dates only',async()=>{
  const {formatSweepEmail}=await import('../email.js');
  const body=formatSweepEmail({finishedAt:1792700000000,locations:[{location:'HYDERABAD VAC',status:'empty',dates:[]},{location:'MUMBAI VAC',status:'available',dates:['2027-01-02']}]});
  assert.match(body,/HYDERABAD VAC: No Slots Available/);
  assert.match(body,/MUMBAI VAC: Dates found — 2027-01-02/);
  assert.doesNotMatch(body,/applicant|password|cookie|raw page/i);
});
