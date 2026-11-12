import test from 'node:test';
import assert from 'node:assert/strict';
import {canRecover,calendarBase} from '../recovery-policy.js';
test('only identified calendar failures are eligible, never login, verification, block or delivery problems',()=>{
 for(const code of ['PSE0501','CALENDAR_LOAD_ERROR','CALENDAR_TIMEOUT','CALENDAR_FRESHNESS_TIMEOUT','CALENDAR_UNREADABLE','PAGE_BLANK','PAGE_LOAD_ERROR','PAGE_LOADING','CALENDAR_RELOAD_TIMEOUT'])assert.equal(canRecover({status:'error',code}),true,code);
 for(const status of ['login','challenge','blocked','available','empty'])assert.equal(canRecover({status,code:'PSE0501'}),false);
 for(const code of ['email_failed','send_error',undefined])assert.equal(canRecover({status:'error',code}),false);
});
test('calendar base strips queries and rejects unexpected origins',()=>{
 assert.equal(calendarBase('https://www.usvisascheduling.com/en-US/ofc-schedule/?private=value'),'https://www.usvisascheduling.com/en-US/ofc-schedule/');
 assert.equal(calendarBase('https://evil.example/en-US/ofc-schedule/'),null);
});
