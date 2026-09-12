/* The rule the whole product rests on: a question that says what is about to be
 * sent, and an answer taken only from a clear yes.
 *
 * Every case here is a way the gate has been got around or could be: a question
 * that named the action and not the values, a password read out into the room,
 * the same password sitting in plain text in the visible log, and a sentence
 * with both words in it being resolved in favour of pressing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { question, written, readAnswer } = loadShared('consent.js', 'Consent');

const secretSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, vaultPassword: { type: 'string', writeOnly: true } },
};

test('the question contains the values, because the sentence is all they have', () => {
  const said = question('Add a note to the list on this page', { note: 'hello' });
  assert.match(said, /note "hello"/);
  assert.match(said, /shall I\?$/);
});

test('several values are read out as a person would say them', () => {
  const said = question('Fill in and submit Apply selections', {
    disability: 'true',
    age: '67',
    state: 'Texas',
  });
  assert.match(said, /disability "true", age "67" and state "Texas"/);
});

test('with nothing to send, it is still a question', () => {
  assert.equal(question('Press Clear selections'), 'Press Clear selections — shall I?');
});

test('the tool’s own full stop does not become a stumble', () => {
  assert.equal(question('Press Apply.'), 'Press Apply — shall I?');
});

test('an empty value is left out rather than read back as nothing', () => {
  // A page reads a blank differently from an absent value, and so does somebody
  // listening: 'with note ""' is a sentence about nothing.
  const said = question('Submit the form', { note: '   ', kept: 'yes' });
  assert.doesNotMatch(said, /note/);
  assert.match(said, /kept "yes"/);
});

test('a password is named and never spoken', () => {
  const said = question('Sign in', { name: 'anton', vaultPassword: 'Hunter2-Zebra!' }, secretSchema);
  assert.match(said, /name "anton"/);
  assert.match(said, /vaultPassword filled in, which I am not saying out loud/);
  assert.doesNotMatch(said, /Hunter2/);
  // Not its length either: a masked value tells a listener nothing at all.
  assert.doesNotMatch(said, /14/);
});

test('format: password is the same rule', () => {
  const schema = { type: 'object', properties: { pin: { type: 'string', format: 'password' } } };
  const said = question('Sign in', { pin: '4821' }, schema);
  assert.doesNotMatch(said, /4821/);
});

test('a value too long to say is cut, and the cut is announced', () => {
  const said = question('Add a note', { note: 'x'.repeat(400) });
  assert.match(said, /goes on longer than I can read out/);
  assert.ok(said.length < 400, 'the whole essay must not be read out');
});

test('what is written down is masked by the same rule as what is spoken', () => {
  // The gate refused to say a password out loud while the phone’s own visible
  // log carried it in full, where a glance at the screen — or a screenshot —
  // has it. Same source, so the two cannot drift apart.
  const line = written({ name: 'anton', vaultPassword: 'Hunter2-Zebra!' }, secretSchema);
  assert.doesNotMatch(line, /Hunter2/);
  assert.match(line, /"vaultPassword":"\(hidden\)"/);
  assert.match(line, /"name":"anton"/);
});

test('a masked value is replaced, not shortened', () => {
  const short = written({ vaultPassword: 'a' }, secretSchema);
  const long = written({ vaultPassword: 'a'.repeat(64) }, secretSchema);
  assert.equal(short, long, 'the length of a secret is part of the secret');
});

test('only a clear yes presses anything', () => {
  for (const heard of ['yes', 'Yes.', 'yeah', 'yep', 'sure', 'ok', 'go ahead', 'please do']) {
    assert.equal(readAnswer(heard), 'yes', heard);
  }
});

test('a refusal is a refusal', () => {
  for (const heard of ['no', 'nope', "don't", 'do not', 'stop', 'cancel', 'wait', 'never mind']) {
    assert.equal(readAnswer(heard), 'no', heard);
  }
});

test('silence is not consent', () => {
  for (const heard of ['', '   ', null, undefined]) {
    assert.equal(readAnswer(heard), 'unclear', JSON.stringify(heard));
  }
});

test('an unrelated sentence is not consent', () => {
  assert.equal(readAnswer('what does the form say'), 'unclear');
});

test('a sentence with both words is asked again, not resolved', () => {
  // Somebody changing their mind mid-sentence. A machine that picks the half it
  // prefers is not asking permission, it is collecting an alibi.
  assert.equal(readAnswer('no, wait, yes'), 'unclear');
  assert.equal(readAnswer('yes — no, cancel that'), 'unclear');
});

test('a yes inside another word is not a yes', () => {
  // Word boundaries, so "yesterday" and "corokay" do not press anything.
  assert.equal(readAnswer('yesterday I did this myself'), 'unclear');
});
