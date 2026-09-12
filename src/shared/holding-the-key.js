/* Has the page holding the talk key actually lost it?
 *
 * A small rule, got wrong twice in one day, both times by the same mistake: the
 * fix for a missed event was written to POLL THE WORLD instead of reading the
 * event. Polling answers about the moment you ask; an event says what happened.
 *
 * What went wrong. The first version asked the browser "is the holding tab
 * still active in a focused window?" and closed the turn when the answer was
 * no. That question has a wrong answer at the worst moment: a window reports
 * focused: false whenever Chrome is not the frontmost APPLICATION — during any
 * automated run, and for a fraction of a second around a click. So the key was
 * held with focus inside an iframe, the phone never listened at all, and the log
 * said the holding page had lost focus a moment after gaining it.
 *
 * Every one of these events already carries WHERE focus went, and only a move
 * somewhere ELSE is a reason to stop: another window taking focus (or nothing
 * at all, which is Chrome losing it to another application), a different tab
 * coming forward, or the holding tab going away. An event that names the
 * holding page is the opposite of a reason to stop.
 *
 * And one more, which only showed up once the first was fixed: focus can only
 * be LOST if it was there to lose. Under automation Chrome never holds the
 * operating system's focus, so the first focus event after a press truthfully
 * reports none — and "focus left the page" was being read out of a state where
 * it had never been.
 *
 * Each decision is a sentence about two facts, so they are pure functions here;
 * the phone around them is chrome.* listeners that cannot be tested at all.
 * They answer with the REASON to stop, because that reason is said out loud to
 * somebody who cannot see why their turn ended — so an empty string means carry
 * on, and every stop arrives with its explanation already written.
 */

const HoldingTheKey = {
  /** Focus moved to some window. Is that the holding page losing it?
   *
   * @param {{
   *   holding: number|null,
   *   holdingWindow: number|null,
   *   wasFocused: boolean,
   *   movedTo: number,
   * }} state
   *   holding: the tab holding the key, or null if nobody is.
   *   holdingWindow: which window that tab is in, or null if it could not be
   *     read.
   *   wasFocused: did the browser have the operating system's focus when the
   *     hold began?
   *   movedTo: the window focus went to — chrome.windows.WINDOW_ID_NONE (-1)
   *     when it left Chrome altogether.
   * @returns {string} why to stop, or '' to carry on
   */
  windowFocusMoved({ holding, holdingWindow, wasFocused, movedTo }) {
    if (holding === null) return '';
    // Nothing was focused when this began, so nothing has been lost. A key
    // pressed while Chrome is not frontmost must not be cut short by an event
    // describing what was already true.
    if (!wasFocused) return '';
    // Focus landing on the window that holds the key is not focus leaving it.
    if (holdingWindow !== null && movedTo === holdingWindow) return '';
    return 'the window holding the key lost focus';
  },

  /** Another tab came forward.
   *
   * Deliberately NOT conditional on the browser having been focused: a
   * different tab taking the front is a real loss whether or not Chrome owns
   * the screen, and it is the one case the person causes themselves.
   *
   * @param {number|null} holding @param {number} nowActive
   * @returns {string} */
  tabCameForward(holding, nowActive) {
    if (holding === null || nowActive === holding) return '';
    return 'another tab came in front of the page holding the key';
  },

  /** The holding tab was closed. Nothing is coming from it — not a keyup, not a
   *  pagehide, nothing.
   *  @param {number|null} holding @param {number} removed
   *  @returns {string} */
  tabWasRemoved(holding, removed) {
    if (holding === null || removed !== holding) return '';
    return 'the tab holding the key was closed';
  },
};
