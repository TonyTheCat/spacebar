/* Which language the person is speaking.
 *
 * Left to guess, transcription guessed wrong: "search Google for best pizza"
 * was written down as "Сочет Google Best Pizza in the" — English words heard as
 * Russian ones. The model then acts on that text, so a wrong guess is not
 * cosmetic: it is the errand going somewhere else, and it is told to somebody
 * who cannot read the transcript to see why.
 *
 * A guess is also the wrong shape for this product. The person using it speaks
 * whatever they speak, every day, and a helper sets the phone up once. So the
 * language is a setting with a default rather than something inferred from each
 * utterance.
 *
 * English is the default because the demo, the instructions and the sites are
 * English. A tag that is not shaped like a language is refused rather than
 * passed on: the session would answer with an error nobody in the room could
 * read, and the fallback is a language that works.
 */

const DEFAULT_LANGUAGE = 'en';

/* ISO 639-1, optionally with a region — 'en', 'ru', 'pt-BR'. Deliberately a
 * shape check rather than a list: the transcription models take far more
 * languages than anybody here can enumerate, and a list would refuse somebody's
 * own language for not being on it. */
const SHAPED_LIKE_A_LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Whatever was typed, in the shape a language tag is written in.
 *
 * 'EN' and 'en-us' are the same request as 'en-US', and refusing them would be
 * pedantry aimed at the one person setting this up for somebody else.
 *
 * @param {unknown} saved
 * @returns {string} '' when there is nothing to read. */
const tidy = (saved) => {
  if (typeof saved !== 'string') return '';
  const said = saved.trim();
  if (!said) return '';
  const [language, region, ...rest] = said.split('-');
  const tag = region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
  // Anything past a region is KEPT rather than dropped, so that it fails the
  // shape check below instead of being quietly trimmed into something valid:
  // 'en-US-x' was tidied into 'en-US' and accepted, which is the machine
  // deciding it knew what somebody meant.
  return rest.length ? `${tag}-${rest.join('-')}` : tag;
};

/** The handful worth offering by name on the settings page. Anything else can
 *  still be typed, and anything shaped like a language is kept. */
const OFFERED = [
  { tag: 'en', name: 'English' },
  { tag: 'ru', name: 'Russian' },
  { tag: 'es', name: 'Spanish' },
  { tag: 'pt', name: 'Portuguese' },
  { tag: 'de', name: 'German' },
  { tag: 'fr', name: 'French' },
];

const SpokenLanguage = {
  DEFAULT: DEFAULT_LANGUAGE,

  /** What to offer on the settings page. A copy, so that a page editing what it
   *  was handed cannot edit this list. */
  offered() {
    return OFFERED.map((one) => ({ ...one }));
  },

  /** Turn whatever is saved into a tag the session will accept.
   *
   * @param {unknown} saved  Whatever the settings page wrote, if anything.
   * @returns {string} A language tag; never empty.
   */
  of(saved) {
    const tag = tidy(saved);
    return tag && SHAPED_LIKE_A_LANGUAGE.test(tag) ? tag : DEFAULT_LANGUAGE;
  },

  /** Would this be used as given, or quietly replaced by English?
   *
   * The settings page asks before saving, because a tag that silently becomes
   * English is the same failure as no setting at all — and the person who could
   * fix it is the one typing.
   *
   * @param {unknown} saved
   * @returns {boolean} true for anything usable, including nothing at all.
   */
  usable(saved) {
    const tag = tidy(saved);
    return tag === '' || SHAPED_LIKE_A_LANGUAGE.test(tag);
  },

  /** The name for a tag, when we have one — for saying it back to a helper.
   *  @param {string} tag */
  nameOf(tag) {
    return OFFERED.find((one) => one.tag === tag)?.name ?? tag;
  },
};
