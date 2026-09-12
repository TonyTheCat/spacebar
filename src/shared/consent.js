/* Asking permission, and reading the answer.
 *
 * This is the one decision in the product that is not allowed to be a
 * judgement call, so it lives on its own, in a classic script with a test that
 * can fail. The phone page cannot be exercised by a test at all — it touches
 * the DOM the moment it loads and then holds a live WebRTC session — and this
 * rule decides whether somebody's page is changed against their wishes.
 *
 * Two halves, one gate.
 *
 * ASKING: the question has to CONTAIN what is about to be sent. Somebody who
 * can see the form reads the field before they say yes. Somebody who cannot has
 * nothing but this sentence, so "shall I add a note?" asks them to agree to
 * nothing in particular. Speech recognition turned "add a note saying hello"
 * into "Add the node testing, hello" and the question asked was still "Add a
 * note to the list on this page — shall I?", which is true and useless: the one
 * moment a misheard word can be caught is the moment before the press, and only
 * if the words are read back.
 *
 * READING: only a clear yes is a yes. Silence is not, an unrelated sentence is
 * not, and a sentence carrying both words is not — that one is asked again
 * rather than resolved. "No, wait, yes" is somebody changing their mind
 * mid-sentence, and a machine that picks the half it prefers is not asking
 * permission, it is collecting an alibi.
 *
 * A password is the exception in both halves: named, never spoken, and never
 * written down either.
 */

/** How much of a value is read out before it is cut. Long enough for an address
 *  or a note, short enough that nobody has to sit through a pasted essay. */
const SPOKEN_VALUE_LIMIT = 200;

/** "a, b and c" — said the way a person would say it, because this sentence is
 *  heard rather than read. @param {string[]} parts */
const listOut = (parts) =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** Is this argument one that must never be spoken or logged?
 *
 * `writeOnly` and `format: "password"` are the words JSON Schema already has
 * for it, so nothing here invents an idiom of ours that a tool author would
 * have to know about.
 *
 * @param {JsonSchema & {writeOnly?: boolean}} [property]
 */
const isSecret = (property) =>
  property?.writeOnly === true || property?.format === 'password';

const Consent = {
  /** Words that mean go ahead. Short and literal on purpose: a long list of
   *  near-synonyms is a slow way of deciding to press things nobody asked for. */
  YES: /\b(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|please do)\b/i,
  /** Words that mean stop. This list only has to catch the CONTRADICTION — a
   *  refusal is anything that is not a clear yes — so it is not exhaustive. */
  NO: /\b(no|nope|nah|don'?t|do not|stop|cancel|wait|hold on|never mind|nevermind)\b/i,

  /** The same values, written down: for a log, a feed, anything with a screen.
   *
   * Declining to say a password out loud is half a promise if the value is
   * sitting in plain text three lines up in the phone's own visible log. That
   * is exactly where one was found — in full, next to a gate that had just
   * refused to speak it — so both halves read the same rule from the same
   * source and cannot drift apart.
   *
   * A masked value gives a reader nothing at all: not the characters, not the
   * length, not the first letter. It is replaced, never shortened.
   *
   * @param {Record<string, unknown>} [args]
   * @param {JsonSchema} [schema]
   * @returns {string}  Ready to drop into a line of text.
   */
  written(args, schema) {
    const properties = schema?.properties ?? {};
    const entries = Object.entries(args ?? {}).map(([name, value]) => [
      name,
      isSecret(properties[name]) ? '(hidden)' : value,
    ]);
    return JSON.stringify(Object.fromEntries(entries));
  },

  /** The question asked out loud before something irreversible happens.
   *
   * It reads the values back, because that is the only chance to catch a
   * misheard word (see the top of this file). A value too long to say is cut
   * and the cut is ANNOUNCED: a sentence that quietly drops half of what it is
   * about to send is worse than one that admits the value is long.
   *
   * A secret is named and withheld. The browser masks it on screen, and reading
   * it out would unmask it into a room that is not always empty. The person
   * still learns that the field was filled in.
   *
   * Empty arguments are left out rather than read back as `name ""`. A page
   * reads a blank differently from an absent value, and so does a listener.
   *
   * @param {string} description  What the tool does, in the tool's own words.
   * @param {Record<string, unknown>} [args]  What it will be called with.
   * @param {JsonSchema} [schema]  The input schema, if it has one — the only
   *   place a value can be marked as one that must not be spoken.
   * @returns {string}
   */
  question(description, args, schema) {
    const properties = schema?.properties ?? {};
    const said = Object.entries(args ?? {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => {
        if (isSecret(properties[name])) {
          return `${name} filled in, which I am not saying out loud`;
        }
        const text = String(value).trim();
        return text.length > SPOKEN_VALUE_LIMIT
          ? `${name} "${text.slice(0, SPOKEN_VALUE_LIMIT)}", and it goes on longer than I can read out`
          : `${name} "${text}"`;
      });
    // The tool's own sentence often ends in a full stop, and "Apply. — shall
    // I?" is heard as a stumble rather than as a question.
    const what = String(description ?? '')
      .trim()
      .replace(/[.\s]+$/, '');
    return said.length === 0 ? `${what} — shall I?` : `${what}, with ${listOut(said)} — shall I?`;
  },

  /** @param {string} said  What the PERSON said, as transcribed. Never the
   *   model's account of what they said: that is the model marking its own
   *   homework, and the model is what the gate stands in front of.
   *  @returns {'yes'|'no'|'unclear'} */
  readAnswer(said) {
    const heard = String(said ?? '').trim();
    if (!heard) return 'unclear';
    const yes = Consent.YES.test(heard);
    const no = Consent.NO.test(heard);
    // Both, or neither: not an answer. Asked again rather than guessed at.
    if (yes === no) return 'unclear';
    return yes ? 'yes' : 'no';
  },
};
