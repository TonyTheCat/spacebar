/* Set up once, by somebody who can see the screen.
 *
 * Four things, and none of them is done by the person who will use Spacebar
 * every day: the key that the voice session needs, the microphone dialog that
 * Chrome shows exactly once, the page the browser opens on, and the language
 * that gets transcribed. Each is saved on its own, with its own line saying
 * what happened, so a helper can do one and come back for the rest.
 *
 * Nothing here opens a session or talks to OpenAI. The key goes into
 * chrome.storage.local under `openaiKey`, which is the only place the phone
 * reads it from, and it is never shown back — not even the first characters.
 *
 * The key and the microphone come first in this file and use nothing but the
 * platform, on purpose: a helper must be able to save the key even if everything
 * else in the extension is broken. Only the start page and the language reach
 * for a shared module, and they do so last.
 */

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ (el(id));

/**
 * One line under a control, saying what just happened.
 *
 * @param {string} id       the status line
 * @param {string} text
 * @param {'info'|'good'|'bad'} [tone]
 */
const tell = (id, text, tone) => {
  const line = el(id);
  line.textContent = text;
  line.className = tone ? `state ${tone}` : 'state';
};

/* 1. The key. Saved, cleared from the field, and confirmed — never echoed.
 *
 * The eye only reveals what the helper is typing right now, so a mistyped
 * character can be seen before it is saved. It does not reveal a saved key:
 * saving clears the field, and nothing reads the key back onto this page. */

/** Everything on this page that says whether a key exists, in one place, so
 *  the field, the Remove button and the line can never disagree.
 *  @param {boolean} set */
const keyIs = (set) => {
  input('key').placeholder = set ? 'A key is saved — type a new one to replace it' : 'sk-…';
  el('remove-key').hidden = !set;
  if (set) tell('key-state', 'A key is saved. Type a new one only to replace it.', 'good');
  else tell('key-state', 'No key yet — Spacebar stays silent until there is one.', 'info');
};

void chrome.storage.local.get('openaiKey').then(({ openaiKey }) => {
  keyIs(typeof openaiKey === 'string' && openaiKey.length > 0);
});

el('remove-key').addEventListener('click', () => {
  void chrome.storage.local.remove('openaiKey').then(() => {
    keyIs(false);
    tell('key-state', 'The key is gone. Spacebar stays silent until a new one is saved.', 'info');
  });
});

/** @param {boolean} shown */
const showKey = (shown) => {
  input('key').type = shown ? 'text' : 'password';
  const eye = el('show-key');
  eye.setAttribute('aria-pressed', String(shown));
  eye.setAttribute('aria-label', shown ? 'Hide the key' : 'Show the key');
  eye.title = shown ? 'Hide the key' : 'Show the key';
  /** @type {HTMLElement} */ (eye.querySelector('.eye-open')).hidden = shown;
  /** @type {HTMLElement} */ (eye.querySelector('.eye-shut')).hidden = !shown;
};

el('show-key').addEventListener('click', () => showKey(input('key').type !== 'text'));

el('save').addEventListener('click', () => {
  const key = input('key').value.trim();
  if (!key) {
    tell('key-state', 'The field is empty, so nothing was saved.', 'bad');
    return;
  }
  void chrome.storage.local.set({ openaiKey: key }).then(() => {
    input('key').value = '';
    showKey(false);
    keyIs(true);
    tell('key-state', 'Saved. Spacebar connects by itself from now on.', 'good');
  });
});

/* 2. The microphone. Ask, then let it go: this is Chrome's question, not a
 * recording, and a settings page has no business keeping a microphone open. */

el('mic').addEventListener('click', () => {
  tell('mic-state', 'Asking Chrome…');
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      for (const track of stream.getTracks()) track.stop();
      tell('mic-state', 'The microphone works. Chrome will not ask again.', 'good');
    })
    .catch((error) => {
      tell('mic-state', `Chrome said no: ${String(error).slice(0, 120)}`, 'bad');
    });
});

/* 3. The start page. Shown back, because it is not a secret and a helper wants
 * to see what is already there. Resolved through the same table `open_site`
 * uses, so what is typed here is confirmed in the words the person would say.
 * A name nobody knows is refused rather than saved and quietly turned into
 * Google later. */

void chrome.storage.local.get('startPage').then(({ startPage }) => {
  const saved = typeof startPage === 'string' ? startPage : '';
  input('start').value = saved;
  tell('start-state', `Opens at ${KnownSites.startPage(saved)}`);
});

el('save-start').addEventListener('click', () => {
  const said = input('start').value.trim();
  if (said && !KnownSites.resolve(said)) {
    tell(
      'start-state',
      `"${said}" is not a site I know, and I will not guess an address. ` +
        `Try ${KnownSites.names().join(', ')}, or a full address like https://example.com.`,
      'bad'
    );
    return;
  }
  void chrome.storage.local.set({ startPage: said }).then(() => {
    tell('start-state', `Saved. Opens at ${KnownSites.startPage(said)}`, 'good');
  });
});

/* 4. The language. A short list is offered; anything shaped like a language tag
 * is accepted. What is refused is a tag that would silently become English —
 * that is the same as no setting, and the one person who can fix it is typing.
 * The list is filled in once storage has answered, so nothing here runs at load
 * outside a callback. */

void chrome.storage.local.get('spokenLanguage').then(({ spokenLanguage }) => {
  for (const { tag, name } of SpokenLanguage.offered()) {
    const option = document.createElement('option');
    option.value = tag;
    option.label = name;
    el('languages').appendChild(option);
  }
  const saved = typeof spokenLanguage === 'string' ? spokenLanguage : '';
  input('language').value = saved;
  const tag = SpokenLanguage.of(saved);
  tell('language-state', `Transcribing as ${SpokenLanguage.nameOf(tag)} (${tag})`);
});

el('save-language').addEventListener('click', () => {
  const said = input('language').value.trim();
  if (!SpokenLanguage.usable(said)) {
    const offered = SpokenLanguage.offered()
      .map((one) => `${one.tag} for ${one.name}`)
      .join(', ');
    tell(
      'language-state',
      `"${said}" is not shaped like a language tag and would quietly become English. ` +
        `Use two letters — ${offered} — or a tag like pt-BR.`,
      'bad'
    );
    return;
  }
  void chrome.storage.local.set({ spokenLanguage: said }).then(() => {
    const tag = SpokenLanguage.of(said);
    tell('language-state', `Saved. Transcribing as ${SpokenLanguage.nameOf(tag)} (${tag})`, 'good');
  });
});
