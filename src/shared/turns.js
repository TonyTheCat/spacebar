/* Whose turn it is, and whether there is anything to answer.
 *
 * Letting go of the talk key means "that was my turn". Acting on that is three
 * questions, and the phone used to answer all three with one boolean:
 *
 *   1. Was anything actually SAID? A release with nothing spoken used to post an
 *      empty turn — you said: "" — and ask the model to answer it.
 *   2. Has the server got the audio yet? Speech detection needs a moment of
 *      silence to decide a sentence ended, so at the instant the key comes up
 *      the words are still in the buffer. Asking for an answer then answers the
 *      turn BEFORE it, which sounds exactly like the model ignoring what was
 *      just said.
 *   3. Is the model already answering? Asking twice is
 *      conversation_already_has_active_response, which the phone read as a lost
 *      line and paid for a new session over. But somebody talking over the
 *      model is not an error — it is how conversation works — so the answer in
 *      progress is cancelled and the new turn takes its place.
 *
 * The machine holds those three facts and says what to do. It is here for the
 * same reason push-to-talk.js is: everything around it is WebRTC and event
 * handlers, and this is the part that can be tested.
 *
 * It is written against a session with server-side speech detection that does
 * NOT answer by itself (create_response: false), and that is not a detail. With
 * the server free to start its own response the moment it hears silence, no
 * client-side flag can be right: our release and its detector are two triggers
 * racing, and whichever loses produces the refusal above. So the detector says
 * WHEN the audio is in and WHETHER anything was said, and the release is the
 * only thing that ever asks for an answer.
 */

/** How long to wait for the server to take the audio after a release before
 *  asking it to take what it has. Speech detection needs about half a second of
 *  silence; this is comfortably past that. A backstop rather than the normal
 *  path — the alternative to having one is a phone that goes quiet forever
 *  because a single event did not arrive. */
const WAIT_FOR_THE_AUDIO_MS = 1500;

/** How long to wait for a cancelled answer to actually stop.
 *
 * Cancelling is a request, not an act: an answer is over when the session says
 * it is over. Asking for the new answer before that word arrives is the same
 * race this file exists to remove — the session refuses the second ask and the
 * interrupting turn is dropped in silence.
 *
 * Shorter than the audio wait because nobody is speaking during it: the person
 * has stopped, the model has been told to stop, and this is the pause before
 * their turn is answered. */
const WAIT_FOR_THE_CANCEL_MS = 800;

const Turns = {
  WAIT_MS: WAIT_FOR_THE_AUDIO_MS,
  WAIT_FOR_THE_CANCEL_MS,

  /**
   * @param {{
   *   onAsk: () => void,
   *   onStillWaiting: () => void,
   *   waitMs?: number,
   *   cancelMs?: number,
   * }} tell
   *   onAsk: ask the model for an answer now — the turn is complete.
   *   onStillWaiting: the audio never arrived; commit what there is.
   */
  create(tell) {
    const waitMs = tell.waitMs ?? WAIT_FOR_THE_AUDIO_MS;
    const cancelMs = tell.cancelMs ?? WAIT_FOR_THE_CANCEL_MS;
    let spoke = false;
    let audioIsIn = false;
    let letGo = false;
    let answering = false;
    /** Is a turn waiting for a cancelled answer to stop before it is asked? */
    let owed = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let waiting;

    const stopWaiting = () => {
      clearTimeout(waiting);
      waiting = undefined;
    };

    const machine = {
      /** Is the model answering right now? */
      get answering() {
        return answering;
      },
      /** Was anything said in this turn? */
      get spoke() {
        return spoke;
      },

      /** A response has started. From response.created — and from the server
       *  refusing a second one, which is the same fact stated as an error. */
      answerStarted() {
        answering = true;
      },

      /** From response.done, whatever the answer's status: finished, or
       *  cancelled because they talked over it.
       *
       * This is where an interrupting turn is finally asked about — it has been
       * waiting for exactly this word.
       *
       * @returns {'asked'|'finished'} */
      answerFinished() {
        answering = false;
        if (!owed) return 'finished';
        owed = false;
        stopWaiting();
        tell.onAsk();
        return 'asked';
      },

      /** They talked over the model, the cancel has been sent, and this turn is
       *  asked about once the session says that answer has stopped.
       *
       * Asking immediately after sending the cancel races the session's own
       * bookkeeping: the ask arrives while the old answer is still running, is
       * refused, and the person's interruption is dropped in silence — which is
       * worse than the noisy version of this bug, because nothing at all
       * happens.
       *
       * @returns {'waiting-for-the-cancel'} */
      askWhenTheAnswerStops() {
        owed = true;
        stopWaiting();
        waiting = setTimeout(() => {
          waiting = undefined;
          owed = false;
          // Waited long enough to stop believing an answer is still running. If
          // the session disagrees it refuses the ask and says so, which is
          // written down rather than read as a lost line: a turn asked and
          // refused is recoverable, a turn never asked is gone.
          answering = false;
          tell.onAsk();
        }, cancelMs);
        return 'waiting-for-the-cancel';
      },

      /** The key went down: a new turn, whatever the last one left behind.
       *
       * Including a turn still waiting for a cancelled answer to stop. That one
       * is SUPERSEDED rather than lost — the person is speaking again, and their
       * release will ask for an answer covering both of the things they said.
       * Leaving it owed instead asks for an answer WHILE they are still
       * talking, which is the interruption bug with the roles swapped.
       *
       * This is why `owed` is cleared here rather than inside stopWaiting:
       * releasing with nothing said also stops the wait, and there the owed turn
       * is still the person's real, unanswered one — their words are already
       * committed at the far end, and dropping the ask would answer them with
       * silence.
       */
      held() {
        stopWaiting();
        spoke = false;
        audioIsIn = false;
        letGo = false;
        owed = false;
        return 'held';
      },

      /** Speech detected in the audio buffer. This is the only honest answer to
       *  "did they say anything": the transcript arrives far too late to decide
       *  whether to ask for an answer at all. */
      heardSpeech() {
        spoke = true;
        return 'heard';
      },

      /** The server took the audio and made a message out of it.
       *
       * A commit only happens when there was audio, so it is also proof that
       * something was said — which matters when detection reports the speech
       * only after the key is already up.
       *
       * @returns {'asked'|'holding'} */
      audioArrived() {
        audioIsIn = true;
        spoke = true;
        if (!letGo) return 'holding';
        stopWaiting();
        machine.clear();
        tell.onAsk();
        return 'asked';
      },

      /** The key came up: that was their turn.
       *
       * @returns {'asked'|'waiting'|'nothing'} */
      released() {
        letGo = true;
        if (!spoke) {
          // Nothing said, so there is nothing to answer. An empty turn must
          // cost nothing at all: it used to cost a refused request and, through
          // that, the whole session.
          stopWaiting();
          return 'nothing';
        }
        if (audioIsIn) {
          stopWaiting();
          machine.clear();
          tell.onAsk();
          return 'asked';
        }
        // Said, but the server has not taken it yet. The answer waits for the
        // audio rather than being asked about the turn before it.
        stopWaiting();
        waiting = setTimeout(() => {
          waiting = undefined;
          tell.onStillWaiting();
        }, waitMs);
        return 'waiting';
      },

      /** Start over: the turn has been asked about, or the line went away. */
      clear() {
        stopWaiting();
        spoke = false;
        audioIsIn = false;
        letGo = false;
        owed = false;
      },
    };
    return machine;
  },
};
