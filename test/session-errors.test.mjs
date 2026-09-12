/* The rule: an `error` event is the server refusing ONE REQUEST, not the line
 * going away. Only the transport can say the line is gone.
 *
 * The phone read every error as a lost connection, said "The connection
 * dropped. Reconnecting." out loud and opened a new session. The error was
 * conversation_already_has_active_response — the session refusing one request
 * while perfectly alive — so a working line was thrown away mid-errand, its
 * context went with it, and the person paid for a second session to be told a
 * lie about the first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from './load-shared.mjs';

const { isDrop, saysAResponseIsRunning, written, ALREADY_ANSWERING } = loadShared(
  'session-errors.js',
  'SessionErrors'
);

const refused = {
  type: 'invalid_request_error',
  code: ALREADY_ANSWERING,
  message: 'Conversation already has an active response',
};

test('the refusal that cost a session is not a dropped line', () => {
  assert.equal(isDrop(refused), false);
});

test('no error at all says the line is gone', () => {
  // GONE is empty by measurement: no payload has been seen announcing the end
  // of a session, and the two places that would notice — the channel closing,
  // the peer connection failing — are not this event.
  for (const error of [
    refused,
    { type: 'invalid_request_error', code: 'unknown_parameter' },
    { type: 'server_error' },
    {},
    null,
    undefined,
  ]) {
    assert.equal(isDrop(error), false, JSON.stringify(error) ?? String(error));
  }
});

test('the server’s word that a response is running is read, not ignored', () => {
  // The phone's own idea of this comes from response.created and response.done;
  // this error is what arrives when that idea is wrong, and believing the
  // server is what stops the next release from being refused too.
  assert.equal(saysAResponseIsRunning(refused), true);
  assert.equal(saysAResponseIsRunning({ code: 'unknown_parameter' }), false);
  assert.equal(saysAResponseIsRunning(null), false);
});

test('the line written down says what it was and carries the message', () => {
  assert.equal(
    written(refused),
    'invalid_request_error / conversation_already_has_active_response — Conversation already has an active response'
  );
});

test('an error with no code or message is still one line', () => {
  assert.equal(written({ type: 'server_error' }), 'server_error');
  assert.equal(written({}), 'error');
  assert.equal(written(null), 'error');
});

test('a long message is cut rather than becoming the log', () => {
  const line = written({ type: 'server_error', message: 'm'.repeat(500) });
  assert.ok(line.length < 260);
});
