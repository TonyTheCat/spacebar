/**
 * page-tools-results — the first few results on a page of results, as data.
 *
 * A classic script defining one global, for the same reason the synthesizer is: the same
 * file has to work in a page, in an MV3 content script (no ES modules there) and injected
 * into a page nobody controls.
 *
 * WHY THIS EXISTS. A voice agent that can search and cannot read the results back has not
 * searched. Reading the page's `innerText` does not do it: on a real results page that is a
 * wall of advertisements, navigation, "about this result", and a footer, and either the
 * model drowns in it or the character cap is reached before the first result. Measured on
 * Anton's own run — the search worked, the page opened, and the answer to "which place
 * would you recommend?" was silence.
 *
 * WHAT IT DOES NOT DO: know about any site. There is not one selector here written for
 * Google or anybody else, because a selector for today's Google is a bug on the day they
 * ship a class-name change, and it teaches the code nothing about the next site. The signal
 * is structural and it is the one thing every results list in every markup shape has in
 * common: SIBLINGS THAT REPEAT, each carrying a link that titles it and text that describes
 * it. Cards in a div, rows in a table, items in a ul — the same rule finds all three, and
 * the tests are three fixtures written in those three shapes.
 *
 * WHAT IT COSTS. An advertisement laid out like a result IS a result to this code, because
 * it is a repeating sibling with a titling link. Filtering those would mean guessing which
 * words or classes mean "advertisement", which is exactly the kind of guess this file
 * refuses. Said out loud rather than hidden: the caller gets what the page shows, in the
 * order the page shows it.
 */

/** @param {typeof globalThis} global */
(function (global) {
  'use strict';

  /** How many results to hand back when the caller does not say. Five is what somebody
   *  listening can hold; more is a list they have to ask you to repeat. */
  const RESULTS = 5;

  /** A title longer than this is a sentence, not a name. */
  const TITLE = 90;
  /** A description longer than this stops being a description when it is read out loud. */
  const SNIPPET = 180;
  /** The short lines beside a result — a rating, a price, "closed", "opens 7 PM". Anything
   *  longer than this is prose that belongs in the snippet. */
  const CHIP = 44;
  /** At most this many of them per result. Three is a rating, a state and a time. */
  const CHIPS = 3;
  /** A link with less text than this titles nothing: it is an icon, a chevron, "more". */
  const TITLE_LINK = 8;
  /** A block with less text than this BESIDE its title describes nothing. Beside, not in
   *  total: a menu item's whole text is its own link, and measuring the total let a
   *  navigation menu of five long links pass as a list of results. Found by the mutation
   *  pass — two rules were covering each other, and neither was doing this job. */
  const HAS_TEXT = 24;

  /** The site's own furniture, which is never the page's results.
   *
   * Measured on usa.gov, three times in a row: "read_page → 4 result(s)", and every time the
   * four were the FOOTER MENU — "All topics and services", "About USAGov". A footer column is
   * repeating siblings, each with a heading link and enough text beside it to describe
   * something, which is exactly what this file looks for. The rule it needs is not about
   * words; it is about WHERE: a list of results is the page's content, and the parts of a
   * page that are the same on every page of the site are not.
   *
   * By landmark, because that is the page saying which parts those are. Anything else would
   * be guessing at class names again, which this file refuses on principle. */
  const CHROME =
    'footer,nav,header,[role="contentinfo"],[role="navigation"],[role="banner"],[role="search"]';

  /** @param {string | null | undefined} s */
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /** @param {string} s @param {number} n */
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

  /** Is this on the screen at all?
   *
   * The same question the synthesizer asks, asked again here rather than imported: this
   * file is dropped in on its own, and a dependency between two vendored scripts is a
   * dependency somebody will vendor half of.
   *
   * @param {Element} el
   */
  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return true;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };

  /** The link that titles this block, if it has one.
   *
   * A link inside a heading first, because that is what a heading is FOR and every markup
   * shape that has one means it. Otherwise the first link with enough text to be a name —
   * an icon or a chevron titles nothing.
   *
   * @param {Element} block
   * @returns {HTMLAnchorElement|null}
   */
  const titleLink = (block) => {
    const headed = block.querySelector(
      'h1 a[href], h2 a[href], h3 a[href], h4 a[href], h5 a[href], h6 a[href]'
    );
    if (headed instanceof HTMLAnchorElement && clean(headed.textContent).length >= 1) return headed;
    for (const link of block.querySelectorAll('a[href]')) {
      if (link instanceof HTMLAnchorElement && clean(link.textContent).length >= TITLE_LINK)
        return link;
    }
    return null;
  };

  /** Does this block SAY anything about the thing it names?
   *
   * The text that is not the title. A block whose entire text is the link titling it is a
   * menu item, not a result — and that is the difference between a list of results and the
   * navigation above it, which is otherwise the same markup with more members.
   *
   * @param {Element} block
   */
  const describes = (block) => {
    const link = titleLink(block);
    if (!link) return false;
    const whole = clean(block.textContent).length;
    const title = clean(link.textContent).length;
    return whole - title >= HAS_TEXT;
  };

  /** Every leaf-ish piece of text in a block, in document order.
   *  Leaf-ish rather than every node: a wrapper's text is its children's text repeated, and
   *  counting both is how a snippet ends up saying everything twice.
   *  @param {Element} block @returns {string[]} */
  const pieces = (block) => {
    /** @type {string[]} */
    const out = [];
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.localName;
      if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
      const text = clean(node.textContent);
      if (text) out.push(text);
    }
    return out;
  };

  /**
   * One result, as data rather than as prose.
   * @param {Element} block @returns {{title: string, snippet: string, extra: string[], url: string}|null}
   */
  const readOne = (block) => {
    const link = titleLink(block);
    if (!link) return null;
    const title = clean(link.textContent);
    if (!title) return null;

    const rest = pieces(block).filter((text) => text !== title && !title.includes(text));
    // The longest piece is the description: on every shape we have looked at, the sentence
    // about the thing is longer than the chips around it.
    const snippet = rest.reduce(
      (longest, text) => (text.length > longest.length ? text : longest),
      ''
    );
    const extra = rest
      .filter((text) => text !== snippet && text.length <= CHIP)
      .filter((text, at, all) => all.indexOf(text) === at)
      .slice(0, CHIPS);

    return {
      title: cut(title, TITLE),
      snippet: cut(snippet, SNIPPET),
      extra,
      url: link.href || '',
    };
  };

  /**
   * The repeating siblings that look like a list of results.
   *
   * Grouped by tag name among ONE parent's children, because that is what every one of the
   * three shapes has in common and it is the only grouping that does not need to know
   * anything about classes — which is just as well, since a real results page randomises
   * them.
   *
   * @param {ParentNode} root
   * @returns {{parent: Element, members: Element[]}|null}
   */
  const findTheList = (root) => {
    /** @type {{parent: Element, members: Element[]}|null} */
    let best = null;
    /* The furniture INSIDE the root, not wherever it is on the page.
     *
     * Asked this way round on purpose: a caller who passes the footer as the root has asked
     * for the footer, and answering "there is nothing there" would be this file overruling
     * them. Inside their root there is no footer, so nothing is skipped and they get what
     * they asked for. */
    const furniture = [...root.querySelectorAll(CHROME)];
    /** @param {Element} el */
    const isFurniture = (el) => furniture.some((part) => part.contains(el));
    const parents = [root, ...root.querySelectorAll('*')];
    for (const parent of parents) {
      if (!(parent instanceof Element) && parent !== root) continue;
      if (parent instanceof Element && isFurniture(parent)) continue;
      /** @type {Map<string, Element[]>} */
      const byTag = new Map();
      for (const child of parent.children) {
        const same = byTag.get(child.localName) ?? [];
        same.push(child);
        byTag.set(child.localName, same);
      }
      for (const [, siblings] of byTag) {
        // A cheap pre-filter, not a rule: the members check below subsumes it, so no test
        // can bind it and none should pretend to. It exists to skip the expensive filter on
        // the overwhelming majority of parents, which have one child of each tag.
        if (siblings.length < 2) continue;
        const members = siblings.filter((block) => isVisible(block) && describes(block));
        if (members.length < 2) continue;
        // More results wins, and the first group to reach a count keeps it.
        //
        // There WAS a tie-breaker here preferring the deeper group. It is gone: the
        // mutation pass showed nothing could bind it — no fixture distinguishes it, and I
        // could not write one where it changes an answer, because a wrapper group and the
        // group it wraps produce the same titles. Complexity no test can hold is worse than
        // a simpler rule, and it reads as if it were protecting something.
        if (best === null || members.length > best.members.length) {
          best = { parent: /** @type {Element} */ (parent), members };
        }
      }
    }
    return best;
  };

  /**
   * Read the first few results off this page.
   *
   * @param {{root?: ParentNode, limit?: number}} [options]
   * @returns {{results: Array<{title: string, snippet: string, extra: string[], url: string}>, found: number, more: boolean}}
   *   `found` is how many the page has; `results` is the first `limit` of them; `more` says
   *   there are others below, which is the difference between "five results" and "the five
   *   results" and it is the caller's to say out loud.
   */
  const readResults = (options) => {
    const root = options?.root ?? document.body ?? document;
    const limit = Math.max(1, options?.limit ?? RESULTS);
    const list = findTheList(root);
    if (!list) return { results: [], found: 0, more: false };

    const read = list.members.map(readOne).filter((one) => one !== null);
    return {
      results:
        /** @type {Array<{title: string, snippet: string, extra: string[], url: string}>} */ (
          read.slice(0, limit)
        ),
      found: read.length,
      more: read.length > limit,
    };
  };

  const api = {
    readResults,
    // The parts, for a caller that wants one of them on its own.
    titleLink,
    isVisible,
    LIMIT: RESULTS,
    version: '0.1.0',
  };

  global.PageToolsResults = api;
  // A CommonJS consumer too, without requiring one.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
