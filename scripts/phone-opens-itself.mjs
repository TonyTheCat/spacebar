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
import { mkdtempSync, rmSync, lstatSync, unlinkSync, readlinkSync } from 'node:fs';
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
 * They are runtime artifacts, not profile data, so removing them from a copy takes nothing
 * away. Taking them from a profile a browser is USING is another thing entirely: the lock is
 * what stops two Chromes sharing one profile and corrupting it, which is why Chrome would
 * rather not start than proceed without it.
 *
 * So this asks whether the lock is STALE rather than trusting a comment that says "only point
 * this at a copy". A warning with nothing enforcing it is a hole with a note beside it — the
 * lesson of the afternoon this cost, applied to the file that taught it. The lock names the
 * process that holds it, host-pid; if that process is alive here, the profile is in use and
 * this refuses rather than removing anything. A dead pid is a crash left behind, and that one
 * is safe to clear — which is also why the test is the PID and not the mere presence of a
 * lock: refusing on a stale one would refuse a run that was going to work. */
const holderOf = (lock) => {
  try {
    // "Antons-MacBook-Pro.local-79257" — the machine, then the process that took it.
    const pid = Number(readlinkSync(lock).split('-').pop());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const stillRunning = (pid) => {
  try {
    // Signal 0 asks the question without sending anything: alive, or not ours to ask about.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM'; // alive, and belongs to somebody else
  }
};

/* lstat, NOT exists, and this one is measured on the real profile: SingletonLock is a symlink
 * to "host-pid", a name and not a path, so it points at nothing that exists. existsSync
 * FOLLOWS the link and answers false about a file that is plainly there — so the first version
 * of this loop skipped the one file that actually blocks Chrome, removed SingletonSocket
 * (which does resolve), and left me believing the instrument handled it. The green runs came
 * from an `rm -f` I had typed myself minutes earlier. */
const thereIsOne = (at) => {
  try {
    return Boolean(lstatSync(at));
  } catch {
    return false;
  }
};

for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
  const at = join(profile, lock);
  if (!thereIsOne(at)) continue;

  const holder = holderOf(at);
  if (holder && stillRunning(holder)) {
    console.error(
      `${profile} is in use: ${lock} is held by process ${holder}, which is running.\n` +
        'Refusing to touch it — that lock is what stops two browsers sharing one profile.\n' +
        'Close that browser, or point this at a COPY of the profile.'
    );
    process.exit(3);
  }

  unlinkSync(at);
  console.log(`removed a stale ${lock} (held by ${holder ?? 'nobody named'}, not running)`);
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
