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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The real brick, not a stand-in for it. What counts as a value is exactly the rule the fill
 * path refuses on, and a hand-written stub here would let the two drift apart silently — which
 * is the whole reason consent.js asks it rather than keeping its own list. */
const here = dirname(fileURLToPath(import.meta.url));
const FilledIn = new Function(
  `${readFileSync(join(here, '..', 'vendor', 'filled-in.js'), 'utf8')}\n;return FilledIn;`
)();

const { question, written, readAnswer } = loadShared('consent.js', 'Consent', { FilledIn });

/** A schema describing the named arguments, the way a synthesized tool's does. Every real
 *  caller passes one: an argument the schema does not describe is never spoken, so a test
 *  that leaves it out is testing the withholding rule rather than the read-back. */
const describing = (...names) => ({
  type: 'object',
  properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
});

const secretSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, vaultPassword: { type: 'string', writeOnly: true } },
};

test('the question contains the values, because the sentence is all they have', () => {
  const said = question('Add a note to the list on this page', { note: 'hello' }, describing('note'));
  assert.match(said, /note "hello"/);
  assert.match(said, /shall I\?$/);
});

test('several values are read out as a person would say them', () => {
  const said = question(
    'Fill in and submit Apply selections',
    { disability: 'true', age: '67', state: 'Texas' },
    describing('disability', 'age', 'state')
  );
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
  const said = question('Submit the form', { note: '   ', kept: 'yes' }, describing('note', 'kept'));
  assert.doesNotMatch(said, /note/);
  assert.match(said, /kept "yes"/);
});

test('our own tools are read back, because we wrote their schemas', () => {
  /* Twice on live runs the log said the model called one of OUR tools with everything
   * (hidden) — open_site with its site, then fill_in with its tool, field and value. The
   * masking rule is right; what was missing was the schema, because the map the phone looks
   * these up in only ever held the PAGE's tools.
   *
   * These are the schemas as phone.js declares them, in the shape it declares them in. A
   * tool of ours is described, so every one of its arguments is said out loud — there is
   * nothing secret in a site name, a field name or a value somebody just spoke.
   */
  const openSite = {
    type: 'object',
    properties: { site: { type: 'string', description: 'What they said: a site name, or an address.' } },
    required: ['site'],
  };
  const fillIn = {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'The name of the submit tool this field belongs to.' },
      field: { type: 'string', description: "The field, named as that tool's schema names it." },
      value: { type: 'string', description: 'What they said, as they said it.' },
    },
    required: ['tool', 'field', 'value'],
  };

  assert.equal(written({ site: 'usa.gov' }, openSite), '{"site":"usa.gov"}');
  assert.equal(
    written({ tool: 'submitNext', field: 'dayOfBirth', value: '20' }, fillIn),
    '{"tool":"submitNext","field":"dayOfBirth","value":"20"}'
  );
  // And the same values are said out loud, not withheld.
  const said = question('Put one value into one field', { field: 'dayOfBirth', value: '20' }, fillIn);
  assert.match(said, /field "dayOfBirth"/);
  assert.match(said, /value "20"/);
});

test('a tool with NO schema still withholds, which is why the map must hold ours', () => {
  // The other half of the same fact: this is what our own tools looked like while the map
  // held only the page's, and it is the correct behaviour for a schema we do not have.
  assert.equal(written({ site: 'usa.gov' }), '{"site":"(hidden)"}');
});

test('a placeholder is not a value, so it is not read back', () => {
  // Measured on the wizard: the model called the submit with the selects' own placeholder
  // text, and the gate read "-Select-" back as if somebody had chosen it.
  const said = question(
    'Fill in and submit "Next"',
    { monthOfBirth: '-Select-', state: '-Select-', dayOfBirth: '12' },
    describing('monthOfBirth', 'state', 'dayOfBirth')
  );
  assert.doesNotMatch(said, /Select/);
  assert.match(said, /dayOfBirth "12"/);
});

test('a form of nothing but placeholders is a question with no values in it', () => {
  const said = question(
    'Fill in and submit "Next"',
    { monthOfBirth: '-Select-', state: '-Select-' },
    describing('monthOfBirth', 'state')
  );
  assert.equal(said, 'Fill in and submit "Next" — shall I?');
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

test('an argument the schema does not describe is named and never spoken', () => {
  // The case that read a password into the room. The gate fixture's field is labelled "Vault
  // password" and named `pin`, so the synthesizer's schema carries vaultPassword and the model
  // calls the tool with pin. Looking pin up found nothing, "not a secret" was the answer, and
  // the question said pin "hunter2-never-say-this" out loud.
  const said = question('Fill in and submit "Save note"', { pin: 'hunter2-never-say-this' }, secretSchema);
  assert.doesNotMatch(said, /hunter2/);
  assert.match(said, /pin filled in, which I am not saying out loud/);
});

test('and it is hidden in what is written down too', () => {
  const line = written({ pin: 'hunter2-never-say-this' }, secretSchema);
  assert.doesNotMatch(line, /hunter2/);
  assert.match(line, /"pin":"\(hidden\)"/);
});

test('a described, ordinary argument is still read back', () => {
  // The other half of the promise: the values ARE said, or somebody who cannot see the form
  // has nothing to catch a mis-heard word with.
  const said = question('Fill in and submit "Save note"', { name: 'anton' }, secretSchema);
  assert.match(said, /name "anton"/);
});

test('with no schema at all, nothing is read back', () => {
  // Stated rather than hidden: the direction is deliberate. Every real caller passes the
  // tool's own inputSchema, and the reverse of this rule costs a password.
  const said = question('Sign in', { note: 'hello' });
  assert.match(said, /note filled in, which I am not saying out loud/);
  assert.doesNotMatch(said, /hello/);
});

test('one wording for both reasons, so the room is not told which is which', () => {
  const secret = question('Sign in', { vaultPassword: 'x' }, secretSchema);
  const unknown = question('Sign in', { mystery: 'x' }, secretSchema);
  assert.match(secret, /vaultPassword filled in, which I am not saying out loud/);
  assert.match(unknown, /mystery filled in, which I am not saying out loud/);
});

test('a value too long to say is cut, and the cut is announced', () => {
  const said = question('Add a note', { note: 'x'.repeat(400) }, describing('note'));
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
