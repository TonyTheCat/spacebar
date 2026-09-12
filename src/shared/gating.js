/* Which tools have to be asked about, and who does the asking.
 *
 * Two different surfaces ask before something is committed, and they are not
 * asking the same question. The phone asks the PERSON, out loud, and waits for
 * their own words. The content script asks the extension and counts silence as
 * a refusal. Both of them need an answer to "must this be asked about", and the
 * answer used to be computed twice, differently.
 *
 * The rule is `gated`, and never the KIND of the tool. A search box is a form
 * that submits, so a rule written as "ask before every submit" asks before a
 * search. That happened: the synthesizer marked the search `gated: false`, the
 * phone read that and pressed on without parking anything, while the content
 * script asked a question with nobody listening for it, read the silence as no,
 * and reported "the search action was declined". Nobody was ever asked
 * anything, and the person had asked for the search twice.
 *
 * The two rules are still DIFFERENT rules, which is why this file has two
 * functions rather than one shared boolean:
 *
 *   - the page's executor asks about what the synthesizer says commits
 *     something;
 *   - the phone asks about that AND about every tool a SITE declared, because a
 *     declared tool carries no statement of consequence at all. WebMCP has no
 *     annotation for it, so "count the notes" and "delete the notes" arrive
 *     indistinguishable. Where a person clicks a tool by hand the click is the
 *     consent; on the phone nobody clicks, so with no signal, asking is the
 *     only honest default.
 */

const Gating = {
  /** Must the page's own executor ask before it commits this?
   *
   * `gated`, and nothing else. Reading the kind instead is how a person's
   * search became "declined".
   *
   * @param {{gated?: unknown}|null|undefined} tool
   * @returns {boolean}
   */
  mustAsk(tool) {
    // A plain `true` only. This value has travelled through a page scan, a
    // message and storage, so it can arrive as the string 'false', as 0, or as
    // an object — none of which is a statement that something is gated.
    return tool?.gated === true;
  },

  /** Must the phone put this to the person out loud and wait for an answer?
   *
   * Everything gated, plus everything a site declared — see the note above:
   * that second half is a hole in WebMCP rather than caution on our part.
   *
   * @param {{gated?: unknown, source?: unknown}|null|undefined} tool
   * @returns {boolean}
   */
  mustAskOutLoud(tool) {
    return Gating.mustAsk(tool) || tool?.source === 'declared';
  },
};
