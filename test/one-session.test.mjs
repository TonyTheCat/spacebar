/* The rule: one line at a time, and a line is up only once the session has said
 * so.
 *
 * Two opens overlapping share the peer connection and the data channel, so the
 * second overwrites what the first is about to use. Measured on a real profile:
 * a key minted twice, a peer connection established twice, and then "cannot
 * send session.update: the channel is not open" — a phone that looks connected
 * and can do nothing, reported on a line of text to somebody who cannot read
 * one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { create } = loadShared('one-session.js', 'OneSession');

test('it starts down, with nothing to say anything into', () => {
  const session = create();
  assert.equal(session.state, 'down');
  assert.equal(session.isUp, false);
});

test('the second caller is told no and does nothing', () => {
  // The button, the automatic connection on load, and a reconnection are three
  // callers who can all arrive while the first attempt is still in flight.
  const session = create();
  assert.equal(session.begin(), true);
  assert.equal(session.begin(), false);
  assert.equal(session.state, 'connecting');
});

test('connecting is not live: nothing may be sent into a channel being built', () => {
  const session = create();
  session.begin();
  assert.equal(session.isUp, false, 'a channel being built is not a channel');
  assert.equal(session.live(), true);
  assert.equal(session.isUp, true);
});

test('a session that is already up cannot be opened again', () => {
  const session = create();
  session.begin();
  session.live();
  assert.equal(session.begin(), false);
  assert.equal(session.state, 'live');
});

test('a session.created that arrives after we gave up does not take the line up', () => {
  // It belongs to a line that is already closed. Reading it as live leaves the
  // phone claiming a connection it does not have.
  const session = create();
  session.begin();
  session.down();
  assert.equal(session.live(), false);
  assert.equal(session.state, 'down');
  assert.equal(session.isUp, false);
});

test('live() out of nowhere is not a session', () => {
  const session = create();
  assert.equal(session.live(), false);
  assert.equal(session.state, 'down');
});

test('down is the same door for a failure on the way up and for a drop', () => {
  // A machine left stuck in 'connecting' by a failure nobody reported takes the
  // Connect button away for the rest of the day.
  const failed = create();
  failed.begin();
  assert.equal(failed.down(), true);
  assert.equal(failed.begin(), true, 'the next attempt has to be allowed');

  const dropped = create();
  dropped.begin();
  dropped.live();
  assert.equal(dropped.down(), true);
  assert.equal(dropped.begin(), true);
});

test('down twice reports that there was nothing to lose', () => {
  // The channel closing, the connection failing and the tab going away all
  // report the same loss, and everything hung off that report — saying it out
  // loud, one reconnection attempt — must happen once.
  const session = create();
  session.begin();
  session.live();
  assert.equal(session.down(), true);
  assert.equal(session.down(), false);
});

test('two sessions do not share a state', () => {
  const one = create();
  const two = create();
  one.begin();
  assert.equal(two.state, 'down');
  assert.equal(two.begin(), true);
});
