/* The rule: one wait, one deadline, one answer — and the answer says which of
 * the two happened.
 *
 * open_site opened Google and reported success in the same instant, so the
 * model's next response was created against the tool list of the page it had
 * just left, and it told the person it could not type a search into a box it
 * was looking at.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { create } = loadShared('one-wait.js', 'OneWait', { setTimeout, clearTimeout, Promise });

const rest = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the thing happening ends the wait, and says so', async () => {
  const wait = create({ ms: 1000 });
  assert.equal(wait.outcome, null, 'still waiting');
  assert.equal(wait.settled(), true);
  assert.equal(await wait.promise, 'settled');
  assert.equal(wait.outcome, 'settled');
});

test('a deadline answers rather than leaving the phone silent', async () => {
  // A late answer is worth more than no answer: a page that never finishes
  // loading must not leave somebody in front of a phone that stopped talking.
  const wait = create({ ms: 20 });
  assert.equal(await wait.promise, 'timed out');
  assert.equal(wait.outcome, 'timed out');
});

test('the same event arriving twice is one answer', () => {
  const wait = create({ ms: 1000 });
  assert.equal(wait.settled(), true);
  assert.equal(wait.settled(), false, 'the second report must not be taken as an answer');
  wait.settled();
});

test('a deadline passing after the thing happened changes nothing', async () => {
  // This is the test that stands in for a guard inside the timer: take the
  // clearTimeout out of settled() and this fails.
  const wait = create({ ms: 20 });
  wait.settled();
  await rest(60);
  assert.equal(wait.outcome, 'settled');
  assert.equal(await wait.promise, 'settled');
});

test('the thing happening after the deadline does not rewrite the answer', async () => {
  // A page that loads eventually, on a turn that has already been answered. A
  // promise resolved twice quietly keeps its first value while the code around
  // it believes the second, so this has to be refused out loud.
  const wait = create({ ms: 20 });
  assert.equal(await wait.promise, 'timed out');
  assert.equal(wait.settled(), false);
  assert.equal(wait.outcome, 'timed out');
});

test('a wait whose point has gone away can be given up', async () => {
  // Watching a page load on a line that has just dropped. Reported as a
  // timeout, because downstream it is the same thing: it did not happen.
  const wait = create({ ms: 5000 });
  assert.equal(wait.giveUp(), true);
  assert.equal(await wait.promise, 'timed out');
  assert.equal(wait.giveUp(), false);
});

test('giving up after an answer is refused', () => {
  const wait = create({ ms: 1000 });
  wait.settled();
  assert.equal(wait.giveUp(), false);
  assert.equal(wait.outcome, 'settled');
});

test('two waits do not share an answer', async () => {
  const one = create({ ms: 1000 });
  const two = create({ ms: 1000 });
  one.settled();
  assert.equal(two.outcome, null);
  two.giveUp();
  assert.equal(await one.promise, 'settled');
  assert.equal(await two.promise, 'timed out');
});
