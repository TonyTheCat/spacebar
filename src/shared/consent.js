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

/* It needs vendor/filled-in.js loaded in the same scope: what counts as a value — and what is
 * only a placeholder standing in for one — is that brick's judgement, and this file asks it
 * rather than keeping a second opinion of its own. Both live on the phone page. */

/** How much of a value is read out before it is cut. Long enough for an address
 *  or a note, short enough that nobody has to sit through a pasted essay. */
const SPOKEN_VALUE_LIMIT = 200;

/** "a, b and c" — said the way a person would say it, because this sentence is
 *  heard rather than read. @param {string[]} parts */
const listOut = (parts) =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** Must this argument be withheld — from the room and from the log?
 *
 * Two reasons, and the second one is the one that was missing.
 *
 * THE SCHEMA SAYS SO. `writeOnly` and `format: "password"` are the words JSON
 * Schema already has for it, so nothing here invents an idiom of ours that a
 * tool author would have to know about.
 *
 * OR THE SCHEMA DOES NOT DESCRIBE THIS ARGUMENT AT ALL, which is the case that
 * read a password out loud. The synthesizer names a property after the field's
 * LABEL; a model calls the tool with whatever name it took from the
 * description. Measured on the gate fixture: the password field is labelled
 * "Vault password" and named `pin`, so the schema carried `vaultPassword`, the
 * call carried `pin`, the lookup found nothing, "not a secret" was the answer,
 * and the question read `pin "hunter2-never-say-this"` into the room.
 *
 * So the rule is the other way round: a value we cannot identify is a value we
 * do not speak. It is not a guess about which words look dangerous — it is the
 * only honest answer to "what is this?", and the field is still NAMED, so the
 * person hears that it was filled in.
 *
 * The cost is stated rather than hidden: an ordinary argument the schema
 * happens not to mention is withheld too, and a tool with no schema at all has
 * every argument withheld. That direction is deliberate. The reverse costs a
 * password.
 *
 * @param {Record<string, JsonSchema & {writeOnly?: boolean}>} [properties]
 * @param {string} name
 */
const mustWithhold = (properties, name) => {
  const property = properties?.[name];
  if (!property) return true;
  return property.writeOnly === true || property.format === 'password';
};

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
    const properties = schema?.properties;
    const entries = Object.entries(args ?? {}).map(([name, value]) => [
      name,
      mustWithhold(properties, name) ? '(hidden)' : value,
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
    const properties = schema?.properties;
    const said = Object.entries(args ?? {})
      /* A PLACEHOLDER IS NOT A VALUE, and the judgement is the brick's rather than ours.
       *
       * Measured on the wizard: the model called the submit with monthOfBirth "-Select-" and
       * state "-Select-" — the selects' own placeholder text, read off the page as if somebody
       * had chosen it — and the gate read both back out loud. Somebody who cannot see the form
       * then hears two answers they never gave, in the one sentence written to be checked.
       *
       * FilledIn.hasAValue already knows what a value is: it is the same rule the fill path
       * refuses on, so the question and the refusal cannot drift apart. Keeping our own list
       * of placeholder words here would be a second opinion about the same fact. */
      .filter(([, value]) => FilledIn.hasAValue(value))
      .map(([name, value]) => {
        /* One wording for both reasons, on purpose. Saying "which I am not
         * saying out loud" for a password and something else for a value we
         * could not identify would tell the room which of the two it is, and a
         * listener has no use for that distinction. */
        if (mustWithhold(properties, name)) {
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
