/* The rule: every call leaves a line, and an answer has a size.
 *
 * One log ends at "the model called read_page with {}" — no result, no answer,
 * no error. Everything after it was silence, to somebody who has only the voice
 * to go on, and nothing written down said which step had failed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { capped, written, tooLong, timedOut, threw, LIMIT } = loadShared(
  'tool-result.js',
  'ToolResult'
);

test('the cap is above a full page read and below what a line would refuse', () => {
  assert.equal(LIMIT, 8000);
});

test('a result inside the cap goes as it is', () => {
  const result = capped({ ok: true, text: 'three tools' });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'three tools');
});

test('a result over the cap is cut, and says so inside itself', () => {
  const result = capped({ ok: true, text: 'x'.repeat(9000) });
  assert.ok(result.text.includes('[cut here'));
  assert.ok(result.text.length < 9000);
  assert.equal(result.ok, true, 'a cut answer is still an answer');
});

test('ok is a real boolean, because the caller decides what to say from it', () => {
  // A truthy string meaning "failed" would be read as success.
  assert.equal(capped({ ok: 'false', text: 'x' }).ok, false);
  assert.equal(capped({ text: 'x' }).ok, false);
  assert.equal(capped(null).ok, false);
  assert.equal(capped(null).text, '');
});

test('the line carries the length, because ok with nothing in it is a bug', () => {
  assert.equal(written('read_page', { ok: true, text: 'x'.repeat(1873) }), 'read_page → ok, 1873 chars');
  assert.equal(written('read_page', { ok: true, text: '' }), 'read_page → ok, 0 chars');
});

test('a refusal is written with its reason', () => {
  assert.equal(
    written('submitApply', { ok: false, text: 'the action was declined' }),
    'submitApply → refused: the action was declined'
  );
});

test('a refusal with no reason still says so', () => {
  assert.equal(written('submitApply', { ok: false, text: '' }), 'submitApply → refused: (no reason given)');
});

test('a call that answered with nothing at all is named, not skipped', () => {
  // This is the case that used to leave no line: the step nobody could debug.
  assert.equal(written('read_page', null), 'read_page → answered with nothing at all');
  assert.equal(written('read_page', undefined), 'read_page → answered with nothing at all');
  assert.equal(written('read_page', 'done'), 'read_page → answered with nothing at all');
});

test('a long refusal is cut in the log rather than filling it', () => {
  const line = written('submitApply', { ok: false, text: 'why '.repeat(200) });
  assert.ok(line.length < 260);
});

test('a call that never came back has its own line and its own answer', () => {
  assert.match(tooLong('read_page', 10000), /read_page → took longer than 10000ms/);
  const answer = timedOut('read_page');
  assert.equal(answer.ok, false);
  // It says what happened rather than pretending: somebody who has heard
  // nothing for ten seconds already knows, and is owed the sentence.
  assert.match(answer.text, /took too long/);
  assert.match(answer.text, /do not know whether it went through/);
  assert.match(answer.text, /ask what they want to do/);
});

test('a call that threw says what it threw', () => {
  assert.equal(threw('press', new Error('no such element')), 'press → threw: Error: no such element');
});

test('an enormous thrown value does not become the log', () => {
  const line = threw('press', 'e'.repeat(1000));
  assert.ok(line.length < 240);
});
