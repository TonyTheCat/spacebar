/* Saying where somebody is.
 *
 * A sighted person glances at the tab and knows. The person this is for has the
 * page change under them — a search runs, a link opens, a tab is switched — and
 * nothing says so. Every other rule in this product is about NOT narrating a
 * page; this is the opposite duty, and it is small: the name of the place,
 * once, and then silence so they can decide what to do.
 *
 * Said by the SESSION rather than by us, and that is a decision. There is
 * nothing to pre-record, because the name of a place is not known until
 * somebody arrives there; and speaking it through the browser's own voice would
 * cut across a conversation the model is already having, so one moment would
 * arrive in two different voices. The cost is that the model is INSTRUCTED to
 * say the sentence rather than constrained to — it may paraphrase. That is the
 * same gap as everywhere else a model is asked to say something exactly, and
 * here it is a matter of wording rather than of safety: they still learn where
 * they are.
 *
 * A title, not the contents. "You're on Google" is orientation; reading the
 * page is the thing the rules already forbid, and the difference between the two
 * is the whole of what makes this bearable to live with.
 */

/** A page's title can be long, decorated and stuffed with the site's slogan.
 *  Said out loud, past about this much it stops being a name and becomes a
 *  sentence nobody asked for. */
const NAME_LIMIT = 60;

const Orientation = {
  LIMIT: NAME_LIMIT,

  /** What to call this place.
   *
   * The title if there is one, the host if there is not: a page with no title is
   * common and is no reason to leave somebody with nothing. The host is also
   * what they would have said themselves to get here.
   *
   * @param {string} [title] @param {string} [url]
   */
  nameOf(title, url) {
    const named = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (named) {
      return named.length > NAME_LIMIT ? `${named.slice(0, NAME_LIMIT).trimEnd()}…` : named;
    }
    const host = String(url ?? '')
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    return host || 'a page with no name';
  },

  /** Hello, in the voice the rest of the conversation will be in.
   *
   * This used to be a recorded clip — "Ready. Hold the space bar." — with the
   * session naming the place a moment later in its own voice. Two different
   * speakers introducing one moment is the product sounding like two products.
   * While there is a line, one voice speaks: this one.
   *
   * The clips are not gone. They are for the states where there is no model to
   * speak at all — not set up, a refused key, no microphone, a line that
   * dropped — which are exactly the moments when silence would leave somebody
   * in front of a status line they cannot read.
   *
   * Both halves of the greeting matter: that the line is up, and where they
   * are. With nowhere to name, what they need is what to say next rather than
   * an apology.
   *
   * @param {string} [title] @param {string} [url] */
  hello(title, url) {
    const somewhere = String(title ?? '').trim() !== '' || String(url ?? '').trim() !== '';
    if (!somewhere) {
      return 'Say exactly this and nothing more: "Ready. Say the name of a site and I\'ll open it."';
    }
    return `Say exactly this and nothing more: "Ready. You're on ${Orientation.nameOf(title, url)}. What do you want to do?"`;
  },

  /** The first thing said once the line is up: where they are, and an opening.
   *  @param {string} [title] @param {string} [url] */
  arrived(title, url) {
    return `Say exactly this and nothing more: "You're on ${Orientation.nameOf(title, url)}. What do you want to do?"`;
  },

  /** The same news, riding out inside something else.
   *
   * When the page moved while the model was speaking, this sentence cannot be
   * created as a response of its own, so it travels in the next tool result
   * instead. There it is ONE MORE THING to mention rather than the whole of
   * what to say: "say exactly this and nothing more" would contradict the
   * result it is attached to, and a model told to say nothing but where they are
   * would drop the answer to what they actually asked for.
   *
   * @param {string} [title] @param {string} [url] */
  alsoSay(title, url) {
    return (
      `Also, the page moved while you were speaking: they are now on ${Orientation.nameOf(title, url)}. ` +
      'Tell them that in the same breath, in one short sentence, and do not describe what is on it.'
    );
  },

  /** The page moved under them. One short sentence, and no reading.
   *  @param {string} [title] @param {string} [url] */
  moved(title, url) {
    return `The page changed. Say exactly this and nothing more: "Now on ${Orientation.nameOf(title, url)}." Do not describe what is on it unless they ask.`;
  },
};
