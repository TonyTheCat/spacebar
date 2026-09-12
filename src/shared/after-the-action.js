/* The action ran. Saying so, so that nobody does it twice.
 *
 * One search was asked for and two were heard. The reason is in the answer the
 * model was given: when a press navigates, the page it was acting on is GONE
 * mid-call, so the content script never answers, and the phone filled that in
 * with "It navigated. The page it was acting on is gone, so it could not report
 * back." Every word of that is true, and it reads like a failure — the machine
 * describing its own broken channel instead of the world. A model given "could
 * not report back" about a search does the sensible thing and searches again.
 *
 * What it needed to hear is that the thing HAPPENED. So:
 *
 *   - the action is named as done, with the words it was given, and told
 *     plainly not to be repeated. "It navigated" is a fact about our port; "the
 *     search ran" is a fact about the person's browser, and only the second one
 *     is an answer.
 *   - and what is on the screen now, counted. "Nine results" is the difference
 *     between a search that worked and a page nobody can see, and it is the one
 *     number that tells a listener the search was theirs.
 *
 * The arguments arrive here ALREADY WRITTEN — masked by Consent.written at the
 * call site — because a password that must not be said out loud must not be
 * written into the answer either, and a module that takes raw arguments is one
 * refactor away from doing exactly that.
 */

const AfterTheAction = {
  /** The action ran and took the page with it.
   *
   * Not "it navigated": that is our channel's problem, and the model reads it
   * as a failure to retry. The tool is named the way the MODEL knows it,
   * because that is the name it would call again — the person hears the model's
   * own words for it rather than these.
   *
   * @param {string} name  the tool as published
   * @param {string} [written]  its arguments, already masked for saying out loud
   * @returns {string}
   */
  wentThrough(name, written) {
    const withWhat = written && written !== '{}' ? ` with ${written}` : '';
    return (
      `DONE: ${name} ran${withWhat} and the page moved because of it. ` +
      'Do not call it again — it has already happened, and nothing here says otherwise. ' +
      'If they want something different, that is a new request in their own words.'
    );
  },

  /** What the page shows now, when it is a list of things.
   *
   * The count, not the list: the list travels separately and is capped. A count
   * is what says the page in front of them is the answer to what they asked —
   * "nine results" cannot be mistaken for a page that did not load.
   *
   * @param {unknown} count  how many were read
   * @param {unknown} of  how many the page has, when more were found than read
   * @returns {string} '' when the page is not a list
   */
  onScreen(count, of) {
    const read = Number(count) || 0;
    if (read <= 0) return '';
    const all = Number(of) || 0;
    const many = read === 1 ? '1 result' : `${read} results`;
    return all > read
      ? `The page shows ${many} of ${all} on it now.`
      : `The page shows ${many} now.`;
  },
};
