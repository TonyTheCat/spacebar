/* The MAIN world: the same page, in the page's own JavaScript context.
 *
 * It exists because one thing lives here and can be reached from nowhere else — a site's own
 * `document.modelContext`, the tools a page DECLARES for an agent rather than the ones we read
 * off its markup. The ISOLATED world cannot see it: that is what world isolation is for. So
 * this half reads the declaration and runs what it names, and everything it learns crosses back
 * over window.postMessage.
 *
 * WHERE THE API LIVES, measured rather than assumed, on Chrome 152 and Chromium 153:
 *
 *   no flags                          -> neither object exists
 *   --enable-features=WebMCPTesting   -> document.modelContext
 *   --enable-features=WebMCP          -> document.modelContext
 *
 * navigator.modelContext was absent in every one of those runs and only document.modelContext
 * is in the explainer — it is still read below, because the cost is one `??` and published
 * descriptions of this build disagree with each other.
 *
 * TWO THINGS THE IMPLEMENTATION DOES THAT THE EXPLAINER DOES NOT SAY, both measured by squad 2
 * against the real API, and both able to look like our own bug if they are not handled here:
 *
 *   getTools() hands back inputSchema as a JSON STRING. Read as an object it looks like a tool
 *   that takes no arguments — and worse for us, a schema with no properties makes the gate's
 *   own rule ("an argument the schema does not describe is never spoken") hide ordinary values.
 *   It is parsed here, once, so nothing downstream has to know.
 *
 *   executeTool takes the TOOL OBJECT, not its name, and its arguments as a JSON string. An
 *   object, or a missing second argument, throws "Failed to parse input arguments".
 *
 * NOTHING HERE IS TRUSTED. Every field of every tool was written by whoever wrote the page:
 * names, descriptions and schemas are coerced to the shapes the rest of the extension expects,
 * and a tool that arrives without a usable name is dropped rather than passed on.
 */

/** @returns {{getTools?: Function, executeTool?: Function, addEventListener?: Function}|null} */
const findModelContext = () => {
  try {
    return document.modelContext ?? navigator.modelContext ?? null;
  } catch {
    return null;
  }
};

/** @returns {'document'|'navigator'|null} */
const whereModelContext = () => {
  try {
    if (document.modelContext) return 'document';
    if (navigator.modelContext) return 'navigator';
  } catch {
    return null;
  }
  return null;
};

const EMPTY_SCHEMA = { type: 'object', properties: {} };

/** A schema, whichever of the two shapes it arrives in.
 *  @param {unknown} raw @returns {JsonSchema} */
const toSchema = (raw) => {
  if (raw && typeof raw === 'object') return /** @type {JsonSchema} */ (raw);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : EMPTY_SCHEMA;
    } catch {
      return EMPTY_SCHEMA;
    }
  }
  return EMPTY_SCHEMA;
};

/** One declared tool, in the shape the rest of this extension uses.
 *
 * `gated: false` with `source: 'declared'` is not a statement that this is safe to run. It is
 * the absence of a statement: WebMCP carries nothing about whether calling a tool reads or
 * changes, so there is no honest value to put there — and src/shared/gating.js already requires
 * the person to be asked out loud about everything a site declared, precisely because of that
 * silence.
 *
 * @param {unknown} raw @returns {Tool|null} */
const toTool = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const tool = /** @type {Record<string, unknown>} */ (raw);
  if (typeof tool.name !== 'string' || tool.name === '') return null;
  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description : '',
    inputSchema: toSchema(tool.inputSchema),
    kind: 'declared',
    gated: false,
    source: 'declared',
  };
};

/** What this page declares, if anything, and whether the browser can even say.
 *
 * `available` is a question about the BROWSER and is kept apart from an empty list on purpose:
 * a browser without the flag and a page that declares nothing produce the same empty array and
 * mean opposite things. Told apart, we can say "this browser has no WebMCP" instead of telling
 * somebody who cannot see the screen that a site offers nothing.
 *
 * @returns {Promise<DeclaredReport>} */
const readDeclared = async () => {
  const ctx = findModelContext();
  if (!ctx) {
    return {
      available: false,
      where: null,
      tools: [],
      reason:
        'This browser exposes no WebMCP API. Start Chrome with --enable-features=WebMCP, or ' +
        'turn on chrome://flags/#enable-webmcp-testing and restart.',
    };
  }
  if (typeof ctx.getTools !== 'function') {
    return {
      available: true,
      where: whereModelContext(),
      tools: [],
      reason: 'modelContext is here but has no getTools().',
    };
  }
  try {
    // Awaited: the API may answer with a promise, and `.length` on one is undefined — which
    // reads as "no tools" about a page that has them.
    const raw = await ctx.getTools();
    const tools = /** @type {Tool[]} */ ((Array.isArray(raw) ? raw : []).map(toTool).filter(Boolean));
    return {
      available: true,
      where: whereModelContext(),
      tools,
      reason: tools.length === 0 ? 'The API is here; this page declares no tools.' : undefined,
    };
  } catch (error) {
    return {
      available: true,
      where: whereModelContext(),
      tools: [],
      reason: `getTools() failed: ${String(error).slice(0, 200)}`,
    };
  }
};

/** @param {string} raw */
const safeParse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/** Whatever executeTool returned, as a line somebody could be read.
 *
 * The explainer's result shape is {content:[{type:'text',text}]} and this build returns it as
 * JSON text, so both are unwrapped — otherwise the person hears a serialized envelope where the
 * page said "there are 2 notes".
 *
 * @param {unknown} result @returns {string} */
const resultText = (result) => {
  const value = typeof result === 'string' ? safeParse(result) : result;
  if (typeof value === 'string') return value;
  const content = /** @type {{content?: unknown}} */ (value ?? {}).content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => /** @type {{text?: unknown}} */ (part ?? {}).text)
      .filter((part) => typeof part === 'string')
      .join(' ');
    if (text !== '') return text;
  }
  return JSON.stringify(value ?? null);
};

/** Run one tool the page declared.
 *
 * The tool is looked up FRESH rather than remembered: a page may register and drop tools while
 * somebody is deciding, and executeTool wants the object it holds now. A name it no longer
 * offers is refused, in words, rather than guessed at.
 *
 * @param {string} name @param {object} args @returns {Promise<{ok: boolean, text: string}>} */
const executeDeclared = async (name, args) => {
  const ctx = findModelContext();
  if (!ctx || typeof ctx.executeTool !== 'function' || typeof ctx.getTools !== 'function') {
    return { ok: false, text: 'There is no WebMCP API on this page to run anything against.' };
  }
  try {
    const tools = await ctx.getTools();
    const tool = (Array.isArray(tools) ? tools : []).find(
      (one) => !!one && typeof one === 'object' && /** @type {{name?: unknown}} */ (one).name === name
    );
    if (!tool) return { ok: false, text: `This page does not declare a tool called "${name}".` };
    // The object, and the arguments as a STRING: see the note at the top of this file.
    const result = await ctx.executeTool(tool, JSON.stringify(args ?? {}));
    return { ok: true, text: resultText(result) };
  } catch (error) {
    return { ok: false, text: `executeTool failed: ${String(error).slice(0, 300)}` };
  }
};

/** Answer, carrying back whatever the asker used to recognise its own question.
 *
 * BOTH `id` and `askId` are echoed, and neither is invented here. The relay in the ISOLATED
 * world numbers its asks with `id`; an instrument asking this half directly — which is how the
 * declared path is checked without a session — stamps `askId`. Echoing what arrived, whatever
 * it was called, is what lets a caller tell its own answer from somebody else's: window
 * .postMessage is delivered to this very window, so a listener that matches on type alone hears
 * its own question come back and reports a path as working when nothing answered at all.
 *
 * @param {string} type @param {object} asked @param {object} payload */
const reply = (type, asked, payload) => {
  window.postMessage(
    {
      channel: PT.CHANNEL,
      from: 'main',
      type,
      ...(asked.id === undefined ? {} : { id: asked.id }),
      ...(asked.askId === undefined ? {} : { askId: asked.askId }),
      ...payload,
    },
    '*'
  );
};

window.addEventListener('message', (event) => {
  /* Same window only, our channel only, and never our own replies.
   *
   * `from: 'main'` is how an answer is told from a question — without it this handler hears
   * itself. What it is NOT is a proof of who asked: a page can post anything it likes here,
   * which is why everything crossing back is treated as the page's own words at the other end
   * rather than trusted because it arrived on our channel. */
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.channel !== PT.CHANNEL || message.from === 'main') return;

  if (message.type === PT.DECLARED_REQUEST) {
    void readDeclared().then((declared) => reply(PT.DECLARED_RESULT, message, { declared }));
    return;
  }

  if (message.type === PT.DECLARED_EXECUTE_REQUEST) {
    /* Under ONE key, and not also flattened onto the envelope. Sending both so that either
     * kind of reader works is two contracts, and on the day one of them changes they part
     * company without a word. The envelope carries channel, type and whatever the asker used
     * to recognise its own question; the answer itself goes under its own name. */
    void executeDeclared(String(message.name ?? ''), message.args ?? {}).then((result) =>
      reply(PT.DECLARED_EXECUTE_RESULT, message, { result })
    );
  }
});

/* A site can register or drop tools at any moment, so when the API offers the event the new
 * list is pushed up unasked. It carries no id, which is how the relay tells news from an
 * answer it was waiting for. */
const atLoad = findModelContext();
if (atLoad && typeof atLoad.addEventListener === 'function') {
  try {
    atLoad.addEventListener('toolchange', () => {
      void readDeclared().then((declared) =>
        window.postMessage(
          { channel: PT.CHANNEL, from: 'main', type: PT.DECLARED_RESULT, id: null, declared },
          '*'
        )
      );
    });
  } catch {
    // An older shape of the API with no events. Asking on demand still works, which is the
    // path everything here actually depends on.
  }
}
