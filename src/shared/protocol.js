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
 * What a SITE declares about itself, read from `document.modelContext` in the page's own world.
 *
 * MEASURED against the real API in Chrome for Testing with --enable-features=WebMCP, because
 * two of these are traps that a reasonable implementation walks into:
 *
 *   getTools() answers objects carrying name, description, title, origin, window — and
 *   `inputSchema` AS A JSON STRING. Passed on unparsed it is not a schema at all: `properties`
 *   is undefined, and the gate's rule that an argument no schema describes is never spoken out
 *   loud would then hide ordinary values from the person while reading back nothing useful.
 *   So it is parsed here, once, and travels as an object like every other schema.
 *
 *   executeTool takes the TOOL OBJECT itself rather than a name, and its arguments as a JSON
 *   STRING. An object or undefined both answer "Failed to parse input arguments".
 *
 * `available` is the platform question — is there a modelContext at all — and it is kept apart
 * from an empty list for the reason the whole product keeps them apart: a browser without the
 * flag and a page that declares nothing are the same empty array and mean opposite things.
 *
 * @typedef {object} DeclaredReport
 * @property {boolean} available          Is the WebMCP API present in this browser at all?
 * @property {'document'|'navigator'|null} where  Which object carried it.
 * @property {Tool[]} tools               Always source 'declared', which makes them gated.
 * @property {string} [reason]            Why there is nothing, in words for a log.
 */

/**
 * What the ISOLATED content script answers a PT.READ_REQUEST with.
 *
 * ALREADY SHAPED, and that is the decision this typedef exists to record. Choosing between
 * reading a page as a list of results and reading it as prose needs the DOM in front of you —
 * it is two or more repeating blocks or it is not — so the content script makes it, handing
 * the hands brick our own Readable.results and Readable.shape as its two ways of saying it.
 * The phone receives a sentence, not parts to assemble. Shaping it again at this end would be
 * one half guessing at a decision the other half already made with the evidence.
 *
 * @typedef {object} ReadResult
 * @property {string} text        The page, in words, ready to be said.
 * @property {number} [results]   How many results were read, when it was a page of results.
 * @property {number} [of]        How many the page has, when there were more than were read.
 * @property {string} [error]     Why there is nothing, in words. NOT the same as an empty page.
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

  /** ISOLATED <-> MAIN, over window.postMessage: the tools the SITE declares for itself.
   *
   * BUILT AND EXERCISED, against the real document.modelContext rather than a stand-in:
   * main-world.js reads the declaration and runs a declared tool, isolated.js asks with a
   * deadline and puts the answer on the scan as `declared`, and scripts/declared-tools.mjs
   * checks the whole of that on a page which declares two tools of its own.
   *
   * This sentence has now been wrong in both directions within one afternoon — claiming a path
   * that did not exist, then denying one that did — each time because it described what the
   * writer had in mind rather than the files beside it. If you change either end, change this
   * line in the same commit.
   *
   * The rule about them is older than the path and is tested: gating.js insists a tool a SITE
   * declared is put to the person out loud, whatever the tool says about itself, because
   * WebMCP carries no statement of consequence — it has a name, a description and a schema,
   * and nothing that says whether calling it reads something or changes something. */
  DECLARED_REQUEST: 'declared-request',
  DECLARED_RESULT: 'declared-result',

  /** phone -> ISOLATED -> MAIN: run one of the tools the SITE declared, and the answer back.
   *  It cannot go the way a synthesized tool goes: the page's own function is reachable only
   *  from the page's own world. */
  /* WHAT THE ENVELOPE LOOKS LIKE, written down because leaving it unsaid cost a round trip.
   *
   * Every message across the two worlds carries `channel`, `type` and the `askId` it answers,
   * and its payload under ONE NAMED KEY rather than spread across the envelope:
   *
   *   { channel, type: DECLARED_RESULT,         askId, declared: DeclaredReport }
   *   { channel, type: DECLARED_EXECUTE_RESULT, askId, result: ExecResult }
   *
   * One key, not four fields flattened into the message. The typedefs below describe objects,
   * and an object that arrives in pieces is a different thing that happens to have the same
   * field names — which is exactly how two halves written from the same typedef disagreed: one
   * end sent `declared`, the other read `available` off the envelope and concluded the browser
   * had no WebMCP at all, with a live modelContext sitting right there.
   *
   * And ONE copy of it. A payload sent both nested and flattened "so either reader works" is
   * two contracts, and the day one of them changes is the day they stop agreeing silently. */
  DECLARED_EXECUTE_REQUEST: 'declared-execute-request',
  DECLARED_EXECUTE_RESULT: 'declared-execute-result',

  /** How long the ISOLATED world would wait for the MAIN world before deciding the page
   *  declares nothing — for the path above, when it is built. */
  MAIN_WORLD_TIMEOUT_MS: 1500,

  /** Where a scan is left for anyone who wants to read it. chrome.storage.local, one key. */
  LAST_SCAN_KEY: 'lastScan',
};
