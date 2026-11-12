import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, sweepLocations, newDates } from '../core.js';
const base = { url:'https://www.usvisascheduling.com/en-US/ofc-schedule/', ready:true, calendar:true, location:'HYDERABAD VAC', text:'No Slots Available', dates:[] };
test('explicit no slots is scoped to selected location', () => assert.equal(classify(base).status,'empty'));
test('blank, incomplete and unselected pages never mean no slots', () => {
  for (const extra of [{text:''},{calendar:false},{ready:false},{location:''}]) assert.notEqual(classify({...base,...extra}).status,'empty');
});
test('access and login failures take precedence over stale empty state', () => {
  for (const [extra,expected] of [[{blocked:true},'blocked'],[{challenge:true},'challenge'],[{login:true},'login'],[{error:true},'error'],[{loading:true},'loading']]) assert.equal(classify({...base,...extra}).status,expected);
});
test('wrong host or path cannot be classified as appointments', () => {
  assert.equal(classify({...base,url:'https://example.com/en-US/ofc-schedule/'}).status,'unknown');
  assert.equal(classify({...base,url:'https://www.usvisascheduling.com/en-US/sign-in/'}).status,'login');
});
test('enabled explicit calendar dates yield availability without clicking', () => {
  assert.deepEqual(classify({...base,text:'Calendar',dates:['2027-02-03','2027-02-03','2027-02-05']}).dates,['2027-02-03','2027-02-05']);
  assert.equal(classify({...base,text:'Calendar',dates:['2027-02-03']}).status,'available');
});
test('conflicting empty and available markers are unknown', () => assert.equal(classify({...base,dates:['2027-02-03']}).status,'unknown'));
test('invalid dates never generate availability', () => assert.equal(classify({...base,text:'Calendar',dates:['2027-02-31','today','2027-13-01']}).status,'unknown'));
test('each sweep starts with Hyderabad and visits every other location once', () => {
  const places=['CHENNAI VAC','HYDERABAD VAC','MUMBAI VAC'];
  assert.deepEqual(sweepLocations(places,true),['HYDERABAD VAC','CHENNAI VAC','MUMBAI VAC']);
  assert.deepEqual(sweepLocations(places,false),['HYDERABAD VAC']);
});
test('missing Hyderabad never silently falls back in Hyderabad-only mode', () => assert.deepEqual(sweepLocations(['MUMBAI VAC'],false),[]));
test('only genuinely new dates trigger alerts', () => {
  assert.deepEqual(newDates(['2027-01-02'],['2027-01-02']),[]);
  assert.deepEqual(newDates(['2027-01-02'],['2027-01-02','2027-01-04']),['2027-01-04']);
  assert.deepEqual(newDates(['2027-01-02'],[]),[]);
});
