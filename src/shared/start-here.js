/* Opening somewhere real, when nobody else did.
 *
 * The service worker is supposed to do this at startup, and twice it has not:
 * once because it asked about a window that did not exist yet, and once because
 * Chrome's New Tab page turned out to be Google's remote one under an address
 * nothing recognised. Each time the person was left on a page with no content
 * script — no talk key, no tools, nothing to act on — and the phone, which was
 * running and could see all of it, said nothing about it.
 *
 * So the phone carries the same decision itself, as a fallback that does not
 * depend on onStartup firing, on a service worker surviving, or on which of
 * them ran first. Same rule (KnownSites.pickBlankTab: the blank tab in front of
 * somebody, by url AND pendingUrl) with one thing added: it happens ONCE per
 * phone.
 *
 * Once matters. The phone republishes its tools on every tab switch, every page
 * load and after every action, so the condition this reacts to is met over and
 * over — and without a memory it would send somebody back to the start page
 * every time they wandered onto a blank one, which is a browser fighting the
 * person using it. One attempt is a fallback; every attempt is a policy nobody
 * asked for.
 *
 * It needs known-sites.js loaded before it.
 */

const StartHere = {
  create() {
    let already = false;
    return {
      /** Has the fallback been used? */
      get used() {
        return already;
      },

      /** Which tab to send to the start page, if any.
       *
       * Marked used only when it actually names one: a phone that loads while
       * somebody is reading a real page has not spent its one attempt, and is
       * still there for the blank tab that appears later.
       *
       * @param {chrome.tabs.Tab[]} tabs  Every tab, from chrome.tabs.query({}).
       * @returns {chrome.tabs.Tab|null}
       */
      decide(tabs) {
        if (already) return null;
        const blank = KnownSites.pickBlankTab(tabs);
        if (!blank) return null;
        already = true;
        return blank;
      },
    };
  },
};
