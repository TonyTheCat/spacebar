/* The rule: twelve tools somebody can be helped with, in the order they would
 * ask for them — not twenty-eight a page happens to have, with the search box
 * twenty-fourth.
 *
 * Google's results page synthesized twenty-eight, twenty-one of them clicks on
 * "about this result". And the page's own layout puts its furniture first,
 * which is why document order alone promoted Share over the results.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { pick, KEEP } = loadShared('shortlist.js', 'Shortlist');

const named = (name, extra = {}) => ({ name, kind: 'click', source: 'synthesized', ...extra });
const names = (tools) => pick(tools).map((tool) => tool.name);

test('twelve is the cut', () => {
  assert.equal(KEEP, 12);
  // Distinct names, not clickThing1..30: a trailing number is the synthesizer's
  // own duplicate marker, and thirty of those collapse to one tool by the rule
  // below rather than being cut by this one.
  const many = Array.from({ length: 30 }, (_, at) => named(`clickThing${'x'.repeat(at + 1)}`));
  assert.equal(pick(many).length, 12);
});

test('the browser’s furniture goes entirely', () => {
  const tools = [
    named('clickAboutThisResult'),
    named('clickAboutThisResult2'),
    named('clickMoreOptions'),
    named('clickFeedback'),
    named('searchTheWeb', { kind: 'search' }),
  ];
  assert.deepEqual(names(tools), ['searchTheWeb']);
});

test('a numbered repeat of a name already kept goes, and the first one stays', () => {
  // The page has ten identical controls. The first is the example; the tenth
  // teaches nobody anything.
  const tools = Array.from({ length: 10 }, (_, at) => named(at === 0 ? 'clickApply' : `clickApply${at}`));
  assert.deepEqual(names(tools), ['clickApply']);
});

test('a different tool is not a duplicate because its name ends in a digit', () => {
  const tools = [named('clickAnswer1'), named('clickAnswer2'), named('clickReply')];
  // clickAnswer1 and clickAnswer2 share the base clickAnswer — that IS the
  // synthesizer's numbering. clickReply is its own tool.
  assert.deepEqual(names(tools), ['clickAnswer1', 'clickReply']);
});

test('the order is what people actually ask for', () => {
  const tools = [
    named('clickSomeButton'),
    named('setTheDropdown', { kind: 'set' }),
    named('navigateSomewhere', { kind: 'navigate' }),
    named('submitTheForm', { kind: 'submit' }),
    named('searchTheSite', { kind: 'search' }),
  ];
  assert.deepEqual(names(tools), [
    'searchTheSite',
    'submitTheForm',
    'navigateSomewhere',
    'setTheDropdown',
    'clickSomeButton',
  ]);
});

test('the page’s own button leads, whatever its kind', () => {
  // A page whose whole purpose is one big Start. Ordered by kind, the model was
  // shown the site header's search box first and called it with an empty
  // string — and somebody who could not see the screen was asked to approve
  // that.
  const tools = [
    named('searchTheSite', { kind: 'search' }),
    named('clickStartTheApplication', { primary: true }),
  ];
  assert.deepEqual(names(tools), ['clickStartTheApplication', 'searchTheSite']);
});

test('the page’s side furniture is kept, and sorts last within its kind', () => {
  // In document order these sit in the header, ABOVE the content. Demoted
  // rather than dropped: somebody may well ask for Share.
  const tools = [
    named('clickSettingsAndPrivacy'),
    named('clickShareThisPage'),
    named('clickSearchByVoice'),
    named('clickTheFirstResult'),
  ];
  assert.deepEqual(names(tools), [
    'clickTheFirstResult',
    'clickSettingsAndPrivacy',
    'clickShareThisPage',
    'clickSearchByVoice',
  ]);
});

test('a result whose title merely contains a furniture word is content', () => {
  // "Change your privacy settings — USA.gov" is a result. The rule reads how
  // the LABEL STARTS, not what it happens to contain.
  const tools = [named('clickShareThisPage'), named('clickChangeYourPrivacySettings')];
  assert.deepEqual(names(tools), ['clickChangeYourPrivacySettings', 'clickShareThisPage']);
});

test('document order is the tie-break inside one kind', () => {
  const tools = [named('clickFirst'), named('clickSecond'), named('clickThird')];
  assert.deepEqual(names(tools), ['clickFirst', 'clickSecond', 'clickThird']);
});

test('a kind nobody has heard of sorts last rather than first', () => {
  const tools = [named('doSomethingNew', { kind: 'teleport' }), named('clickAButton')];
  assert.deepEqual(names(tools), ['clickAButton', 'doSomethingNew']);
});

test('the site’s own declared tools come first and are never cut', () => {
  // Their author said what they wanted an agent to do; whatever room they take
  // is room they asked for.
  const declared = Array.from({ length: 14 }, (_, at) => named(`site_tool_${at}`, { source: 'declared' }));
  const ours = [named('searchTheSite', { kind: 'search' })];
  const picked = pick([...ours, ...declared]);
  assert.equal(picked.length, 14, 'declared are never cut, and leave no room');
  assert.ok(picked.every((tool) => tool.source === 'declared'));
});

test('declared tools take their room out of ours, not out of the cut', () => {
  const declared = [named('site_search', { source: 'declared' })];
  const ours = Array.from({ length: 20 }, (_, at) => named(`clickThing${'x'.repeat(at + 1)}`));
  const picked = pick([...ours, ...declared]);
  assert.equal(picked.length, 12);
  assert.equal(picked[0].name, 'site_search');
});

test('a declared tool is never dropped as furniture or as a duplicate', () => {
  // Those two rules are about what the synthesizer read off the markup. A site
  // that names its own tool "feedback" has named it.
  const tools = [
    named('clickFeedback', { source: 'declared' }),
    named('clickApply', { source: 'declared' }),
    named('clickApply2', { source: 'declared' }),
  ];
  assert.equal(pick(tools).length, 3);
});

test('the tools come back whole, with everything the caller put on them', () => {
  // The caller's tools carry a schema and a description this file has no
  // business knowing about, and narrowing them would quietly lose the rest.
  const tool = named('submitTheForm', {
    kind: 'submit',
    gated: true,
    description: 'Submit the form',
    inputSchema: { type: 'object', properties: { note: { type: 'string' } } },
  });
  assert.deepEqual(pick([tool])[0], tool);
});

test('a nameless tool is not a tool, and nothing at all is an empty list', () => {
  assert.deepEqual(names([named('clickReal'), { kind: 'click' }, null, undefined]), ['clickReal']);
  assert.deepEqual(pick(null), []);
  assert.deepEqual(pick('tools'), []);
});

test('keep is an argument, and zero keeps nothing of ours', () => {
  const tools = [named('searchTheSite', { kind: 'search' }), named('clickAButton')];
  assert.equal(pick(tools, 1).length, 1);
  assert.equal(pick(tools, 0).length, 0);
});
