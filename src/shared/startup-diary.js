/* What the browser looked like when it started, kept where somebody can read it.
 *
 * The start page failed to open twice, and both times the answer was the same:
 * nobody could see what the service worker saw. A worker's console lives behind
 * a link on chrome://extensions that a blind person cannot reach and a sighted
 * one does not think to open; it is empty the moment the worker is killed; and
 * the run that matters is the one nobody was watching. So the second attempt
 * was a guess, and the guess was wrong for a reason no line of code could have
 * shown — the New Tab page was Google's remote one, and only Chrome's own
 * stderr said so.
 *
 * This is the fix, and it is deliberately small: a handful of lines in
 * chrome.storage.session, written as the worker decides things, printed by the
 * phone into its own log the moment it loads. The next run answers the question
 * by itself, in the place the person and everybody helping them is already
 * looking.
 *
 * Session storage rather than local, because the lifetime is exactly right: it
 * is about THIS launch of the browser, and it goes when the browser does.
 */

/** Enough for a startup, not enough to be a log file. */
const KEEP = 40;
const MORE = '…and more, which was not kept';

const StartupDiary = {
  KEY: 'startupDiary',
  KEEP,
  MORE,

  /** Add one line, keeping the FIRST ones.
   *
   * The first lines are the startup; anything still writing past the cap is a
   * loop, and its first turn is the interesting one. Dropping the oldest
   * instead would quietly erase the only part worth reading.
   *
   * @param {unknown} diary  Whatever was in storage, which may be nothing.
   * @param {string} line
   * @param {number} at  When it happened. Shown in local time, as the phone's
   *   own log is: whoever reads this is in a room, not in UTC.
   * @returns {string[]}
   */
  add(diary, line, at) {
    const kept = Array.isArray(diary) ? diary.filter((one) => typeof one === 'string') : [];
    if (kept.length >= KEEP) {
      // Said once, so that a runaway cannot fill the diary with its own apology.
      return kept[kept.length - 1] === MORE ? kept : [...kept, MORE];
    }
    return [...kept, `${new Date(at).toLocaleTimeString()} — ${line}`];
  },

  /** What the browser has open, in one line.
   *
   * The active tab's url AND pendingUrl, because that pair is the whole of the
   * question: a restoring tab carries where it is going in pendingUrl with an
   * empty url, and Chrome's own New Tab page carries the reverse.
   *
   * @param {chrome.tabs.Tab[]} tabs
   * @returns {string}
   */
  whatIsThere(tabs) {
    const all = Array.isArray(tabs) ? tabs : [];
    if (all.length === 0) return 'no tabs at all — no window has been opened yet';
    const windows = new Set(all.map((tab) => tab.windowId)).size;
    const said = all
      .filter((tab) => tab.active)
      .map(
        (tab) =>
          `[${tab.id ?? '?'}] url=${tab.url || '(none)'} pendingUrl=${tab.pendingUrl || '(none)'}`
      );
    return (
      `${all.length} tab(s) in ${windows} window(s); active: ` +
      `${said.length ? said.join(' | ') : '(none is active)'}`
    );
  },
};
