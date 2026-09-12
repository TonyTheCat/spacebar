/* Turning something a person SAID into somewhere to go.
 *
 * The phone could only follow links that were already on the page, which means
 * it could not start anything at all. "Open duck duck go" reached nothing — and
 * for somebody who cannot see the address bar, a browser you cannot point
 * anywhere is a browser you cannot use.
 *
 * This is deliberately small and deliberately literal, and it is NOT a guesser.
 * A name it knows becomes an address; something already shaped like an address
 * becomes that address; and nothing here ever invents a hostname. Guessing is
 * worse than failing here, because the person cannot see where they landed, so
 * a wrong guess is a page they have no way to identify.
 *
 * What it does instead of a dead end: an unknown NAME becomes a SEARCH for that
 * name. "Open the social security office" used to reach "I do not know a site
 * called that" and stop, while inventing socialsecurityoffice.com would have
 * landed them somewhere unidentifiable. A search does neither — the results
 * page is ABOUT what they said, it says so in its own title, and the answer
 * tells them it is a search rather than the site.
 *
 * Only for words, though. Something already shaped like an address with a
 * scheme this will not follow stays refused: "open file colon slash slash…" is
 * a request to be told no, and quietly searching for the text of it would hide
 * what was refused.
 */

/** The handful of places the demo actually names. The aliases are what a person
 *  SAYS, including what speech recognition does to it: "duck duck go" comes
 *  back as three words far more often than as one. */
const KNOWN_SITES = [
  { url: 'https://duckduckgo.com', names: ['duckduckgo', 'duck duck go', 'ddg', 'duck-duck-go'] },
  { url: 'https://www.google.com', names: ['google', 'google.com'] },
  {
    url: 'https://www.usa.gov/benefit-finder',
    names: [
      'benefit finder',
      'usa.gov benefit finder',
      'usa gov benefit finder',
      'the benefit finder',
    ],
  },
  { url: 'https://www.usa.gov', names: ['usa.gov', 'usa gov', 'usa'] },
  { url: 'https://en.wikipedia.org', names: ['wikipedia'] },
];

/* Every address that means "this tab is showing nothing".
 *
 * A list rather than one regular expression, because each entry is a separate
 * fact about the browser and the next one somebody finds should be a line here
 * with its own reason:
 *   - chrome://newtab and chrome://new-tab-page — Chrome's own, and what the
 *     address bar shows even when the tab is somewhere else;
 *   - about:blank — a tab opened with nothing in it;
 *   - chrome-search:// — the local New Tab surface and its parts;
 *   - Google's REMOTE New Tab page, which is what branded Chrome with Google as
 *     its search engine actually loads. The path is the distinctive part:
 *     nobody browses to /_/chrome/newtab.
 *
 * That last one names Google's own domain and nothing that merely contains the
 * word. Written with a loose suffix it eats whole domains — google.evil.com
 * would match, so a page anybody could put up would read as Chrome's New Tab
 * surface. So the suffix is one label, or two for a country domain
 * (google.com, google.co.uk), and a label is at most three characters: every
 * Google suffix is, and "evil" is not.
 */
const NOTHING_IN_PARTICULAR = [
  /^chrome:\/\/newtab/,
  /^chrome:\/\/new-tab-page/,
  /^about:blank/,
  /^chrome-search:\/\//,
  /^https?:\/\/([a-z0-9-]+\.)*google\.[a-z]{2,3}(\.[a-z]{2,3})?\/_\/chrome\/newtab/,
];

/** Where an unknown name is searched for.
 *
 * DuckDuckGo, measured rather than preferred: of the four engines the recon
 * looked at, it is the only one whose results come back as clean titles with
 * the REAL destination in the href — Google and Bing hand out redirect links
 * and mangled labels, and Google serves this machine a Spanish page. It also
 * answers in English wherever the browser happens to be. A results page nobody
 * can read is the same dead end with extra steps.
 */
const SEARCH_AT = 'https://duckduckgo.com/?q=';

const KnownSites = {
  SEARCH_AT,

  /**
   * @param {string} said  A name or an address, as spoken or as typed.
   * @returns {string|null}  Where to go, or null if we do not know and will not
   *   guess.
   */
  resolve(said) {
    const heard = String(said ?? '')
      .trim()
      .toLowerCase()
      // Speech writes an address out in words. "usa dot gov" is the same
      // request as "usa.gov", and refusing it would be pedantry aimed at the
      // one person who cannot type it instead.
      .replace(/\s+dot\s+/g, '.')
      // A sentence's full stop is not part of a hostname.
      .replace(/[.,!?;]+$/, '')
      .trim();
    if (!heard) return null;

    const known = KNOWN_SITES.find((site) => site.names.includes(heard));
    if (known) return known.url;

    // Already an address. http and https only: any other scheme can run code or
    // read a file, and no spoken request should ever produce one.
    if (/^[a-z][a-z0-9+.-]*:/.test(heard)) {
      return /^https?:\/\/[^\s]+$/.test(heard) ? heard : null;
    }

    // Shaped like a host: something.something, no spaces. A single word with no
    // dot is a name we do not know rather than a host — "settings" is not
    // settings.com.
    const host = heard.replace(/^\/+/, '');
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/.test(host)) return `https://${host}`;

    return null;
  },

  /** A search for what they said, when it is not a place we can reach.
   *
   * The last step before a dead end, and deliberately narrower than "anything
   * resolve() refused":
   *
   *   - nothing to search for is still nothing. An empty request is not a
   *     search for "".
   *   - a SCHEME we will not follow stays refused. "javascript:…" and "file:…"
   *     are requests to be told no, and searching for the text of one hides the
   *     refusal behind a page of results — the person would never learn that
   *     what they asked for was not done.
   *
   * Everything else is words, and words are what a search engine is for.
   *
   * @param {string} said  What they said, as spoken.
   * @returns {string|null}  Where to search, or null when there is nothing to
   *   search for.
   */
  searchFor(said) {
    const heard = String(said ?? '').trim();
    if (!heard) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(heard)) return null;
    return `${SEARCH_AT}${encodeURIComponent(heard)}`;
  },

  /** Is this tab showing nothing in particular?
   *
   * A new tab page, a blank page, or a tab so new it has no url yet. These are
   * the only tabs worth taking over at startup: anything else is a page
   * somebody was already on — usually because Chrome restored their session —
   * and replacing it, or opening a second copy of the start page beside it, is
   * the browser deciding it knows better.
   *
   * "A new tab page" is more than one address, and knowing only the obvious one
   * is why the start page never opened at all. In branded Chrome with Google as
   * the search engine the New Tab page is Google's REMOTE one: the address bar
   * says chrome://newtab, the tab's url is
   * https://www.google.com/_/chrome/newtab?…, and chrome://newtab appears only
   * in pendingUrl for the moment before it commits. Matching the obvious
   * address alone read that tab as a page somebody was already on, so the
   * person was left on exactly the dead end this exists to fix.
   *
   * @param {string} [url]
   */
  isBlankPage(url) {
    if (!url) return true;
    return NOTHING_IN_PARTICULAR.some((shape) => shape.test(url));
  },

  /** Which tab, out of every tab in the browser, is the blank one in front of
   *  somebody — or nothing, if they are already somewhere.
   *
   * The caller is the service worker at startup, and it has to look at ALL the
   * tabs rather than the current window's. Measured on a restart: a startup
   * handler asking for `{ active: true, currentWindow: true }` gets an empty
   * list, because the window does not exist yet at the moment the extension
   * wakes. So it asked the wrong question and quietly did nothing, and a blind
   * person was left on the New Tab page with no content script, no talk key,
   * and nothing to say why.
   *
   * `active` is what makes this the tab in front of somebody. It also keeps the
   * phone out of it — the phone opens itself with `active: false` — and a
   * background tab finishing a restore is not somewhere anybody is looking.
   *
   * A tab is blank only when BOTH its url and its pendingUrl are: a tab being
   * restored carries where it is going in `pendingUrl` and an EMPTY url, so
   * reading the url alone says "blank" about a page somebody was reading
   * yesterday, and taking it over throws away where they were.
   *
   * @param {chrome.tabs.Tab[]} tabs  Every tab, from chrome.tabs.query({}).
   * @returns {chrome.tabs.Tab|null}
   */
  pickBlankTab(tabs) {
    return (
      (Array.isArray(tabs) ? tabs : []).find(
        (tab) =>
          tab.active &&
          tab.id !== undefined &&
          KnownSites.isBlankPage(tab.url) &&
          KnownSites.isBlankPage(tab.pendingUrl)
      ) ?? null
    );
  },

  /** Where the browser opens.
   *
   * A new tab page is a dead end for this product: no content script lives
   * there, so the talk key does nothing and the phone is a background tab. A
   * blind person opens the browser and speaks into nothing at all, and the
   * whole flow stops before it starts. So the browser opens somewhere real.
   *
   * Google by default, because the first thing asked of this was "search in
   * Google". A helper can set something else on the settings page, in the same
   * words open_site understands.
   *
   * Never returns nothing: a start page that failed to resolve would put the
   * person back on the dead end this exists to prevent.
   *
   * @param {string} [saved]  Whatever the settings page has, if anything.
   * @returns {string}
   */
  startPage(saved) {
    return KnownSites.resolve(saved ?? '') ?? 'https://www.google.com';
  },

  /** What we can offer when we do not know a name — said out loud, so it has to
   *  be short enough to listen to. */
  names() {
    return KNOWN_SITES.map((site) => site.names[0]);
  },
};
