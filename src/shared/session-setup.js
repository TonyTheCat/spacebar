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

const SessionSetup = {
  TRANSCRIBER,

  /** The first session.update, sent the moment the channel opens.
   *
   * @param {{ instructions: string, language?: unknown }} said
   * @returns {object} the event, ready to send.
   */
  opening(said) {
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: said.instructions,
        audio: {
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
