/* The rule: a blank tab is REPLACED, never navigated in place.
 *
 * Navigating Chrome's New Tab page looks tidiest and leaves the keyboard in the
 * address bar — measured in a screenshot: google.com loaded, the omnibox still
 * focused with its text selected, and the space bar going to the address bar
 * rather than to the page. The talk key is the whole product, and on that tab it
 * was dead. A page cannot take focus back from browser chrome; a tab opened with
 * a real URL has the keyboard in the page from the start.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const KnownSites = loadShared('known-sites.js', 'KnownSites');
const { how } = loadShared('going-there.js', 'GoingThere', { KnownSites });

test('a tab somebody is on is navigated: closing it throws away where they were', () => {
  assert.equal(how({ id: 3, url: 'https://www.usa.gov/benefit-finder' }), 'navigate this tab');
});

test('a blank tab is replaced, so the keyboard lands in the page', () => {
  assert.equal(how({ id: 2, url: 'chrome://newtab', pendingUrl: '' }), 'replace the blank tab');
  assert.equal(how({ id: 2, url: 'about:blank' }), 'replace the blank tab');
  assert.equal(
    how({ id: 2, url: 'https://www.google.com/_/chrome/newtab?ie=UTF-8' }),
    'replace the blank tab'
  );
});

test('a tab still restoring a real page is navigated, not replaced', () => {
  // Blank by BOTH addresses or not blank at all — the same rule pickBlankTab
  // uses.
  assert.equal(
    how({ id: 4, url: '', pendingUrl: 'https://www.usa.gov/benefit-finder' }),
    'navigate this tab'
  );
});

test('with no tab at all, a tab is opened', () => {
  assert.equal(how(null), 'open a tab');
  assert.equal(how(undefined), 'open a tab');
  assert.equal(how({ url: 'https://www.usa.gov' }), 'open a tab', 'no id is nothing to navigate');
});
