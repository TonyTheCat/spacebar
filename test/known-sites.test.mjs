/* The rule: a name it knows becomes an address, an address becomes itself,
 * anything else becomes a SEARCH for what they said — and nothing here ever
 * invents a hostname.
 *
 * "Open duck duck go" used to reach nothing at all, which for somebody who
 * cannot see the address bar is a browser that cannot be pointed anywhere. And
 * the start page never opened on a real browser because a New Tab page is more
 * than one address.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const site = loadShared('known-sites.js', 'KnownSites');
const { resolve, searchFor, isBlankPage, pickBlankTab, startPage, names } = site;

test('a name it knows becomes an address', () => {
  assert.equal(resolve('google'), 'https://www.google.com');
  assert.equal(resolve('wikipedia'), 'https://en.wikipedia.org');
  assert.equal(resolve('benefit finder'), 'https://www.usa.gov/benefit-finder');
});

test('what speech recognition does to a name is one of its names', () => {
  // "duck duck go" comes back as three words far more often than as one.
  for (const said of ['duckduckgo', 'duck duck go', 'ddg', 'duck-duck-go']) {
    assert.equal(resolve(said), 'https://duckduckgo.com', said);
  }
});

test('an address spoken in words is the same request as the address', () => {
  // Refusing "usa dot gov" would be pedantry aimed at the one person who
  // cannot type it instead.
  assert.equal(resolve('usa dot gov'), 'https://www.usa.gov');
  assert.equal(resolve('example dot com'), 'https://example.com');
});

test('a sentence’s full stop is not part of a hostname', () => {
  assert.equal(resolve('Google.'), 'https://www.google.com');
  assert.equal(resolve('example.com,'), 'https://example.com');
});

test('something shaped like a host becomes an address', () => {
  assert.equal(resolve('example.com'), 'https://example.com');
  assert.equal(resolve('example.com/some/path'), 'https://example.com/some/path');
  assert.equal(resolve('https://example.com/x'), 'https://example.com/x');
});

test('a single word with no dot is a name we do not know, not a host', () => {
  // "settings" is not settings.com. A wrong guess is a page they have no way to
  // identify, because they cannot see where they landed.
  assert.equal(resolve('settings'), null);
  assert.equal(resolve('the social security office'), null);
});

test('a scheme that can run code or read a file is refused, not followed', () => {
  for (const said of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'chrome://settings']) {
    assert.equal(resolve(said), null, said);
  }
});

test('nothing said is nothing resolved', () => {
  for (const said of ['', '   ', null, undefined]) {
    assert.equal(resolve(said), null, JSON.stringify(said) ?? String(said));
  }
});

test('an unknown name becomes a search for what they said', () => {
  // Not a dead end and not a fabrication: the results page is ABOUT what they
  // said and says so in its own title.
  assert.equal(
    searchFor('the social security office'),
    'https://duckduckgo.com/?q=the%20social%20security%20office'
  );
});

test('a refused scheme stays refused rather than being searched for', () => {
  // Searching for the text of it would hide the refusal behind a page of
  // results, and they would never learn that what they asked for was not done.
  assert.equal(searchFor('javascript:alert(1)'), null);
  assert.equal(searchFor('file:///etc/passwd'), null);
});

test('an empty request is not a search for nothing', () => {
  assert.equal(searchFor(''), null);
  assert.equal(searchFor('   '), null);
  assert.equal(searchFor(null), null);
});

test('a tab showing nothing is more than one address', () => {
  // Knowing only chrome://newtab is why the start page never opened: in branded
  // Chrome with Google as the search engine, the New Tab page is Google's
  // REMOTE one and the url is the /_/chrome/newtab path.
  for (const url of [
    undefined,
    '',
    'chrome://newtab',
    'chrome://new-tab-page/',
    'about:blank',
    'chrome-search://local-ntp/local-ntp.html',
    'https://www.google.com/_/chrome/newtab?ie=UTF-8',
    'https://www.google.co.uk/_/chrome/newtab',
  ]) {
    assert.equal(isBlankPage(url), true, String(url));
  }
});

test('a page somebody is reading is not a blank tab', () => {
  for (const url of [
    'https://www.google.com',
    'https://www.google.com/search?q=pizza',
    'https://www.usa.gov/benefit-finder',
    'https://newtab.example.com',
  ]) {
    assert.equal(isBlankPage(url), false, url);
  }
});

test('a domain that merely contains the word google is not Chrome’s New Tab', () => {
  // Written with a loose suffix this ate a whole domain, so a page anybody
  // could put up read as the browser's own surface.
  assert.equal(isBlankPage('https://google.evil.com/_/chrome/newtab'), false);
});

test('the blank tab in front of somebody is the one that gets taken over', () => {
  const tabs = [
    { id: 1, active: false, url: 'https://www.usa.gov' },
    { id: 2, active: true, url: 'chrome://newtab', pendingUrl: '' },
  ];
  assert.equal(pickBlankTab(tabs)?.id, 2);
});

test('a restoring tab carries where it is going in pendingUrl, and is not blank', () => {
  // Reading the url alone says "blank" about a page they were reading
  // yesterday, and taking it over throws away where they were.
  const tabs = [{ id: 1, active: true, url: '', pendingUrl: 'https://www.usa.gov/benefit-finder' }];
  assert.equal(pickBlankTab(tabs), null);
});

test('a background tab is not somewhere anybody is looking', () => {
  // This is also what keeps the phone out of it: the phone opens itself
  // inactive.
  const tabs = [{ id: 7, active: false, url: 'about:blank' }];
  assert.equal(pickBlankTab(tabs), null);
});

test('a tab with no id cannot be sent anywhere', () => {
  assert.equal(pickBlankTab([{ active: true, url: 'about:blank' }]), null);
});

test('somebody already somewhere is left there', () => {
  const tabs = [{ id: 1, active: true, url: 'https://www.usa.gov/benefit-finder' }];
  assert.equal(pickBlankTab(tabs), null);
  assert.equal(pickBlankTab([]), null);
});

test('the start page always resolves to somewhere real', () => {
  // A start page that failed to resolve would put them back on the dead end
  // this exists to prevent.
  assert.equal(startPage('benefit finder'), 'https://www.usa.gov/benefit-finder');
  assert.equal(startPage('example.com'), 'https://example.com');
  assert.equal(startPage(''), 'https://www.google.com');
  assert.equal(startPage(undefined), 'https://www.google.com');
  assert.equal(startPage('something nobody knows'), 'https://www.google.com');
  assert.equal(startPage('javascript:alert(1)'), 'https://www.google.com');
});

test('what we can offer out loud is short enough to listen to', () => {
  const offered = names();
  assert.ok(offered.length <= 6, 'a list said out loud cannot be long');
  assert.ok(offered.includes('google'));
  assert.ok(offered.every((name) => typeof name === 'string' && name.length > 0));
});
