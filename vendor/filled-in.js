/* Is this form actually filled in, and did the page accept it?
 *
 * Two halves of one failure, from Anton's own run. The model called a submit tool with
 * month "-Select-", day "", year "" and selectAnOption "-Select-". The gate read those values
 * back faithfully, he said yes, and the page answered "Your information contains 4 errors" —
 * while he heard "Submitted. The form went through."
 *
 * Nothing lied on purpose. The gate's promise is that the question contains what will be
 * sent, and it did. What was missing is the two questions either side of it:
 *
 *   BEFORE — is there anything here to send? A required field left empty, or a select still
 *   showing its placeholder, is not an argument: it is the absence of one. Offering to submit
 *   that costs the person a yes, a submission, and a page of errors they cannot see.
 *
 *   AFTER — did it go through? "Pressed" and "accepted" are different facts, and a form that
 *   comes back with its own errors is the commonest way they differ. Saying the first while
 *   meaning the second is the machine reporting its own action instead of the world.
 *
 * The rule this file holds: SENT is not ACCEPTED.
 */

/** Values that mean "nothing chosen yet".
 *
 * Empty is unambiguous. The rest is a placeholder written the way pages write them — and it
 * is a SHORT, LITERAL list rather than a cleverness about dashes, because a guess here
 * refuses somebody's real answer. Anything not on it and not empty is treated as a real
 * value, which is the safe direction: the AFTER check catches what this one misses. */
const NOT_CHOSEN = [
  '-select-',
  'select',
  'select one',
  'select an option',
  'choose',
  'choose one',
  '--',
  '---',
  'none',
  'please select',
];

const FilledIn = {
  NOT_CHOSEN,

  /** Is this one value something a page could act on?
   *  @param {unknown} value */
  hasAValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean' || typeof value === 'number') return true;
    const said = String(value).trim();
    if (said === '') return false;
    return !NOT_CHOSEN.includes(said.toLowerCase());
  },

  /** Which required fields of this tool were not filled in.
   *
   * Required as the SCHEMA declares it — the synthesizer reads that off the markup, so it is
   * the page's own statement about itself rather than our reading of its labels.
   *
   * @param {{properties?: Record<string, {description?: string}>, required?: string[]}|undefined} schema
   * @param {Record<string, unknown>} args
   * @returns {string[]} the human names of the fields still empty, in schema order
   */
  missing(schema, args) {
    const required = schema?.required ?? [];
    if (required.length === 0) return [];
    return required
      .filter((key) => !FilledIn.hasAValue(args?.[key]))
      .map((key) => schema?.properties?.[key]?.description || key);
  },

  /** What to tell the model instead of asking the person to approve an empty form.
   *
   * It names the fields and hands the turn back: the model has to ask them for the values,
   * which is the conversation that should have happened before any of this. Deliberately not
   * a refusal to act — nothing is broken, something is simply not known yet.
   *
   * @param {string[]} fields @returns {string}
   */
  askForThem(fields) {
    const list = fields.join(', ');
    return (
      `Not yet — these are still empty: ${list}. Do not submit this. Ask them for those ` +
      'values, out loud and in their own words, then call this tool again with all of them.'
    );
  },

  /** Every field of it, when not one of them has a value.
   *
   * `missing` reads the schema's `required`, which is the page's own statement — and a page
   * need not make one. Anton's run: a header search box whose field is not marked required
   * was called with {"search": ""}, so nothing was missing by that rule, and the gate did
   * exactly what it is for: it asked him to approve sending it. He heard "Fill in and submit
   * Search — shall I?" about a request that would have sent nothing at all.
   *
   * A call with no values in it is not a thing to approve. It is not a refusal either —
   * nothing is broken, they simply have not said what to look for yet — so the answer is the
   * same one the missing-required case gives: the fields, to be asked about.
   *
   * Only when EVERY field is empty. A partly filled form is somebody's deliberate choice
   * (a search with a term and no category), and second-guessing that would be this file
   * deciding what a page's fields are worth.
   *
   * @param {{properties?: Record<string, {description?: string}>}|undefined} schema
   * @param {Record<string, unknown>} args
   * @returns {string[]} the human names of its fields, or nothing when one of them is filled
   */
  nothingButEmpties(schema, args) {
    const keys = Object.keys(schema?.properties ?? {});
    if (keys.length === 0) return [];
    if (keys.some((key) => FilledIn.hasAValue(args?.[key]))) return [];
    return keys.map((key) => schema?.properties?.[key]?.description || key);
  },

  /** Did the control actually take what it was asked for?
   *
   * The reviewer's finding on the commit before this one: a fill was treated as refused only
   * when the control came back holding NOTHING. A select that keeps its placeholder comes
   * back holding "-Select-" — not empty, so it read as a success, and the only thing standing
   * between that and a submitted empty form was the model noticing that "-Select-" is not a
   * value. That is comprehension where a comparison will do.
   *
   * Compared loosely on purpose: a page may normalise what it was given — trimming it,
   * changing its case, expanding "NY" to "New York" — and calling that a refusal would refuse
   * a fill that worked. What is refused is a control that holds something ELSE, and a
   * placeholder is something else.
   *
   * @param {unknown} asked what the person said
   * @param {unknown} holds what the control holds now
   * @returns {boolean}
   */
  tookIt(asked, holds) {
    const wanted = String(asked ?? '')
      .trim()
      .toLowerCase();
    const has = String(holds ?? '')
      .trim()
      .toLowerCase();
    if (wanted === '') return true;
    if (!FilledIn.hasAValue(has)) return false;
    return has === wanted || has.includes(wanted) || wanted.includes(has);
  },

  /** A page counting its own problems, when it counts ANY.
   *
   * "contains 0 errors" is the phrase a form uses to say nothing is wrong, and it was read as
   * a complaint: the number was thrown away and the sentence kept. Measured on the live
   * benefit finder — the summary carrying that sentence is in the document AT ALL TIMES,
   * before the press and after one the page accepted, with only the number changing. So the
   * number is the only part that ever meant anything.
   *
   * The cost of getting it wrong was the whole point of the gate going backwards: the form
   * was accepted, the wizard moved on, and the model said out loud "it went through, but the
   * page did not accept it" to somebody who could not see either fact.
   *
   * @param {string} text @returns {string|null} the count as the page worded it, or null
   */
  countedErrors(text) {
    const found = String(text ?? '').match(/contains\s+(\d+)\s+errors?/i);
    if (!found || Number(found[1]) === 0) return null;
    return found[0];
  },

  /** Is this the page saying nothing is wrong? Only a count of ZERO says that — a page that
   *  does not count has said nothing either way, which is not the same thing.
   *  @param {string} text */
  saysNothingIsWrong(text) {
    const found = String(text ?? '').match(/contains\s+(\d+)\s+errors?/i);
    return found !== null && Number(found[1]) === 0;
  },

  /** Did the page answer with its own errors?
   *
   * Read from the page's own report rather than guessed at: the count in a sentence
   * ("contains 4 errors"), the roles a page uses to announce a problem, and the tool names
   * the synthesizer produces when a validation summary appears. Any of those is the page
   * saying no.
   *
   * @param {{text?: string, problems?: string[]}|null|undefined} result
   * @returns {string[]} what the page complained about, empty when it did not
   */
  problems(result) {
    const found = Array.isArray(result?.problems) ? result.problems.filter(Boolean) : [];
    const text = String(result?.text ?? '');
    const counted = FilledIn.countedErrors(text);
    if (counted && !found.includes(counted)) found.push(counted);
    return found;
  },

  /** What to say when the press happened and the page refused it.
   *
   * "Went through" is not in here, and that is deliberate. It is the exact phrase Anton heard
   * about a submission the page had refused, and a model reads its instructions for words to
   * reuse — putting the misleading one inside the correction is how it comes back out of the
   * speaker. My own instrument caught this: it bans that phrase in the spoken answer, and the
   * answer contained it because this sentence handed it over.
   *
   * @param {string[]} problems @returns {string} */
  saySoInstead(problems) {
    return (
      `It was sent and the page did NOT accept it — it says: ${problems.join('; ')}. ` +
      'Tell them that plainly: it reached the page and the page came back with errors. Do not ' +
      'say it worked.'
    );
  },
};
