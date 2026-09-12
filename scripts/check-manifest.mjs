/**
 * Does manifest.json still describe an extension Chrome can load?
 *
 * Nothing else in this repository can answer that. There is no bundler and no build step —
 * the folder is loaded as it is — so every path in the manifest is resolved by Chrome and by
 * nothing before it. The two ways that goes wrong are both silent:
 *
 *   A path that does not exist. Chrome refuses the extension outright for some keys, and for
 *   a content script it loads the extension and leaves that script out. A page then answers
 *   no scan, which is indistinguishable from a page that genuinely has no tools — the exact
 *   pair of facts this product is built to keep apart.
 *
 *   A load order that is wrong. The vendored bricks are classic scripts sharing one global
 *   scope, with no import to fix an order up: drive-the-page.js reads FilledIn and
 *   PageToolsResults, so both have to be listed before it. Listed after, the failure is a
 *   ReferenceError in the middle of a form being filled in, in front of somebody who cannot
 *   see it.
 *
 * So this is a text check, run on every commit: read the manifest, resolve every path it
 * names, and refuse an order that puts a brick after something that needs it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Who needs whom, among the vendored scripts. The names are the globals each file defines,
 *  and the rule is one line long: everything a file reads has to be loaded before it. */
const NEEDS = {
  'vendor/drive-the-page.js': ['vendor/filled-in.js', 'vendor/read-results.js'],
};

const problems = [];

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
} catch (error) {
  console.error(`manifest.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

/** Every path the manifest names, with the key it came from, so a failure says where to look. */
const named = [];
const take = (where, value) => {
  if (typeof value === 'string') named.push({ where, path: value });
  else if (Array.isArray(value)) for (const one of value) take(where, one);
  else if (value && typeof value === 'object') for (const one of Object.values(value)) take(where, one);
};

take('background.service_worker', manifest.background?.service_worker);
take('action.default_icon', manifest.action?.default_icon);
take('icons', manifest.icons);
take('side_panel.default_path', manifest.side_panel?.default_path);
take('options_ui.page', manifest.options_ui?.page);
take('web_accessible_resources.resources', (manifest.web_accessible_resources || []).map((one) => one.resources));
for (const [i, script] of (manifest.content_scripts || []).entries()) {
  take(`content_scripts[${i}].js`, script.js);
  take(`content_scripts[${i}].css`, script.css);
}

for (const { where, path } of named) {
  if (!existsSync(join(ROOT, path))) problems.push(`${where}: ${path} does not exist`);
}

for (const [i, script] of (manifest.content_scripts || []).entries()) {
  const js = script.js || [];
  for (const [file, needed] of Object.entries(NEEDS)) {
    const at = js.indexOf(file);
    if (at === -1) continue;
    for (const one of needed) {
      const before = js.indexOf(one);
      if (before === -1) problems.push(`content_scripts[${i}].js: ${file} is loaded without ${one}`);
      else if (before > at) problems.push(`content_scripts[${i}].js: ${one} must come before ${file}`);
    }
  }
}

if (problems.length) {
  console.error('manifest.json does not describe a loadable extension:');
  for (const one of problems) console.error(`  - ${one}`);
  process.exit(1);
}

console.log(`manifest.json: ${named.length} paths resolved, load order holds.`);
