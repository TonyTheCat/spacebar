/* The rule: transcription ON before any tool exists, the language SET, speech
 * detection on, and the server answering by itself OFF.
 *
 * Without transcription the gate has nothing to read, because the only evidence
 * of consent is what the PERSON said. And a detector free to answer on its own
 * is a second trigger racing our release — the loser produces
 * conversation_already_has_active_response, which cost a live session
 * mid-errand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const SpokenLanguage = loadShared('spoken-language.js', 'SpokenLanguage');
// session-setup.js reads SpokenLanguage by name: they are classic scripts
// sharing one scope in the browser, so it is handed in here rather than
// imported.
const { opening, TRANSCRIBER, VOICES } = loadShared('session-setup.js', 'SessionSetup', {
  SpokenLanguage,
});

const input = (said) => opening(said).session.audio.input;

test('it is a session.update carrying the instructions it was given', () => {
  const event = opening({ instructions: 'Be brief.' });
  assert.equal(event.type, 'session.update');
  assert.equal(event.session.type, 'realtime');
  assert.equal(event.session.instructions, 'Be brief.');
});

test('transcription is on from the first event, with the model named', () => {
  // Turned on before any tool exists, so no confirmation can ever be reached
  // with it off.
  assert.equal(input({ instructions: '' }).transcription.model, TRANSCRIBER);
  assert.ok(TRANSCRIBER.length > 0);
});

test('the language is set rather than left to be guessed', () => {
  assert.equal(input({ instructions: '', language: 'ru' }).transcription.language, 'ru');
  assert.equal(input({ instructions: '', language: 'en-us' }).transcription.language, 'en-US');
});

test('an unusable language becomes one that works, not an error nobody can read', () => {
  assert.equal(input({ instructions: '', language: 'english' }).transcription.language, 'en');
  assert.equal(input({ instructions: '' }).transcription.language, 'en');
});

test('by default no voice is asked for, so nobody\'s product changes', () => {
  // The knob exists; the default is that it is not turned. With no voice named there is no
  // audio.output at all, and the session speaks in whatever voice it spoke in before.
  const audio = opening({ instructions: '' }).session.audio;
  assert.equal(audio.output, undefined);
  assert.ok(audio.input, 'the input half is untouched');
});

test('a voice the API offers is asked for, once, where it can still be set', () => {
  // The API's own rule: the voice cannot be changed once the model has produced audio in a
  // session. This event is the first thing sent on a new channel, so it is the only moment.
  const audio = opening({ instructions: '', voice: 'coral' }).session.audio;
  assert.deepEqual(audio.output, { voice: 'coral' });
});

test('however it was typed', () => {
  assert.deepEqual(opening({ instructions: '', voice: '  Coral ' }).session.audio.output, {
    voice: 'coral',
  });
});

test('a name the API does not know is not sent at all', () => {
  /* Not passed through and not corrected: the session refuses an update it cannot read, and
   * THAT update is the one carrying the transcription the gate reads and the tools the model
   * uses. A typo in a setting would take the whole product down rather than sound wrong. */
  for (const asked of ['female', 'Karen', '', '   ', null, undefined, 42, {}]) {
    assert.equal(
      opening({ instructions: '', voice: asked }).session.audio.output,
      undefined,
      JSON.stringify(asked) ?? String(asked)
    );
  }
});

test('the list is the API\'s own, and every name in it is accepted', () => {
  for (const name of VOICES) {
    assert.deepEqual(opening({ instructions: '', voice: name }).session.audio.output, {
      voice: name,
    });
  }
  // The ones the film can choose from, named so a change to the list is visible here.
  for (const named of ['alloy', 'coral', 'shimmer', 'sage', 'marin', 'cedar']) {
    assert.ok(VOICES.includes(named), `${named} is missing from the list`);
  }
});

test('speech detection is on, and the server never answers by itself', () => {
  const detection = input({ instructions: '' }).turn_detection;
  assert.equal(detection.type, 'server_vad');
  assert.equal(detection.create_response, false, 'the release is the only thing that asks');
  assert.equal(detection.interrupt_response, false, 'interrupting is ours to do explicitly');
});
