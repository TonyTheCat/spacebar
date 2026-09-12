/* Whose acknowledgement is this?
 *
 * The session confirms a new tool list by sending session.updated, and that
 * event carries no reference at all to the client event that caused it — no id,
 * nothing to correlate. So a phone that waits for "my list was accepted" and
 * reads the next session.updated as its own answer is reading somebody else's
 * post, and there are at least three other posts to read:
 *
 *   - the opening session.update, which sets the instructions and the
 *     transcription and carries NO tools, is acknowledged the same way;
 *   - republishing after a tab change is triggered by the very events a
 *     navigating tool call is also waiting on, so those two overlap as a matter
 *     of course rather than as a rare race;
 *   - a reconnection republishes everything from the beginning.
 *
 * What the event does carry is the tool list itself, and that is the
 * correlation: an acknowledgement answers OUR list when the session says it is
 * holding exactly the names we sent. Not a guess about timing — the names
 * either match or they do not, and somebody else's acknowledgement is ignored
 * instead of being mistaken for ours.
 */

const ToolsAck = {
  /** Does this acknowledgement answer the list we sent?
   *
   * Compared as a SET. The order we send in is our own business — our own tools
   * go last so that a page cannot stand in front of them — and nothing promises
   * the list comes back the same way round, so making order part of the
   * identity would turn a working confirmation into a timeout.
   *
   * @param {string[]|null|undefined} sent  The names we published.
   * @param {unknown} acked  The names the session says it now holds.
   * @returns {boolean}
   */
  answers(sent, acked) {
    if (!Array.isArray(sent) || !Array.isArray(acked)) return false;
    if (sent.length !== acked.length) return false;
    const theirs = acked.map(String).sort();
    return sent
      .map(String)
      .sort()
      .every((name, at) => name === theirs[at]);
  },

  /** The tool names out of a session.updated event, however empty it is.
   *
   * Everything here arrives off the wire, so every level of it is optional: the
   * opening acknowledgement has no tools key at all, and a tool with no name is
   * read as an empty name rather than as a crash in an event handler nobody is
   * watching.
   *
   * @param {unknown} session
   * @returns {string[]}
   */
  namesIn(session) {
    const tools = /** @type {{tools?: unknown}} */ (session ?? {})?.tools;
    if (!Array.isArray(tools)) return [];
    return tools.map((tool) => String(/** @type {{name?: unknown}} */ (tool)?.name ?? ''));
  },
};
