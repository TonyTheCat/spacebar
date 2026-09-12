/* The rule: a refusal to interrupt is a POSTPONEMENT, never a silence.
 *
 * The phone saw an answer in progress, wrote "it is already answering" in the
 * log and stopped there — which is how the page moved under somebody who could
 * not see it while the only thing that would have told them was dropped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const Orientation = loadShared('orientation.js', 'Orientation');
// still-to-say.js calls Orientation by name: in the browser they are two
// classic scripts in one scope, so it is handed in here rather than imported.
const StillToSay = loadShared('still-to-say.js', 'StillToSay', { Orientation });

test('nothing is owed until something is kept', () => {
  const slot = StillToSay.create();
  assert.equal(slot.has, false);
  assert.equal(slot.takeSpoken(), '');
  assert.equal(slot.takeFolded(), '');
});

test('a postponed line is the same line, said later', () => {
  const slot = StillToSay.create();
  slot.keep('moved', 'Benefit Finder', 'https://www.usa.gov/benefit-finder');
  assert.equal(slot.has, true);
  assert.equal(
    slot.takeSpoken(),
    Orientation.moved('Benefit Finder', 'https://www.usa.gov/benefit-finder')
  );
});

test('each kind of sentence keeps its own words', () => {
  for (const kind of ['hello', 'arrived', 'moved']) {
    const slot = StillToSay.create();
    slot.keep(kind, 'Google', 'https://www.google.com');
    assert.equal(slot.takeSpoken(), Orientation[kind]('Google', 'https://www.google.com'));
  }
});

test('folded into a tool result it is different words, not the same ones', () => {
  // Alone it is the whole of what to say; inside a result it is one more thing
  // to mention. Keeping a rendered string would keep the wrong one half the
  // time — which is why only the PLACE is kept.
  const slot = StillToSay.create();
  slot.keep('moved', 'Google', 'https://www.google.com');
  const folded = slot.takeFolded();
  assert.equal(folded, Orientation.alsoSay('Google', 'https://www.google.com'));
  assert.notEqual(folded, Orientation.moved('Google', 'https://www.google.com'));
});

test('taking the line clears it: one move is said once', () => {
  const slot = StillToSay.create();
  slot.keep('moved', 'Google');
  assert.ok(slot.takeSpoken());
  assert.equal(slot.has, false);
  assert.equal(slot.takeSpoken(), '');
  assert.equal(slot.takeFolded(), '');
});

test('the latest place wins, and only the latest', () => {
  // Two moves while the model was speaking are not two things to say: the first
  // is history by the time anybody could hear it, and reciting a route is the
  // narration this product is written against.
  const slot = StillToSay.create();
  slot.keep('moved', 'Google', 'https://www.google.com');
  slot.keep('moved', 'Benefit Finder', 'https://www.usa.gov/benefit-finder');
  const said = slot.takeSpoken();
  assert.match(said, /Benefit Finder/);
  assert.doesNotMatch(said, /Google/);
});

test('a place from before the line dropped is not news', () => {
  const slot = StillToSay.create();
  slot.keep('arrived', 'Google');
  slot.forget();
  assert.equal(slot.has, false);
  assert.equal(slot.takeSpoken(), '');
});

test('two slots do not share what they owe', () => {
  const one = StillToSay.create();
  const two = StillToSay.create();
  one.keep('moved', 'Google');
  assert.equal(two.has, false);
});
