# Spacebar

A browser a blind person can drive by voice. Hold the space bar, say what you want, and it acts
on the page — asking first, out loud, with the values, before anything is sent.

Built at AI Tinkerers Asunción, *Agents, Everywhere*, 12 September 2026. This README's first
section was written before the first line of code, so that the line between what was prepared
and what was built today is stated up front rather than reconstructed from timestamps.

## What was prepared before today, and what was built today

The rules for this hackathon allow libraries prepared in advance; the project itself is created on
the day. This section says exactly where the line falls in this repository, so that nobody has to
guess by reading commit timestamps.

### Prepared in advance — libraries

These are copied in as files and pinned by commit. They are not installed: every library here is a
classic script that the extension loads by path, with no build step. Their repositories are
private, and an `npm install` from a private remote needs a token — in an environment with a clock
running, that is a wall rather than an inconvenience. The pin is the sha, and it is recorded in
`vendor/PINS.md`.

| library | what it does | commit |
|---|---|---|
| `page-tools-synth` / `synthesize.js` | Reads a live page and returns the tools an agent can use: accessible names computed in the page, fields grouped by their container rather than by `<form>`, the commit button chosen properly, links collapsed into one way to navigate. | `48adf98` |
| `page-tools-synth` / `read-results.js` | Pulls a result list out of a page by repeated structure, with no site-specific selectors, and leaves the page's own furniture out of it. | `48adf98` |
| `page-tools-synth` / `drive-the-page.js` | The hands: pressing any element including a link inside an `<svg>`, choosing a select option by the label a person would say, reading a value back only once the page has taken it, and telling a page's real complaint from its own announcement. | `48adf98` |
| `page-tools-synth` / `filled-in.js` | The rules for "did that actually go in?" and "did the page refuse this?", separated from anything that knows about a browser extension. | `48adf98` |

Each of those files carries comments that name the page a behaviour was measured on. That is on
purpose: the library layer is where measurements live, and a rule without its measurement is a
guess that somebody will delete next year.

### Built today

Everything that knows about this product rather than about web pages in general:

- the extension itself — manifest, background service worker, and the content scripts that connect
  the page to the rest;
- the phone: a pinned tab that holds one voice session, publishes the page's tools to the model,
  and speaks;
- push-to-talk: the space bar claimed on the page, and the microphone kept closed between turns;
- the gate: the question asked out loud before anything is submitted, the values read back inside
  that question, consent taken only from the transcript of the person's own voice, and a password
  named but never spoken;
- the settings page, the start page, and the lines the product says when the session itself has
  broken.

### The proof, not the claim

`verify-tools/` runs the whole errand against fixtures and against live pages without ever calling
OpenAI: the gate's properties, the talk key, the form. It is meant to be run by somebody who does
not believe us.

```
node verify-tools/errand-check.mjs
```

## Working on this repository

Nothing is installed. There is no build step and no dependency — the folder is what Chrome
loads — so a clone needs `node` (20 or newer) and `git` and nothing else.

The one thing to do once, in a fresh clone, is point git at the committed hook:

```
npm install          # installs nothing; its only job is to set core.hooksPath
```

or, the same thing without npm:

```
git config core.hooksPath .githooks
```

`.githooks/pre-commit` then runs on every commit: it resolves every path `manifest.json` names
and refuses a vendored script loaded before something it reads, and it runs the tests. Without
that one command the hooks directory is simply not consulted and a clone looks exactly like a
gated one while checking nothing — which is why the line is here rather than assumed.

### Loading it into Chrome

`chrome://extensions` → Developer mode → **Load unpacked** → this folder. Not
`--load-extension`: in branded Chrome that flag fails silently, with one line in a log and an
empty extensions page.
