/* The background half. It has no DOM and no page; it watches tabs and asks them what they are.
 *
 * Not a module: a service worker in MV3 is a classic worker unless the manifest says
 * otherwise, so the shared message names come in by importScripts rather than by import. And
 * a classic worker rejects top-level await with a SyntaxError, at which point the worker never
 * starts and Chrome shows an extension with no background at all — which is why everything
 * below that waits for something lives inside a function.
 */
/* Absolute from the extension root, not relative to this file. importScripts resolves
 * against the WORKER'S location — src/background/ — so a relative path here would have to
 * climb out of a directory, and it would have to be re-checked every time this file moved.
 * The manifest's own paths are root-relative for the same reason; the leading slash is what
 * says "root" to importScripts. */
importScripts('/src/shared/protocol.js');

/** How long ONE ask may hang before we call it nothing. */
const ONE_ASK_MS = 1200;
/** How long to wait before asking the document that is actually there. */
const A_BREATH_MS = 500;

const after = (ms) => new Promise((done) => setTimeout(done, ms));

/** Ask a tab, and give up on it rather than wait forever.
 *
 * Two different failures are both handled here and only one of them is a rejection. A tab with
 * no content script rejects with "Could not establish connection" — that is the catch. But a
 * message delivered to a document that is being replaced can leave a promise that NEVER
 * SETTLES, which no try/catch can reach; that is the race with a timeout. Without the second
 * one, a navigation at the wrong moment hangs the scan for good.
 *
 * @param {number} tabId @param {object} message @returns {Promise<object|null>} */
const askThePage = async (tabId, message) =>
  Promise.race([
    chrome.tabs.sendMessage(tabId, message).catch(() => null),
    after(ONE_ASK_MS).then(() => null),
  ]);

/** What can be done on this tab? Asked twice, because once is measurably not enough.
 *
 * tabs.onUpdated fires `complete` while the content script of the NEW document may not be
 * listening yet. The first ask then fails exactly the way a page with no tools looks. Asked
 * again a breath later, the same page answers — measured on the live usa.gov benefit finder,
 * which returned nothing on the first ask and three tools on the second.
 *
 * One retry, not a loop. If a page is not answering a moment after it finished loading, the
 * honest answer is that we could not read it, and saying so is worth more than a longer wait.
 *
 * @param {number} tabId @returns {Promise<object>} a Scan */
const scanTab = async (tabId) => {
  let scan = await askThePage(tabId, { type: PT.SCAN_REQUEST });

  /* An answer that is not an object is treated as no answer. A tab with no content script does
   * not always reject: on an extension page, or a chrome:// URL, sendMessage resolves with
   * undefined instead. */
  if (!scan || typeof scan !== 'object') {
    await after(A_BREATH_MS);
    scan = await askThePage(tabId, { type: PT.SCAN_REQUEST });
  }

  if (!scan || typeof scan !== 'object') {
    /* We could not look. NOT "the page has none" — the two are the same empty list and mean
     * opposite things, and this is the one place where the difference is still known. */
    scan = { readable: false, error: 'the page did not answer twice', at: Date.now() };
  }

  console.log(
    'scan',
    scan.url || `tab ${tabId}`,
    scan.readable ? `${(scan.synthesized || []).length} tools` : scan.error
  );
  await chrome.storage.local.set({ [PT.LAST_SCAN_KEY]: scan });
  return scan;
};

/* The phone opens itself, and there is only ever one.
 *
 * The person this is built for should not have to find a tab, remember a chord, or know that
 * an extension exists. The browser starts and the line is already there. It is opened PINNED,
 * so it keeps its place at the left of the strip all day and is not mistaken for a page, and
 * it is opened in the background so it does not take the screen away from wherever they were.
 *
 * BOTH events, and the second is not redundant. Under --load-extension, onStartup never fires
 * at all: every launch is treated as a fresh install, so only onInstalled runs. The honest
 * consequence is that a bench started that way will show this tab appearing and will be
 * showing it for the wrong reason — the real startup path is only exercised by Load unpacked
 * into a profile that survives a restart.
 */
const PHONE = 'src/phone/index.html';

const openThePhone = async () => {
  const url = chrome.runtime.getURL(PHONE);

  /* One phone, however the browser came back.
   *
   * Chrome restores the last session, so yesterday's phone can already be on screen when this
   * runs — and a second one means a second microphone held against the same person. Asking
   * tabs.query({ url }) is not enough: a tab still being restored has not committed its url
   * and carries it in pendingUrl instead, so the query misses it and opens a duplicate at
   * exactly the moment a session is being restored, which is every launch. Both are checked.
   */
  const tabs = await chrome.tabs.query({});
  if (tabs.some((tab) => tab.url === url || tab.pendingUrl === url)) return;
  await chrome.tabs.create({ url, pinned: true, active: false });
};

chrome.runtime.onStartup.addListener(() => void openThePhone());
chrome.runtime.onInstalled.addListener(() => void openThePhone());

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') void scanTab(tabId);
});

/* The toolbar button rescans the tab in front of you. Until the phone exists this is the only
 * way to ask a page that finished loading before the extension did. */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void scanTab(tab.id);
});
