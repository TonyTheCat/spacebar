/* The rule: the phone's fallback to a real page happens ONCE.
 *
 * The service worker was meant to do this and twice did not — once asking about
 * a window that did not exist yet, once because the New Tab page was Google's
 * remote one. Each time somebody was left on a page with no content script, no
 * talk key and nothing to act on.
 *
 * But the phone republishes on every tab switch, page load and action, so the
 * condition is met over and over: without a memory this would send somebody
 * back to the start page every time they wandered onto a blank tab, which is a
 * browser fighting the person using it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const KnownSites = loadShared('known-sites.js', 'KnownSites');
// start-here.js calls KnownSites by name: one scope in the browser, handed in
// here.
const { create } = loadShared('start-here.js', 'StartHere', { KnownSites });

const blankTab = { id: 2, active: true, url: 'chrome://newtab', pendingUrl: '' };
const realTab = { id: 3, active: true, url: 'https://www.usa.gov/benefit-finder' };

test('the blank tab in front of somebody is the one it names', () => {
  const fallback = create();
  assert.equal(fallback.decide([realTab, blankTab])?.id, 2);
});

test('it is used once, and then never again', () => {
  const fallback = create();
  assert.ok(fallback.decide([blankTab]));
  assert.equal(fallback.used, true);
  assert.equal(fallback.decide([blankTab]), null, 'every attempt would be a policy nobody asked for');
});

test('finding nothing does not spend the one attempt', () => {
  // A phone that loads while somebody is reading a real page is still there for
  // the blank tab that appears later.
  const fallback = create();
  assert.equal(fallback.decide([realTab]), null);
  assert.equal(fallback.used, false);
  assert.equal(fallback.decide([blankTab])?.id, 2);
});

test('no tabs at all is not a tab to send anywhere', () => {
  const fallback = create();
  assert.equal(fallback.decide([]), null);
  assert.equal(fallback.used, false);
});

test('a restoring tab is somebody’s page, not a blank one', () => {
  // Same rule as pickBlankTab: url AND pendingUrl. Taking this over would throw
  // away where they were.
  const fallback = create();
  const restoring = [{ id: 4, active: true, url: '', pendingUrl: 'https://www.usa.gov' }];
  assert.equal(fallback.decide(restoring), null);
  assert.equal(fallback.used, false);
});

test('two phones do not share one attempt', () => {
  const one = create();
  const two = create();
  one.decide([blankTab]);
  assert.equal(two.used, false);
});
