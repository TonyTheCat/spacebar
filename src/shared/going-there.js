/* Putting a real page in front of somebody, so that the page can hear them.
 *
 * Navigating Chrome's New Tab page in place looks like the tidiest way to do
 * it — no extra tab appears, nothing for somebody who cannot see the tab strip
 * to close — and it leaves the KEYBOARD in the address bar. Measured, in a
 * screenshot: google.com loaded, the omnibox still focused with its text
 * selected, and the space bar going to the address bar rather than to the page.
 * The talk key is the whole product, and on that tab it was dead.
 *
 * The New Tab page focuses the address bar on purpose, and a page cannot take
 * focus back from browser chrome: nothing a content script can call — not
 * window.focus(), not body.focus(), not a synthetic click — reaches the
 * omnibox, because it is not in the document. What DOES put the keyboard in the
 * page is opening a tab that has a real URL from the start.
 *
 * So a blank tab is REPLACED rather than navigated: a new tab is opened at the
 * address and the blank one is closed behind it. The person is left with the
 * same number of tabs, which was the point of navigating in place, and with a
 * keyboard that reaches the page, which is the point of everything else.
 *
 * A tab somebody is actually on is navigated, as before: closing that would
 * throw away where they were, and its keyboard is already in the page.
 *
 * It needs known-sites.js loaded before it.
 */

const GoingThere = {
  /** How to put a page in front of the person, given the tab we would use.
   *
   * @param {{id?: number, url?: string, pendingUrl?: string}|null|undefined} tab
   * @returns {GoingThereHow}
   */
  how(tab) {
    if (!tab || tab.id === undefined) return 'open a tab';
    // Blank by BOTH addresses, the same rule pickBlankTab uses: a tab restoring
    // a real page carries it in pendingUrl with an empty url, and that is
    // somebody's page rather than a blank one.
    const blank = KnownSites.isBlankPage(tab.url) && KnownSites.isBlankPage(tab.pendingUrl);
    return blank ? 'replace the blank tab' : 'navigate this tab';
  },
};
