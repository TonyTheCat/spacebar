/* The rule: a turn is asked about once, after the audio is in, and only when
 * something was said.
 *
 * Three defects stand behind it: an empty turn posted as you said: "", an
 * answer asked for before the server had the words (so the model answered the
 * turn before), and a second ask refused with
 * conversation_already_has_active_response — which the phone read as a lost
 * line and paid for a new session over.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { create, WAIT_MS, WAIT_FOR_THE_CANCEL_MS } = loadShared('turns.js', 'Turns', {
  setTimeout,
  clearTimeout,
});

const watcher = (extra = {}) => {
  const seen = { asked: 0, stillWaiting: 0 };
  const machine = create({
    onAsk: () => {
      seen.asked += 1;
    },
    onStillWaiting: () => {
      seen.stillWaiting += 1;
    },
    waitMs: 30,
    cancelMs: 30,
    ...extra,
  });
  return { seen, machine };
};

const rest = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the waits are the ones that were measured', () => {
  // Speech detection needs about half a second of silence; the cancel wait is
  // shorter because nobody is speaking during it.
  assert.equal(WAIT_MS, 1500);
  assert.equal(WAIT_FOR_THE_CANCEL_MS, 800);
});

test('letting go with nothing said costs nothing', () => {
  const { seen, machine } = watcher();
  machine.held();
  assert.equal(machine.released(), 'nothing');
  assert.equal(seen.asked, 0, 'an empty turn must not be answered');
  assert.equal(seen.stillWaiting, 0, 'and must not start a wait either');
});

test('said, and the audio already in: the turn is asked about at once', () => {
  const { seen, machine } = watcher();
  machine.held();
  machine.heardSpeech();
  machine.audioArrived();
  assert.equal(machine.released(), 'asked');
  assert.equal(seen.asked, 1);
});

test('said, but the audio not in yet: the answer waits for it', () => {
  // At the instant the key comes up the words are still in the buffer. Asking
  // now answers the turn BEFORE this one.
  const { seen, machine } = watcher();
  machine.held();
  machine.heardSpeech();
  assert.equal(machine.released(), 'waiting');
  assert.equal(seen.asked, 0);
});

test('the audio arriving after the release is what asks the question', () => {
  const { seen, machine } = watcher();
  machine.held();
  machine.heardSpeech();
  machine.released();
  assert.equal(machine.audioArrived(), 'asked');
  assert.equal(seen.asked, 1);
});

test('the audio arriving while the key is still down asks nothing', () => {
  const { seen, machine } = watcher();
  machine.held();
  machine.heardSpeech();
  assert.equal(machine.audioArrived(), 'holding');
  assert.equal(seen.asked, 0, 'they have not finished their turn yet');
});

test('a commit is also proof that something was said', () => {
  // Detection sometimes reports the speech only after the key is already up, so
  // the commit itself has to count as "they spoke".
  const { seen, machine } = watcher();
  machine.held();
  machine.audioArrived();
  assert.equal(machine.spoke, true);
  assert.equal(machine.released(), 'asked');
  assert.equal(seen.asked, 1);
});

test('audio that never arrives is committed rather than left silent', async () => {
  // A backstop, not the normal path: the alternative is a phone that goes quiet
  // forever because one event did not turn up.
  const { seen, machine } = watcher({ waitMs: 20 });
  machine.held();
  machine.heardSpeech();
  machine.released();
  await rest(60);
  assert.equal(seen.stillWaiting, 1);
});

test('audio that arrives in time cancels the backstop', async () => {
  const { seen, machine } = watcher({ waitMs: 40 });
  machine.held();
  machine.heardSpeech();
  machine.released();
  machine.audioArrived();
  await rest(90);
  assert.equal(seen.asked, 1);
  assert.equal(seen.stillWaiting, 0, 'the wait must not fire after the audio is in');
});

test('one turn is asked about once, however many events describe it', () => {
  const { seen, machine } = watcher();
  machine.held();
  machine.heardSpeech();
  machine.audioArrived();
  machine.released();
  machine.audioArrived();
  assert.equal(seen.asked, 1);
});

test('an interrupting turn waits for the cancelled answer to actually stop', () => {
  // Cancelling is a request, not an act. Asking straight after sending it is
  // refused, and the interruption is dropped in silence.
  const { seen, machine } = watcher();
  machine.answerStarted();
  assert.equal(machine.answering, true);
  assert.equal(machine.askWhenTheAnswerStops(), 'waiting-for-the-cancel');
  assert.equal(seen.asked, 0);
  assert.equal(machine.answerFinished(), 'asked');
  assert.equal(seen.asked, 1);
  assert.equal(machine.answering, false);
});

test('an answer finishing on its own asks for nothing', () => {
  const { seen, machine } = watcher();
  machine.answerStarted();
  assert.equal(machine.answerFinished(), 'finished');
  assert.equal(seen.asked, 0);
});

test('a cancel the session never confirms is asked about anyway', async () => {
  // A turn asked and refused is recoverable; a turn never asked is gone.
  const { seen, machine } = watcher({ cancelMs: 20 });
  machine.answerStarted();
  machine.askWhenTheAnswerStops();
  await rest(60);
  assert.equal(seen.asked, 1);
  assert.equal(machine.answering, false, 'we have stopped believing an answer is running');
  // And the late confirmation does not ask a second time.
  assert.equal(machine.answerFinished(), 'finished');
  assert.equal(seen.asked, 1);
});

test('speaking again supersedes a turn that was still owed', async () => {
  // Leaving it owed asks for an answer WHILE they are talking: the same
  // interruption bug with the roles swapped. Their release will cover both
  // things they said.
  const { seen, machine } = watcher({ cancelMs: 30 });
  machine.answerStarted();
  machine.askWhenTheAnswerStops();
  machine.held();
  await rest(80);
  assert.equal(seen.asked, 0);
  assert.equal(machine.answerFinished(), 'finished');
  assert.equal(seen.asked, 0);
});

test('releasing with nothing said leaves an owed turn owed', async () => {
  // Their words are already committed at the far end, so dropping the ask would
  // answer them with silence. This is why the owed flag is cleared on a hold
  // rather than wherever the wait is stopped.
  const { seen, machine } = watcher({ cancelMs: 500 });
  machine.answerStarted();
  machine.askWhenTheAnswerStops();
  assert.equal(machine.released(), 'nothing');
  assert.equal(machine.answerFinished(), 'asked');
  assert.equal(seen.asked, 1);
});

test('a new hold starts a clean turn', () => {
  const { machine } = watcher();
  machine.held();
  machine.heardSpeech();
  machine.audioArrived();
  assert.equal(machine.held(), 'held');
  assert.equal(machine.spoke, false);
  assert.equal(machine.released(), 'nothing', 'nothing has been said in THIS turn');
});

test('clearing after the line goes away leaves nothing pending', async () => {
  const { seen, machine } = watcher({ waitMs: 20 });
  machine.held();
  machine.heardSpeech();
  machine.released();
  machine.clear();
  await rest(60);
  assert.equal(seen.stillWaiting, 0);
  assert.equal(seen.asked, 0);
});
