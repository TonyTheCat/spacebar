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
