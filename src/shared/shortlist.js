/* Twelve tools somebody can be helped with, not twenty-eight a page happens to
 * have.
 *
 * Google's results page synthesized twenty-eight tools, and twenty-one of them
 * were clicks on the furniture: clickAboutThisResult, clickAboutThisResult2, …
 * up to ten. That costs three things, and only the first is obvious. Every
 * republish carries the whole list, so it is paid for again on every page load
 * and after every action. The model has to find the search box among twenty
 * near-identical names. And "what can I do here" cannot be answered out loud
 * from a list like that at all.
 *
 * The rules, in the order they apply:
 *
 *   - a site's OWN declared tools are all kept. The author said what they
 *     wanted an agent to do, we are in no position to shorten that, and a page
 *     that declares its tools does not declare twenty-eight of them.
 *   - the browser's and the search engine's furniture goes: "about this result"
 *     and its numbered copies belong to Chrome and to Google, not to the page.
 *   - a numbered repeat of a name already kept goes. The synthesizer numbers
 *     duplicates because the page has ten identical controls; the first is the
 *     example and the tenth teaches nobody anything.
 *   - what is left is ordered by what people actually ask for — searching,
 *     going somewhere, filling something in, and only then pressing one of the
 *     page's many buttons — and cut to twelve.
 *   - the page's SIDE furniture sorts last within its kind. Settings, Share,
 *     Clear, Search by voice: kept, because somebody may well ask for one, but
 *     never ahead of the thing they came for.
 *   - and the page's OWN BUTTON comes first, ahead of every kind.
 *
 * Order matters as much as the cut, because the model reads this list top
 * down: the tool that answers "search for pizza" should not be the
 * twenty-fourth thing it sees.
 *
 * Document order is the tie-break, and on a results page document order is
 * upside down — Settings, Share and "Search by voice" sit in the header ABOVE
 * the results. So the page's own layout promotes its furniture over its
 * content, and once twenty-eight are cut to twelve that is not a matter of
 * position: a result gets dropped for a Share button. Demoted rather than
 * dropped, because the worst case of demoting is somebody's "Share" arriving
 * twelfth, and the worst case of dropping is a tool they asked for out loud
 * not being there at all.
 */

/** As many as somebody could be read out loud, and as many as a model can
 *  choose between without the choice becoming a lottery.
 *
 *  Named for this file rather than a bare KEEP: everything in src/shared shares
 *  ONE global scope, so short names here collide with each other, and a type
 *  check catches that where a browser would not. */
const SHORTLIST_KEEP = 12;

/** What each kind is worth to somebody who cannot see the page. Searching and
 *  going somewhere are why they opened a browser at all; a button on the page
 *  is the long tail. */
const KIND_WORTH = { search: 0, submit: 1, navigate: 2, set: 3, click: 4 };

/** A kind nobody has heard of sorts LAST rather than first. A new kind is not a
 *  kind to lead with. @param {string} [kind] */
const worthOf = (kind) =>
  kind && kind in KIND_WORTH ? KIND_WORTH[/** @type {keyof typeof KIND_WORTH} */ (kind)] : 9;

/** The page's own button comes before all of it.
 *
 * From a run on a government page whose whole purpose is one big "Start". The
 * synthesizer reports that link as the page's own button (`primary`), and by
 * KIND it is a click — the long tail, below the search box in the site's
 * header. Ordered that way, the model is shown a search tool first on a page
 * built for one action, and that is exactly what went wrong: it called the
 * search with an empty string, and somebody who could not see the screen was
 * asked to approve it.
 *
 * A kind is a guess about what people usually want. `primary` is what THIS page
 * says it is for, and a statement beats a guess.
 *
 * @param {{primary?: boolean}} tool */
const leads = (tool) => (tool?.primary === true ? 0 : 1);

/** The browser's and the search engine's own furniture, dropped by name.
 *
 *  A short literal list on purpose: a cleverness about which words sound
 *  "unimportant" would eventually throw away somebody's real tool. */
const NOT_THE_PAGE = [/aboutthisresult/i, /^clickmoreoptions/i, /^clickfeedback/i];

/** The page's own furniture: kept, and last of its kind.
 *
 * These are the controls every page of a site carries in its header and footer,
 * named the way the synthesizer names them — from the label, so "Search by
 * voice" arrives as clickSearchByVoice.
 *
 * Anchored to the kind prefix, so the word has to be how the LABEL STARTS
 * rather than something spotted anywhere inside it: a result whose title merely
 * contains one ("Change your privacy settings — USA.gov") is content, and
 * demoting that would be this file guessing about somebody's page again.
 *
 * The tail is deliberately not anchored, and that has a cost worth naming: real
 * furniture is usually more than one word ("Clear search", "Settings and
 * privacy"), so the rule has to allow a tail — which also demotes a genuine
 * result whose title BEGINS with one of these words ("Privacy for your
 * family"). Accepted rather than fixed: the only tighter rule is an exact-word
 * list, which misses most real furniture, and being demoted costs a place in a
 * list of twelve where being dropped costs the tool itself. */
const KEPT_BUT_LAST = [
  /^(?:click|navigate|submit)(?:the)?(?:settings|share|clear|reset|signin|signout|login|logout|help|privacy|terms|cookies|preferences|feedback|report)/i,
  /^(?:click|navigate|submit)searchby/i,
];

/** @param {string} name */
const isSideFurniture = (name) => KEPT_BUT_LAST.some((shape) => shape.test(String(name ?? '')));

/** The name without the synthesizer's duplicate number: clickApply3 → clickApply.
 *  @param {string} name */
const withoutTheNumber = (name) => String(name ?? '').replace(/\d+$/, '');

const Shortlist = {
  KEEP: SHORTLIST_KEEP,

  /** Which of a page's tools to put in front of the model.
   *
   * Generic, so it hands back exactly what it was given: the caller's tools
   * carry a schema and a description this file has no business knowing about,
   * and narrowing the type to the fields it reads would quietly lose the rest.
   *
   * @template {{name: string, kind?: string, source?: string, primary?: boolean}} T
   * @param {T[]} tools
   * @param {number} [keep]
   * @returns {T[]}  In the order they should be offered, declared first.
   */
  pick(tools, keep = SHORTLIST_KEEP) {
    const all = Array.isArray(tools) ? tools.filter((tool) => tool && tool.name) : [];
    const declared = all.filter((tool) => tool.source === 'declared');
    const ours = all.filter((tool) => tool.source !== 'declared');

    /** @type {Set<string>} */
    const seen = new Set();
    const worthwhile = ours
      .filter((tool) => !NOT_THE_PAGE.some((shape) => shape.test(tool.name)))
      .filter((tool) => {
        // A page with ten identical controls gets one of them: the first, which
        // is the one nearest the top of the document.
        const base = withoutTheNumber(tool.name);
        if (seen.has(base)) return false;
        seen.add(base);
        return true;
      });

    /* Stable within a kind. The synthesizer's order is document order, which is
     * the page as somebody would meet it — except for the furniture, which the
     * page puts first and which nobody came for. Four keys, in this order: what
     * the page says it is for, what the kind is worth, whether it is the site's
     * own furniture, and finally where it sits on the page. */
    const ordered = worthwhile
      .map((tool, at) => ({ tool, at }))
      .sort((one, two) => {
        const said = leads(one.tool) - leads(two.tool);
        if (said !== 0) return said;
        const worth = worthOf(one.tool.kind) - worthOf(two.tool.kind);
        if (worth !== 0) return worth;
        const side = Number(isSideFurniture(one.tool.name)) - Number(isSideFurniture(two.tool.name));
        return side !== 0 ? side : one.at - two.at;
      })
      .map(({ tool }) => tool);

    // The site's own go first and are never cut: whatever room they take is
    // room their author asked for.
    return [...declared, ...ordered.slice(0, Math.max(0, keep - declared.length))];
  },
};
