/* The MAIN world: the same page, in the page's own JavaScript context.
 *
 * It exists because one thing lives here and can be reached from nowhere else — a site's own
 * `document.modelContext`, the tools a page DECLARES for an agent rather than the ones we read
 * off its markup. The ISOLATED world cannot see it: that is what world isolation is for.
 *
 * Today it answers nothing. It is wired from the first commit anyway, and deliberately: the
 * pair of worlds is the shape of this content layer, and adding the second one later means
 * adding a script at document_start to a manifest that is already loading pages — a change
 * that is much easier to get wrong than to have made at the beginning.
 *
 * Two rules hold for anything that is added here, and they are the reason this file is not
 * just an empty listener with no comment. Every message is stamped with PT.CHANNEL, and every
 * handler checks `event.source === window` — window.postMessage is delivered to the page, so
 * without both of those we would be listening to a page that can imitate our own extension.
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.channel !== PT.CHANNEL) return;
  // Nothing declares tools to us yet. When it does, PT.DECLARED_REQUEST is answered here.
});
