/* The rule: say WHERE they are, once, and nothing about what is on the page.
 *
 * This is the one place that owes the opposite of every other rule here. A
 * sighted person glances at the tab; this person has the page move under them
 * and nothing says so.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { nameOf, hello, arrived, alsoSay, moved, LIMIT } = loadShared(
  'orientation.js',
  'Orientation'
);

test('a name said out loud has a length', () => {
  assert.equal(LIMIT, 60);
});

test('the title is the name of the place', () => {
  assert.equal(nameOf('Benefit Finder', 'https://www.usa.gov/benefit-finder'), 'Benefit Finder');
});

test('a title that is really a slogan is cut, and the cut is audible', () => {
  const long = 'Benefit Finder — find out which benefits you may be eligible for today';
  const said = nameOf(long, 'https://www.usa.gov');
  assert.ok(said.length <= LIMIT + 1, 'the ellipsis is the only thing over the limit');
  assert.ok(said.endsWith('…'));
  assert.ok(!said.endsWith(' …'), 'no gap before the ellipsis');
});

test('a page with no title is named by its host', () => {
  // Common, and no reason to leave somebody with nothing. The host is also what
  // they would have said themselves to get here.
  assert.equal(nameOf('', 'https://www.usa.gov/benefit-finder'), 'usa.gov');
  assert.equal(nameOf(undefined, 'https://duckduckgo.com/?q=pizza'), 'duckduckgo.com');
});

test('a title of only whitespace is no title', () => {
  assert.equal(nameOf('   ', 'https://example.com'), 'example.com');
});

test('a title with newlines in it is one line when spoken', () => {
  assert.equal(nameOf('Benefit\n  Finder', 'https://example.com'), 'Benefit Finder');
});

test('nowhere at all still has a name', () => {
  assert.equal(nameOf('', ''), 'a page with no name');
  assert.equal(nameOf(), 'a page with no name');
});

test('hello says the line is up and where they are', () => {
  const said = hello('Google', 'https://www.google.com');
  assert.match(said, /Ready\./);
  assert.match(said, /You're on Google/);
  assert.match(said, /What do you want to do\?/);
  assert.match(said, /^Say exactly this and nothing more:/);
});

test('hello with nowhere to name says what to do instead of apologising', () => {
  const said = hello('', '');
  assert.match(said, /Ready\./);
  assert.match(said, /Say the name of a site/);
  assert.doesNotMatch(said, /You're on/);
});

test('arriving says where they are and opens the conversation', () => {
  const said = arrived('Benefit Finder', 'https://www.usa.gov/benefit-finder');
  assert.match(said, /You're on Benefit Finder\. What do you want to do\?/);
});

test('the page moving is one sentence, with the reading forbidden in it', () => {
  const said = moved('Benefit Finder', 'https://www.usa.gov/benefit-finder');
  assert.match(said, /Now on Benefit Finder\./);
  assert.match(said, /Do not describe what is on it/);
});

test('a line riding inside a tool result does not claim to be the whole answer', () => {
  // "Say exactly this and nothing more" would contradict the result it travels
  // with, and the model would drop the answer to what they actually asked for.
  const said = alsoSay('Google', 'https://www.google.com');
  assert.doesNotMatch(said, /nothing more/);
  assert.match(said, /now on Google/);
  assert.match(said, /in the same breath/);
  assert.match(said, /do not describe what is on it/);
});
