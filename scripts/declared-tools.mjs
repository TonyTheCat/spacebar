/**
 * Does the page-side half of WebMCP work against a REAL declaration?
 *
 * A site can publish tools for an agent through `document.modelContext`. Almost nothing does,
 * so this path had never been run against an actual declaration — and until now there was no
 * path: main-world.js listened and answered nothing.
 *
 * WHAT THIS EXERCISES, said plainly because the distinction decides what a green run means:
 * the REAL platform API, not a stand-in. Chrome for Testing exposes document.modelContext with
 * --enable-features=WebMCP, and it still exposes it with an extension loaded — measured in
 * three configurations, against the claim that it does not. So the fixture registers real
 * tools, and our MAIN-world script reads them the way it will read a real site's.
 *
 * WHAT IT DOES NOT REACH YET: the phone. isolated.js does not ask the MAIN world, so nothing
 * declared travels to the session. This checks the half that exists.
 *
 * ONE MORE MEASURED ASYMMETRY, because it cost this probe its first run: registerTool wants
 * inputSchema as an OBJECT going in ("Failed to convert value to 'object'" otherwise), and
 * getTools hands it back as a JSON STRING coming out. The same field, two types, depending on
 * direction. A fixture that stringifies it registers nothing at all, silently as far as the
 * page is concerned — the error lands in the console and the tool list is simply empty.
 *
 *   node scripts/declared-tools.mjs
 *
 * No key, no session, its own page. Exits non-zero when the declaration is not read back, when
 * the schema does not arrive as an object, or when running a declared tool does not reach the
 * page's own function.
 */
import { chromium } from '/Users/anton/work/hackathon/hackathon-spike/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.on('unhandledRejection', (why) => {
  console.error(`the browser did not start: ${String(why).slice(0, 300)}`);
  process.exit(2);
});

const EXT = process.env.EXT || new URL('..', import.meta.url).pathname;

/* A site that declares two tools: one that only counts, and one that cannot be undone. Both
 * matter — the gate must ask about BOTH, because WebMCP says nothing about which is which. */
const PAGE = `<!doctype html><title>Notes that declare themselves</title>
<h1>Notes</h1><p id="said">nothing yet</p>
<script>
  let notes = ['milk', 'dentist'];
  document.modelContext.registerTool({
    name: 'count_notes',
    description: 'How many notes are saved.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      document.getElementById('said').textContent = 'counted';
      return { content: [{ type: 'text', text: 'there are ' + notes.length + ' notes' }] };
    },
  });
  document.modelContext.registerTool({
    name: 'delete_all_notes',
    description: 'Delete every note. This cannot be undone.',
    inputSchema: { type: 'object', properties: { sure: { type: 'string' } } },
    async execute() {
      notes = [];
      document.getElementById('said').textContent = 'deleted';
      return { content: [{ type: 'text', text: 'all notes deleted' }] };
    },
  });
</script>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}).listen(0);
await new Promise((done) => server.once('listening', done));
const FIXTURE = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'declared-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [
    '--enable-features=WebMCP',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--mute-audio',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[PAGEERROR]', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text().slice(0, 200)); });
await page.goto(FIXTURE);
await new Promise((r) => setTimeout(r, 1200));

/* Asked the way isolated.js will ask: a stamped postMessage from the page's own window, which
 * is what our handler's `event.source === window` check expects. */
const out = await page.evaluate(async () => {
  /* The ANSWER is matched, never merely the id. window.postMessage delivers to this very
   * window, so a listener keyed on the id alone hears the probe's own question and reports it
   * as a reply — which is how an instrument tells you a path works when nothing answered at
   * all. Caught on this probe's own second run. */
  const ask = (type, expected, body) =>
    new Promise((done) => {
      const askId = `probe-${Math.random()}`;
      const heard = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (data?.channel !== 'spacebar/v1' || data?.askId !== askId || data?.type !== expected) return;
        window.removeEventListener('message', heard);
        done(data);
      };
      window.addEventListener('message', heard);
      window.postMessage({ channel: 'spacebar/v1', type, askId, ...body }, '*');
      setTimeout(() => {
        window.removeEventListener('message', heard);
        done(null);
      }, 2000);
    });

  const here = {
    modelContext: typeof document.modelContext,
    ptSeenByPage: typeof PT,
  };
  const report = await ask('declared-request', 'declared-result', {});
  const ran = await ask('declared-execute-request', 'declared-execute-result', { name: 'count_notes', args: {} });
  const missing = await ask('declared-execute-request', 'declared-execute-result', { name: 'no_such_tool', args: {} });
  return {
    here,
    answered: report !== null,
    ranAnswered: ran !== null,
    /* The payload travels under ONE named key, which is what protocol.js says the envelope
     * looks like. Read off the envelope instead, a live declaration reads as no WebMCP at all
     * — which is how this probe and the page side first disagreed. */
    available: report?.declared?.available,
    where: report?.declared?.where,
    names: (report?.declared?.tools ?? []).map((t) => t.name),
    sources: [...new Set((report?.declared?.tools ?? []).map((t) => t.source))],
    schemaIsObject: (report?.declared?.tools ?? []).map((t) => typeof t.inputSchema),
    schemaProperties: (report?.declared?.tools ?? []).map((t) => Object.keys(t.inputSchema?.properties ?? {})),
    ran: { ok: ran?.result?.ok, text: ran?.result?.text },
    missing: { ok: missing?.result?.ok, text: missing?.result?.text },
    pageSays: document.getElementById('said').textContent,
  };
});

/* And the PHONE half: does what the site declared actually reach the session, under the site's
 * own names, and does the gate insist on asking about it? The wire working is not the same as
 * the phone calling it — that gap is exactly what a reviewer found after the page side landed. */
const phone = ctx.pages().find((p) => p.url().includes('/src/phone/'));
const fromThePhone = phone
  ? await phone.evaluate(async (fixture) => {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((t) => t.url === fixture || t.url?.startsWith(fixture));
      if (!target) return { error: 'the fixture tab was not found from the phone' };
      pageTabId = target.id;
      const scan = await chrome.tabs.sendMessage(target.id, { type: PT.SCAN_REQUEST });
      const offered = toolsOf(scan);
      const declaredTool = (scan?.declared?.tools ?? []).find((t) => t.name === 'delete_all_notes');
      return {
        scanCarriesDeclared: Array.isArray(scan?.declared?.tools) ? scan.declared.tools.length : null,
        offeredNames: offered.map((t) => t.name),
        // every declared tool must be gated, whatever it claims about itself
        gatedByTheRule: (scan?.declared?.tools ?? []).map((t) => Gating.mustAskOutLoud(t)),
        // and calling one must PARK rather than run
        parkedAnswer: declaredTool
          ? await runOnThePage('delete_all_notes', { sure: 'yes' }, declaredTool)
          : null,
        pageSaysAfterTheAsk: null,
      };
    }, FIXTURE)
  : { error: 'no phone tab' };
const pageAfter = await page.evaluate(() => document.getElementById('said').textContent);
console.log(JSON.stringify({ ...out, fromThePhone, pageAfterTheAsk: pageAfter }, null, 1));

const problems = [];
if (out.available !== true) problems.push('the browser reported no WebMCP at all');
if (out.names.length !== 2) problems.push(`expected two declared tools, got ${out.names.length}`);
if (out.sources.join() !== 'declared') problems.push(`every declared tool must carry source 'declared', got: ${out.sources.join()}`);
if (out.schemaIsObject.some((t) => t !== 'object')) problems.push('a schema arrived as something other than an object — it is a JSON string on the wire and must be parsed');
if (!out.schemaProperties.some((keys) => keys.includes('sure'))) problems.push('a parsed schema lost its properties');
if (out.ran?.ok !== true || !/there are 2 notes/.test(out.ran?.text ?? '')) problems.push(`running a declared tool did not reach the page: ${out.ran?.text}`);
if (out.pageSays !== 'counted') problems.push(`the page itself did not run it: ${out.pageSays}`);
if (out.missing?.ok !== false) problems.push('a tool the page does not offer must be refused, not guessed at');
if (fromThePhone?.scanCarriesDeclared !== 2) problems.push(`the scan did not carry the declaration to the phone: ${fromThePhone?.error ?? fromThePhone?.scanCarriesDeclared}`);
if (!(fromThePhone?.offeredNames ?? []).includes('delete_all_notes')) problems.push(`the phone did not offer the site's own tools: ${(fromThePhone?.offeredNames ?? []).join(', ')}`);
if ((fromThePhone?.gatedByTheRule ?? []).some((gated) => gated !== true)) problems.push('a declared tool was not treated as must-ask');
if (fromThePhone?.parkedAnswer?.ok !== false || !/shall I\?/.test(fromThePhone?.parkedAnswer?.text ?? '')) problems.push(`calling a declared tool must ask first, not run: ${fromThePhone?.parkedAnswer?.text}`);
if (pageAfter === 'deleted') problems.push('the page ran an irreversible declared tool that was never agreed to');

await ctx.close().catch(() => {});
rmSync(profile, { recursive: true, force: true });
server.close();

if (problems.length) {
  console.error('\nFAIL:');
  for (const one of problems) console.error(`  - ${one}`);
  process.exit(1);
}
console.log('\nthe declared path reads a real declaration and runs it.');
