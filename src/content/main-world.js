/* The MAIN world: the same page, in the page's own JavaScript context.
 *
 * It exists because one thing lives here and can be reached from nowhere else — a site's own
 * `document.modelContext`, the tools a page DECLARES for an agent rather than the ones we read
 * off its markup. The ISOLATED world cannot see it: that is what world isolation is for.
 *
 * NOTHING HERE READS IT, AND NOTHING ANYWHERE ELSE DOES EITHER. That sentence is the whole
 * point of this paragraph, because the one it replaced said this file was "wired" and left a
 * reader — including the person who wrote it — believing the declared path existed and was
 * merely quiet. It does not exist: this file has an empty listener, isolated.js never asks the
 * MAIN world anything, no scan carries a `declared` field, and the phone publishes only the
 * tools the synthesizer reads off the markup.
 *
 * One half IS real and is worth knowing about: gating.js treats a tool with source 'declared'
 * as something that must be put to the person out loud, and that rule has a test. Nothing
 * produces such a tool yet, so the rule has never fired in a live session.
 *
 * The file is here for the SHAPE rather than for what it does: adding a MAIN-world script at
 * document_start to a manifest that is already loading pages is much easier to get wrong later
 * than to have in place from the start.
 *
 * IT RUNS IN THE TOP FRAME ONLY, while the ISOLATED half runs in every frame. The asymmetry
 * is deliberate and it is two separate decisions. What lives here is `document.modelContext`,
 * which a SITE declares for its page — an advert in an iframe declaring tools is not the page
 * offering them, and acting on one would be acting on a third party's markup. The ISOLATED
 * half runs everywhere because the talk key has to work wherever the person's focus happens
 * to be, which is a per-frame fact. If something is ever added here that genuinely belongs in
 * subframes, that is the moment to change the flag, and this is the line to change with it.
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
