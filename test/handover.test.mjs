/* The rule: a focus change WE caused says nothing about the key.
 *
 * The first time the phone did its job it cut somebody off mid-sentence: the
 * model called open_site while they were still speaking, the new tab came to
 * the front, and the page they were on reported losing focus — which the phone
 * read as them letting go.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { expected, WINDOW_MS } = loadShared('handover.js', 'Handover');

test('the window is long enough for a tab to come forward', () => {
  assert.equal(WINDOW_MS, 2000);
});

test('a blur in the middle of our own navigation is not a lost key', () => {
  assert.equal(expected(1000, 1000), true);
  assert.equal(expected(1000, 1999), true);
});

test('once the window has passed, a blur is a blur again', () => {
  // Narrow on purpose: outside this window, losing sight of the key means what
  // it always meant, and the microphone closes.
  assert.equal(expected(1000, 3000), false);
  assert.equal(expected(1000, 1000 + WINDOW_MS), false, 'the edge is not inside');
});

test('nothing recorded means we are not moving anybody', () => {
  // Which is the state before the first navigation of a session.
  assert.equal(expected(0, 5000), false);
  assert.equal(expected(undefined, 5000), false);
  assert.equal(expected(null, 5000), false);
});

test('a timestamp in the future is a disagreeing clock, not a move', () => {
  // Read as "still handing over", it would suppress every lost key until the
  // clock caught up — a microphone held open for as long as the disagreement
  // lasts.
  assert.equal(expected(9000, 1000), false);
});

test('the window can be set by the caller', () => {
  assert.equal(expected(1000, 1500, 200), false);
  assert.equal(expected(1000, 1100, 200), true);
});
