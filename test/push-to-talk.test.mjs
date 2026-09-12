/* The rule: one turn per hold, and every way of losing the key ends the turn.
 *
 * The failure this stands in front of is a microphone left open on somebody who
 * thinks they stopped talking — the key coming up in another window, the tab
 * hidden mid-sentence, the page navigating underneath them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { claims, create, KEY } = loadShared('push-to-talk.js', 'PushToTalk', {
  setTimeout,
  clearTimeout,
});

const watcher = (extra = {}) => {
  const seen = { starts: 0, stops: [], tooLong: 0 };
  const machine = create({
    onStart: () => {
      seen.starts += 1;
    },
    onStop: (why) => {
      seen.stops.push(why);
    },
    onTooLong: () => {
      seen.tooLong += 1;
    },
    ...extra,
  });
  return { seen, machine };
};

const rest = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the key is the space bar, by physical code', () => {
  // KeyboardEvent.code, so it does not move with the keyboard layout.
  assert.equal(KEY, 'Space');
});

test('the key is only ours while a session is live', () => {
  // With no session there is nothing to talk to, so somebody typing a space
  // gets a space and the browser behaves like a browser.
  assert.equal(claims(true, 'Space'), true);
  assert.equal(claims(false, 'Space'), false);
  assert.equal(claims(true, 'Enter'), false);
  assert.equal(claims('yes', 'Space'), false, 'only a real boolean is a live session');
});

test('a key repeat is one turn, not a second one', () => {
  const { seen, machine } = watcher();
  assert.equal(machine.start(), true);
  assert.equal(machine.start(), false);
  assert.equal(machine.start(), false);
  assert.equal(seen.starts, 1);
  assert.equal(machine.held, true);
});

test('a release ends the turn and says it was a release', () => {
  const { seen, machine } = watcher();
  machine.start();
  assert.equal(machine.stop(), true);
  assert.deepEqual(seen.stops, ['released']);
  assert.equal(machine.held, false);
});

test('a stop with nothing held does nothing at all', () => {
  // A release that went missing must not be "corrected" into an extra stop
  // later: that would end somebody else's turn.
  const { seen, machine } = watcher();
  assert.equal(machine.stop(), false);
  machine.start();
  machine.stop();
  assert.equal(machine.stop(), false);
  assert.deepEqual(seen.stops, ['released']);
});

test('losing sight of the key is the same stop, with its own reason', () => {
  // A blur, a hidden tab, a page going away. The reason travels because the
  // phone treats a guess made on somebody's behalf differently from their own
  // release.
  const { seen, machine } = watcher();
  machine.start();
  assert.equal(machine.lostSight(), true);
  assert.deepEqual(seen.stops, ['lost-sight']);
  assert.equal(machine.held, false);
});

test('a hold that runs too long is ended, and reported', async () => {
  // One broken page takes every other watch away at once: a hung thread queues
  // the keyup, the blur and the pagehide behind itself. Time is the only thing
  // that still passes.
  const { seen, machine } = watcher({ limitMs: 20 });
  machine.start();
  await rest(60);
  assert.equal(machine.held, false);
  assert.deepEqual(seen.stops, ['too-long']);
  assert.equal(seen.tooLong, 1);
});

test('a turn that ended in time is not ended again by the clock', async () => {
  const { seen, machine } = watcher({ limitMs: 20 });
  machine.start();
  machine.stop();
  await rest(60);
  assert.deepEqual(seen.stops, ['released'], 'the limit must not fire after a release');
  assert.equal(seen.tooLong, 0);
});

test('the next hold gets its own limit', async () => {
  const { seen, machine } = watcher({ limitMs: 30 });
  machine.start();
  machine.stop();
  machine.start();
  await rest(80);
  assert.deepEqual(seen.stops, ['released', 'too-long']);
});

test('with no limit, a hold is not ended by time', async () => {
  const { seen, machine } = watcher();
  machine.start();
  await rest(40);
  assert.equal(machine.held, true);
  assert.deepEqual(seen.stops, []);
});
