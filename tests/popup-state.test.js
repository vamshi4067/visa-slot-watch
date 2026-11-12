import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryLabel,desktopTestFeedback} from '../popup-state.js';

test('delivery label safely handles missing delivery state',()=>{
  assert.equal(deliveryLabel(null),'');
});

test('delivery label shows only known failed delivery codes',()=>{
  assert.equal(deliveryLabel({status:'failed',reason:'draft'}),'Last WhatsApp report failed (draft); monitoring continues. Check receipt before clearing the send lock.');
  assert.equal(deliveryLabel({status:'failed',reason:'private text'}),'Last WhatsApp report failed (unknown); monitoring continues. Check receipt before clearing the send lock.');
});

test('desktop test feedback distinguishes Chrome request acceptance from OS display',()=>{
  assert.match(desktopTestFeedback,/Chrome accepted/);
  assert.match(desktopTestFeedback,/macOS/);
});
