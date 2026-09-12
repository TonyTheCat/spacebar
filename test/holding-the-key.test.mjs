/* The rule: read the EVENT, which already says where focus went — never poll
 * the world.
 *
 * Polling answered about the moment of asking: a window reports focused: false
 * whenever Chrome is not the frontmost application, so the phone closed a turn
 * a moment after the key was pressed and the log said the holding page had lost
 * focus just after gaining it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { windowFocusMoved, tabCameForward, tabWasRemoved } = loadShared(
  'holding-the-key.js',
  'HoldingTheKey'
);

const NO_WINDOW = -1; // chrome.windows.WINDOW_ID_NONE

test('focus landing on the window that holds the key is not losing it', () => {
  const why = windowFocusMoved({ holding: 7, holdingWindow: 1, wasFocused: true, movedTo: 1 });
  assert.equal(why, '', 'an event that names the holding page is not a reason to stop');
});

test('focus moving to another window ends the turn, with a reason to say out loud', () => {
  const why = windowFocusMoved({ holding: 7, holdingWindow: 1, wasFocused: true, movedTo: 2 });
  assert.equal(why, 'the window holding the key lost focus');
});

test('focus leaving Chrome altogether ends the turn', () => {
  const why = windowFocusMoved({
    holding: 7,
    holdingWindow: 1,
    wasFocused: true,
    movedTo: NO_WINDOW,
  });
  assert.ok(why, 'a microphone open with nobody watching it is the failure here');
});

test('focus that was never there cannot be lost', () => {
  // Under automation Chrome never holds the operating system's focus, so the
  // first focus event after a press truthfully reports none — and the turn was
  // being closed out of a state where focus had never been.
  const why = windowFocusMoved({
    holding: 7,
    holdingWindow: 1,
    wasFocused: false,
    movedTo: NO_WINDOW,
  });
  assert.equal(why, '');
});

test('an unreadable holding window does not swallow a real loss', () => {
  // holdingWindow is null when it could not be read. The choice is between
  // ignoring every focus change and acting on one that may be ours; a
  // microphone left open is the worse half.
  const why = windowFocusMoved({ holding: 7, holdingWindow: null, wasFocused: true, movedTo: 2 });
  assert.equal(why, 'the window holding the key lost focus');
});

test('nobody holding the key means there is nothing to end', () => {
  assert.equal(
    windowFocusMoved({ holding: null, holdingWindow: 1, wasFocused: true, movedTo: NO_WINDOW }),
    ''
  );
  assert.equal(tabCameForward(null, 9), '');
  assert.equal(tabWasRemoved(null, 9), '');
});

test('another tab coming forward ends the turn whether or not Chrome owns the screen', () => {
  // Deliberately not conditional on focus: this is the case the person causes
  // themselves.
  assert.equal(tabCameForward(7, 9), 'another tab came in front of the page holding the key');
  assert.equal(tabCameForward(7, 7), '', 'the holding tab coming forward is not a loss');
});

test('the holding tab being closed ends the turn, and another tab’s does not', () => {
  // Nothing is coming from a closed tab: not a keyup, not a pagehide, nothing.
  assert.equal(tabWasRemoved(7, 7), 'the tab holding the key was closed');
  assert.equal(tabWasRemoved(7, 9), '');
});
