/**
 * Does connecting hand the session the tools of the page the person is on?
 *
 * The one thing the phone must do when a line comes up. It is here because it broke, silently,
 * in a way nothing else could see: with a blank tab open beside a real page — which is exactly
 * how the film recorder drives the browser — the phone followed the blank one, every scan
 * found nobody, and the session was handed our four general tools and never the page's. A take
 * waited a full minute for a tool list that could not arrive.
 *
 * NO SESSION AND NO KEY. The data channel is stood in for, so what the phone SENDS is readable
 * without spending anything. It needs Chrome for Testing and the extension, which is why it is
 * NOT in the commit hook: a gate that takes ten seconds and a browser would be turned off
 * within the day. Run it before a take, and after anything that touches which tab is followed.
 *
 *   node scripts/connect-publishes-tools.mjs            # uses this checkout
 *   EXT=/path/to/extension node scripts/connect-publishes-tools.mjs
 *
 * It prints the tab it chose and the lists it published, and exits non-zero when the page's own
 * tools are missing from them.
 */
import { chromium } from '/Users/anton/work/hackathon/hackathon-spike/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Its own page, served over http — a file:// page has no content script and would fail for a
 * reason that has nothing to do with what is being measured. */
const PAGE = `<!doctype html><title>A form</title><h1>Find benefits</h1>
<form><label>Note <input name="n"></label><button type="submit">Save note</button></form>`;
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}).listen(0);
await new Promise((done) => server.once('listening', done));
const FIXTURE = `http://127.0.0.1:${server.address().port}/`;
const CFT = '/Users/anton/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const EXT = process.env.EXT || new URL('..', import.meta.url).pathname; const CDP = 9501;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'connect-'));
const proc = spawn(CFT, [`--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--mute-audio', '--headless=new', 'about:blank'], { stdio: 'ignore' });
await wait(4000);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
const ctx = browser.contexts()[0];
const real = await ctx.newPage(); await real.goto(FIXTURE);
const blank = await ctx.newPage(); // playwright's about:blank, exactly like the recorder's
await wait(1500);
const phone = ctx.pages().find((p) => p.url().includes('/src/phone/'));
const killBlank = process.env.KILL_BLANK === '1';
const out = await phone.evaluate(async (killBlank) => {
  // Stand in for the data channel so a publish is observable without a session.
  window.__sent = [];
  events = { readyState: 'open', send: (t) => window.__sent.push(JSON.parse(t)) };
  theLine.begin(); theLine.live();
  if (killBlank) {
    // The recorder closes its extra page around connect time. Make tabs.update fail the way
    // a vanished tab does.
    const tabs = await chrome.tabs.query({});
    const b = tabs.find((t) => t.url === 'about:blank' || t.pendingUrl === 'about:blank');
    if (b) await chrome.tabs.remove(b.id).catch(() => {});
  }
  const tabsNow = (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url, active: t.active }));
  const pageTabIdBefore = pageTabId;
  const chosen = await findPageTab();
  const started = Date.now();
  let threw = null;
  try {
    await openTheStartPageIfNothingElseDid().then(() => readThePageAndPublish('the first set'));
  } catch (e) { threw = String(e).slice(0, 160); }
  return {
    tabsNow, pageTabIdBefore, chosen: chosen ? { id: chosen.id, url: chosen.url } : null,
    ms: Date.now() - started,
    threw,
    published: window.__sent.filter((e) => e.type === 'session.update').map((e) => (e.session.tools || []).map((t) => t.name)),
    log: [...document.querySelectorAll('#log li')].map((l) => l.textContent).slice(-6),
  };
}, killBlank);
console.log(JSON.stringify(out, null, 1));
const pageTools = out.published.flat().filter((name) => !['open_site', 'read_page', 'fill_in', 'confirm_action'].includes(name));
if (pageTools.length === 0) {
  console.error('\nFAIL: the session was never given the tools of the page — only our own four.');
  console.error('The phone is following the wrong tab, or the scan never reached the page.');
}
await browser.close().catch(() => {}); proc.kill(); server.close();
process.exit(pageTools.length === 0 ? 1 : 0);
