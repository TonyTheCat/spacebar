/* What a tool call is worth saying about, and how big its answer may be.
 *
 * A call went out and nothing came back. One log ends at "the model called
 * read_page with {}" — no result, no answer, no error — on a results page with
 * a heavy DOM and twenty-eight synthesized tools. Everything after that call
 * was silence, to somebody who has only the voice to go on, and there was
 * nothing written down to say which step had failed.
 *
 * That is two defects, and only one of them is the hang: a step that can fail
 * without leaving a line is a step nobody can debug. So every call reports its
 * own outcome, in one wording, whichever way it ended — answered, refused,
 * thrown, or took too long. A line per call is cheap; a run that cannot be read
 * afterwards costs another run.
 *
 * And an answer has a size. A tool result travels as JSON over a data channel
 * whose message limit is not ours to know, and a page's own text is the one
 * part of it with no natural bound. It is cut here, with the cut announced, for
 * the same reason a read is: a page that admits it was trimmed can be asked for
 * the rest.
 */

/** What a single tool result may weigh, in characters of text.
 *
 * Comfortably above a full page read (4000) plus the untrusted frame around it,
 * and comfortably below anything a data channel would refuse. A backstop for
 * whatever grows next, not a budget anybody should be spending. */
const RESULT_LIMIT = 8000;

const ToolResult = {
  LIMIT: RESULT_LIMIT,

  /** Cut a result down to what may be sent, and say so inside it.
   *
   * @param {{ok: boolean, text: string}} result
   * @param {number} [limit]
   * @returns {{ok: boolean, text: string}}
   */
  capped(result, limit = RESULT_LIMIT) {
    const text = String(result?.text ?? '');
    /* Everything the answer came with, with only the text cut.
     *
     * This used to rebuild the object out of ok and text alone, which quietly dropped every
     * other field the page side had sent: `problems`, the page's own complaints about what it
     * refused, and `moved`, which says the press went through and took the page with it. Both
     * exist to be acted on, and a field nobody can see is a field nobody can act on.
     *
     * ok is still normalised to a real boolean: the caller reads it to decide what to tell the
     * person, and a truthy string meaning "failed" would be read as success. */
    const whole = {
      ...(result && typeof result === 'object' ? result : {}),
      ok: result?.ok === true,
    };
    if (text.length <= limit) return { ...whole, text };
    return {
      ...whole,
      text: `${text.slice(0, limit)}\n[cut here — this answer was longer than the line allows]`,
    };
  },

  /** One line for the log, whichever way the call ended.
   *
   * The length is in it on purpose: "ok, 0 chars" and "ok, 1873 chars" are
   * different events wearing the same word, and the first one is a bug.
   *
   * @param {string} name
   * @param {{ok?: unknown, text?: unknown}|null|undefined} result
   * @returns {string}
   */
  written(name, result) {
    if (!result || typeof result !== 'object') return `${name} → answered with nothing at all`;
    const text = String(result.text ?? '');
    if (result.ok === true) return `${name} → ok, ${text.length} chars`;
    return `${name} → refused: ${text.slice(0, 160) || '(no reason given)'}`;
  },

  /** The line for a call that never came back.
   *  @param {string} name @param {number} ms */
  tooLong(name, ms) {
    return `${name} → took longer than ${ms}ms — answered so the person is not left waiting`;
  },

  /** What goes back to the model when a call runs out of time.
   *
   * It says what happened rather than pretending otherwise, and it asks the
   * model to say so plainly: somebody who has heard nothing for ten seconds
   * already knows something is wrong and is owed the sentence.
   *
   * @param {string} name @returns {{ok: boolean, text: string}} */
  timedOut(name) {
    return {
      ok: false,
      text:
        `${name} took too long and I stopped waiting for it. Say that plainly — that it took ` +
        'too long and you do not know whether it went through — and ask what they want to do.',
    };
  },

  /** The line, and the reason, for a call that threw.
   *  @param {string} name @param {unknown} error */
  threw(name, error) {
    return `${name} → threw: ${String(error).slice(0, 200)}`;
  },
};
