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

## Setting it up, once, by somebody who can see

The person who will use Spacebar never sees a settings page. Somebody sighted does this once,
sitting next to them, and then hands the machine over.

1. **Load it** — see [Loading it into Chrome](#loading-it-into-chrome) below.
2. **Open the settings page.** Right-click the Spacebar icon in the toolbar → *Options*.
3. **Enter the OpenAI key** and press *Save the key*. It is kept in this Chrome profile and
   sent nowhere but OpenAI. The page confirms that a key is saved and never shows it back.
4. **Press *Check the microphone*.** Chrome asks for the microphone once, in a dialog. Answer
   it now, while you can see it — otherwise the first thing they say goes into a box they
   cannot find.
5. **Close the tab.** There is nothing else to press, ever.

The key lives in that Chrome profile, so set it up in the profile they will actually use.

## Using it

1. **Open Chrome.** A pinned tab opens by itself, connects, and says where you are. Nothing to
   find, nothing to click.
2. **Hold the space bar** on the page you are on — not in any window of ours — and say what you
   want: *"search for the benefit finder"*, *"open the second one"*, *"tick disability and
   apply"*. **Let go** when you are done. The microphone is closed while the key is up.
3. **It acts, and tells you what came of it:** where you are now, or the first few results by
   name. Ask for more if you want the rest.
4. **Before anything is sent, it asks first** — and the question carries the values about to
   go: *"…with disability "true" — shall I?"* Say **yes** and it presses; say **no** and the
   page does not move. Only your own spoken yes counts.
5. **A password is named, never spoken.** The question says *"password filled in, which I am
   not saying out loud"*, and the log writes `(hidden)`.

One field per turn, in the page's own words: *"July"* for a month, the option as the page
lists it. A whole form in one breath is more than the model will fill.

### What it says when something is wrong

These are the phone's own sentences, recorded in advance (`vendor/voice-lines.js`), so they
sound the same every time — including the times when the session itself is what has broken:

| when | it says |
|---|---|
| no key saved yet | *Page Tools is not set up yet. Ask your helper to enter the key in its settings.* |
| the key was rejected | *The key was refused. Ask your helper to check it in the settings.* |
| connected | *Ready. Hold the space bar and tell me what you want.* |
| the connection dropped | *The connection dropped. Reconnecting.* |
| it could not come back | *I could not get the connection back. Press Connect to try again.* |
| the microphone is blocked | *I can't hear you. The microphone is not allowed for this browser.* |
| no page to work on | *There is no page open for me to work on. Open a site and try again.* |
| the key was held too long | *I stopped listening. Let go of the key and press it again.* |

The pinned tab shows the same in writing: a state line (*not connected*, *connected, hold Space
to talk*, *reconnecting…*) and a log of what happened. If something goes wrong, that log is
where to look.

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
