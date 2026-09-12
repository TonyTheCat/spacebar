/* What a session error MEANS, which is almost never "the line is gone".
 *
 * The phone treated every `error` event from the session as a lost connection:
 * it said "The connection dropped. Reconnecting." out loud, closed the channel
 * and opened a new session. Measured on a real run, the error was
 *
 *   { type: 'invalid_request_error',
 *     code: 'conversation_already_has_active_response' }
 *
 * which is the session REFUSING ONE REQUEST while perfectly alive. So a working
 * line was thrown away mid-errand, the conversation's context went with it, and
 * the person paid for a second session in order to be told a lie about the
 * first.
 *
 * The rule this file holds: only the TRANSPORT can say the line is gone — the
 * peer connection failing, the data channel closing, a key that cannot be
 * minted. Those arrive as their own events and never come through here. An
 * `error` event is the server answering something we sent, and the honest
 * response to one is to write it down and carry on.
 *
 * GONE is therefore deliberately EMPTY. Not an oversight: no error payload has
 * been measured announcing the end of a session, and the two places that would
 * notice — onclose on the channel, onconnectionstatechange on the peer —
 * already do. If a run ever catches the server naming the end of a session in
 * an error, its code goes in that list and this note goes with it. Until then,
 * guessing which words sound fatal would be the same defect in the other
 * direction: a line torn down because a message looked severe.
 */

/** Codes that mean the session itself has ended, so there is nothing left to
 *  send into. Empty by measurement — see the note above. */
const GONE = /** @type {string[]} */ ([]);

/** The one code seen in the wild, and the one that carries evidence: the server
 *  saying a response is already running is the server telling us something true
 *  about its own state. */
const ALREADY_ANSWERING = 'conversation_already_has_active_response';

const SessionErrors = {
  ALREADY_ANSWERING,

  /** Is the line gone, or was one request refused?
   *
   * @param {{type?: string, code?: string, message?: string}|null|undefined} error
   *   The `error` object of a session `error` event.
   * @returns {boolean} true only if there is no session left to talk to.
   */
  isDrop(error) {
    const code = String(error?.code ?? '');
    return GONE.includes(code);
  },

  /** Does this error carry the server's word that a response is running?
   *
   * Worth reading rather than ignoring. The phone's own idea of whether the
   * model is answering comes from response.created and response.done, and this
   * error is what arrives when that idea is wrong — believing the server here
   * is what stops the next release from asking again and being refused again.
   *
   * @param {{type?: string, code?: string, message?: string}|null|undefined} error
   * @returns {boolean}
   */
  saysAResponseIsRunning(error) {
    return String(error?.code ?? '') === ALREADY_ANSWERING;
  },

  /** One line for the log: what it was, and what we are doing about it.
   *  @param {{type?: string, code?: string, message?: string}|null|undefined} error
   *  @returns {string} */
  written(error) {
    const type = String(error?.type ?? 'error');
    const code = String(error?.code ?? '');
    const message = String(error?.message ?? '').slice(0, 160);
    const named = code ? `${type} / ${code}` : type;
    return message ? `${named} — ${message}` : named;
  },
};
