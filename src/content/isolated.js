/* The relay. It runs in every page, in the ISOLATED world, and it is the only half of this
 * extension that can reach chrome.* and the page's DOM at the same time.
 *
 * What it does today is one thing: answer "what can be done on this page?" by handing the
 * synthesizer the live document. The tools come back as live element references held in the
 * synthesizer's own registry — only their names and schemas cross the wire, because a model
 * is shown a description of a control, never a handle on one.
 *
 * The scripts it needs are loaded before it by the manifest, in this order:
 *   vendor/synthesize.js -> vendor/read-results.js -> vendor/filled-in.js ->
 *   vendor/drive-the-page.js -> src/shared/protocol.js -> this file
 * They are classic scripts sharing one global scope and there is no import to fix a wrong
 * order up, which is why scripts/check-manifest.mjs refuses one on every commit.
 */

/* A subframe answers nothing.
 *
 * chrome.tabs.sendMessage delivers to EVERY frame at once and the sender is given the first
 * answer anybody sends. An advert in an iframe is a document with a form in it, so a subframe
 * that answers a scan does not merely add noise: it sometimes wins, and the agent then
 * describes the advert as if it were the page. The content script still runs in subframes —
 * the talk key has to work wherever the person's focus happens to be — but only the top frame
 * speaks for the page.
 */
const isTopFrame = window.top === window;

/** Everything this page offers, read off the live DOM.
 *
 * `readable` is the flag that carries the difference between the two ways a tool list can be
 * empty. FALSE means we could not look — the synthesizer threw, or this document is one we
 * cannot read. An empty list with `readable: true` means we looked and the page has nothing.
 * Run together they are the same empty array and they mean opposite things, and the person on
 * the other end cannot see the screen to tell which it was.
 *
 * @returns {object} a Scan, as described in src/shared/protocol.js */
const scanThisPage = () => {
  try {
    const { tools, stats } = PageToolsSynth.synthesizeTools();
    return {
      url: location.href,
      title: document.title,
      synthesized: tools,
      stats,
      readable: true,
      at: Date.now(),
    };
  } catch (error) {
    return {
      url: location.href,
      title: document.title,
      synthesized: [],
      readable: false,
      error: `scanning this page threw: ${String(error).slice(0, 200)}`,
      at: Date.now(),
    };
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isTopFrame) return false;
  if (message?.type !== PT.SCAN_REQUEST) return false;

  /* Answered whatever happens, and that is the point of the try inside scanThisPage.
   *
   * A throw here does not stay here: the listener dies, the port closes with no response, and
   * the caller's sendMessage rejects. The caller cannot tell that apart from a page with
   * nothing to say — so the failure is ANSWERED, with its reason, rather than dropped. */
  sendResponse(scanThisPage());
  return false; // answered synchronously; nothing to keep the channel open for
});
