/* What a session is told when it opens.
 *
 * One place, because every field here is a decision somebody had to make twice
 * before it was written down — and because it is the only part of connecting
 * that can be read back in a test. The rest is WebRTC.
 *
 * It needs spoken-language.js loaded before it: these are classic scripts
 * sharing one scope, and there is no import to fix the order up.
 */

/** The transcription model. It writes down what the PERSON said, which is the
 *  only evidence the consent gate accepts — the model cannot write into it. */
const TRANSCRIBER = 'gpt-4o-mini-transcribe';

/** The voices the Realtime API offers, as its own reference lists them.
 *
 * A closed list because an unknown name is not a quiet fallback at the far end: the session
 * refuses the update, and a refused update is a session with no tools and no transcription —
 * every promise in this product, gone, over a typo in a setting.
 *
 * Kept here rather than in a module of its own, deliberately: this file is the only thing that
 * sends it, and a new file in src/shared costs a line in the manifest and a line in the phone's
 * page — two files belonging to other people — for one list. If the settings page ever offers
 * these by name, that is when it earns its own module, the way the spoken language did. */
const VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];

const SessionSetup = {
  TRANSCRIBER,
  VOICES,

  /** The voice to ask for, or nothing at all.
   *
   * NOTHING is the default, and that is the whole design of this knob: with no voice named,
   * this file sends no audio.output at all and the session speaks in whatever voice it would
   * have spoken in before. Nobody's product changes because the option exists.
   *
   * An unrecognised name is treated as no name rather than passed through. The session refuses
   * an update it cannot read, and that update is the one carrying the transcription the gate
   * reads and the tools the model uses — so a typo in a setting would take the whole product
   * down rather than sound wrong.
   *
   * @param {unknown} asked  Whatever a setting holds, if anything.
   * @returns {string} '' when there is nothing usable to ask for.
   */
  voice(asked) {
    const said = String(asked ?? '')
      .trim()
      .toLowerCase();
    return VOICES.includes(said) ? said : '';
  },

  /** The first session.update, sent the moment the channel opens.
   *
   * @param {{ instructions: string, language?: unknown, voice?: unknown }} said
   * @returns {object} the event, ready to send.
   */
  opening(said) {
    const voice = SessionSetup.voice(said.voice);
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: said.instructions,
        audio: {
          /* THE VOICE IS SET HERE OR NOWHERE, and that is the API's rule rather than ours: the
           * voice cannot be changed once the model has produced audio even once in a session.
           * This is the first thing sent on a new channel, so it is the only moment there is.
           *
           * And the key is absent unless somebody chose one — an empty string is a value, and
           * a value the session does not recognise is an update it refuses. */
          ...(voice ? { output: { voice } } : {}),
          input: {
            /* Transcription is turned on before any tool exists, so that no
             * confirmation can ever be reached with it off. Without it the
             * session hears the person but never writes down what they said,
             * and the gate has nothing to read.
             *
             * The language is SET rather than guessed, because guessing got it
             * wrong on a live run and the model then acts on the wrong words. */
            transcription: {
              model: TRANSCRIBER,
              language: SpokenLanguage.of(said.language),
            },
            /* Speech detection stays ON, and answering by itself is turned OFF.
             *
             * Both halves matter. Detection is the only thing that knows in
             * time whether anything was said and when the audio has been taken
             * — the transcript arrives long after the key is up. But a detector
             * free to start its own response the moment it hears silence is a
             * SECOND trigger racing our release: whichever loses produces
             * conversation_already_has_active_response, the refusal that cost a
             * live session mid-errand. No client-side flag can fix a race
             * between two triggers; removing one of them can.
             *
             * So the release is the only thing that ever asks for an answer,
             * and interrupting is ours to do explicitly rather than the
             * detector's to do on a volume threshold. */
            turn_detection: {
              type: 'server_vad',
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    };
  },
};
