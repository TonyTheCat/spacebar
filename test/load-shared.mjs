/* Loading a shared module into a test.
 *
 * Everything in src/shared is a classic script that declares one global — that is what the
 * extension needs, because a content script and an extension page load these with <script>
 * tags and there are no ES modules in either place. A test therefore cannot import them; it
 * evaluates the file and reads the global back out.
 *
 * It is one helper rather than the same eight lines at the top of every test file, for a
 * reason that is about the tests rather than about tidiness: these files share ONE global
 * scope in the browser, so a test that evaluates two of them has to do it in one scope to be
 * exercising what actually ships.
 *
 * WHY THIS IS NOT `vm`, which is the obvious way to write it and was the first way it was
 * written. A vm context is a separate REALM: it has its own Array, its own Object, its own
 * every intrinsic. An empty array created by a line inside the module is therefore not an
 * instance of the test's Array, and `node:assert/strict` — which every test file here imports
 * — compares prototypes. So this passed:
 *
 *     assert.deepEqual(namesIn({ tools: [{}, { name: 'navigate' }] }), ['', 'navigate'])
 *
 * because that array is built by `.map` over an array the TEST made, and this failed:
 *
 *     assert.deepEqual(namesIn(null), [])
 *
 * because that `[]` is a literal inside the module, born in the other realm — "Values have
 * same structure but are not reference-equal", about two empty arrays. A real defect in the
 * harness that reads exactly like a defect in the code under test, and the module is correct.
 *
 * So the module is evaluated in THIS realm, and the isolation that `vm` was there for is kept
 * by a scope object instead: `extras` is what the module may reach for, and anything else it
 * touches throws by name. That property is the point and not a nicety — a module that quietly
 * finds a global nobody handed it passes here and is missing in a live session, which is the
 * failure this whole repository keeps being surprised by. `vm` reported it as a bare
 * ReferenceError; this reports which module reached for what.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} file  A file name in src/shared, e.g. 'gating.js'. */
const sourceOf = (file) => readFileSync(join(here, '..', 'src', 'shared', file), 'utf8');

/* The LANGUAGE, which every module may use without listing it, and nothing else.
 *
 * Deliberately the ECMAScript intrinsics rather than "whatever this Node has on globalThis".
 * Node carries a good deal of the web platform now — WebSocket, Response, Event, performance —
 * and those are exactly the names a phone module must not be able to find by accident: in the
 * browser they behave differently or are not there at all, and a test that silently borrows
 * Node's is a test that proves nothing about the extension.
 *
 * What it leans on, said out loud: every module in src/shared declares its global with a
 * top-level `const`, never `var` or a function declaration. A `var` would go to the enclosing
 * function scope rather than the block inside the `with`, and `return Gating` would then ask
 * the scope object for it and be told nobody listed it. That fails LOUDLY, with the name in
 * the message, which is why it is a note rather than a guard. */
const LANGUAGE = new Set([
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'EvalError',
  'FinalizationRegistry', 'Function', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN',
  'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError', 'Reflect', 'RegExp',
  'Set', 'String', 'Symbol', 'SyntaxError', 'TypeError', 'URIError', 'WeakMap', 'WeakRef',
  'WeakSet', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'globalThis',
  'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined',
]);

/**
 * @param {string} file  The file in src/shared.
 * @param {string} global  The global it declares, e.g. 'Gating'.
 * @param {Record<string, unknown>} [extras]  What the module needs from the platform.
 * @returns {any}
 */
export const loadShared = (file, global, extras = {}) => {
  const scope = new Proxy(extras, {
    /* `with` asks this about every unqualified name the module mentions. True means "I have
     * it", and the get trap below then either hands it over or names it as unlisted; false
     * lets the name fall through to this realm, which is how the language stays available. */
    has: (listed, name) => {
      if (typeof name === 'symbol') return false; // Symbol.unscopables, and nothing else asks
      return name in listed || !LANGUAGE.has(name);
    },
    get: (listed, name) => {
      if (typeof name === 'symbol') return undefined;
      if (name in listed) return listed[name];
      throw new ReferenceError(
        `${file} reached for "${String(name)}", which this test did not hand it. ` +
          'Add it to the third argument of loadShared if the extension really provides it.'
      );
    },
  });

  /* Not an arrow and not a module: a classic Function body is non-strict, which is what makes
   * `with` legal — and these files are non-strict classic scripts in the browser too, so this
   * is the same shape they actually run in. The module's own `const` lands in the block inside
   * the with, so it is found before the scope object is asked. */
  return new Function('__scope', `with (__scope) { ${sourceOf(file)}\n; return ${global}; }`)(scope);
};
