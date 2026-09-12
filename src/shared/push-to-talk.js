/* Holding the key, as a thing that can be reasoned about.
 *
 * Push to talk looks like two event listeners until you count the ways the
 * "let go" can fail to arrive. The key comes up while another window has focus.
 * The tab is hidden mid-sentence. The page navigates under the person. Each one
 * leaves a microphone open with nobody watching it, and the promise this
 * product makes is that nothing is heard between turns.
 *
 * So holding the key is a small machine rather than a boolean in two handlers,
 * and it lives here because it is the only testable part: the rest is listeners
 * in a content script and a page that touches the DOM as it loads.
 *
 * What it enforces:
 *   - start twice is one start. A key repeat, or the page and the phone both
 *     reporting the same press, must not open two turns;
 *   - stop without a start does nothing, so a release that went missing cannot
 *     be "corrected" into an extra stop later;
 *   - anything meaning "we have lost sight of the key" — a blur, a hidden tab,
 *     a page going away — is a stop, and it is the SAME stop rather than a
 *     special case at each call site.
 */

const PushToTalk = {
  /** The key this product listens for. */
  KEY: 'Space',

  /** Is this key press ours to take?
   *
   * Only while a session is actually live. Swallowing the key unconditionally
   * would make a broken page of every page on the machine, including for
   * somebody who never opened the phone and is simply typing. With no session
   * there is nothing to talk to, so the key belongs to the page and the browser
   * behaves like a browser.
   *
   * @param {boolean} live  Is a voice session running right now?
   * @param {string} code   KeyboardEvent.code — the physical key, so it does
   *   not change with the keyboard layout.
   */
  claims(live, code) {
    return live === true && code === PushToTalk.KEY;
  },

  /**
   * @param {{
   *   onStart: () => void,
   *   onStop: (why: StopReason) => void,
   *   limitMs?: number,
   *   onTooLong?: () => void,
   * }} tell
   *   onStop is told WHY the turn ended, and the reasons are not
   *   interchangeable downstream: a release is the person saying "that was my
   *   turn", while losing sight of the key is a guess made on their behalf —
   *   and when the phone has just moved them to another tab, that guess is
   *   about our own navigation rather than about anything they did.
   */
  create(tell) {
    let held = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let tooLong;

    const machine = {
      get held() {
        return held;
      },

      /** @returns {boolean} true if this actually began a turn. */
      start() {
        if (held) return false;
        held = true;
        /* A turn cannot last forever.
         *
         * Every other way of noticing a lost release goes through the page or
         * through focus, and one broken page takes both away at once: a hung
         * JavaScript thread queues the keyup, the blur and the pagehide behind
         * itself, and nothing about focus changes, so no event is left for
         * anybody to react to. Time is the only thing that still passes.
         *
         * A backstop rather than a feature: nobody speaks for this long on
         * purpose, and the point is that the person is TOLD what happened
         * instead of wondering why the agent went quiet.
         */
        if (tell.limitMs) {
          tooLong = setTimeout(() => {
            if (machine.stop('too-long')) tell.onTooLong?.();
          }, tell.limitMs);
        }
        tell.onStart();
        return true;
      },

      /** @param {StopReason} [why]  Defaults to a real release.
       *  @returns {boolean} true if this actually ended a turn. */
      stop(why) {
        if (!held) return false;
        held = false;
        clearTimeout(tooLong);
        tell.onStop(why ?? 'released');
        return true;
      },

      /** We can no longer see the key: focus went elsewhere, the tab was
       *  hidden, the page is going away. Deliberately the same stop — a
       *  microphone left open because the release never arrived is the failure
       *  this whole file exists for. */
      lostSight() {
        return machine.stop('lost-sight');
      },
    };
    return machine;
  },
};
