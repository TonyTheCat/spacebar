/**
 * Does every page load the globals its own scripts use?
 *
 * Nothing else here can answer that, and the gap is not theoretical. These are classic scripts
 * sharing one global scope on purpose — there is no bundler to resolve an import, no module
 * graph, and no test that loads a page. src/phone/index.html names twenty-odd files by hand;
 * drop one and the page still loads, the extension still installs, and the failure is a
 * ReferenceError thrown inside a live voice session, in front of somebody who cannot read the
 * console it goes to.
 *
 * check-manifest.mjs resolves the paths the MANIFEST names and refuses a wrong vendored order.
 * It never opens an HTML page. So this is the other half: read each page's script list in
 * order, collect what each of those files DEFINES, and refuse a use that nothing on that page
 * provides.
 *
 * ORDER IS DELIBERATELY NOT CHECKED HERE, and that is a measured decision rather than an
 * omission. Every cross-module reference in src/shared sits INSIDE a function — SessionSetup
 * reads SpokenLanguage when opening() is called, StillToSay reads Orientation when it takes a
 * line — and phone.js is last in the list. What matters is that a name is on the page at all,
 * not where. A check that also demanded position would fail correct pages and teach people to
 * ignore it.
 *
 * It is deliberately blunt about what counts as a use: a capitalised name followed by a dot,
 * outside strings and comments, that is not on the platform list below. A false positive costs
 * one name added to that list, announced by a failing commit. A false negative costs a page
 * that throws in front of a person who cannot see the error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The pages that load their own scripts, and whose lists must therefore be complete. */
const PAGES = ['src/phone/index.html', 'src/options/index.html'];

/** What the browser provides. Everything else has to come from a script the page loads. */
const PLATFORM = new Set([
  'Array', 'ArrayBuffer', 'Audio', 'Blob', 'Boolean', 'CustomEvent', 'Date', 'Element', 'Error',
  'Event', 'EventTarget', 'File', 'FileReader', 'FormData', 'Function', 'HTMLAnchorElement',
  'HTMLButtonElement', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLSelectElement',
  'HTMLTextAreaElement', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'MediaStream',
  'MediaStreamTrack', 'MessageEvent', 'NaN', 'Node', 'NodeFilter', 'Number', 'Object', 'Promise',
  'Proxy', 'RTCPeerConnection', 'RangeError', 'Reflect', 'RegExp', 'Request', 'Response', 'Set',
  'SpeechSynthesisUtterance', 'String', 'Symbol', 'TypeError', 'URL', 'URLSearchParams', 'WeakMap',
  'WeakSet', 'WebSocket',
]);

/** The scripts a page loads, in order, as paths from the repository root.
 *  @param {string} page */
const scriptsOf = (page) => {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const here = dirname(page);
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => resolve('/', here, m[1]).slice(1));
};

/** Everything that is not code: strings and comments, where a capitalised word means nothing.
 *
 * ONE left-to-right pass, and it has to be. The obvious version is three independent regex
 * replaces — block comments, then line comments, then each kind of quote — and it is wrong in
 * a way that looks right: this repository's own voice line says "I can't hear you." That
 * apostrophe, reached by a single-quote rule that never saw the double quotes around it, opens
 * a string which then swallows the rest of the file. The first run of this check reported that
 * vendor/voice-lines.js does not define VoiceLines, three lines below where it does.
 *
 * A gate that invents a defect is worse than no gate: it gets switched off, and then the real
 * one goes with it.
 *
 * @param {string} text */
const codeOnly = (text) => {
  let out = '';
  let at = 0;
  while (at < text.length) {
    const ch = text[at];
    const next = text[at + 1];

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      at += 1;
      while (at < text.length && text[at] !== quote) at += text[at] === '\\' ? 2 : 1;
      at += 1;
      out += ' ';
      continue;
    }
    out += ch;
    at += 1;
  }
  return out;
};

/** The names a file DECLARES anywhere — not only at the top level: the vendored bricks wrap
 *  themselves in an IIFE and hand their API to `global.Name`, so a check anchored to the start
 *  of a line reports every one of them as missing.
 *  @param {string} file */
const definedIn = (file) => {
  const text = codeOnly(readFileSync(join(ROOT, file), 'utf8'));
  /** @type {Set<string>} */
  const names = new Set();
  for (const m of text.matchAll(/\b(?:const|let|var|class|function)\s+([A-Z][A-Za-z0-9_]*)\b/g)) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/(?:global|globalThis|window)\.([A-Z][A-Za-z0-9_]*)\s*=/g)) {
    names.add(m[1]);
  }
  return names;
};

/** The globals a file USES: a capitalised name followed by a dot, in code.
 *
 * Not preceded by a dot of its own, which is the difference between a global and a PROPERTY of
 * one. `Consent.YES.test(...)` contains `YES.`, and read without that rule this check reported
 * that nothing on the page defines YES — about a constant inside a module the page loads. The
 * same for `VoiceLines.NO_PAGE.text`. Both were its own second and third false alarms, and a
 * check that cries wolf is a check somebody turns off.
 *
 * @param {string} file */
const usedIn = (file) => {
  const text = codeOnly(readFileSync(join(ROOT, file), 'utf8'));
  /** @type {Set<string>} */
  const names = new Set();
  for (const m of text.matchAll(/(?<![.?\w$])([A-Z][A-Za-z0-9_]*)\s*\./g)) names.add(m[1]);
  return names;
};

const problems = [];

for (const page of PAGES) {
  if (!existsSync(join(ROOT, page))) continue;
  const scripts = scriptsOf(page);

  /** @type {Set<string>} */
  const onThePage = new Set();
  for (const file of scripts) {
    if (!existsSync(join(ROOT, file))) {
      problems.push(`${page}: loads ${file}, which does not exist`);
      continue;
    }
    for (const name of definedIn(file)) onThePage.add(name);
  }

  for (const file of scripts) {
    if (!existsSync(join(ROOT, file))) continue;
    for (const name of usedIn(file)) {
      if (PLATFORM.has(name) || onThePage.has(name)) continue;
      problems.push(`${page}: ${file} uses ${name}, which no script on that page defines`);
    }
  }
}

if (problems.length) {
  console.error('a page is missing a script its own code needs:');
  for (const one of problems) console.error(`  - ${one}`);
  console.error('\nAdd the file to that page\'s script list, or add the name to PLATFORM here.');
  process.exit(1);
}

console.log(`pages: every global used is defined by a script the page loads.`);
