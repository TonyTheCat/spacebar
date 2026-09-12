/* Do it once, after the flurry stops.
 *
 * A browser reports one thing happening to a tab as several events in quick
 * succession: a switch that also finishes loading, a navigation that fires more
 * than once, a frame settling. Each of them is a reason to re-read the page,
 * and only the last of them is still true.
 *
 * This is not about saving work. Publishing a tool list is a change to what the
 * model is ALLOWED to do, so three of them in a second is three chances for the
 * model to act on a list describing a page that has already moved.
 *
 * So the trigger is cheap to pull and the work happens once, when the pulling
 * stops. It sits here on its own because it is the only testable part of that
 * behaviour — the rest is chrome.tabs listeners inside a page that touches the
 * DOM as it loads.
 */

const Coalesce = {
  /**
   * @param {number} ms  How long the quiet has to last.
   * @param {() => void} run  What to do once it does.
   * @returns {() => void}  Pull it as often as you like.
   */
  after(ms, run) {
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let waiting;
    return () => {
      // Every pull moves the moment further out, so a burst of ten does the
      // work once, ms after the TENTH. Doing it ms after the first would
      // describe the page as it was when the burst began, which is the page
      // that has just stopped being true.
      clearTimeout(waiting);
      waiting = setTimeout(run, ms);
    };
  },
};
