/* The hands: driving a page that is already in front of you.
 *
 * The other half of the synthesizer. That one READS a page and hands back a tool list; this
 * one does the things on it — press a control, put a value in one, read back what the control
 * ended up holding, describe what changed, and hear what the page objected to.
 *
 * Every line in here is the shape of something that went wrong in front of a person who could
 * not see the screen, and each one carries the measurement that put it there. It is a library
 * rather than part of a product because none of it knows anything about how it is called:
 * there is no messaging, no session, no agent, no permission model in this file.
 *
 * A classic script, one global, no build step — the same delivery as synthesize.js, because
 * it goes into the same place: a content script in an MV3 extension, where ES modules do not
 * exist.
 *
 *   <script src="filled-in.js"></script>     <!-- FilledIn: asItTakesIt judges arrival with it -->
 *   <script src="read-results.js"></script>  <!-- PageToolsResults: readPage reads lists with it -->
 *   <script src="drive-the-page.js"></script>
 *
 * Both of those are bricks from this same repository, and the two that need them say so on the
 * function. Nothing else is required.
 *
 * WHICH WORLD THIS RUNS IN MATTERS, and it is measured rather than assumed: a page's own
 * expando properties are invisible to a content script's isolated world, so `el.value = x`
 * here reaches the native setter and a framework counts the change as its own. The identical
 * line in the page's own world goes through React's value accessor, updates its tracker, and
 * is LOST. Measure this from an isolated world or you will measure the wrong world.
 */
(function (global) {
  /** Press whatever it is, HTML or not.
   *
   * This used to be one cast — "click() lives on HTMLElement, so cast once here rather than at
   * every call" — and the comment was right about the fact and wrong about the conclusion. A
   * cast silences the type checker; it does not give SVGElement a method it does not have.
   *
   * Anton's run, on the SNAP state directory: the page holds a map of the United States where
   * every state is a link INSIDE an <svg>, labelled "CA", "TX", "AK". The model asked to follow
   * "CA" and got back "running it on the page threw: TypeError: el?.click is not a function".
   * Every press in this file goes through here, so that was navigate and every click tool at
   * once, on any page that draws its own controls.
   *
   * So: call click() when there is one, and otherwise dispatch a real mouse event. Chrome
   * activates a link from an untrusted click as well as a trusted one — the composed and
   * bubbling flags matter because an SVG link lives in its own subtree and a page may listen
   * for it further up.
   *
   * Verified in a real browser rather than jsdom, because the whole question is what a
   * particular kind of element inherits — and jsdom would happily report green for a module
   * that presses nothing at all.
   *
   * @param {Element | undefined} el */
  const press = (el) => {
    if (!el) return;
    const maybe = /** @type {{click?: unknown}} */ (/** @type {unknown} */ (el));
    if (typeof maybe.click === 'function') {
      /** @type {HTMLElement} */ (el).click();
      return;
    }
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window })
    );
  };

  /** @param {Element} el @param {unknown} value */
  const setValue = (el, value) => {
    const field = /** @type {HTMLInputElement} */ (el);
    if (field.type === 'checkbox' || field.type === 'radio') {
      field.checked = Boolean(value);
    } else if (el instanceof HTMLSelectElement) {
      /* A select is chosen by its LABEL, because that is what the model was offered and what a
       * person says out loud.
       *
       * The synthesizer puts the visible text in the schema's enum on purpose — its own comment
       * says it: "the model is reading the page, and 'California' is something it can choose;
       * 'CA-06' is not". Assigning that text to .value, which is what this did, matches only
       * where a page happens to use the same string for both. On every real select it silently
       * kept the old selection: give the benefit finder "January" and the month stayed at
       * "-Select-", which is half of how Anton's form came back with four errors.
       *
       * The label first, then the value as a fallback for a caller that knows the internals.
       * Nothing is guessed: a value matching neither leaves the control alone, and the caller
       * reads back what it now HOLDS. */
      const said = String(value ?? '')
        .trim()
        .toLowerCase();
      const options = Array.from(el.options);
      const hit =
        options.find((option) => (option.textContent || '').trim().toLowerCase() === said) ??
        options.find((option) => option.value.trim().toLowerCase() === said);
      if (hit) el.value = hit.value;
    } else {
      field.value = String(value ?? '');
    }
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /* How long a read-back waits for the control to take the value, and how often it looks.
   *
   * The bound is three times the longest arrival anybody has measured — the month select on
   * usa.gov's live benefit finder showed the written value 400ms after the events, on the same
   * node — and it is only ever paid in full by a value the control genuinely refuses. A write
   * that lands is answered on the look after it lands. */
  const TAKES_WITHIN_MS = 1200;
  const LOOK_AGAIN_MS = 25;

  /** What a control HOLDS, in the words it was asked in.
   *
   * A select answers with the chosen option's LABEL, because "1" means nothing to somebody who
   * said "January" — and a read-back that is not the value asked for is how the caller learns
   * the control would not take it.
   * @param {Element} el */
  const whatItHolds = (el) =>
    el instanceof HTMLSelectElement
      ? (el.selectedOptions[0]?.textContent || '').trim()
      : String(/** @type {HTMLInputElement} */ (el).value ?? '');

  /** Read a field back once the control has TAKEN the value — or answer with what it holds.
   *
   * Measured on the page this went wrong on. Anton's run, 11:28:39: the model filled the month
   * with "07 - July", the answer came back "did not go into month — it holds "-Select-"
   * instead", and "07 - July" was standing on his screen. The TL then did on the live benefit
   * finder exactly what setValue does: right after the assignment and the events the select
   * still read its OLD value, and 400ms later it read the new one — same node, nothing
   * replaced. The value arrives A TICK LATER, and we were reading in the line after the write.
   *
   * The cost of that was not a wasted call: the lie was spoken to somebody who cannot see the
   * form, and he redid work that was already done, twice.
   *
   * So this waits for the VALUE rather than for a guessed number of milliseconds, and it
   * judges arrival with the same FilledIn.tookIt the phone refuses on — so it stops looking at
   * exactly the moment the phone would stop refusing. The bound is what keeps a refusal
   * meaningful: when it runs out, the control really has not taken the value (a select with no
   * such option), and the honest answer is what it holds instead.
   *
   * @param {Element} el @param {unknown} asked @returns {Promise<string>} */
  const asItTakesIt = async (el, asked) => {
    let holds = whatItHolds(el);
    for (
      let waited = 0;
      waited < TAKES_WITHIN_MS && !FilledIn.tookIt(asked, holds);
      waited += LOOK_AGAIN_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, LOOK_AGAIN_MS));
      holds = whatItHolds(el);
    }
    return holds;
  };

  /** A short description of the page, so "did anything happen" is answerable
   *  rather than assumed.
   *
   *  Form state is in here because the first tool ever run through this panel —
   *  Clear Selections on usa.gov — emptied thirteen ticked checkboxes and the
   *  summary said "nothing visible changed": the URL, title and link count had
   *  not moved, and those were all it looked at. A report that misses the thing
   *  the tool was for is worse than no report. */
  const snapshot = () => ({
    url: location.href,
    links: document.links.length,
    title: document.title,
    ticked: document.querySelectorAll('input:checked').length,
    filled: [...document.querySelectorAll('input, textarea, select')].filter(
      (el) => /** @type {HTMLInputElement} */ (el).value !== ''
    ).length,
  });

  /** What the page is complaining about, if anything.
   *
   * Its own announcements, not our reading of them: an element with role=alert or
   * aria-live=assertive is a page saying something, aria-invalid is a page marking the field
   * that is wrong, and "contains 4 errors" is a page counting them. A page that says none of
   * those has not complained, and silence here must not be reported as approval either — the
   * caller pairs this with what it asked for.
   *
   * TWO THINGS THIS MUST NOT DO, both measured on the live benefit finder after a step it
   * ACCEPTED, and both of which it did — and the model then said out loud "it went through,
   * but the page did not accept it" to somebody who could not see that their form had been
   * taken and the wizard had moved on.
   *
   *   1. A counter reading ZERO is the page saying everything is fine. usa.gov's error summary
   *      is in the document ALWAYS — measured: role="alert", class usa-alert--error, text
   *      "Your information contains 0 errors", present before the press and after an accepted
   *      one, with only the number and aria-live changing when something is actually wrong. So
   *      presence is not a complaint and the NUMBER is what speaks. The counting rule itself
   *      is FilledIn's — src/shared/filled-in.js, loaded in this world too — because the phone
   *      judges the very same sentence when it arrives as text in a tool result, and two
   *      copies of a rule about somebody's error summary is one copy too many.
   *
   *   2. A live region is how an accessible page announces ANY change, including success.
   *      Measured: the first "complaint" we collected was the step's own title, out of
   *      div#a11y-titles[aria-live=assertive].usa-sr-only — the site's screen-reader
   *      announcement of where the person now is. Reading that as a failure turns a site's
   *      accessibility into our evidence against it, which on a product for blind people is
   *      the worst possible direction to be wrong in.
   *
   * @returns {string[]}
   */
  const complaints = () => {
    /** @type {string[]} */
    const said = [];
    for (const el of document.querySelectorAll(
      '[role="alert"], [aria-live="assertive"], .usa-alert--error'
    )) {
      if (!(el instanceof HTMLElement) || el.hidden) continue;
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // The page announcing where we are. Its own title, in a live region, is a step
      // announcement — the thing a blind person is there to hear, and never a problem.
      if (document.title && text === document.title.replace(/\s+/g, ' ').trim()) continue;
      // A page counting its problems and arriving at none.
      if (FilledIn.saysNothingIsWrong(text)) continue;
      said.push(text.slice(0, 200));
    }
    const invalid = document.querySelectorAll('[aria-invalid="true"]').length;
    if (invalid > 0) said.push(`${invalid} field(s) marked invalid`);
    const counted = FilledIn.countedErrors(document.body.innerText || '');
    if (counted && !said.some((one) => one.includes(counted))) said.push(counted);
    return said.filter((one, at, all) => all.indexOf(one) === at).slice(0, 4);
  };

  /** @param {ReturnType<typeof snapshot>} before */
  const changedSince = (before) => {
    const after = snapshot();
    const parts = [];
    if (after.url !== before.url) parts.push(`URL is now ${after.url}`);
    if (after.title !== before.title) parts.push(`title is now "${after.title}"`);
    if (after.links !== before.links) parts.push(`link count ${before.links} → ${after.links}`);
    if (after.ticked !== before.ticked)
      parts.push(`ticked controls ${before.ticked} → ${after.ticked}`);
    if (after.filled !== before.filled)
      parts.push(`filled fields ${before.filled} → ${after.filled}`);
    return parts.length > 0 ? parts.join('; ') : 'nothing visible changed';
  };

  /** Read the page out, as something worth saying out loud.
   *
   * The finding is here, where the DOM is; the SHAPING is the product's, and it arrives as
   * an argument rather than being read off a global — how many results a person can hold and
   * how long a page may be are decisions about a listener, not about a page. That split is
   * deliberate and predates this move: the same reason readResults takes its own limit.
   *
   * @param {{results: (read: unknown) => string, shape: (page: object) => string, resultsLimit: number}} say
   * @returns {{text: string, results?: number, of?: number}}
   */
  /* What this page says, for someone who cannot look at it.
   *
   * Where the words are is a judgement the page has usually already made: <main>,
   * or whatever it marked role="main". Falling back to the whole body is right
   * rather than lazy — a page with no landmarks is exactly the page whose author
   * gave a screen reader nothing to work with, and refusing to read it would
   * punish the reader for the page's failing.
   *
   * Headings and link texts go first because they are how a page is skimmed by
   * eye, and skimming is precisely what a person listening cannot do. Ten links,
   * not all of them: this is read ALOUD, and a navigation menu recited in full is
   * how a screen reader becomes something people turn off.
   */
  const readPage = (say) => {
    /* A page of RESULTS is read as results, not as prose.
     *
     * This is the path Anton's run died on: the search worked, the results page opened, and
     * "which place would you recommend?" got silence. What arrives below — innerText of main
     * — is a wall of advertisement, navigation and footer on a real results page, and either
     * the model drowns in it or the cap arrives before the first result does.
     *
     * Two or more, because one repeating block is not a list and reporting it as one would be
     * a confident answer about a page that is something else. Below that, the plain text path
     * is right and it is what runs.
     */
    const found = PageToolsResults.readResults({ limit: say.resultsLimit });
    if (found.results.length >= 2) {
      return { text: say.results(found), results: found.results.length, of: found.found };
    }

    const main = document.querySelector('main, [role="main"]') ?? document.body;
    const headings = [...document.querySelectorAll('h1, h2')]
      .map((h) => h.textContent ?? '')
      .filter((text) => text.trim())
      .slice(0, 12);
    const links = [...main.querySelectorAll('a[href]')]
      .map((a) => a.textContent ?? '')
      .filter((text) => text.trim().length > 1)
      .slice(0, 10);
    return {
      text: say.shape({
        title: document.title,
        url: location.href,
        headings,
        links,
        // innerText rather than textContent: it is what is actually VISIBLE, so a
        // hidden menu or an off-screen cookie banner does not get read out as if
        // it were on the page.
        text: main instanceof HTMLElement ? main.innerText : (main.textContent ?? ''),
      }),
    };
  };

  const api = {
    press,
    setValue,
    whatItHolds,
    asItTakesIt,
    snapshot,
    changedSince,
    complaints,
    readPage,
    version: '0.1.0',
  };

  global.PageToolsHands = api;
  // A CommonJS consumer too, without requiring one.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
