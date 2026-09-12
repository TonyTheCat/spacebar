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

/** One run at a time, however many things ask at once.
 *
 * The reviewer found this the moment the top-level call was added: on a real install BOTH the
 * top level and onInstalled call this, and each begins by asking tabs.query. Two questions can
 * be in the air before either answer comes back, both find no phone, and both create one — two
 * phones, two sessions, and two microphones held against one person, which is the exact harm
 * the dedup below exists to prevent.
 *
 * A shared promise closes it: whoever is second joins the run already going rather than
 * starting a second. Cleared when it finishes, so a later ask — a browser start, a reload —
 * still does its own work. */
let opening = null;

/**
 * @param {{ reviveStale: boolean }} how
 */
const openThePhone = (how) => {
  /* Whoever is second joins the run already going — and if THEY asked to revive, the run
   * revives. A caller that only wanted "make sure one exists" must never silence a caller that
   * knows the existing one is dead: joining the weaker run would be the strongest reason to
   * reload quietly losing to the fact that something else asked first.
   *
   * The cleanup is attached to whatever the chain is NOW, every time, and that is the
   * reviewer's second find. Hung on the first run alone, it fires when THAT run settles —
   * which is before a joined revive has even started — so the shared promise would be thrown
   * away in the middle of the work it was protecting. It did not bite today only because
   * three call sites never overlap three deep, and a guarantee that holds by counting call
   * sites is not a guarantee. It is compared before clearing, so a later, unrelated run is
   * never cleared by an older one finishing. */
  const chain = opening
    ? how.reviveStale
      ? opening.then(() => theOnlyOpening(how))
      : opening
    : theOnlyOpening(how);

  const mine = chain.finally(() => {
    // Compared against the promise THIS call published, not against the chain inside it: the
    // published one is the wrapper, and comparing the wrong one never matches, which would
    // leave `opening` set forever and stop the phone ever being opened again. Found by
    // reading this back after writing it.
    if (opening === mine) opening = null;
  });
  opening = mine;
  return opening;
};

const theOnlyOpening = async ({ reviveStale }) => {
  const url = chrome.runtime.getURL(PHONE);

  /* One phone, however the browser came back.
   *
   * Chrome restores the last session, so yesterday's phone can already be on screen when this
   * runs — and a second one means a second microphone held against the same person. Asking
   * tabs.query({ url }) is not enough: a tab still being restored has not committed its url
   * and carries it in pendingUrl instead, so the query misses it and opens a duplicate at
   * exactly the moment a session is being restored, which is every launch. Both are checked.
   *
   * The url is compared WHOLE, extension id and all, rather than by its path. Another
   * extension's phone — last night's build, still in the profile — carries the same path under
   * a different id, and counting that as ours means never opening one of our own.
   */
  const tabs = await chrome.tabs.query({});
  const already = tabs.find((tab) => tab.url === url || tab.pendingUrl === url);

  if (!already) {
    await chrome.tabs.create({ url, pinned: true, active: false });
    return;
  }

  /* A tab at our own address is not the same thing as a phone that works.
   *
   * An unpacked extension keeps its id across a reload — the id comes from the folder — so
   * after Load unpacked → Reload, the OLD tab is still there with exactly our url, and it is
   * dead: its scripts belong to an extension context that no longer exists. Trusted, it means
   * the service worker starts, finds "a phone", opens nothing, and the browser sits there with
   * a broken page pinned and no voice at all. Measured on a real restart, not imagined.
   *
   * So on an install, an update or a reload, an existing tab is REVIVED rather than believed.
   * On a browser start it is left alone: a restored tab loads its scripts fresh against the
   * extension that is starting with it, and reloading it would throw away a session that is
   * coming up anyway.
   */
  if (!reviveStale || already.id === undefined) return;
  await chrome.tabs.reload(already.id).catch(() => chrome.tabs.create({ url, pinned: true, active: false }));
};

/* NOT revived on a browser start, and that stayed this way on purpose after an hour of being
 * told otherwise.
 *
 * The report was that a restored phone comes back as a corpse — a tab at our own address with
 * a dead extension context — and that this path therefore had to reload it. I had already
 * written the change when its own author said they could not reproduce the red in any of three
 * configurations: clean install, second launch on the same profile, and an unclean kill with a
 * restart. No corpse in any of them.
 *
 * So it is back to what it was. A restored tab loads its scripts against the extension
 * starting with it, and reloading one on every browser start would throw away a session that
 * is coming up anyway — a real cost, paid for a failure nobody has been able to show. If a red
 * turns up, this is the line, and reviveStale is already the argument it takes. */
chrome.runtime.onStartup.addListener(() => void openThePhone({ reviveStale: false }));
chrome.runtime.onInstalled.addListener(() => void openThePhone({ reviveStale: true }));

/* AND AT THE TOP LEVEL, because neither of those two fires on the path that matters.
 *
 * Measured, on a copy of the real demo profile with the extension loaded from the folder the
 * recorder uses: the service worker starts, and no phone opens at all. onStartup never fires
 * under --load-extension — every launch is treated as an install, which is the note already
 * written above it — and onInstalled does not fire either, because in THAT profile the
 * extension is already registered from earlier runs. Two handlers, neither of them reached,
 * and a browser with a dead pinned page and no voice. It is why every real take of the film
 * died: the phone was never there to report its tools.
 *
 * The worker itself does wake on load, whatever event did or did not fire, so this is the one
 * place that always runs.
 *
 * NOT reviveStale HERE, and that is the whole care of this change. A service worker restarts
 * on any event after it has been idle, and top-level code runs again on every one of those
 * restarts — so reviving from here would RELOAD the phone in the middle of a live voice
 * session, dropping the line somebody was talking to. The dedup below already stops a second
 * phone; what this adds is the first one. Reviving a dead phone stays on onInstalled, which
 * happens once, when the extension is actually (re)loaded.
 */
void openThePhone({ reviveStale: false });

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') void scanTab(tabId);
});

/* The toolbar button rescans the tab in front of you. Until the phone exists this is the only
 * way to ask a page that finished loading before the extension did. */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void scanTab(tab.id);
});
