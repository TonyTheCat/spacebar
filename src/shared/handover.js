/* The moment we move somebody ourselves.
 *
 * Every way of losing sight of the talk key is treated as a release, because a
 * microphone left open with nobody watching it is the one failure this product
 * must not have. That rule turned against us the first time the phone did its
 * job: the key was held, the sentence was "open Google and search…", the model
 * called open_site while the person was still speaking, the new tab came to the
 * front, and the page they were on reported that it had lost focus. Their turn
 * was closed mid-sentence — by us — and the rest of the sentence arrived as a
 * separate utterance with its beginning missing.
 *
 * So a focus change we CAUSED is not evidence about the key. This file holds
 * the window in which that is true. Opening a tab and having it come forward is
 * one turn of the event loop plus however long the browser takes; two seconds
 * covers that without covering anything a person did.
 *
 * It stays deliberately narrow. The only thing suppressed is losing SIGHT of
 * the key. A real release still ends the turn from wherever it arrives,
 * including from the page we just moved them to, so the microphone cannot be
 * held open by this.
 */

/** Long enough for a tab to be created and focused, short enough that nothing a
 *  person does falls inside it. */
const HANDOVER_WINDOW_MS = 2000;

const Handover = {
  WINDOW_MS: HANDOVER_WINDOW_MS,

  /** Are we still in the middle of moving them ourselves?
   *
   * @param {number} startedAt  When the move began. 0 or absent means we are
   *   not moving anybody, which is the right answer whenever nothing has been
   *   recorded — including before the first navigation of a session.
   * @param {number} now
   * @param {number} [windowMs]
   * @returns {boolean}
   */
  expected(startedAt, now, windowMs = HANDOVER_WINDOW_MS) {
    if (!startedAt) return false;
    const since = now - startedAt;
    // A timestamp in the future is not a move in progress, it is a clock that
    // disagrees with itself. Reading it as "still handing over" would suppress
    // every lost key until the clock caught up, which is a microphone held open
    // for as long as the disagreement lasts.
    if (since < 0) return false;
    return since < windowMs;
  },
};
