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

These are the phone's own sentences — ten of them, each recorded in advance and played from
the recording, so they sound the same every time, including the times when the session itself
is what has broken. The texts below are the ones in `vendor/voice-lines.js`, which is what the
recordings were made from; there is no browser voice behind them any more, so a line with no
clip is written to the log as `NO CLIP` rather than spoken shrill:

| when | it says |
|---|---|
| no key saved yet | *Spacebar is not set up yet. Ask your helper to add the key in settings.* |
| it could not start with the key it has | *I could not start. Ask your helper to check the key in settings.* |
| the key was rejected | *The key was refused. Ask your helper to check it in the settings.* |
| Chrome is asking for the microphone | *Allow the microphone. Your browser is asking, at the top of the window.* |
| the microphone is blocked | *I can't hear you. The microphone is not allowed for this browser.* |
| connected | *Ready. Hold the space bar and tell me what you want.* |
| the connection dropped | *The connection dropped. Reconnecting.* |
| it could not come back | *I could not get the connection back. Press Connect to try again.* |
| no page to work on | *There is no page open for me to work on. Open a site and try again.* |
| the key was held too long | *I stopped listening. Let go of the key and press it again.* |

The pinned tab shows the same in writing: a state line (*not connected*, *connected, hold Space
to talk*, *reconnecting…*) and a log of what happened. If something goes wrong, that log is
where to look.

## In a workspace behind a login — Ambiguous

Everything above is on public pages. The same key works on a site somebody actually works in
every day, behind a login, that was never built for this — the demo's second site is an
[Ambiguous](https://app.ambiguous.ai) workspace: mail, tasks, documents, one account.

1. **Be on the Docs page** of a workspace you are signed in to — the list of documents, with a
   row of templates above it.
2. **Hold the space bar and say:** *"Start a new document."* Let go.
3. **It asks, naming the button it is about to press:** *"Fill in and submit "Start a new
   document" (2 fields). Commits with the "Create from Blank template" button — shall I?"*
4. **Say yes.** A document appears in the list. Say no, and nothing does.

There is no title field on that page — the tool it read off the markup groups the list's own
filters with the create button — so *"create a document called X"* goes nowhere. Start the
document, then name it, as a second turn.

**Read it back through the workspace's own door.** Ambiguous offers agents an MCP endpoint
(`app.ambiguous.ai/mcp`, with an API key from its *MCP* page). `workspace-readback.mjs` in the
`verify-tools` repository asks that endpoint, read-only, whether a document exists now that
did not before the yes — the workspace's own record, by id, not a picture of a list. Start it
before you speak; it prints the answer when the document lands:

```sh
AMBIGUOUS_API_KEY=ak_… node workspace-readback.mjs watch
# 3 document(s) visible to Elena Galka — waiting up to 120s for one more.
# PASS  the workspace's own API lists the document the gate created — "Project Brief"
#       f1b94fc9-…, created 2026-09-12T17:39:57Z by Elena Galka
#       https://app.ambiguous.ai/docs/f1b94fc9-…
```

The key must belong to the account the page is signed in as: a document is private to whoever
created it, and a read-back through another member's key reports nothing about a document that
is on the screen. `whoami` prints who a key is.

**What that workspace declares, measured.** It has an *MCP* entry in its own side menu, and
on five of its surfaces `document.modelContext` is present — Chrome provides it — and
`getTools()` returns zero. Nothing is wrong with the product; it is where the web is today, and
it is why the twenty-five tools Spacebar has there, the button above included, are read off the
markup rather than declared.

## When a site declares its own tools

Everything above is Spacebar reading a page's markup. A site can also publish tools for an
agent directly, through Chrome's WebMCP — `document.modelContext` — and when one does, Spacebar
uses **those**, under the names the site chose, ahead of anything it worked out for itself. A
site saying what it offers beats a stranger guessing from buttons.

**Every declared tool is asked about out loud, whatever it says about itself.** This is not
caution, it is a hole in the specification: a declared tool arrives with a name, a description
and a schema, and nothing at all that says whether calling it reads something or changes
something. "Count the notes" and "delete the notes" are identical in every field that matters,
so the only honest default is to ask. The person's own spoken yes is what presses it, exactly
as for anything else that cannot be undone.

**Measured, not claimed.** `node scripts/declared-tools.mjs` serves a page that declares two
tools of its own — one that counts, one that deletes everything — and drives the real
`document.modelContext` rather than a stand-in. One run shows both halves of the promise:

```
delete_all_notes  ->  "Delete every note. This cannot be undone,
                       with sure "yes" — shall I?"        the page: counted
their own words:  "yes please"
confirm_action    ->  ok, "all notes deleted"             the page: deleted
```

Chrome exposes `document.modelContext` under `--enable-features=WebMCP`, and it still does with
an extension loaded — checked in three configurations, because the opposite was believed for
long enough to shape a plan around it.

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

### The three checks that need a browser

`npm run verify` runs on every commit and needs nothing but node. Three things cannot be checked
that way, because they are about what Chrome does, and all three are kept OUT of the commit
hook on purpose: ten seconds and a browser per commit is a gate that gets switched off within a week.

```sh
node scripts/phone-opens-itself.mjs     # PROFILE=/a/copy/of/a/real/profile, EXT=…
node scripts/declared-tools.mjs         # serves its own declaring page
node scripts/connect-publishes-tools.mjs # a real page and a blank tab, as a recorder has them
```

Run them before recording anything, before submitting anything, and after touching which tab
the phone follows or how tools reach the session. Each spends no key and no session, prints
what it saw, and exits non-zero when the thing it is named after does not happen.

**Copy a profile before pointing one at it, and the copy needs its lock removed.**
`SingletonLock`, `SingletonSocket` and `SingletonCookie` name the process that last held a
profile; copied along, Chrome refuses to start at all and the run looks exactly like a broken
extension. `phone-opens-itself.mjs` strips them from the copy it is given and says so — never
do it to a profile somebody is using.

### Loading it into Chrome

`chrome://extensions` → Developer mode → **Load unpacked** → this folder. Not
`--load-extension`: in branded Chrome that flag fails silently, with one line in a log and an
empty extensions page.

## Quickstart — for somebody who has the repository and nothing else

A clone, an install and one command, on a machine with `node` 20 or newer and `git`.
Setting it up for the person
who will use it is [above](#setting-it-up-once-by-somebody-who-can-see); this is only how to
get from a clean clone to a loaded extension.

```sh
git clone https://github.com/TonyTheCat/spacebar.git
cd spacebar
npm install      # installs nothing — there are no dependencies; its one job is core.hooksPath
npm run verify   # no key, no browser, no network
```

`npm run verify` is four checks and it names each as it goes: `scripts/check-manifest.mjs`
resolves every path `manifest.json` names and refuses a vendored script loaded before
something that reads it, `scripts/check-globals.mjs` refuses a page whose own code uses a
global no script on that page defines, `scripts/check-syntax.mjs` parses every script the
extension loads, and `node --test` runs the suite over `src/shared/`. Any one failing exits
non-zero and names the file. It is what `.githooks/pre-commit` runs, so what passes here is
what was committed.

Then `chrome://extensions` → Developer mode → **Load unpacked** → this folder, and follow
*Setting it up* above. Not `--load-extension`: in branded Chrome that flag fails silently.
