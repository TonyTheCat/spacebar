/* The rule: what must be asked about is the tool's CONSEQUENCE, never its kind.
 *
 * Reading the kind is how a person's search became "declined": a search form is
 * a submit, the content script asked a question nobody was listening for, and
 * the silence was read as a refusal. He had asked for the search twice and was
 * never asked anything once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { mustAsk, mustAskOutLoud } = loadShared('gating.js', 'Gating');

test('a search submits and must NOT be asked about', () => {
  const search = { name: 'searchTheSite', kind: 'submit', gated: false, source: 'synthesized' };
  assert.equal(mustAsk(search), false);
  assert.equal(mustAskOutLoud(search), false);
});

test('a submit that commits something is asked about on both surfaces', () => {
  const apply = { name: 'submitApplySelections', kind: 'submit', gated: true, source: 'synthesized' };
  assert.equal(mustAsk(apply), true);
  assert.equal(mustAskOutLoud(apply), true);
});

test('the kind never decides it, whichever kind it is', () => {
  for (const kind of ['search', 'submit', 'set', 'click', 'navigate', undefined]) {
    assert.equal(mustAsk({ kind, gated: true }), true, String(kind));
    assert.equal(mustAsk({ kind, gated: false }), false, String(kind));
  }
});

test('every tool a SITE declared is put to the person out loud, gated or not', () => {
  // WebMCP says nothing about consequence, so "count the notes" and "delete the
  // notes" arrive indistinguishable. Asking is the only honest default.
  const declared = { name: 'notes_delete', source: 'declared', gated: false };
  assert.equal(mustAskOutLoud(declared), true);
  // The page's own executor still stops at `gated`: where a person clicks the
  // tool by hand, the click is the consent.
  assert.equal(mustAsk(declared), false);
});

test('a synthesized tool is not declared just because it is ungated', () => {
  assert.equal(mustAskOutLoud({ name: 'navigate', gated: false, source: 'synthesized' }), false);
});

test('anything that is not a plain true is not a gate', () => {
  // This value comes off a page scan and travels through messaging and storage,
  // so it can arrive as any shape at all. A truthy string is not a statement.
  for (const gated of [undefined, null, 0, 1, '', 'true', 'false', 'yes', {}, []]) {
    assert.equal(mustAsk({ gated }), false, JSON.stringify(gated) ?? String(gated));
  }
});

test('nothing at all is not something to ask about', () => {
  // The caller looks a tool up by name and may not have found one. A crash here
  // is in a tool-call handler, where the person hears nothing happen.
  for (const nothing of [null, undefined]) {
    assert.equal(mustAsk(nothing), false);
    assert.equal(mustAskOutLoud(nothing), false);
  }
});
