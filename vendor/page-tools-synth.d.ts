/**
 * The package's types, in one place.
 *
 * They live here rather than as JSDoc inside synthesize.js because that file is a classic
 * script: its typedefs would be global, and index.mjs importing the same file registers
 * every one of them a second time ("Duplicate identifier 'Tool'"). An ambient declaration
 * file has one home, and it also gives consumers real types without a build step.
 */

type ToolKind = 'submit' | 'search' | 'set' | 'click' | 'navigate';

interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: string[];
  items?: JSONSchema;
  description?: string;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

interface Tool {
  /** Identifier for the model: `submitFindBenefitsByCategory`. */
  name: string;
  /** One sentence a model can choose on. */
  description: string;
  /** Plain JSON Schema. No custom keys — several providers reject unknown ones. */
  inputSchema: JSONSchema;
  /** A CSS path, for display and debugging ONLY. Execute through `refs`. */
  selector: string;
  kind: ToolKind;
  /**
   * True when activating this tool presses a button that commits something.
   *
   * False for kind 'search': the page declares that form a search, which reads. A consumer
   * that asks a person before every commit should not ask before one of these — that is the
   * whole reason the kind exists.
   */
  gated: boolean;
  /** navigate only: links on the page, before the enum was capped. */
  linkTotal?: number;
  /**
   * True when the PAGE presents this control as its own button — a link carrying a button
   * class, which is how a call to action is written.
   *
   * A fact about the markup, not a decision: the brick says the page built this to be
   * pressed, and a consumer decides whether that leads the list it offers. It exists because
   * a page whose whole purpose is one big "Start" had it arrive as one label among
   * twenty-four inside a generic "follow one link", beside a header search box with a tool of
   * its own — and the model looking for a way to begin chose the search box.
   */
  primary?: boolean;
}

interface FieldRef {
  /** Property name in the tool's inputSchema. */
  key: string;
  kind: 'field' | 'radio';
  /** kind 'field': the control. */
  el?: Element;
  /** kind 'radio': every radio in the group. */
  els?: Element[];
  /** kind 'radio': accessible name per radio, index-aligned with `els`. */
  labels?: string[];
}

interface Ref {
  kind: ToolKind;
  /** The control, container, or field. For an Enter-committed submit, the `<form>`. */
  el?: Element;
  /**
   * kind 'submit': the button that commits it.
   *
   * ABSENT when the form offers no button and the commit is Enter — google.com, bing.com
   * and duckduckgo.com are all like this. Prefer `commit()`, which covers both; a consumer
   * that presses `submit` directly will refuse those tools instead of committing them.
   */
  submit?: Element;
  /**
   * kind 'submit': press it. The one call that commits either kind — a button click, or
   * Enter in the field for a form with no button.
   */
  commit?: () => void;
  /**
   * kind 'submit': one entry per property in the tool's inputSchema.
   *
   * kind 'set': present ONLY for a radio group that stands on its own — one entry, kind
   * 'radio', carrying every radio in the group and their labels. A consumer ticks the
   * element whose label was chosen, which is the same thing it already does for a radio
   * field inside a composite form. `el` is still the group's first radio, so a consumer that
   * has not been taught about this sets that one, exactly as before.
   */
  fields?: FieldRef[];
  /** kind 'set': the single property name. */
  key?: string;
  /** kind 'navigate': the enum values, resolved to their elements. */
  targets?: { label: string; el: Element }[];
}

interface Stats {
  /** Interactive elements seen before filtering. */
  candidates: number;
  /** Of those, the ones a person could actually use. */
  visible: number;
  /** Visible controls with no accessible name. Watch this one. */
  unnamed: number;
  /** Composite (submit) tools built. */
  groups: number;
  /** Links found, before the navigate enum was capped. */
  links: number;
  /** Wrappers discarded as duplicates of a descendant. */
  dropped: number;
  /** Tools synthesized, BEFORE `maxTools` was applied. */
  total: number;
  /** Tools actually returned. */
  returned: number;
  /** True when `returned < total`. Say so in your UI. */
  truncated: boolean;
}

interface Result {
  tools: Tool[];
  /** Tool name to the live elements behind it. Rebuilt on every call. */
  refs: Map<string, Ref>;
  stats: Stats;
}

interface Options {
  /** Where to look. Defaults to `document`. */
  root?: Document | Element;
  /**
   * Cap on returned tools. Default 0, meaning NO cap.
   *
   * A silent cap is a trap: measured on a booking widget, one click took the real tool
   * count from 18 to 41 while a capped list read 16 and 16 — the strongest evidence the
   * page had changed, hidden by our own default. If you cap, read `stats.truncated` and
   * show "N of M".
   */
  maxTools?: number;
  /** Cap on the navigate enum. Default 24. The tool still reports the true total. */
  maxNavTargets?: number;
  /**
   * One navigate tool instead of one tool per link. Default true. Turning this off is how
   * you get a sitemap instead of an API.
   */
  collapseLinks?: boolean;
  /** Extra CSS selectors to treat as noise. Your own overlay belongs here. */
  exclude?: string[];
  /** Default false. Read the visibility note in the README before turning this on. */
  includeHiddenForms?: boolean;
}

interface PageToolsSynthApi {
  synthesizeTools(options?: Options): Result;
  toOpenAITools(tools: Tool[]): {
    type: 'function';
    function: { name: string; description: string; parameters: JSONSchema };
  }[];
  accessibleName(el: Element | null): string;
  roleOf(el: Element): string;
  isVisible(el: Element): boolean;
  fieldSchema(el: Element): JSONSchema;
  version: string;
}

/* No import/export in this file, on purpose: that keeps it a script, so every interface
 * above is global and the JSDoc in synthesize.js can name them. Wrapping these two in
 * `declare global` would require making it a module, which would take the rest with it. */
interface Window {
  PageToolsSynth: PageToolsSynthApi;
}

declare var PageToolsSynth: PageToolsSynthApi;

/* ============================ webmcp-bridge ============================ */

/** What a provider's callTool may answer with, besides a full ToolResult. */
interface CallOutcome {
  ok?: boolean;
  text?: string;
}

/** What an MCP call answers with. */
interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface BridgeOptions {
  /** The tools on the page right now. Called again on every dispatch, never cached. */
  listTools: () => Promise<Tool[]> | Tool[];
  /**
   * Perform one. The bridge cannot touch the page except through this, which is what
   * makes a confirmation gate inside it un-bypassable from WebMCP.
   *
   * Two asymmetries, both deliberate and neither obvious:
   * - `name` arrives WITHOUT the published `synth_` prefix. That prefix is a publication
   *   detail; an executor should not have to know about it or strip it. This is the name
   *   your own `listTools()` returned.
   * - `args` arrives as an OBJECT, though the caller passed a JSON string. The platform
   *   parses it on the way in, so the envelope never reaches you.
   *
   * RETURNING NOTHING IS A FAILURE, not a success. `if (!confirmed) return;` is how a
   * confirmation gate is written, and treating that as "done" would turn a human's refusal
   * into permission. Say what happened: a ToolResult, or `{ ok, text }`.
   */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Told what each refresh registered, skipped, or failed to register. */
  onPublish?: (summary: {
    added: string[];
    skipped: string[];
    failed: { name: string; error: string }[];
    budgetReached: boolean;
  }) => void;
  /**
   * Re-publish by itself after every successful call. Default TRUE, and leave it that way
   * unless you have a reason: a caller who forgets to refresh leaves every outside agent
   * on a stale list forever, and nothing tells them.
   */
  autoRefresh?: boolean;
  /**
   * Most tools this document will ever publish. Default 200, 0 for no limit. Names are
   * permanent, so a page that mints a control per row could otherwise grow without bound.
   * Reaching it stops NEW registrations; everything published keeps resolving live.
   */
  maxPublished?: number;
}

interface Bridge {
  /** Register anything new. Existing names are left alone; they cannot be replaced. */
  refresh(): Promise<{
    added: string[];
    skipped: string[];
    failed: { name: string; error: string }[];
    /** True once `maxPublished` is reached: new names are no longer registered. */
    budgetReached: boolean;
  }>;
  /** Published name -> the name the provider knows it by. */
  readonly published: Map<string, string>;
  /** Names the site declared for itself. Never claimed, never overwritten. */
  readonly siteDeclared: Set<string>;
  /**
   * Answer honestly from now on. Registrations cannot be withdrawn — and the names are not
   * released either, so a later publish() skips them instead of claiming them. A stopped
   * bridge's tools are permanently dead and unclaimable.
   */
  stop(): void;
}

interface ConsumerView {
  tools: {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    /** True when the description carries the synthesized marker. */
    synthesized: boolean;
  }[];
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
}

/** Chrome's ModelContext, which is newer than lib.dom. Only what this module touches. */
interface RegisteredToolLike {
  name: string;
  description: string;
  /** getTools() hands this back as a STRING however it was registered. */
  inputSchema: string | JSONSchema;
  origin?: string;
  title?: string;
}

interface ModelContextLike {
  /**
   * Fires when the published set changes. This is how an outside agent learns to re-read:
   * it cannot refresh us, but it is told, and can call getTools() again. Measured: it fires
   * on both publish and refresh, and getTools() then returns the new set.
   */
  ontoolchange: ((e: Event) => void) | null;
  getTools(): Promise<RegisteredToolLike[]>;
  /** Resolves to undefined. NOT a handle: there is no unregister and no replace. */
  registerTool(descriptor: {
    name: string;
    /** Settable, and returned verbatim. Sites that declare tools normally leave it empty. */
    title?: string;
    /**
     * Accepted and then IGNORED: the browser keeps the page's origin whatever is passed.
     * Declared here so the measurement is written down where someone would try it.
     */
    origin?: string;
    description: string;
    inputSchema: JSONSchema;
    execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
  }): Promise<void>;
  /**
   * Takes the RegisteredTool object, and the arguments as a JSON STRING — and resolves
   * with a JSON STRING too, not an object. Reading `.isError` off the return value gives
   * undefined and turns a refusal into an apparent success.
   */
  executeTool(tool: RegisteredToolLike, argsJson: string): Promise<string>;
}

interface Document {
  modelContext?: ModelContextLike;
}

interface PageToolsBridgeApi {
  available(): { ok: boolean; reason: string };
  publish(options: BridgeOptions): Promise<Bridge>;
  consume(): Promise<ConsumerView>;
  providerOverPostMessage(options?: { timeoutMs?: number }): {
    listTools: () => Promise<Tool[]>;
    callTool: (name: string, args: unknown) => Promise<unknown>;
  };
  serveOverPostMessage(provider: {
    listTools: () => Promise<Tool[]> | Tool[];
    callTool: (name: string, args: unknown) => unknown;
  }): () => void;
  MARK: string;
  FALLBACK_MARK: string;
  version: string;
}

declare var PageToolsBridge: PageToolsBridgeApi;

/* ---------------------------------------------------------------- read-results.js
 *
 * The first few results on a page of results. A separate global (`PageToolsResults`) and a
 * separate file, because it is a separate job: the synthesizer says what can be DONE to a
 * page, this says what the page is SHOWING. A caller that only wants one of them vendors
 * one file.
 */

/** One result, as data rather than as prose. */
interface PageResult {
  /** The text of the link that titles it. */
  title: string;
  /** The longest piece of text in the block that is not the title. */
  snippet: string;
  /** The short pieces beside it: a rating, a price, "closed", "opens 7 PM". At most three,
   *  each short enough to be read out loud without becoming a sentence. */
  extra: string[];
  /** Where the titling link goes. */
  url: string;
}

interface PageResults {
  /** The first `limit` of them, in the order the page shows them. */
  results: PageResult[];
  /** How many the page has. */
  found: number;
  /** Are there more below the ones returned? The difference between "five results" and
   *  "the five results", and it is the caller's to say out loud. */
  more: boolean;
}

interface PageToolsResultsApi {
  readResults(options?: { root?: ParentNode; limit?: number }): PageResults;
  titleLink(block: Element): HTMLAnchorElement | null;
  isVisible(el: Element): boolean;
  LIMIT: number;
  version: string;
}

/* Declared the same way the synthesizer's global is, and for the same reason: `declare var`
 * rather than `const`, so the file that PUTS it there type-checks as well as the files that
 * read it. `declare const` type-checks every reader and then refuses the one assignment
 * that makes any of them true. */
interface Window {
  PageToolsResults: PageToolsResultsApi;
}

declare var PageToolsResults: PageToolsResultsApi;

/* ============================ drive-the-page ============================
 *
 * The hands. The synthesizer reads a page; these do things on it — and they are typed here
 * beside it because a consumer loads both from the same place.
 */

/** The few facts that answer "did anything happen". */
interface PageSnapshot {
  url: string;
  links: number;
  title: string;
  ticked: number;
  filled: number;
}

/** The product's own voice, handed to readPage.
 *
 * How many results a listener can hold, and how a page is shaped for hearing, are decisions
 * about a PERSON rather than about a page — so they stay with the consumer, exactly as
 * readResults takes its own limit. */
interface SayThePage {
  results(read: PageResults): string;
  shape(page: {
    title: string;
    url: string;
    headings: string[];
    links: string[];
    text: string;
  }): string;
  resultsLimit: number;
}

interface PageToolsHandsApi {
  /** Press anything, HTML or not — an SVG link has no click(). */
  press(el: Element | undefined): void;
  /** Put a value in a control. A select is chosen by its LABEL. */
  setValue(el: Element, value: unknown): void;
  /** What a control HOLDS, in the words it was asked in. */
  whatItHolds(el: Element): string;
  /** Read a field back once the control has TAKEN the value, or answer with what it holds.
   *  Judges arrival with FilledIn.tookIt, so filled-in.js loads first. */
  asItTakesIt(el: Element, asked: unknown): Promise<string>;
  snapshot(): PageSnapshot;
  /** What moved since a snapshot, in a sentence, or "nothing visible changed". */
  changedSince(before: PageSnapshot): string;
  /** What the page is complaining about, if anything. Needs filled-in.js. */
  complaints(): string[];
  /** The page, read out. Needs read-results.js. */
  readPage(say: SayThePage): { text: string; results?: number; of?: number };
  version: string;
}

/* `declare var` for the same reason as the two above: the file that PUTS it there has to
 * type-check as well as the files that read it. */
interface Window {
  PageToolsHands: PageToolsHandsApi;
}

declare var PageToolsHands: PageToolsHandsApi;

/* ============================ filled-in ============================
 *
 * Is this form actually filled in, and did the page accept it? Pure judgement, no DOM.
 */
interface FilledInApi {
  NOT_CHOSEN: string[];
  hasAValue(value: unknown): boolean;
  missing(schema: JSONSchema, args: Record<string, unknown>): string[];
  nothingButEmpties(schema: JSONSchema, args: Record<string, unknown>): string[];
  askForThem(fields: string[]): string;
  tookIt(asked: unknown, holds: unknown): boolean;
  countedErrors(text: string): string | null;
  saysNothingIsWrong(text: string): boolean;
  problems(result: { text?: string; problems?: string[] } | null | undefined): string[];
  saySoInstead(problems: string[]): string;
}

/* No `declare var` for this one, and no Window entry: filled-in.js is a bare classic script
 * that declares `const FilledIn` at the top level of the shared global scope — so the file
 * itself is the declaration, and a `var` here would be a second one of the same name. A
 * top-level const is not a property of `window` either, so saying it was would be a lie a
 * consumer could act on. */

/* ============================ voice-lines ============================
 *
 * The handful of sentences a phone says for ITSELF — no key, a dropped line, a hold that ran
 * too long. Each one is a text AND a recording, and the two come from this one table, because
 * a recording that says something other than the text somebody reads is the failure this
 * cannot have.
 */

/* Named VoiceLineRecord rather than VoiceLine on purpose: voice-lines.js carries its own
 * `@typedef {{id, text, file}} VoiceLine`, and that typedef is part of this program, so a
 * second declaration of that name here is a duplicate identifier. A consumer whose program
 * does NOT include the vendored .js declares `type VoiceLine = VoiceLineRecord` on its own
 * side — which is where the name is needed, because that is where the JSDoc reading it lives. */
interface VoiceLineRecord {
  /** Matches the recording's filename, without the extension. */
  id: string;
  /** What gets spoken when the recording is missing, and what the recording was made FROM. */
  text: string;
  /** Path to the clip, relative to the consumer's own root: assets/voice/<id>.mp3. */
  file: string;
}

interface VoiceLinesApi {
  NOT_SET_UP: VoiceLineRecord;
  CONNECTED: VoiceLineRecord;
  RECONNECTING: VoiceLineRecord;
  CANNOT_RECONNECT: VoiceLineRecord;
  KEY_REFUSED: VoiceLineRecord;
  NO_MICROPHONE: VoiceLineRecord;
  NO_PAGE: VoiceLineRecord;
  HELD_TOO_LONG: VoiceLineRecord;
  /** Every line, for whatever records them. */
  all(): VoiceLineRecord[];
  /** The recording for something about to be said, if there is one. */
  find(said: VoiceLineRecord | string): VoiceLineRecord | null;
  /** What to say, recording or not. */
  textOf(said: VoiceLineRecord | string): string;
}

/* No `declare var` here, for the same reason as FilledIn: voice-lines.js declares
 * `const VoiceLines` itself at the top level of a classic script, so the file is the
 * declaration and a second one of the same name is a redeclaration. A consumer whose type
 * program does not include the vendored .js states it on its own side. */
