/* The one place that says what the halves of Spacebar say to each other.
 *
 * Four things talk here: the service worker, the ISOLATED content script (the only half that
 * can reach chrome.*), the MAIN-world content script (the only half that can see a site's own
 * document.modelContext), and the phone tab that holds the voice session. None of them can
 * import anything — content scripts are classic scripts, not modules — so this file declares
 * globals and every consumer loads it first. The service worker is not a page and cannot use
 * a script tag for it, so it pulls it in with importScripts.
 *
 * Message NAMES are the whole contract. Keep them here, in one list, so that a rename is one
 * edit rather than a grep across four surfaces that fails silently in three of them.
 */

/**
 * What a tool takes, in plain JSON Schema and nothing else. No x-* extensions: the live
 * elements a tool acts on stay in the synthesizer's own registry, keyed by tool name, and
 * never travel inside a schema a model is shown.
 *
 * Two of these properties are the gate's, not the model's. `format: 'password'` and
 * `writeOnly: true` are the same fact said two ways — this value goes in and does not come
 * back out — and either one silences a value when the question is read out loud. A password
 * is NAMED at the gate and never spoken.
 *
 * @typedef {object} JsonSchema
 * @property {string} [type]
 * @property {Record<string, JsonSchema & {description?: string}>} [properties]
 * @property {string[]} [required]
 * @property {string} [description]
 * @property {string} [format]
 * @property {boolean} [writeOnly]
 *
 * @typedef {'submit'|'search'|'set'|'click'|'navigate'|'done'|'declared'} ToolKind
 *
 * @typedef {object} Tool
 * @property {string} name
 * @property {string} description
 * @property {JsonSchema} inputSchema
 * @property {ToolKind} kind
 * @property {boolean} gated        True = a person must be asked, out loud, before it fires.
 * @property {'declared'|'synthesized'} source
 *
 * @typedef {object} Scan
 * @property {string} url
 * @property {string} title
 * @property {Tool[]} [synthesized]
 * @property {boolean} readable     FALSE means we could not look. An empty tool list means the
 *                                  page has none. The two are identical in an empty array and
 *                                  mean opposite things: told apart, the agent says it lost the
 *                                  page; run together, it tells somebody who cannot see the
 *                                  screen that the thing they just asked for does not exist.
 * @property {string} [error]       Why we could not look, in words.
 * @property {object} [stats]       What the synthesizer counted on the way, for the log.
 * @property {number} [at]          Date.now() of the scan.
 */

/**
 * What the ISOLATED content script answers a PT.READ_REQUEST with.
 *
 * One object serves both halves of reading a page, which is why it is written down here rather
 * than left to each end: `results` is a page OF RESULTS read as a repeating block, and the rest
 * is the page in labelled parts. The phone offers the results when there are any and the shape
 * when there are not, and `Readable.results` and `Readable.shape` take exactly these fields.
 *
 * @typedef {object} ReadResult
 * @property {string} [title]
 * @property {string} [url]
 * @property {string[]} [headings]
 * @property {string[]} [links]
 * @property {string} [text]
 * @property {Array<{title: string, extra?: string[]}>} [results]  A page of results, in order.
 * @property {boolean} [more]      There were more than were read.
 * @property {string} [error]      Why there is nothing, in words.
 */

/**
 * What the ISOLATED content script answers a PT.EXECUTE_REQUEST or PT.FILL_REQUEST with.
 *
 * `ok` is whether the press HAPPENED. `problems` is what the PAGE said about it afterwards, in
 * the page's own words — pressed and accepted are different facts, and a form is exactly where
 * they differ. Without the second the phone can only report its own press, which is how
 * somebody hears "submitted" about a form the page refused.
 *
 * @typedef {object} ExecResult
 * @property {boolean} ok
 * @property {string} text          What changed on the page, in words.
 * @property {boolean} [done]
 * @property {string[]} [problems]  The page's own complaints, if it made any.
 */

// eslint-disable-next-line no-unused-vars
const PT = {
  /** Stamped on every window.postMessage between the MAIN and ISOLATED worlds. Both ends also
   *  check event.source === window: anything else is another frame's traffic, or a page
   *  imitating us. */
  CHANNEL: 'spacebar/v1',

  /** service worker or phone -> ISOLATED content script, and the answer back. */
  SCAN_REQUEST: 'scan-request',
  SCAN_RESULT: 'scan-result',

  /** phone -> ISOLATED content script: run one tool the synthesizer offered. */
  EXECUTE_REQUEST: 'execute-request',
  EXECUTE_RESULT: 'execute-result',

  /** The gate. A request carries the id of whoever asked, and the answer carries it back.
   *
   *  chrome.runtime.sendMessage reaches EVERY listener in the extension and the sender is
   *  handed the FIRST answer any of them sends. So an executor stamps its own id on the
   *  request, the content script echoes it, and a listener answers only what it asked for.
   *  An unclaimed request is answered by nobody, which is read as no — the safe direction. */
  CONFIRM_REQUEST: 'confirm-request',
  CONFIRM_RESPONSE: 'confirm-response',

  /** phone -> ISOLATED content script: put ONE value in ONE field, committing nothing.
   *
   *  A form inside a submit tool has no tools of its own — the synthesizer claims its fields —
   *  so the only thing on offer is "fill it all in and send it". For a voice on a wizard with
   *  required fields that is the wrong shape: the model fills what it has, leaves the rest at
   *  a placeholder, and the page answers with errors while the person hears "submitted". One
   *  value at a time, and the submit stays gated. */
  FILL_REQUEST: 'fill-request',

  /** phone -> ISOLATED content script: what does this page say now?
   *
   *  Acting and looking are separate powers. An agent that can press and cannot read reports
   *  what it did and can tell nobody what appeared, and a search whose results cannot be read
   *  back is not a search. */
  READ_REQUEST: 'read-request',

  /** phone -> ISOLATED content script: say this out loud, from the PAGE.
   *
   *  It has to be the page that speaks. A screen reader follows the document the person is in,
   *  and the phone is a different one. */
  SPEAK: 'speak',

  /** ISOLATED content script -> phone: the space bar went down, and came back up.
   *
   *  Push to talk has to live on the PAGE. Somebody who cannot see the screen is on the site,
   *  not on our tab, and a key handler that only works while the phone has focus reaches them
   *  never — which is the same as the product not working. */
  TALK_START: 'talk-start',
  /** Carries `why`. A release is the person ending their turn; losing sight of the key —
   *  focus moved, tab hidden, the page navigated under them — is a guess made on their
   *  behalf, and the two must not be recorded as the same event. */
  TALK_STOP: 'talk-stop',

  /** ISOLATED content script -> phone: I cannot read the talk flag, so the space bar is not
   *  mine to take.
   *
   *  Session storage is trusted-contexts-only until something raises the access level. A
   *  content script that cannot read it has no way to know a voice session exists, correctly
   *  leaves the key to the page, and the person's talk key then does nothing with nothing to
   *  say why. Reported rather than swallowed, so it lands in the phone's log where a sighted
   *  helper is already looking. */
  NO_TALK_FLAG: 'no-talk-flag',

  /** Anything worth a line in the phone's own diary. */
  STEP: 'step',

  /** ISOLATED <-> MAIN, over window.postMessage: the tools the SITE declares for itself. */
  DECLARED_REQUEST: 'declared-request',
  DECLARED_RESULT: 'declared-result',

  /** How long the ISOLATED world waits for the MAIN world before deciding the page declares
   *  nothing. The MAIN script answers synchronously in practice; this only bounds the case
   *  where it never loaded at all. */
  MAIN_WORLD_TIMEOUT_MS: 1500,

  /** Where a scan is left for anyone who wants to read it. chrome.storage.local, one key. */
  LAST_SCAN_KEY: 'lastScan',
};
