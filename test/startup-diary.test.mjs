/* The rule: keep the FIRST lines, and say once when there were more.
 *
 * The start page failed to open twice and nobody could see what the service
 * worker saw: its console lives behind a link on chrome://extensions, it is
 * empty the moment the worker is killed, and the run that matters is the one
 * nobody was watching. So the worker writes a few lines where the phone can
 * print them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { add, whatIsThere, KEY, KEEP, MORE } = loadShared('startup-diary.js', 'StartupDiary');

const at = Date.parse('2026-09-12T14:15:00Z');

test('it lives in session storage under its own name', () => {
  // Session rather than local: it is about THIS launch of the browser and goes
  // when the browser does.
  assert.equal(KEY, 'startupDiary');
  assert.equal(KEEP, 40);
});

test('a line carries the time it happened, in the reader’s own clock', () => {
  // Whoever reads this is in a room, not in UTC.
  const [line] = add(undefined, 'onStartup ran', at);
  assert.equal(line, `${new Date(at).toLocaleTimeString()} — onStartup ran`);
});

test('lines are kept in the order they happened', () => {
  let diary = add(undefined, 'first', at);
  diary = add(diary, 'second', at);
  assert.equal(diary.length, 2);
  assert.match(diary[0], /first/);
  assert.match(diary[1], /second/);
});

test('whatever was in storage is not trusted to be lines', () => {
  // It travels through chrome.storage, so it can come back as anything.
  for (const junk of [null, undefined, 'a line', 42, {}]) {
    assert.equal(add(junk, 'onStartup ran', at).length, 1, JSON.stringify(junk) ?? String(junk));
  }
  assert.deepEqual(add([1, 'kept', {}], 'new', at).length, 2);
});

test('past the cap it keeps the startup and says once that there was more', () => {
  // Anything still writing past the cap is a loop, and its first turn is the
  // interesting one. Dropping the oldest would erase the only part worth
  // reading.
  let diary = [];
  for (let i = 0; i < KEEP; i += 1) diary = add(diary, `line ${i}`, at);
  assert.equal(diary.length, KEEP);

  diary = add(diary, 'one too many', at);
  assert.equal(diary.length, KEEP + 1);
  assert.equal(diary[diary.length - 1], MORE);
  assert.match(diary[0], /line 0/, 'the startup itself is still there');

  // And a runaway cannot fill the diary with its own apology.
  for (let i = 0; i < 50; i += 1) diary = add(diary, 'and another', at);
  assert.equal(diary.length, KEEP + 1);
});

test('what is there names the pair that decides the question', () => {
  // A restoring tab carries where it is going in pendingUrl with an empty url;
  // Chrome's own New Tab page carries the reverse.
  const said = whatIsThere([
    { id: 1, windowId: 1, active: true, url: '', pendingUrl: 'https://www.usa.gov' },
    { id: 2, windowId: 1, active: false, url: 'https://example.com' },
  ]);
  assert.match(said, /2 tab\(s\) in 1 window\(s\)/);
  assert.match(said, /\[1\] url=\(none\) pendingUrl=https:\/\/www\.usa\.gov/);
  assert.doesNotMatch(said, /example\.com/, 'only the tab in front of somebody is named');
});

test('no window yet is said plainly, because that is the answer twice now', () => {
  assert.equal(whatIsThere([]), 'no tabs at all — no window has been opened yet');
  assert.equal(whatIsThere(null), 'no tabs at all — no window has been opened yet');
});

test('tabs with no active one still report what is open', () => {
  const said = whatIsThere([{ id: 1, windowId: 1, url: 'https://example.com' }]);
  assert.match(said, /1 tab\(s\) in 1 window\(s\)/);
  assert.match(said, /\(none is active\)/);
});
