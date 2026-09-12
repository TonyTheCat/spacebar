/* A line somebody is owed, kept until there is room to say it.
 *
 * Where they are is said by the SESSION, through a response created for that
 * one sentence — and a response cannot be created while another is running. The
 * session refuses it with conversation_already_has_active_response, and one run
 * has three of those in it. The phone was right not to interrupt: it checked,
 * saw an answer in progress, wrote "it is already answering" in the log and
 * stopped there. Stopping there is how a page moved under somebody who cannot
 * see it while the only thing that would have told them was dropped on the
 * floor.
 *
 * A refusal to interrupt has to be a POSTPONEMENT, or it is a silence.
 *
 * So the place is kept here until whichever comes first:
 *
 *   - a tool result goes out. The model is about to be asked to speak anyway,
 *     so the line rides along inside that result and is said in the same
 *     breath: one response, one voice, nothing to collide with.
 *   - the answer in progress finishes. Then there is room for a response of its
 *     own, which is what would have happened had nothing been running.
 *
 * THE LATEST PLACE WINS, and only the latest. Two moves while the model was
 * speaking are not two things to say — the first is already history by the time
 * anybody could hear it, and reciting a route is exactly the narration this
 * product is written against. They are told where they ARE.
 *
 * Only the place is kept, never the rendered sentence, because the two routes
 * need different words: alone it is the whole of what to say, folded into a tool
 * result it is one more thing to mention. Keeping a string would mean keeping
 * the wrong one half the time.
 */

const StillToSay = {
  create() {
    /** @type {{kind: 'hello'|'arrived'|'moved', title?: string, url?: string}|null} */
    let owed = null;

    const slot = {
      /** Is anybody owed a line? */
      get has() {
        return owed !== null;
      },

      /** Keep this place until there is room for it.
       *  @param {'hello'|'arrived'|'moved'} kind  which sentence was refused
       *  @param {string} [title] @param {string} [url]
       *  @returns {'kept'} */
      keep(kind, title, url) {
        owed = { kind, title, url };
        return 'kept';
      },

      /** The words for a response of its own: the sentence that was refused,
       *  unchanged, so a postponed line is the same line.
       *  @returns {string} '' when nothing is owed. */
      takeSpoken() {
        if (!owed) return '';
        const { kind, title, url } = owed;
        owed = null;
        return Orientation[kind](title, url);
      },

      /** The words for riding out inside a tool result — deliberately not the
       *  same sentence, for the reason at the top of this file.
       *  @returns {string} '' when nothing is owed. */
      takeFolded() {
        if (!owed) return '';
        const { title, url } = owed;
        owed = null;
        return Orientation.alsoSay(title, url);
      },

      /** Nobody is owed anything any more. The line went away, and a place from
       *  before a reconnection is not news. */
      forget() {
        owed = null;
      },
    };
    return slot;
  },
};
