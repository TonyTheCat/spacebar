/* The handful of things the phone says for itself.
 *
 * Not what the model says — that voice is the session's, and it is good. These
 * are the sentences the phone has to produce when the session is exactly what
 * has gone wrong: no key, a dropped line, a hold that ran too long. Until now
 * they went through the browser's own speechSynthesis, and the first person to
 * hear it called it shrill. That matters more here than anywhere else in the
 * product: this is a voice somebody will live with, and the sentences it says
 * are the ones that arrive at the worst moments.
 *
 * So each fixed phrase gets a recording, made once with the same kind of voice
 * the session uses, and the phone plays that file. speechSynthesis stays as the
 * fallback for a missing file and for anything not on this list — it is worse to
 * be silent than to be shrill.
 *
 * Every line keeps its text. That is not documentation: it is what gets spoken
 * when the recording is missing, and it is what the recording is made FROM, so
 * the two cannot drift apart.
 */

/** @typedef {{ id: string, text: string, file: string }} VoiceLine */

/* Not annotated as a Record on purpose: the inferred shape keeps each name, so a
 * typo in VoiceLines.CONNECTD is a type error rather than a silent undefined at
 * the moment somebody needed to be told something. */
const LINES = {
  NOT_SET_UP: {
    id: 'not-set-up',
    text: 'Page Tools is not set up yet. Ask your helper to enter the key in its settings.',
    file: 'assets/voice/not-set-up.mp3',
  },
  CONNECTED: {
    id: 'connected',
    text: 'Ready. Hold the space bar and tell me what you want.',
    file: 'assets/voice/connected.mp3',
  },
  RECONNECTING: {
    id: 'reconnecting',
    text: 'The connection dropped. Reconnecting.',
    file: 'assets/voice/reconnecting.mp3',
  },
  CANNOT_RECONNECT: {
    id: 'cannot-reconnect',
    text: 'I could not get the connection back. Press Connect to try again.',
    file: 'assets/voice/cannot-reconnect.mp3',
  },
  KEY_REFUSED: {
    id: 'key-refused',
    text: 'The key was refused. Ask your helper to check it in the settings.',
    file: 'assets/voice/key-refused.mp3',
  },
  NO_MICROPHONE: {
    id: 'no-microphone',
    text: "I can't hear you. The microphone is not allowed for this browser.",
    file: 'assets/voice/no-microphone.mp3',
  },
  NO_PAGE: {
    id: 'no-page',
    text: 'There is no page open for me to work on. Open a site and try again.',
    file: 'assets/voice/no-page.mp3',
  },
  HELD_TOO_LONG: {
    id: 'held-too-long',
    text: 'I stopped listening. Let go of the key and press it again.',
    file: 'assets/voice/held-too-long.mp3',
  },
};

const VoiceLines = {
  ...LINES,

  /** Every line, for whatever records them. */
  all() {
    return Object.values(LINES);
  },

  /**
   * The recording for something about to be said, if there is one.
   *
   * Takes a line or a plain sentence, so a caller that has one of ours gets the
   * recording and a caller with something else still gets spoken.
   *
   * @param {VoiceLine|string} said
   * @returns {VoiceLine|null}
   */
  find(said) {
    if (said && typeof said === 'object' && 'file' in said) return said;
    const text = String(said ?? '').trim();
    return VoiceLines.all().find((line) => line.text === text) ?? null;
  },

  /** What to say, recording or not. @param {VoiceLine|string} said */
  textOf(said) {
    return said && typeof said === 'object' && 'text' in said ? said.text : String(said ?? '');
  },
};
