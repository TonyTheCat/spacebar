/**
 * Does every script we wrote still PARSE?
 *
 * Nothing sits between these files and Chrome. There is no bundler, no transpiler and no
 * linter — the folder is loaded as it is — so a syntax error is not caught by anything before
 * the browser reaches it, and the browser does not say so out loud: the extension loads, that
 * one script is silently absent, and the page answers nothing. Which is indistinguishable from
 * a page that has no tools, the exact pair of facts this product exists to keep apart.
 *
 * `node --check` is the parser on its own: no dependency, no execution, no configuration. It
 * reads a file, parses it — as a module for `.mjs`, as a classic script for `.js`, which is
 * what each of them actually is here — and says nothing unless it cannot. That is the whole
 * check, and it is the reason this repository needs no toolchain to be gated.
 *
 * `check-manifest.mjs` is the other half and does not overlap with this one: it resolves the
 * paths the manifest names and the order the bricks load in, and it never opens a file.
 *
 * WHAT IS LEFT OUT, and why. `vendor/` is copies, pinned by sha in `vendor/PINS.md`, with
 * their own conventions — this repository does not get to have an opinion about them.
 * `node_modules/` is not ours either, and there is none: nothing is installed here.
 *
 * This walks the directory rather than asking git for the file list, on purpose. The judges'
 * instruction is `npm run verify`, and what that lands in is not always a clone — a downloaded
 * folder is a folder, and a check that needs a `.git` next to it to find anything is a check
 * that reports zero files and exits 0, which reads exactly like a repository that passed.
 */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that are not our source. See the note above for why each one is here. */
const NOT_OURS = new Set(['.git', 'node_modules', 'vendor']);

/** @param {string} directory @returns {string[]} absolute paths of every script under it */
const scriptsUnder = (directory) => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (NOT_OURS.has(entry.name)) continue;
      found.push(...scriptsUnder(join(directory, entry.name)));
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
};

const scripts = scriptsUnder(ROOT).sort();
const problems = [];

for (const script of scripts) {
  try {
    execFileSync(process.execPath, ['--check', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    /* Node prints the offending line, a caret under it and the message. Kept whole: the point
     * of a parse failure is WHERE it is, and a one-line summary throws that away. */
    const said = String(error.stderr || error.message).trim();
    problems.push(`${relative(ROOT, script)} does not parse — Chrome would load without it:\n${said}`);
  }
}

if (problems.length) {
  console.error('a script this extension loads does not parse:');
  for (const one of problems) console.error(`  - ${one}`);
  process.exit(1);
}

/* A count, because "no output" and "found nothing to check" look the same from outside and
 * mean opposite things — the same distinction this product keeps for a page it could not read. */
console.log(`syntax: ${scripts.length} scripts parse.`);
