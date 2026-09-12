/* The rule: a burst of reasons to re-read the page is ONE re-read, taken when
 * the burst ends — not one per reason, and not one at the start of it.
 *
 * Publishing a tool list is a change to what the model may do, so three in a
 * second is three chances to act on a page that has already moved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { after } = loadShared('coalesce.js', 'Coalesce', { setTimeout, clearTimeout });

const rest = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('ten reasons in a row do the work once', async () => {
  let done = 0;
  const trigger = after(20, () => {
    done += 1;
  });
  for (let i = 0; i < 10; i += 1) trigger();
  await rest(80);
  assert.equal(done, 1);
});

test('it waits for the quiet rather than running on the first pull', async () => {
  let done = 0;
  const trigger = after(50, () => {
    done += 1;
  });
  trigger();
  await rest(10);
  assert.equal(done, 0, 'a list read now describes where the page was, not where it is');
  await rest(100);
  assert.equal(done, 1);
});

test('a pull during the wait moves the moment further out', async () => {
  let done = 0;
  const trigger = after(40, () => {
    done += 1;
  });
  trigger();
  await rest(25);
  trigger();
  await rest(25);
  assert.equal(done, 0, 'the second pull restarts the quiet');
  await rest(60);
  assert.equal(done, 1);
});

test('a later burst is its own re-read', async () => {
  // A tab switch now and a navigation a second later are two pages, not one.
  let done = 0;
  const trigger = after(20, () => {
    done += 1;
  });
  trigger();
  await rest(80);
  trigger();
  await rest(80);
  assert.equal(done, 2);
});

test('nothing happens without a pull', async () => {
  let done = 0;
  after(10, () => {
    done += 1;
  });
  await rest(50);
  assert.equal(done, 0);
});
