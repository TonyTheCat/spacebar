/* The rule, now that the recordings ARE the voice: every line has a file.
 *
 * speechSynthesis is gone as the fallback — @anton's ruling, once every line had a clip — so a
 * line whose file is missing is no longer shrill, it is SILENT. That is the one failure this
 * product can least afford, and it is invisible in a diff: nothing about adding a line to the
 * table tells you the recording was never made.
 *
 * So it is a gate, and it runs on every commit with the rest. It reads the vendored table —
 * the copy that actually ships — and resolves each path the way the phone does, relative to the
 * extension root.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const VoiceLines = new Function(
  `${readFileSync(join(root, 'vendor', 'voice-lines.js'), 'utf8')}\n;return VoiceLines;`
)();

test('every line the phone can say has a recording behind it', () => {
  const missing = VoiceLines.all()
    .filter((line) => !existsSync(join(root, line.file)))
    .map((line) => `${line.id} -> ${line.file}`);
  assert.deepEqual(missing, [], `these lines would be SILENT: ${missing.join(', ')}`);
});

test('and the recording is a file with something in it', () => {
  // A zero-byte mp3 exists, loads, and says nothing — which is the failure this gate is for,
  // wearing the clothes of the thing that passes it.
  const empty = VoiceLines.all()
    .filter((line) => statSync(join(root, line.file)).size < 1024)
    .map((line) => line.id);
  assert.deepEqual(empty, [], `these recordings are too small to be speech: ${empty.join(', ')}`);
});

test('every line is named, and no two share a file', () => {
  const lines = VoiceLines.all();
  assert.ok(lines.length >= 9, `only ${lines.length} lines — the table lost some`);
  for (const line of lines) {
    assert.ok(line.id, 'a line with no id cannot be looked up');
    assert.ok(line.text.trim(), `${line.id} has no text — the recording was made from it`);
    assert.match(line.file, /^assets\/voice\/.+\.mp3$/, `${line.id}: ${line.file}`);
  }
  const files = lines.map((line) => line.file);
  assert.equal(new Set(files).size, files.length, 'two lines share one recording');
});
