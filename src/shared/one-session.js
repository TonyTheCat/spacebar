/* One line at a time, however many things ask for one.
 *
 * Opening a session is not a call, it is a sequence: mint a short-lived key,
 * open a peer connection, send the offer, take the answer, wait for the session
 * to announce itself. Every step is a wait, and while the page is waiting it
 * still answers its own Connect button.
 *
 * Two runs overlapping is not a wasted request. They share the peer connection
 * and the data channel, so the second overwrites what the first is about to
 * use, and the first then talks into a channel that is not open yet. Measured
 * on a real profile: "short-lived key minted" twice, "peer connection
 * established" twice, then "cannot send session.update: the channel is not
 * open" — a phone that looks connected and can do nothing, reported on a line
 * of text to somebody who cannot read one. Two microphones and two paid
 * sessions are the rest of the bill.
 *
 * So opening is a small machine rather than a boolean somebody forgets to
 * check, and it lives here because it is the only testable part of connecting.
 *
 * What it enforces:
 *   - begin twice is one begin. The second caller is told no and does nothing,
 *     whether it is the button, the automatic connection on load, or a
 *     reconnection landing on an attempt still in flight;
 *   - a line is up only once the session has SAID so. 'connecting' is not
 *     'live', and nothing may be sent into a channel still being built;
 *   - down is the only way back, and it is the same door for every way of
 *     losing the line. A machine left stuck in 'connecting' by a failure
 *     nobody reported takes the Connect button away for the rest of the day.
 */

const OneSession = {
  create() {
    /** @type {'down'|'connecting'|'live'} */
    let where = 'down';
    return {
      /** @returns {'down'|'connecting'|'live'} */
      get state() {
        return where;
      },
      /** Is there a session to say something into? Only after it has announced
       *  itself: a channel being built is not a channel. */
      get isUp() {
        return where === 'live';
      },
      /** May this caller open a session?
       *  @returns {boolean} true if it is theirs to open. false means one is
       *    already being opened or is already up, and the caller must do
       *    nothing at all. */
      begin() {
        if (where !== 'down') return false;
        where = 'connecting';
        return true;
      },
      /** The session announced itself.
       *
       * Only from 'connecting'. A session.created that arrives after we gave up
       * and went down belongs to a line that is already closed, and reading it
       * as live leaves the phone claiming a connection it does not have.
       *
       * @returns {boolean} true if this call took the line up. */
      live() {
        if (where !== 'connecting') return false;
        where = 'live';
        return true;
      },
      /** The line is gone: it failed on the way up, or it dropped once it was
       *  up. Deliberately one door for both, because the next attempt has to be
       *  allowed either way.
       *  @returns {boolean} true if there was something to lose. */
      down() {
        if (where === 'down') return false;
        where = 'down';
        return true;
      },
    };
  },
};
