/* Why a turn ended.
 *
 * Declared globally because the three files that pass this value around —
 * src/shared/push-to-talk.js, the content script and the phone — are classic
 * scripts sharing one scope rather than modules with imports, and a string
 * union repeated in three JSDoc blocks is exactly the kind of thing that
 * quietly diverges.
 *
 * The distinction is not cosmetic. A release is the person saying their turn is
 * over. Losing sight of the key is a guess made on their behalf: right when
 * focus really went away, and wrong when the phone itself moved them to another
 * tab while they were still speaking.
 */

type StopReason = 'released' | 'lost-sight' | 'too-long';

/* What is in the session's hands right now.
 *
 * Returned by the phone's publish, so that whatever answers the model can NAME
 * the tools it may use. A live run turned on this: the model was answered
 * before the new list was accepted, so it reasoned with the previous page's
 * tools and said it could not act on a page it was looking at. Telling it what
 * it now holds, in the same breath as the result, costs one sentence.
 */
interface Published {
  /** The tool names the session accepted, ours included. */
  names: string[];
  /** Did the session confirm, or did we go on without the word? */
  accepted: boolean;
  /** The page they are on, when there is one. */
  title?: string;
  url?: string;
  /** The NAME of the place, set only when it changed and only for a quiet
   *  publish — the caller says it itself, in the same breath as what its action
   *  did. A separate sentence about the same event is two answers to one thing,
   *  and the one a person actually heard was the half that said where they were
   *  and nothing about what had happened. */
  place?: string;
}

/* What happened to the page after we acted on it.
 *
 * Three outcomes, because two of them are ordinary and only one is a problem:
 * the action did not navigate at all (a press that changed something on the
 * page), it navigated and finished, or it navigated and is still going when we
 * ran out of patience — in which case the tools published describe the page as
 * far as it has got, which is better than a phone that says nothing.
 */
type PageMoved = 'did not move' | 'loaded' | 'still loading';

/* How to put a page in front of somebody.
 *
 * 'navigate this tab' is the ordinary case. 'replace the blank tab' opens the
 * address in a new tab and closes the blank one behind it, because navigating
 * Chrome's New Tab page in place leaves the keyboard in the address bar — where
 * the talk key reaches nothing. 'open a tab' is for when there is no tab at all.
 */
type GoingThereHow = 'navigate this tab' | 'replace the blank tab' | 'open a tab';
