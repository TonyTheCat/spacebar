/* Set up once, by somebody who can see the screen.
 *
 * Two things, and neither is done by the person who will use Spacebar every
 * day: the key that the voice session needs, and the microphone dialog that
 * Chrome shows exactly once. Each is saved on its own, with its own line saying
 * what happened, so a helper can do one and come back for the other.
 *
 * Nothing here opens a session or talks to OpenAI. The key goes into
 * chrome.storage.local under `openaiKey`, which is the only place the phone
 * reads it from, and it is never shown back — not even the first characters.
 *
 * This page loads no other script on purpose: a helper must be able to save the
 * key even if everything else in the extension is broken.
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
 * @param {'good'|'bad'} [tone]
 */
const tell = (id, text, tone) => {
  const line = el(id);
  line.textContent = text;
  line.className = tone ? `state ${tone}` : 'state';
};

/* 1. The key. Saved, cleared from the field, and confirmed — never echoed. */

void chrome.storage.local.get('openaiKey').then(({ openaiKey }) => {
  const set = typeof openaiKey === 'string' && openaiKey.length > 0;
  tell(
    'key-state',
    set
      ? 'A key is saved. Type a new one only to replace it.'
      : 'No key yet — Spacebar stays silent until there is one.'
  );
});

el('save').addEventListener('click', () => {
  const key = input('key').value.trim();
  if (!key) {
    tell('key-state', 'The field is empty, so nothing was saved.', 'bad');
    return;
  }
  void chrome.storage.local.set({ openaiKey: key }).then(() => {
    input('key').value = '';
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
