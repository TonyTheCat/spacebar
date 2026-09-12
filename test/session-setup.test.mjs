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
const { opening, TRANSCRIBER } = loadShared('session-setup.js', 'SessionSetup', { SpokenLanguage });

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

test('speech detection is on, and the server never answers by itself', () => {
  const detection = input({ instructions: '' }).turn_detection;
  assert.equal(detection.type, 'server_vad');
  assert.equal(detection.create_response, false, 'the release is the only thing that asks');
  assert.equal(detection.interrupt_response, false, 'interrupting is ours to do explicitly');
});
