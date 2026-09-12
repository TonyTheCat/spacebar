/**
 * Does the phone open by itself, and is the one that appears ALIVE?
 *
 * The first thing the product must do, and the thing that failed every real take of the film:
 * the service worker started, no phone opened at all, and the session was never told anything
 * because there was nothing there to tell it.
 *
 * WHY IT NEEDS A PROFILE ARGUMENT TO MEAN ANYTHING. Under --load-extension Chrome treats every
 * launch as a fresh install, so onInstalled fires and a throwaway profile always passes — this
 * check is green on a clean profile no matter what the code does. The failure lives in a
 * profile where the extension id is ALREADY registered from earlier real runs (Load unpacked),
 * where neither onStartup (never fires under that flag) nor onInstalled is reached. The id
 * comes from the FOLDER, so reproducing it means the same profile AND the same extension path
 * the recorder uses.
 *
 *   PROFILE=/tmp/a-copy-of-the-demo-profile EXT=/Users/anton/work/hackathon/spacebar \
 *     node scripts/phone-opens-itself.mjs
 *
 * Copy the profile first; this launches a browser against whatever it is given. Exits non-zero
 * when no phone opens, or when the one that opens is a corpse from a dead extension context.
 */
import { chromium } from '/Users/anton/work/hackathon/hackathon-spike/node_modules/playwright/index.mjs';

/* A browser that never starts is a FAILED check, not a silent one.
 *
 * Without this the launch throws, the process dies on an uncaught rejection, and the shell
 * still sees exit 0 from the pipeline it was in — so a run that never tested anything reads as
 * a pass. That is worse than no check: it is a check that lies in the reassuring direction. */
process.on('unhandledRejection', (why) => {
  console.error(`the browser did not start: ${String(why).slice(0, 300)}`);
  process.exit(2);
});
import { mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const EXT = process.env.EXT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = process.env.PROFILE || mkdtempSync(join(tmpdir(), 'calm-'));
/* A COPIED PROFILE CARRIES ITS LOCK, and Chrome then refuses to start at all.
 *
 * SingletonLock, SingletonSocket and SingletonCookie are symlinks naming the machine and the
 * process that last held the profile. Copy a profile and they come with it, pointing at a
 * process that is not this one — Chrome prints "Failed to create a ProcessSingleton for your
 * profile directory ... Aborting now to avoid profile corruption" and exits 21.
 *
 * This cost a whole afternoon. The failure looks nothing like a lock: the browser simply never
 * comes up, and an instrument that copied a profile reports no phone — which reads exactly
 * like the product being broken, and sent three people looking for a defect in the extension
 * that was not there.
 *
 * They are runtime artifacts, not profile data, so removing them from the copy takes nothing
 * away. Never do this to a profile somebody is using — only to a copy. */
for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
  const at = join(profile, lock);
  if (existsSync(at)) {
    unlinkSync(at);
    console.log(`removed a stale ${lock} from the profile copy`);
  }
}

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--mute-audio',
    '--headless=new', '--no-first-run', '--no-default-browser-check'],
});
let phone = null;
const started = Date.now();
for (let i = 0; i < 24 && !phone; i++) {
  phone = ctx.pages().find((p) => p.url().includes('/src/phone/')) ?? null;
  if (!phone) await wait(500);
}
const ms = Date.now() - started;
const workers = ctx.serviceWorkers().length;
let alive = null;
if (phone) {
  await wait(1200);
  alive = await phone.evaluate(() => {
    try { return typeof chrome !== 'undefined' && !!chrome.runtime?.id; } catch { return false; }
  }).catch((e) => `evaluate threw: ${String(e).slice(0, 80)}`);
}
console.log(JSON.stringify({
  serviceWorkers: workers,
  phoneOpened: Boolean(phone),
  msToOpen: phone ? ms : null,
  phoneAlive: alive,
  pages: ctx.pages().map((p) => p.url().slice(0, 70)),
}, null, 1));
await ctx.close().catch(() => {});
if (!process.env.PROFILE) rmSync(profile, { recursive: true, force: true });
process.exit(phone && alive === true ? 0 : 1);
