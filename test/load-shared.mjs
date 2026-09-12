/* Loading a shared module into a test.
 *
 * Everything in src/shared is a classic script that declares one global — that
 * is what the extension needs, because a content script and an extension page
 * load these with <script> tags and there are no ES modules in either place. A
 * test therefore cannot import them; it evaluates the file and reads the global
 * back out.
 *
 * It is one helper rather than the same eight lines at the top of every test
 * file, for a reason that is about the tests rather than about tidiness: these
 * files share ONE global scope in the browser, so a test that evaluates two of
 * them has to do it in ONE context to be exercising what actually ships. A
 * per-file copy of the boilerplate makes that awkward and it will be needed —
 * the phone's modules read each other.
 *
 * `extras` is what the module needs from the platform. Deliberately not the
 * whole of globalThis: a module that reaches for something nobody listed shows
 * up here as a ReferenceError in a test, rather than as a missing global in a
 * live session.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} file  A file name in src/shared, e.g. 'gating.js'. */
const sourceOf = (file) => readFileSync(join(here, '..', 'src', 'shared', file), 'utf8');

/**
 * @param {string} file  The file in src/shared.
 * @param {string} global  The global it declares, e.g. 'Gating'.
 * @param {Record<string, unknown>} [extras]  What the module needs from the platform.
 * @returns {any}
 */
export const loadShared = (file, global, extras = {}) => {
  const sandbox = { ...extras };
  vm.createContext(sandbox);
  return vm.runInContext(`${sourceOf(file)}\n;${global}`, sandbox);
};
