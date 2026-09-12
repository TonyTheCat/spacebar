/* Waiting for one thing, with a deadline, exactly once.
 *
 * The phone has answered the model before the browser caught up twice now, and
 * the worse of the two is worth writing down: open_site opened Google and
 * reported success in the same instant, so the model's next response was
 * created against the tool list of the page it had just LEFT — a list holding
 * nothing but open_site. The real tools arrived a second later, too late for a
 * response that had already been given its tools, and the model told the person
 * it could not type a search into a box it was looking at.
 *
 * The fix is to wait for the thing that has to happen first. Every such wait
 * has the same three traps, so they are solved here once rather than in three
 * event handlers:
 *
 *   - it must finish ONCE. The event can arrive twice, or arrive after the
 *     deadline has already given up, and a promise resolved a second time
 *     quietly keeps its first value while the code around it believes the
 *     second.
 *   - it must have a DEADLINE. A page that never finishes loading, or a session
 *     that never confirms, must not leave somebody in front of a phone that has
 *     gone silent. A late answer is worth more than no answer.
 *   - it must say WHICH of the two happened, so that whoever reads the log
 *     afterwards knows whether the browser was slow or the wait was pointless.
 */

const OneWait = {
  /**
   * @param {{ ms: number }} how  How long to wait before giving up.
   */
  create(how) {
    /** @type {(how: 'settled'|'timed out') => void} */
    let finish = () => {};
    /** @type {'settled'|'timed out'|null} */
    let outcome = null;

    /** @type {Promise<'settled'|'timed out'>} */
    const promise = new Promise((resolve) => {
      finish = resolve;
    });

    /* The deadline carries no "has it finished already?" guard, deliberately:
     * settled() and giveUp() both clear this timer synchronously, so there is no
     * path on which it can run after an answer has been given. A guard nothing
     * can reach is a guard no test can hold, which is worse than not having
     * one. The test that stands in its place is "a deadline passing after the
     * thing happened changes nothing" — take the clearTimeout out and it
     * fails. */
    const timer = setTimeout(() => {
      outcome = 'timed out';
      finish(outcome);
    }, how.ms);

    return {
      promise,
      /** What happened, or null while it is still waiting. */
      get outcome() {
        return outcome;
      },
      /** The thing happened.
       *  @returns {boolean} true if this is the call that ended the wait; false
       *    for a second report of the same event, and for one arriving after
       *    the deadline has already been announced. */
      settled() {
        if (outcome) return false;
        outcome = 'settled';
        clearTimeout(timer);
        finish(outcome);
        return true;
      },
      /** Stop waiting, and call it a timeout — for a wait whose point has gone
       *  away, such as watching a page load on a line that has just dropped.
       *  Reported as 'timed out' rather than as a third outcome, because to
       *  everybody downstream it is the same thing: the thing did not
       *  happen. */
      giveUp() {
        if (outcome) return false;
        outcome = 'timed out';
        clearTimeout(timer);
        finish(outcome);
        return true;
      },
    };
  },
};
