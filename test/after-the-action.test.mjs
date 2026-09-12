/* The rule: tell the model the thing HAPPENED, never that our channel broke.
 *
 * One search was asked for and two were heard. When a press navigates, the page
 * it was acting on is gone mid-call, so the content script never answers — and
 * "it could not report back" is true about our port and reads as a failure. A
 * model given that about a search does the sensible thing and searches again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { wentThrough, onScreen } = loadShared('after-the-action.js', 'AfterTheAction');

test('the action is named as done, and told not to be repeated', () => {
  const said = wentThrough('searchTheSite', '{"q":"benefit finder"}');
  assert.match(said, /^DONE: searchTheSite ran with \{"q":"benefit finder"\}/);
  assert.match(said, /the page moved because of it/);
  assert.match(said, /Do not call it again/);
  assert.doesNotMatch(said, /could not report back/, 'never our channel’s problem');
});

test('a call with no arguments does not say "with {}"', () => {
  const said = wentThrough('clickStart', '{}');
  assert.doesNotMatch(said, /with \{\}/);
  assert.match(said, /^DONE: clickStart ran and the page moved/);
  assert.equal(wentThrough('clickStart'), said, 'nothing written at all reads the same');
});

test('the arguments arrive already masked, and this module never unmasks them', () => {
  // Masked by Consent.written at the call site: a password that must not be
  // said out loud must not be written into the answer either.
  const said = wentThrough('signIn', '{"name":"anton","vaultPassword":"(hidden)"}');
  assert.match(said, /\(hidden\)/);
  assert.doesNotMatch(said, /Hunter2/);
});

test('what is on the screen is counted, because a count says the page is theirs', () => {
  assert.equal(onScreen(9), 'The page shows 9 results now.');
  assert.equal(onScreen(1), 'The page shows 1 result now.');
});

test('more found than read is said as both numbers', () => {
  assert.equal(onScreen(5, 9), 'The page shows 5 results of 9 on it now.');
});

test('a page that is not a list says nothing at all', () => {
  for (const count of [0, undefined, null, 'nine', -1, {}]) {
    assert.equal(onScreen(count), '', JSON.stringify(count) ?? String(count));
  }
});

test('a total no bigger than what was read is not mentioned', () => {
  assert.equal(onScreen(5, 5), 'The page shows 5 results now.');
  assert.equal(onScreen(5, 2), 'The page shows 5 results now.');
  assert.equal(onScreen(5, 'nine'), 'The page shows 5 results now.');
});
