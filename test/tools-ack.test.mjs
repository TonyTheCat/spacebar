/* The rule: an acknowledgement is ours only when the session says it is holding
 * exactly the names we sent.
 *
 * session.updated carries no correlation id, and there are at least three other
 * posts to mistake for our own: the opening session.update with no tools at all,
 * a republish triggered by the same tab events a navigating call waits on, and
 * everything a reconnection sends again from the beginning.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { answers, namesIn } = loadShared('tools-ack.js', 'ToolsAck');

const updated = (...names) => ({ tools: names.map((name) => ({ name, type: 'function' })) });

test('our own list, acknowledged', () => {
  const sent = ['searchTheSite', 'navigate', 'confirm_action'];
  assert.equal(answers(sent, namesIn(updated(...sent))), true);
});

test('order is not part of the identity', () => {
  // Ours go last so a page cannot stand in front of them; nothing promises the
  // list comes back the same way round, and requiring that turns a working
  // confirmation into a timeout.
  assert.equal(answers(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});

test('the opening acknowledgement, which carries no tools, is not ours', () => {
  // It confirms the instructions and the transcription. Reading it as the
  // acknowledgement of a tool list is how the model gets the previous page.
  assert.equal(namesIn({ instructions: 'be brief' }).length, 0);
  assert.equal(answers(['searchTheSite'], namesIn({ instructions: 'be brief' })), false);
});

test('somebody else’s list is ignored rather than mistaken for ours', () => {
  // The previous page's list, arriving while we wait for the new one.
  assert.equal(answers(['searchTheSite', 'navigate'], ['open_site', 'navigate']), false);
});

test('a longer or shorter list of the same names is not ours', () => {
  assert.equal(answers(['a', 'b'], ['a', 'b', 'c']), false);
  assert.equal(answers(['a', 'b', 'c'], ['a', 'b']), false);
});

test('two empty lists answer each other', () => {
  // A page with nothing on it publishes nothing, and that update is still ours
  // to wait for.
  assert.equal(answers([], namesIn({ tools: [] })), true);
});

test('a duplicate name is not the same as two different ones', () => {
  // Sorted comparison, not set membership: same length, same sorted order or
  // nothing.
  assert.equal(answers(['a', 'a'], ['a', 'b']), false);
});

test('nothing off the wire is trusted to be an array', () => {
  for (const junk of [null, undefined, 'a,b', 42, {}]) {
    assert.equal(answers(['a'], junk), false, JSON.stringify(junk) ?? String(junk));
    assert.equal(answers(junk, ['a']), false, JSON.stringify(junk) ?? String(junk));
  }
});

test('a nameless tool reads as an empty name rather than throwing', () => {
  // This runs inside an event handler nobody is watching, so a crash here is a
  // phone that has silently stopped acknowledging anything.
  assert.deepEqual(namesIn({ tools: [{}, { name: 'navigate' }, null] }), ['', 'navigate', '']);
  assert.deepEqual(namesIn(null), []);
  assert.deepEqual(namesIn({ tools: 'navigate' }), []);
});
