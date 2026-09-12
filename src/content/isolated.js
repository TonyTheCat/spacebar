/* The relay. It runs in every page, in the ISOLATED world, and it is the only half of this
 * extension that can reach chrome.* and the page's DOM at the same time.
 *
 * Four jobs, and the third one is the product:
 *
 *   - it answers "what can be done on this page?" by handing the synthesizer the live
 *     document. The tools come back as live element references held in the synthesizer's own
 *     registry — only their names and schemas cross the wire, because a model is shown a
 *     description of a control, never a handle on one.
 *   - it RUNS one of those tools, through the same references, and says what changed.
 *   - it stands in front of anything that commits something: the question is SAID through
 *     the page, the extension is asked, and a missing answer is a no.
 *   - and it carries the talk key, because somebody who cannot see the screen is on the
 *     SITE rather than on our tab, and a key handler that only works while the phone has
 *     focus reaches them never.
 *
 * HOW A PAGE IS DRIVEN IS NOT IN HERE. press, setValue, asItTakesIt, snapshot, changedSince,
 * complaints and readPage are the brick's (vendor/drive-the-page.js, the global
 * PageToolsHands) and every one of them carries the measurement it came from. This file
 * calls them; it does not re-decide them. What stays here is the product: which messages
 * exist, who must be asked about what, and how much of a page a person is read.
 *
 * The scripts it needs are loaded before it by the manifest, in this order:
 *   vendor/synthesize.js -> vendor/read-results.js -> vendor/filled-in.js ->
 *   vendor/drive-the-page.js -> src/shared/protocol.js -> src/shared/gating.js ->
 *   src/shared/readable.js -> src/shared/push-to-talk.js -> this file
 * They are classic scripts sharing one global scope and there is no import to fix a wrong
 * order up, which is why scripts/check-manifest.mjs refuses one on every commit.
 */

/* Which frame is this?
 *
 * The key capture has to run in EVERY frame: focus inside an iframe would otherwise swallow
 * the talk key and the person would be holding it into nothing. Everything else runs in the
 * top frame only — chrome.tabs.sendMessage delivers to every frame at once and the sender is
 * given the first answer anybody sends. An advert in an iframe is a document with a form in
 * it, so a subframe that answers a scan does not merely add noise: it sometimes wins, and the
 * agent then describes the advert as if it were the page.
 */
const isTopFrame = window.top === window;

/* ============================== the synthesizer ============================== */

/** The refs from the last scan: tool name → its live elements.
 *
 * Rebuilt every time, because the tool set is a function of the page as it is NOW rather
 * than of its URL. A ref that is no longer in this map is a tool that has gone, and saying
 * so is better than pressing something else. */
let refs = new Map();

/** What the synthesizer said about each tool's CONSEQUENCE, kept beside the refs and rebuilt
 *  with them.
 *
 * The refs carry a kind and no consequence, and gating on the kind is the mistake this pair
 * exists to prevent: a search box IS a submit, the synthesizer marks it `gated: false` for
 * exactly that reason, and asking before a search turned somebody's request into "the search
 * action was declined" without a question ever being put to them. */
let gates = new Map();

/** Mark the values that must never be read back out loud.
 *
 * The gate reads arguments back so that somebody who cannot see the form can catch a mistake
 * while it is still catchable — and a password is the one value where saying it aloud takes
 * away a protection that already works. Only this file can tell: it sees
 * input[type=password] directly, while the phone composes its question from the SCHEMA
 * alone.
 *
 * So the schema is told, exactly rather than by guessing: the synthesizer hands back the live
 * elements for each tool keyed by the same property name the schema uses, so nothing here
 * matches on a label or on the word "password" appearing somewhere. It ADDS a marker and
 * replaces nothing — `format: 'password'` is JSON Schema's own vocabulary, and protocol.js
 * names it as one of the two ways a value is silenced at the gate.
 *
 * @param {JsonSchema|undefined} schema
 * @param {{fields?: Array<{key: string, el?: Element}>}|undefined} ref
 * @returns {JsonSchema|undefined} */
const markSecrets = (schema, ref) => {
  const properties = schema?.properties;
  if (!properties || !ref?.fields) return schema;
  const secrets = ref.fields.filter(
    (field) =>
      field.el instanceof HTMLInputElement && field.el.type === 'password' && field.key in properties
  );
  if (secrets.length === 0) return schema;
  const marked = { ...properties };
  for (const field of secrets) marked[field.key] = { ...properties[field.key], format: 'password' };
  return { ...schema, properties: marked };
};

/** Everything this page offers, read off the live DOM, with the refs kept for running it.
 *  @returns {{tools: Tool[], stats: object}} */
const synthesize = () => {
  const result = PageToolsSynth.synthesizeTools();
  refs = result.refs;
  gates = new Map(result.tools.map((tool) => [tool.name, tool.gated === true]));
  return {
    stats: result.stats,
    tools: result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: markSecrets(tool.inputSchema, result.refs.get(tool.name)),
      kind: tool.kind,
      gated: tool.gated,
      source: 'synthesized',
      /* What the PAGE said about it, carried on rather than dropped here.
       *
       * The synthesizer marks the link a page styles as its call to action, and the
       * shortlist leads with it. This map is the wire between those two, and it copies
       * NAMED fields — so a flag nobody adds here is a flag that reaches nothing. That has
       * happened: unit tests passed on objects built with the flag by hand while the real
       * page had Start sorted last. */
      primary: tool.primary,
    })),
  };
};

/** Everything this page offers, as a Scan.
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
    const { tools, stats } = synthesize();
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

/* ================================= the hands ================================= */

/* Taken off the brick by name, so that every call site below reads as the brick's own
 * documentation does. Its methods are plain functions closing over their own helpers, so
 * lifting them off the object is safe.
 *
 * Three measurements live inside these and must not be worked around:
 *   - asItTakesIt waits for the CONTROL to hold the value, with a bound. A select takes a
 *     value a tick later, so a read on the next line reports a written field unwritten — and
 *     that lie was spoken to somebody who could not see the form, who then redid work that
 *     was already done.
 *   - complaints() reads what the page ANNOUNCES. "contains 0 errors" is a page saying it is
 *     fine, and a live region carrying the page's own title is an announcement rather than a
 *     problem.
 *   - press() works on an element a click() does not reach, such as a link inside an <svg>.
 */
const { press, setValue, asItTakesIt, snapshot, changedSince, complaints } = PageToolsHands;

/** How long to let the page settle after an action before describing it.
 *
 *  Not a wait for a navigation — that is the phone's to wait for, because only the phone
 *  knows whether the tools it published have been accepted yet. This is the pause that makes
 *  changedSince() describe the page after the click rather than during it. */
const SETTLE_MS = 800;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

/** Read the page out, in our own voice.
 *
 * The finding is the brick's; the SHAPING is ours and stays here. How many results somebody
 * listening can hold, and how long a page may be read aloud, are decisions about a person
 * rather than about a page — which is why the brick takes them as an argument instead of
 * reaching for a global of its own. */
const readPage = () =>
  PageToolsHands.readPage({
    results: Readable.results,
    shape: Readable.shape,
    resultsLimit: Readable.RESULTS,
  });

/** Say something through the page, for whoever is listening to it.
 *
 * ariaNotify reaches a screen reader without moving anybody's cursor or stealing focus,
 * which is what a running agent needs: it reports, it does not interrupt. Chrome ignores it
 * when no screen reader is on, so this is free when unheard.
 *
 * It has to be the PAGE that speaks: a screen reader follows the document the person is in,
 * and the phone is a different one.
 *
 * @param {string} text @param {'normal'|'high'} [priority]
 * @returns {string|null} the reason it could not, or null */
const speak = (text, priority) => {
  try {
    document.ariaNotify(text, { priority: priority ?? 'normal' });
  } catch (error) {
    // An older Chrome has no ariaNotify, and a run is not about to stop over it — but
    // swallowing the reason is how "nothing is being spoken" becomes an evening of looking
    // in the wrong place. Hand it back to the caller.
    return String(error);
  }
  return null;
};

/* ================================== the gate ================================== */

/** Ask the person, through whichever half of the extension asked for this action, before
 *  doing something irreversible.
 *
 * Built per request rather than defined once, because the question has to carry the asker's
 * id. chrome.runtime.sendMessage reaches EVERY listener in the extension and the sender is
 * handed the FIRST answer any of them sends, so without an id any listening surface decides
 * every gate in the product.
 *
 * This is the CONTENT SCRIPT's half of the gate and it is deliberately the smaller half. The
 * phone parks the action, puts the question to the person in the session's own voice, and
 * reads the answer out of the transcript of what THEY said — the model cannot write into
 * that. This side says the question through the page as well, for a screen reader that is
 * following the document rather than our tab, and then asks and waits.
 *
 * @param {string|undefined} askedBy
 * @returns {(label: string, steps: string[]) => Promise<boolean>} */
const confirmWith = (askedBy) => async (label, steps) => {
  /* Said before it is asked, and said HERE.
   *
   * A gate that only exists in the phone's tab is a gate the person it is for cannot find:
   * their screen reader is following this page. High priority because it is a question, and
   * the rest of the errand is waiting on the answer.
   *
   * What was filled in, in WORDS rather than a count of it. Somebody who can see the form
   * reads the fields before they say yes; somebody who cannot has only this sentence, and "2
   * fields filled" is not a description of anything.
   */
  speak(
    steps.length === 0
      ? `Waiting for you: press "${label}"?`
      : `Waiting for you: press "${label}"? I have ${steps.join(', ')}.`,
    'high'
  );

  const answer = await chrome.runtime
    .sendMessage({ type: PT.CONFIRM_REQUEST, label, steps, askedBy })
    .catch(() => null);
  /* Nobody listening is a NO.
   *
   * Every way of not getting an answer lands here — no phone open, a phone that dropped its
   * line, a request nobody claims as their own — and all of them mean the same thing: no
   * person said yes. A missing answer must never read as consent, which is the direction
   * this whole product leans. */
  return answer?.ok === true;
};

/* ============================== running one tool ============================== */

/** Run one synthesized tool through the live elements the synthesizer handed back.
 *
 * The four branches are the four shapes of ref the synthesizer produces, and the tool's own
 * `kind` is not one of them: a search arrives as a submit ref with `gated: false`, which is
 * why the ask below reads `gates` rather than the branch it is standing in.
 *
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {(label: string, steps: string[]) => Promise<boolean>} confirm
 * @returns {Promise<{ok: boolean, text: string, problems?: unknown}>} */
const execute = async (name, args, confirm) => {
  const ref = refs.get(name);
  if (!ref) {
    // The page has moved on since the list was published. Saying so is worth more than
    // pressing whatever is in that place now.
    return { ok: false, text: `"${name}" is not on the page any more — rescan and pick again.` };
  }
  const before = snapshot();

  if (ref.kind === 'click') {
    if (!ref.el?.isConnected) return { ok: false, text: 'That control is gone from the page.' };
    ref.el.scrollIntoView({ block: 'center' });
    press(ref.el);
    await settle();
    return { ok: true, text: changedSince(before) };
  }

  if (ref.kind === 'navigate') {
    /* Three ways to match, not one. A caller names a link the way a person would say it —
     * "benefit finder" for a link actually labelled "Find government benefits and financial
     * help - USAGov" — and exact equality turns every such near miss into a dead end. It
     * matters more than it looks: a list of targets longer than a handful is handed to the
     * model as prose rather than as an enum, precisely because the caller is expected to be
     * resolved tolerantly. */
    const want = String(args.target ?? '')
      .toLowerCase()
      .trim();
    const targets = ref.targets ?? [];
    const hit =
      targets.find((one) => one.label.toLowerCase().trim() === want) ||
      targets.find((one) => want && one.label.toLowerCase().includes(want)) ||
      targets.find((one) => want && want.includes(one.label.toLowerCase().trim()));

    if (!hit) {
      // "There is no such link" leaves the caller to guess again, and it guesses the same
      // shape twice. The links are right here, so say them.
      const offered = targets.map((one) => `"${one.label}"`).join(', ');
      return {
        ok: false,
        text: `No link called "${args.target}". The links on this page are: ${offered}`,
      };
    }

    hit.el.scrollIntoView({ block: 'center' });
    press(hit.el);
    await settle();
    return { ok: true, text: `followed "${hit.label}". ${changedSince(before)}` };
  }

  if (ref.kind === 'set') {
    /* A radio group answers a QUESTION with one of its options, and the brick hands the whole
     * group over on `fields` — one entry, kind 'radio', its elements and their labels
     * index-aligned.
     *
     * Without this branch, "No" ticks "Yes": the ref's `el` is the group's FIRST radio, and
     * setValue only knows how to check the element it is given. The refusal is worded the way
     * the fill path words it, because it is the same refusal — a value the control does not
     * offer, said back with the choices, so the caller can pick one that exists. */
    const choice = (ref.fields ?? []).find((one) => one.kind === 'radio');
    if (choice) {
      const said = String(args[ref.key ?? ''] ?? '');
      const index = (choice.labels ?? []).indexOf(said);
      if (index < 0 || !choice.els?.[index]) {
        return {
          ok: false,
          text: `"${said}" is not one of the choices: ${(choice.labels ?? []).join(', ')}.`,
        };
      }
      if (!choice.els[index].isConnected) {
        return { ok: false, text: 'That control is gone from the page.' };
      }
      setValue(choice.els[index], true);
      await settle();
      return { ok: true, text: changedSince(before) };
    }
    if (!ref.el?.isConnected) return { ok: false, text: 'That control is gone from the page.' };
    setValue(ref.el, args[ref.key ?? '']);
    await settle();
    return { ok: true, text: changedSince(before) };
  }

  if (ref.kind === 'submit') {
    /* Everything is filled in first, then the person is asked — IF this tool is one that has
     * to be asked about — and only then is the thing pressed. A refusal leaves the fields as
     * they are and says so, because a form filled in and not sent is a state somebody may
     * want to keep.
     *
     * Whether to ask is Gating.mustAsk, reading the synthesizer's own `gated`. It used to be
     * this branch itself: reaching a submit was taken as reason enough. A search form is a
     * submit, marked gated: false by the synthesizer precisely so that nobody asks before a
     * search, and asking anyway is what answered a request with "the search action was
     * declined". */
    const mustAsk = Gating.mustAsk({ gated: gates.get(name) });
    const steps = [];
    for (const field of ref.fields ?? []) {
      if (!(field.key in args)) continue;
      if (field.kind === 'radio') {
        const index = (field.labels ?? []).indexOf(String(args[field.key]));
        if (index >= 0 && field.els?.[index]) {
          setValue(field.els[index], true);
          steps.push(`chose ${field.labels?.[index]}`);
        }
      } else if (field.el?.isConnected) {
        setValue(field.el, args[field.key]);
        /* The VALUE, not just the field's name: this list is what a person is read back
         * before they agree, and "set note" tells them nothing about what the note says.
         *
         * Except a password. Reading values back exists so that somebody who cannot see the
         * form can catch a mistake before it is irreversible — but a password is the one
         * field where saying it out loud defeats a protection that already works: the browser
         * masks it on screen, and this would unmask it into a room that is not always empty.
         * The field is still NAMED, so they know it was filled; only the characters are
         * withheld. */
        const secret = field.el instanceof HTMLInputElement && field.el.type === 'password';
        steps.push(
          secret
            ? `filled ${field.key}, and I am not saying a password out loud`
            : `set ${field.key} to "${String(args[field.key])}"`
        );
      }
    }

    /* Two shapes of submit reach here. One has a button. The other — a lone search box with
     * no button that submits its form — commits by pressing Enter in the field and carries NO
     * `submit` element at all. Both carry commit(), so that is what gets called; reaching for
     * `submit` directly refuses every search box on Google, Bing and DuckDuckGo.
     *
     * And the gate's whole job is to say what is about to happen, so an unnamed button must
     * not produce an unnamed question. DuckDuckGo's search button is exactly that: a
     * zero-width icon whose textContent is empty, which asked a person to approve pressing
     * "". So fall back to the accessible name — the synthesizer already computes it, and it
     * is what a screen reader would say — and to the keystroke when there is no button. */
    const label = ref.submit
      ? (ref.submit.textContent ?? '').trim() ||
        (PageToolsSynth.accessibleName(ref.submit) ?? '').trim() ||
        'submit'
      : 'Enter';

    if (typeof ref.commit !== 'function') {
      return {
        ok: false,
        text: 'This tool has no way to commit itself — the synthesizer gave no commit().',
      };
    }

    if (mustAsk && !(await confirm(label, steps))) {
      return {
        ok: false,
        text: `The human declined to press "${label}". The fields are left as they are.`,
      };
    }

    ref.submit?.scrollIntoView({ block: 'center' });
    ref.commit();
    await settle();
    /* What the page said about it, in the page's own words.
     *
     * "Pressed" and "accepted" are different facts, and a form is exactly where they differ:
     * it comes back with its own errors while the phone reports a press. complaints() reads
     * what the page ANNOUNCES — the roles it uses to raise a problem, the fields it marks
     * invalid, the sentence it writes when it counts them — and it knows that "contains 0
     * errors" is a page saying it is fine. */
    return {
      ok: true,
      text: `filled ${steps.length} field(s), pressed "${label}". ${changedSince(before)}`,
      problems: complaints(),
    };
  }

  return { ok: false, text: `Nothing here knows how to run a "${ref.kind}" tool.` };
};

/* ============================= one field at a time ============================= */

/** One value into one field, committing nothing.
 *
 * The fields of a submit widget are the widget's — the synthesizer hands them back on its
 * ref, keyed by the same property names the schema uses — so this sets them through the same
 * setValue every other path uses, and refuses a name it does not have rather than guessing
 * which field was meant.
 *
 * Its answer is the CONTROL's own, read back once the control has taken the value: what was
 * asked for is our intention and what the control holds is the fact. A select given a value
 * it has no option for keeps what it had, and that read-back is how the caller learns it —
 * within a bound, because a wait with no bound is a phone that goes quiet.
 *
 * @param {{tool?: unknown, field?: unknown, value?: unknown}} message
 * @returns {Promise<{ok: boolean, text: string, is?: string, field?: string}>} */
const fillOneField = async (message) => {
  const ref = refs.get(String(message.tool ?? ''));
  if (!ref) return { ok: false, text: `"${message.tool}" is not on the page any more.` };

  const fields = ref.fields ?? (ref.key ? [{ key: ref.key, kind: 'field', el: ref.el }] : []);
  const field = fields.find((one) => one.key === String(message.field ?? ''));
  if (!field) {
    return {
      ok: false,
      text: `"${message.field}" is not a field of that form. Its fields are: ${fields
        .map((one) => one.key)
        .join(', ')}.`,
    };
  }

  if (field.kind === 'radio') {
    const index = (field.labels ?? []).indexOf(String(message.value));
    if (index < 0 || !field.els?.[index]) {
      return {
        ok: false,
        text: `"${message.value}" is not one of the choices for ${field.key}: ${(
          field.labels ?? []
        ).join(', ')}.`,
      };
    }
    setValue(field.els[index], true);
    /* A radio says back the CHOICE that was made. What it holds is a boolean spread over
     * several elements, and the label is the thing worth reading back to a person. */
    return {
      ok: true,
      text: `${field.key} is now "${String(message.value)}"`,
      is: String(message.value),
      field: field.key,
    };
  }

  const el = field.el;
  if (!el?.isConnected) {
    return { ok: false, text: `The ${field.key} control is gone from the page.` };
  }
  setValue(el, message.value);
  const now = await asItTakesIt(el, message.value);
  return { ok: true, text: `${field.key} is now "${now}"`, is: now, field: field.key };
};

/* ================================== the relay ================================== */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // A subframe answers nothing. It is here for the talk key and nothing else.
  if (!isTopFrame) return false;

  if (message?.type === PT.SPEAK && typeof message.text === 'string') {
    /* Chrome only raises an announcement for the tab a person is actually on: an agent
     * narrating into a background tab is silent and says so nowhere. Measured — the same call
     * went unheard while the page was not the active tab and arrived the moment it was — so
     * whether it could be heard is reported back rather than assumed. */
    sendResponse({
      spoke: document.visibilityState === 'visible',
      error: speak(message.text, message.priority === 'high' ? 'high' : 'normal'),
    });
    return false;
  }

  /* Every one of the four below ANSWERS, whatever happens inside it.
   *
   * A throw in here does not stay in here: the listener dies, the port closes with no
   * response, and the caller's sendMessage rejects — which the phone reads as "no answer" and
   * cannot tell apart from a page with nothing to say. A read_page once went silent on a
   * results page, and this is one of the two paths that could have swallowed it. So a failure
   * is answered, with its reason, and the reason reaches the log.
   */
  if (message?.type === PT.FILL_REQUEST) {
    fillOneField(message)
      .catch((error) => ({
        ok: false,
        text: `filling that threw: ${String(error).slice(0, 200)}`,
      }))
      .then(sendResponse);
    // Kept open: the answer is the control's, and on some pages it arrives a tick later.
    return true;
  }

  if (message?.type === PT.READ_REQUEST) {
    try {
      sendResponse(readPage());
    } catch (error) {
      sendResponse({ text: '', error: `reading the page threw: ${String(error).slice(0, 200)}` });
    }
    return false;
  }

  if (message?.type === PT.SCAN_REQUEST) {
    // Synchronous: the scan is this document, and scanThisPage answers with readable: false
    // rather than throwing.
    sendResponse(scanThisPage());
    return false;
  }

  if (message?.type === PT.EXECUTE_REQUEST) {
    execute(message.name, message.args ?? {}, confirmWith(message.askedBy))
      .catch((error) => ({
        ok: false,
        text: `running it on the page threw: ${String(error).slice(0, 200)}`,
      }))
      .then(sendResponse);
    return true; // kept open: running a tool waits for the page to settle
  }

  return false;
});

/* ============================ the talk key, on the page ============================ */

/* Push to talk has to work where the person actually is.
 *
 * The phone listens for Space on its own document, which means it only hears the key while
 * the phone tab has focus. Somebody who cannot see the screen is on the PAGE, and there the
 * key reached nothing — which is indistinguishable from the product being broken. So every
 * page watches for it and tells the phone.
 *
 * Captured, and swallowed. The concept is that this person SPEAKS rather than types: a page
 * must never also receive the key, or holding it to talk scrolls the page under them, ticks
 * a checkbox, or plays a video. Capture phase and stopImmediatePropagation are what make
 * that true even for a page that listens first, on the same node.
 *
 * The cost is real and worth stating plainly: while a session is live, the space bar cannot
 * be typed into a field on any page. That is the trade this product makes, not an oversight
 * — and it is why the key is only taken while there is something to talk to.
 */

/** Tell the phone the turn ended, and WHY.
 *
 * The why is not decoration. A release is the person saying their turn is over; losing sight
 * of the key is a guess made on their behalf, and it is the wrong guess when the phone has
 * just moved them to another tab mid-sentence — which is exactly what opening a site does.
 * The phone decides what to do with each; this side only reports honestly which happened.
 *
 * @param {StopReason} why */
const tellThePhone = (why) =>
  void chrome.runtime.sendMessage({ type: PT.TALK_STOP, why }).catch(() => {});

const talkKeyOnPage = PushToTalk.create({
  /* The page keeps its own limit as well as the phone's. If this side is the one still
   * running — a hung phone, a dropped line — it should not go on reporting a hold that
   * nobody is holding. */
  limitMs: 45000,
  onStart: () => void chrome.runtime.sendMessage({ type: PT.TALK_START }).catch(() => {}),
  onStop: (why) => tellThePhone(why),
});

/* Whether a voice session is live right now.
 *
 * Swallowing the key on every page whether or not anybody is listening turns the space bar
 * into a dead key across the whole browser — for somebody typing a message, and for anybody
 * who never opened the phone. So the key is ours only while there is something to talk to.
 * The phone writes this flag when its session opens and clears it when the line goes away;
 * this reads it once and then follows it.
 */
let voiceLive = false;

const watchVoice = () => {
  chrome.storage.session
    .get('voiceLive')
    .then(({ voiceLive: live }) => {
      voiceLive = live === true;
    })
    .catch(() => {
      /* Storage unreachable is NOT a reason to start swallowing keys: a page whose space bar
       * does nothing is worse than a phone that misses a press. */
      voiceLive = false;
      /* And it is SAID, because this was the silent one.
       *
       * chrome.storage.session is trusted-contexts-only until something raises its access
       * level, and while it is not, this read is refused on every page. Leaving the key to
       * the page is the right thing to do about that; doing it without a word is how somebody
       * came to hold the space bar on a page twice with nothing anywhere to say why. The
       * phone prints this in its own log, where a sighted helper is already looking. */
      void chrome.runtime.sendMessage({ type: PT.NO_TALK_FLAG, host: location.host }).catch(() => {
        // No phone listening is not a second failure: with no phone there is no session, and
        // the key belongs to the page anyway.
      });
    });
};
watchVoice();

chrome.storage.session.onChanged?.addListener((changes) => {
  if ('voiceLive' in changes) voiceLive = changes.voiceLive.newValue === true;
});

window.addEventListener(
  'keydown',
  (event) => {
    if (!PushToTalk.claims(voiceLive, event.code)) return;
    event.preventDefault();
    /* Immediate, not just stopPropagation. Measured: with the plain one a page's own
     * listeners still counted every keydown. Two capture listeners on the same node both run
     * — stopPropagation only stops the NEXT node — and a page that registered first is
     * exactly the page that does its own work in a keydown handler. Nothing moves on screen,
     * because preventDefault holds; the page still gets to act, and that is worth writing
     * down rather than claiming a key nothing else can see. */
    event.stopImmediatePropagation();
    // A held key repeats, and every repeat would be another "they started talking". The
    // machine ignores it anyway; stopping here saves the traffic.
    if (event.repeat) return;
    talkKeyOnPage.start();
  },
  true
);

window.addEventListener(
  'keyup',
  (event) => {
    if (!PushToTalk.claims(voiceLive, event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    /* A release is reported even when THIS page never saw the press.
     *
     * The hold can have begun somewhere else and ended here: on the phone's own tab, or on
     * the page they were on until the agent moved them, which is the case that made this
     * necessary. The local machine has nothing held in either case, so without this the
     * person's release reaches nobody and the microphone stays open until the
     * forty-five-second backstop. A stray release with no turn open costs nothing at the
     * other end — the phone's own machine ignores a stop with nothing held. */
    if (!talkKeyOnPage.stop()) tellThePhone('released');
  },
  true
);

/* Every way the release can go missing. A microphone left open because the key came up
 * somewhere else is the one failure this must not have. */
window.addEventListener('blur', () => void talkKeyOnPage.lostSight());
window.addEventListener('pagehide', () => void talkKeyOnPage.lostSight());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') talkKeyOnPage.lostSight();
});
