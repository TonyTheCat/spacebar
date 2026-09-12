/* The phone: one voice session, and the key that opens the microphone.
 *
 * A pinned tab that the service worker opens by itself. It holds exactly one Realtime session
 * — a peer connection, a microphone whose track is disabled between turns, and one data
 * channel carrying every event either side sends. Nothing here is a surface a blind person is
 * expected to use: the state line and the log are for a sighted helper sitting next to them
 * while it is set up. The product is the voice.
 *
 * This file is the plumbing around the machines in src/shared, and the split is deliberate.
 * Everything that can be reasoned about without a browser lives there and is tested:
 * OneSession (is there a line, or is one being built), Turns (whose turn it is and whether
 * there is anything to answer), PushToTalk (holding the key, and every way a release goes
 * missing), SessionErrors (what an error MEANS, which is almost never "the line is gone"),
 * SessionSetup (what a session is told when it opens). What is left here is WebRTC, the DOM,
 * and the order things happen in.
 */

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** A line in the page's own diary. Not for the person this is built for — for the helper who
 *  is setting it up, and for an instrument reading the page back afterwards.
 *  @param {string} text */
const log = (text) => {
  const line = document.createElement('li');
  line.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  byId('log').appendChild(line);
  line.scrollIntoView({ block: 'nearest' });
};

/** @param {string} text @param {string} [tone] */
const state = (text, tone) => {
  byId('state').textContent = text;
  byId('state').className = `state ${tone ?? ''}`;
};

/** @type {RTCPeerConnection|null} */
let peer = null;
/** @type {RTCDataChannel|null} */
let events = null;
/** @type {MediaStreamTrack|null} */
let microphone = null;

/* Let every page read the talk flag — from HERE, and not only from the service worker.
 *
 * The talk key on a page works by reading one flag out of chrome.storage.session, and session
 * storage is trusted-contexts-only until something raises the access level. Putting that call
 * only in the worker's startup handlers makes the whole talk key depend on onStartup firing,
 * and there are profiles where it does not: the flag is then never readable, every page's read
 * is refused, every page correctly reads that refusal as "no session", and the space bar does
 * nothing anywhere with nothing on screen to say why.
 *
 * This page is a trusted context too, and it is the one that cannot be missing — there is no
 * voice session without it. So it is raised here as well. Both callers setting it is harmless;
 * neither of them setting it is the failure above. */
const pagesCanReadTheFlag = chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch(() => {});

/** Tell the pages whether there is anything to talk to. @param {boolean} live */
const sayVoiceLive = async (live) => {
  // Not before the pages are allowed to READ it: a flag written while session storage is still
  // trusted-contexts-only is a flag every page is refused, which is indistinguishable from no
  // session at all.
  await pagesCanReadTheFlag;
  await chrome.storage.session.set({ voiceLive: live }).catch(() => {});
};

window.addEventListener('pagehide', () => void sayVoiceLive(false));

/** Say something out loud from the phone ITSELF.
 *
 * Not through the session — the session is exactly what has gone wrong whenever this is
 * needed. The state line is text on a screen, which is the one thing the person this is built
 * for cannot use, and a connection that dropped in silence is indistinguishable from an agent
 * with nothing to say.
 *
 * A recorded line is played when there is one: these sentences arrive at the worst moments,
 * and the browser's own voice was called shrill by the first person to hear it. Synthesis
 * stays behind it for anything unrecorded and for a file that will not play — being shrill
 * beats being silent.
 *
 * @param {VoiceLine|string} said */
const sayOutLoud = (said) => {
  const text = VoiceLines.textOf(said);
  const line = VoiceLines.find(said);
  log(`said out loud: "${text}"`);

  /* THE RECORDINGS ARE THE VOICE NOW, and there is no falling back to the browser's own.
   *
   * @anton's ruling, once every line of the table had a clip: speechSynthesis was described by
   * the first person to hear it as shrill, and these sentences arrive at the worst moments —
   * no key, a dropped line, a hold that ran too long. The rule it replaces said being shrill
   * beats being silent, and that was true while three lines had no recording. They all have
   * one.
   *
   * What that buys is one voice. What it costs is that a line with no clip is now SILENT, and
   * silence is the failure this product can least afford — so it is made loud in the log
   * instead, where a test catches it before a person does. test/voice-lines.test.mjs holds
   * that gate: every line of the table has a file in assets/voice, checked on every commit.
   *
   * A raw string reaches here only if somebody adds one; there are none left. */
  if (!line) {
    log(`NO CLIP for "${text}" — nothing was said out loud. Every spoken line needs one.`);
    return;
  }
  const clip = new Audio(chrome.runtime.getURL(line.file));
  clip.onerror = () => {
    log(`NO CLIP for "${line.id}" — the file did not load, so nothing was said out loud.`);
  };
  clip.play().catch((error) => {
    /* A file that is present and will not play. The one case nobody has measured is a pinned
     * tab that has never been interacted with, where a browser may refuse audio outright —
     * said here in full rather than summarised, because if it ever happens this line is the
     * only evidence there will be. */
    log(`NO CLIP for "${line.id}" — it would not play: ${String(error).slice(0, 120)}`);
  });
};

/** One line, however many things ask for one: the automatic connection on load, the Connect
 *  button, and a reconnection after a drop. None of them knows what the others are doing. */
const theLine = OneSession.create();

/** One automatic reconnection per connection, so a dead line comes back without anybody
 *  watching — and a line that cannot come back does not spin. */
let mayReconnect = false;

/** Send one event into the session. @param {object} event @returns {boolean} */
const send = (event) => {
  const what = 'type' in event ? String(event.type) : 'event';
  if (events?.readyState !== 'open') {
    log(`cannot send ${what}: the channel is not open`);
    return false;
  }
  try {
    events.send(JSON.stringify(event));
    return true;
  } catch (error) {
    /* A send that throws must not end the turn in silence. It is the last thing that happens
     * on the path out — a payload too large for the transport, a buffer that has filled — and
     * left unhandled the throw travels up into a promise nobody is watching: no answer,
     * nothing said out loud, to the one person who cannot see that nothing happened. */
    log(`could not send ${what}: ${String(error).slice(0, 160)}`);
    return false;
  }
};

/* Whose turn it is. The three facts this holds — was anything said, has the server taken the
 * audio, is the model already answering — used to be one boolean, and all three of them were
 * wrong at once on a live run. */
const turn = Turns.create({
  onAsk: () => askForAnAnswer(),
  onStillWaiting: () => {
    // The audio never arrived. Ask the server to take what it has rather than leaving the
    // person in front of a phone that has gone quiet.
    log('the audio has not arrived — asking the session to take what it has');
    send({ type: 'input_audio_buffer.commit' });
  },
});

/** Ask the model to answer the turn that just ended.
 *
 * The only place a response is ever asked for, which is what keeps the rule about
 * interrupting in one place. Talking over the model is not an error to be prevented — it is
 * how conversation works, and for somebody who cannot see a screen it is the only way to stop
 * an answer that has gone wrong. So the answer in progress is cancelled first, and the audio
 * already on its way out is cleared with it: over WebRTC the speaker is holding seconds of
 * sound the session has already sent, and cancelling without clearing leaves the model talking
 * after it has stopped.
 */
let answerWasCutOff = false;

const askForAnAnswer = () => {
  if (turn.answering) {
    log('they talked over the answer — cancelling it');
    answerWasCutOff = true;
    send({ type: 'response.cancel' });
    send({ type: 'output_audio_buffer.clear' });
    // And ask once the session says that answer has actually stopped. Asking straight after
    // the cancel races the session's own bookkeeping: the ask arrives while the old answer is
    // still running, is refused, and the person's interruption disappears without a sound.
    turn.askWhenTheAnswerStops();
    return;
  }

  /* Before it answers, the model is told the last answer did not arrive whole.
   *
   * Its own record says it told them everything it produced — including the words we threw
   * away at the speaker when they interrupted. Without this it never mentions those again, and
   * the person is left with half a list and no way to know there was more. */
  if (answerWasCutOff) {
    answerWasCutOff = false;
    log('the last answer was cut off — telling it they heard only the beginning');
    send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: CUT_OFF_NOTE }] },
    });
  }
  send({ type: 'response.create' });
};

/** Ask the session to say one line, now.
 *
 * Per-response instructions, so it cannot be mistaken for a change to how the whole
 * conversation behaves. The only place that creates a response for a sentence of OURS rather
 * than for a turn the person took.
 *
 * @param {string} instructions @returns {boolean} */
const askItToSay = (instructions) => send({ type: 'response.create', response: { instructions } });

/** @param {MessageEvent} message */
const onServerEvent = (message) => {
  const event = JSON.parse(message.data);

  if (event.type === 'session.created') {
    log(`session.created — model ${event.session?.model}`);
    state('connected, hold Space to talk', 'live');
    // Every page may take the space bar now, because there is finally something to say into.
    void sayVoiceLive(true);
    // A line that came up may drop, and one automatic attempt is allowed again.
    mayReconnect = true;
    theLine.live();
    /* Somewhere real to be, then the first list, then hello — in that order, and the order is
     * the point. The greeting names where they are, so it cannot be said before there is a
     * page; and the tools have to be in the session's hands before the model is asked for
     * anything at all, or its first response is built against nothing.
     *
     * THE SESSION SAYS IT, not the phone. The recorded lines are for when the session is what
     * has gone wrong — using one here would put a second voice into an errand, and the phone's
     * own voice is the sound of something being broken. The clip is the fallback for a line
     * that cannot be asked for at all. */
    void openTheStartPageIfNothingElseDid()
      .then(() => readThePageAndPublish('the first set'))
      .then((scan) => {
        if (!theLine.isUp) return; // the line can go while we are getting here
        if (!askItToSay(Orientation.hello(scan?.title, scan?.url))) {
          sayOutLoud(VoiceLines.CONNECTED);
        }
      });
  }

  if (event.type === 'session.updated') {
    const names = ToolsAck.namesIn(event.session);
    log(`session.updated ACCEPTED — tools now: ${names.join(', ') || '(none)'}`);
    /* Somebody may be holding the model's answer until this arrives, and WHOSE acknowledgement
     * this is decides whether they may stop holding. A response is created with the tools the
     * session has AT THAT MOMENT, so answering a tool call before our list is accepted hands
     * the model the tools of the page it has just left.
     *
     * The event carries no correlation id, and there is always something else in flight — the
     * opening update carries no tools and is acknowledged just the same. So the list ITSELF is
     * the correlation. An acknowledgement of somebody else's list leaves ours waiting, which
     * times out honestly instead of confirming something that never happened. */
    if (accepted && ToolsAck.answers(accepted.names, names)) {
      accepted.wait.settled();
      accepted = null;
      // Now we KNOW what it holds, by its own word. The only place that may say so.
      heldBySession = names;
    } else if (accepted) {
      log('that was an acknowledgement of another list — still waiting for ours');
      // And we no longer know what it is holding, so nothing may be skipped on that belief.
      heldBySession = null;
    }
  }

  if (event.type === 'response.function_call_arguments.done') {
    const args = JSON.parse(event.arguments || '{}');
    // Written down, never printed raw: a password the gate refuses to say out loud is not
    // protected if the line above it carries the characters in full.
    log(`the model called ${event.name} with ${Consent.written(args, schemasInPlay.get(event.name))}`);
    void answerTheCall(String(event.call_id), String(event.name), args);
  }

  /* The person's own words, as the session heard them. This is the only evidence the consent
   * gate will ever accept, and the model has no way to write into it. */
  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    lastHeardFromPerson = String(event.transcript ?? '').trim();
    heardAt = Date.now();
    log(`you said: "${lastHeardFromPerson}"`);
  }

  if (event.type === 'response.created') turn.answerStarted();
  if (event.type === 'response.done') turn.answerFinished();

  /* Speech detection is the only thing that knows whether anything was said in time for it to
   * matter: the transcript arrives long after the key is back up. */
  if (event.type === 'input_audio_buffer.speech_started') {
    turn.heardSpeech();
    log('it is hearing speech');
  }
  if (event.type === 'input_audio_buffer.committed') {
    log(`the session has the audio (${turn.audioArrived()})`);
  }
  if (event.type === 'response.output_audio_transcript.done') {
    log(`it said: "${event.transcript}"`);
  }

  if (event.type === 'error') {
    log(`the session reported: ${SessionErrors.written(event.error)}`);
    /* A refused request is not a lost line. This branch used to say "the connection dropped"
     * out loud for every error, close a healthy channel and pay for a new session — while the
     * error was the server refusing ONE request and staying perfectly alive. Only the
     * transport may say the line is gone, and it says so through its own events. */
    if (!SessionErrors.isDrop(event.error)) {
      if (SessionErrors.saysAResponseIsRunning(event.error)) {
        // The server's word about its own state beats ours. Ours comes from response.created
        // and response.done, and this error is what arrives when ours is wrong; left
        // uncorrected, the next release asks again and is refused again.
        turn.answerStarted();
        log('it is still answering — noted, and the line is untouched');
      }
      return;
    }
    state('the session reported an error', 'failed');
    void sayVoiceLive(false);
    turn.answerFinished();
    void comeBack(VoiceLines.RECONNECTING);
  }
};

/** The line is gone. Say so, then try once. @param {VoiceLine|string} said */
const comeBack = async (said) => {
  if (!theLine.down()) return; // somebody else already noticed; one reconnection, not three
  turn.clear();
  answerWasCutOff = false;
  talkKeyOnPhone.lostSight();
  if (microphone) microphone.enabled = false;
  peer?.close();
  peer = null;
  events = null;

  if (!mayReconnect) {
    state('not connected', 'failed');
    sayOutLoud(VoiceLines.CANNOT_RECONNECT);
    return;
  }
  // One attempt, and it is spent whether or not it works. A line that cannot come back must
  // not spin: the person is told to press Connect, which is a thing a helper can do.
  mayReconnect = false;
  state('reconnecting…');
  sayOutLoud(said);
  await connect();
};

/** Open a session, if there is not one already. */
const connect = async () => {
  if (!theLine.begin()) {
    // Not a failure and nothing to say out loud: the line they wanted is either up or on its
    // way, which is what they asked for.
    log(`already ${theLine.state} — not opening a second session`);
    return;
  }
  try {
    // Anything short of an established connection leaves no line behind, so the machine goes
    // back down and the next attempt is allowed. Stuck in 'connecting', it would take the
    // Connect button away for the rest of the day.
    if (!(await openTheLine())) theLine.down();
  } catch (error) {
    theLine.down();
    log(`opening the line threw: ${String(error).slice(0, 160)}`);
    state('could not start', 'failed');
  }
};

/** The sequence itself. Only ever called through connect(), which is what keeps one of these
 *  running at a time.
 *  @returns {Promise<boolean>} true if the connection was established. */
const openTheLine = async () => {
  /* A new line is a new hello: whatever turn the last one was in the middle of went with it.
   *
   * Including the fact that an answer was cut off. That flag is consumed by the next ask, and
   * if the line drops inside the cancel window the ask never comes — so it would survive the
   * reconnection and tell a fresh session that its previous answer was interrupted. It was not:
   * that session did not exist yet. Found by the reviewer, and it is exactly the shape of thing
   * that produces one baffling turn nobody can reproduce. */
  turn.clear();
  answerWasCutOff = false;
  // A new session holds nothing, whatever the last one had taken.
  heldBySession = null;

  /* The key comes from the settings page, never from here. It used to be a password field on
   * this surface — the one screen a blind person uses every day, asking them to type a secret
   * they cannot read into a box they cannot see. A helper enters it once at installation. */
  const { openaiKey: key, spokenLanguage } = await chrome.storage.local.get([
    'openaiKey',
    'spokenLanguage',
  ]);
  if (typeof key !== 'string' || !key.trim()) {
    log("no key saved — a helper enters one on the extension's settings page");
    state('not set up yet', 'failed');
    sayOutLoud(VoiceLines.NOT_SET_UP);
    return false;
  }

  state('minting a short-lived key…');
  const minted = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: { type: 'realtime', model: 'gpt-realtime-2.1' } }),
  }).catch((error) => {
    log(`could not reach the service: ${String(error).slice(0, 160)}`);
    return null;
  });
  if (!minted) {
    state('could not start', 'failed');
    return false;
  }
  if (!minted.ok) {
    log(`could not mint a key: ${minted.status} ${(await minted.text()).slice(0, 160)}`);
    state('could not start', 'failed');
    /* A refused key is not a broken product, it is a wrong key — and the person who can fix it
     * is the one who typed it. Naming which failure this is turns "nothing works" into an
     * errand somebody can actually run. */
    /* The status is in the log above, where the helper who can act on it reads it. Out loud it
     * is a number that means nothing to the person hearing it — and a sentence built around
     * one can never have a recording, which is what left this the last line in the product
     * falling back to the browser's voice. */
    if (minted.status === 401 || minted.status === 403) sayOutLoud(VoiceLines.KEY_REFUSED);
    else sayOutLoud(VoiceLines.COULD_NOT_START);
    return false;
  }
  const { value: ephemeral } = await minted.json();
  log('short-lived key minted');

  peer = new RTCPeerConnection();

  const speaker = new Audio();
  speaker.autoplay = true;
  peer.ontrack = (e) => {
    speaker.srcObject = e.streams[0];
  };

  /* The microphone is opened once and kept, and its track starts DISABLED. Push to talk IS
   * that flag: permission is granted once, and nothing is heard until the key is held. A
   * microphone that is open because it was easier is the thing this product must not be. */
  /* Said BEFORE the ask, out loud, because the thing they have to do next is invisible to them.
   *
   * Chrome puts a permission bubble at the top of the window. Somebody who cannot see it gets
   * silence from a phone that says "short-lived key minted" and then nothing at all, while the
   * browser waits for a click on something they do not know is there. One sentence, from the
   * phone's own voice — this is exactly the kind of moment the recorded lines exist for, and
   * the session cannot say it because the session is not up yet. */
  state('waiting for the microphone — allow it in the browser');
  sayOutLoud(VoiceLines.ALLOW_THE_MICROPHONE);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error) => {
    // Silence from here would be indistinguishable from an agent with nothing to say — and
    // this is the one failure where the person is about to hold a key and talk into a
    // microphone nobody is listening to.
    log(`the microphone was refused: ${String(error?.name ?? error).slice(0, 80)}`);
    state('the microphone is not allowed', 'failed');
    sayOutLoud(VoiceLines.NO_MICROPHONE);
    return null;
  });
  if (!stream) {
    peer.close();
    peer = null;
    return false;
  }
  microphone = stream.getAudioTracks()[0];
  microphone.enabled = false;
  peer.addTrack(microphone, stream);
  log('microphone granted, and muted until Space is held');

  events = peer.createDataChannel('oai-events');
  events.onmessage = onServerEvent;
  /* The channel can die on its own, with the peer connection perfectly healthy. Watching only
   * the connection means watching the wrong thing: ICE stays fine and everything a session is
   * actually made of travels on this channel. A line that is up and carries nothing is the
   * worst kind to have, because it looks exactly like a working one. */
  events.onclose = () => {
    log('the events channel closed');
    void sayVoiceLive(false);
    void comeBack(VoiceLines.RECONNECTING);
  };
  events.onerror = () => {
    log('the events channel reported an error');
    void comeBack(VoiceLines.RECONNECTING);
  };
  events.onopen = () => {
    log('data channel open');
    send(SessionSetup.opening({ instructions: PHONE_INSTRUCTIONS, language: spokenLanguage }));
    log(`transcribing as ${SpokenLanguage.nameOf(SpokenLanguage.of(spokenLanguage))}`);
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
  }).catch((error) => {
    log(`could not reach the service: ${String(error).slice(0, 160)}`);
    return null;
  });
  if (!answer || !answer.ok) {
    if (answer) log(`the call was refused: ${answer.status} ${(await answer.text()).slice(0, 160)}`);
    state('could not start', 'failed');
    peer.close();
    peer = null;
    return false;
  }
  await peer.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
  log('peer connection established');

  // A connection that drops takes the key with it, whether or not the session said goodbye.
  peer.onconnectionstatechange = () => {
    if (!peer || !['disconnected', 'failed', 'closed'].includes(peer.connectionState)) return;
    log(`the connection is ${peer.connectionState} — the talk key goes back to the pages`);
    void sayVoiceLive(false);
    void comeBack(VoiceLines.RECONNECTING);
  };

  return true;
};

/* ============================ the page, and its tools ============================
 *
 * One path, and it is the single largest source of defects in this product's history:
 *
 *   an action happens -> the page settles -> the new tools are published -> the model is
 *   answered.
 *
 * It looks like four lines. Each arrow is a place two asynchronous things meet.
 *
 * A response is created with the tools the session holds AT THAT MOMENT, so answering a tool
 * call before the new list is accepted hands the model the previous page's tools — and it then
 * says it cannot act on the page it is looking at. Waiting for `complete` alone does not work
 * either: nothing has committed a navigation by the time the call returns, so the wait is
 * answered instantly by the page being LEFT. And session.updated carries no correlation, so
 * "my tools were accepted" has to be matched by the tool list itself.
 */

/** The tab the person is working in — not this one. */
let pageTabId = /** @type {number|null} */ (null);

/** What the person last actually said, and when. The ONLY evidence the gate accepts: the
 *  model cannot write into a transcript of somebody else's voice. */
let lastHeardFromPerson = '';
let heardAt = 0;

/** The list we are waiting to hear accepted. One at a time — a new publish replaces it,
 *  because what matters is that the LAST list sent has been taken.
 *  @type {{names: string[], wait: ReturnType<typeof OneWait.create>}|null} */
let accepted = null;

/** What the session itself says it is holding. Only its own acknowledgement may set this: our
 *  belief about what we sent is not evidence about what it took. @type {string[]|null} */
let heldBySession = null;

/** The schema of each tool currently on offer, by name. Kept so that what is read back at the
 *  gate can be masked by the same rules the schema declares — a password is named, never said. */
const schemasInPlay = new Map();

/** An action that has been asked about and is waiting for a real answer. */
let parked = /** @type {{name: string, args: object, at: number, schema?: object}|null} */ (null);

/** The ONE press a person has just agreed to.
 *
 * The page asks the extension to confirm before it runs anything gated — its own gate, and not
 * a duplicate of ours: ours stops the model pressing without asking, its one stops the PAGE
 * pressing on its own behalf, and a gate that trusts whoever is calling it is not a gate. It
 * has to be answered, and an unanswered request is read as no, which is the safe direction and
 * exactly what went wrong: the phone listened for the talk key and nothing else, so every
 * confirmed press came back "the human declined to press Search" — said to the person who had
 * just said yes.
 *
 * So this is a token for one press: set when their own words confirmed it, spent by the first
 * matching question, and gone. Anything else — a second ask for the same tool, a press
 * nobody agreed to, a page trying its luck — is answered no, because it is.
 *
 * @type {{name: string, at: number}|null} */
let pressToken = null;

/** How long a confirmed press stays confirmable. Long enough for the round trip to the page,
 *  short enough that a yes cannot be spent on something that happens later. */
const PRESS_TOKEN_MS = 15000;

/** How long a parked action stays answerable. A question nobody answered must die rather than
 *  be answered late: a yes said ninety seconds after the fact is a yes to something else. */
const PARK_LIFETIME_MS = 90000;

/** How long to wait for the session to accept a tool list before answering anyway. */
const ACCEPTED_MS = 4000;
/** How long to wait for a page to finish loading after we sent it somewhere. */
const PAGE_LOAD_MS = 8000;
/** One ask of the content script. */
const ONE_ROUND_TRIP_MS = 4000;
/** How long a press may take before we stop waiting for its answer. Longer than a round trip:
 *  the content script waits for the control to take the value and for the page to react. */
const PRESS_MS = 8000;
/** How long to watch for the page to move after a press, before deciding it did not. */
const MOVED_MS = 2500;

/** Ask something and give up rather than hang. A tool call that never answers leaves the model
 *  waiting and the person in silence, which is worse than a refusal.
 *  @template T @param {Promise<T>} asked @param {string} what @param {number} [ms]
 *  @returns {Promise<T|null>} */
const orNothing = async (asked, what, ms = ONE_ROUND_TRIP_MS) => {
  const wait = OneWait.create({ ms });
  const answer = await Promise.race([
    asked.then((got) => {
      wait.settled();
      return got;
    }).catch((error) => {
      wait.settled();
      log(ToolResult.threw(what, error));
      return null;
    }),
    wait.promise.then(() => null),
  ]);
  if (wait.outcome === 'timed out') log(ToolResult.tooLong(what, ms));
  return answer ?? null;
};

/** How long to keep asking a page that is not listening yet, and how often. */
const KEEP_ASKING_MS = 4000;
const A_BREATH_MS = 250;

/** Ask a page something READ-ONLY, until it is there to answer or the time is up.
 *
 * `complete` is not when the content script starts. It is injected at document_idle, which
 * Chrome schedules AFTER the load event at its own discretion — measured here as several
 * hundred milliseconds to over a second past the `complete` this phone waits for. Until then
 * sendMessage rejects with "Could not establish connection", which looks exactly like a page
 * that has no tools: the run said "the page did not answer a scan" three times about a page
 * that answered perfectly when asked again three seconds later.
 *
 * So this asks until somebody is listening, on a deadline. Two asks a fixed breath apart is
 * what the service worker does and it is right there — an opportunistic scan on a page that
 * finished loading whenever it did. This path is different: the phone has JUST sent them
 * somewhere and is waiting for that page specifically, so a bounded poll is the honest shape.
 *
 * ONLY for reading. An action is never retried: asking a page to press something again because
 * the first answer was slow is how a form gets sent twice, and one of those cannot be undone.
 * Reading the same page twice costs nothing.
 *
 * @param {number} tabId @param {object} message @param {string} what */
const askUntilItAnswers = async (tabId, message, what) => {
  const until = Date.now() + KEEP_ASKING_MS;
  let asks = 0;
  for (;;) {
    asks += 1;
    const answer = await chrome.tabs.sendMessage(tabId, message).catch(() => null);
    if (answer && typeof answer === 'object') {
      if (asks > 1) log(`${what}: answered on ask ${asks}`);
      return answer;
    }
    if (Date.now() >= until) {
      log(`${what}: nobody answered after ${asks} asks`);
      return null;
    }
    await new Promise((done) => setTimeout(done, A_BREATH_MS));
  }
};

/** The tab the person is on. Never this one, and never another extension page.
 *  @returns {Promise<chrome.tabs.Tab|null>} */
const findPageTab = async () => {
  const tabs = await chrome.tabs.query({});
  const ours = chrome.runtime.getURL('');
  const theirs = tabs.filter((tab) => !String(tab.url ?? tab.pendingUrl ?? '').startsWith(ours));
  if (pageTabId !== null) {
    const known = theirs.find((tab) => tab.id === pageTabId);
    if (known) return known;
  }
  // Whatever they are looking at, and a blank tab in preference to nothing: a blank one is
  // where a page can be put without taking away somewhere they were.
  const active = theirs.find((tab) => tab.active);
  return active ?? KnownSites.pickBlankTab(theirs) ?? theirs[0] ?? null;
};

/** A page tool, as the model is shown it. The live element stays in the content script's own
 *  registry, keyed by this name; nothing here carries a handle on anything.
 *  @param {Tool} tool */
const asFunctionTool = (tool) => ({
  type: 'function',
  name: tool.name,
  description: Gating.mustAskOutLoud(tool)
    ? `${tool.description} This one has to be put to the person out loud before it happens: call it, and it will hand you the question to ask.`
    : tool.description,
  parameters: tool.inputSchema,
});

/** The tools that are ours rather than the page's. They are the same four on every page,
 *  which is what makes it possible to start anywhere at all: everything else on offer comes
 *  from the page already in front of the person. */
const OUR_TOOLS = [
  {
    type: 'function',
    name: 'open_site',
    description:
      'Go to a website. Use it when they name somewhere to go rather than something on this ' +
      'page. Takes a name you know or an address; if it is neither, say so instead of guessing.',
    parameters: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'What they said: a site name, or an address.' },
      },
      required: ['site'],
    },
  },
  /* One field at a time, for a form that is a conversation rather than a form.
   *
   * The synthesizer CLAIMS the fields of a submit widget, so the only thing offered there is
   * "fill in and submit all of it". On a wizard with required fields — a date of birth, a
   * state, a citizenship — that is the wrong shape for a voice: the model fills what it has,
   * leaves the rest at a placeholder, and the page comes back with four errors while the
   * person hears "submitted".
   *
   * So this puts in ONE value and commits nothing. Deliberately NOT gated: typing into a box
   * sends nothing, and asking permission for each keystroke is the gate crying wolf until
   * nobody hears it. The submit stays gated and unchanged. */
  {
    type: 'function',
    name: 'fill_in',
    description:
      'Put one value into one field of a form on this page, without submitting anything. Use ' +
      'it for a form whose required fields are still empty: ask them for one value out loud, ' +
      "fill it in, then ask for the next. The field names and the values a select will accept " +
      "are in the submit tool's own schema. Never invent a value, and never leave a required " +
      'field at its placeholder.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'The name of the submit tool this field belongs to.' },
        field: { type: 'string', description: "The field, named as that tool's schema names it." },
        value: { type: 'string', description: 'What they said, as they said it.' },
      },
      required: ['tool', 'field', 'value'],
    },
  },
  {
    type: 'function',
    name: 'read_page',
    description:
      'What does this page say now? Use it when you arrive somewhere, or when something you ' +
      'did changed the page. It comes back as the page in parts; say a sentence or two of it.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'confirm_action',
    description:
      'Only after you asked the question a gated tool handed you, out loud, and they answered. ' +
      'It reads their own words; it will refuse anything that is not a clear yes.',
    parameters: { type: 'object', properties: {} },
  },
];

/** Everything on offer right now, in the order the model reads it. @param {object} scan */
const toolsOf = (scan) => {
  const page = Shortlist.pick(scan?.synthesized ?? []);
  schemasInPlay.clear();
  for (const tool of page) schemasInPlay.set(tool.name, tool.inputSchema);
  return [...page.map(asFunctionTool), ...OUR_TOOLS];
};

/** Hand a list to the session and wait for it to say it has taken it.
 *  @param {object[]} tools @param {string} why @returns {Promise<boolean>} accepted? */
const handToTheSession = async (tools, why) => {
  const names = tools.map((tool) => String(tool.name));

  /* A list the session already HOLDS is not sent again.
   *
   * Not tidiness: every publish is a session.update the session has to take in order, and one
   * action produces two of them — the tab finishing its load, and the action's own republish.
   * The second arrives while the first is still being acknowledged, and then "was my list
   * accepted?" has two answers in flight for the same question, which is the race the whole
   * ToolsAck correlation exists to settle.
   *
   * Only when it is the SAME list, by the session's own word about what it holds — and it is
   * said out loud in the log as KEPT. A list quietly not sent looks exactly like a list that
   * was dropped, and those mean opposite things to whoever is reading the feed afterwards. */
  if (heldBySession && ToolsAck.answers(heldBySession, names)) {
    log(`the session already holds these ${names.length} tools — KEPT, not sent again (${why})`);
    return true;
  }
  // An older wait is finished rather than left for its own deadline: what matters is that the
  // LAST list sent has been accepted.
  accepted?.wait.giveUp();
  const wait = OneWait.create({ ms: ACCEPTED_MS });
  accepted = { names, wait };
  log(`publishing ${names.length} tools (${why})`);
  if (!send({ type: 'session.update', session: { type: 'realtime', tools } })) {
    accepted = null;
    return false;
  }
  const how = await wait.promise;
  if (how === 'timed out') log('the session never acknowledged that list — answering anyway');
  return how === 'settled';
};


/** One fallback, once per phone: somewhere real to start.
 *
 * A browser that comes up on a blank tab is nothing at all to somebody who cannot see it —
 * there is no page, so there are no tools, so the voice can do nothing and cannot say why.
 * The helper sets a start page in the settings; with nothing there it is a sensible default.
 *
 * ONE attempt, and only when there is actually a blank tab to use. A phone that loads while
 * somebody is reading a real page has not spent it, and is still there for the blank tab that
 * appears later. Every attempt would be a policy nobody asked for — it would keep pulling them
 * back to a start page they had deliberately left. */
const startHere = StartHere.create();

const openTheStartPageIfNothingElseDid = async () => {
  const tabs = await chrome.tabs.query({});
  const ours = chrome.runtime.getURL('');
  const blank = startHere.decide(tabs.filter((tab) => !String(tab.url ?? tab.pendingUrl ?? '').startsWith(ours)));
  if (!blank || blank.id === undefined) return;
  const { startPage } = await chrome.storage.local.get('startPage');
  const where = KnownSites.startPage(startPage);
  handedOverAt = Date.now();
  await chrome.tabs.update(blank.id, { url: where, active: true });
  pageTabId = blank.id;
  log(`nothing was open, so the blank tab was sent to ${where}`);
  await waitForThePage(blank.id, String(blank.url ?? ''));
};

/** Scan whatever page the person is on and publish what it offers.
 *  @param {string} why @returns {Promise<object|null>} the scan */
const readThePageAndPublish = async (why) => {
  const tab = await findPageTab();

  /* OUR OWN TOOLS GO OUT EVEN WHEN THE PAGE CANNOT BE READ, and this is the most important
   * line in the function.
   *
   * From a live run: the browser came back with restored tabs, none of them blank. A tab that
   * existed BEFORE the extension loaded has no content script in it — Chrome does not inject
   * into tabs already open — so the scan went unanswered, nothing was published, and the
   * session was handed a list of no tools at all. The model, with no way to do anything and no
   * way to say why, announced that it had searched for pizza and was looking at the results.
   * That is a lie told to somebody who cannot check it, and it starts here: a model holding
   * nothing will narrate rather than refuse.
   *
   * open_site always works — it is ours, it needs no content script — so it always goes out.
   * A person who cannot read this page can still be taken somewhere that reads. */
  if (!tab || tab.id === undefined) {
    log('there is no page open to read — publishing our own tools so there is still a way out');
    await handToTheSession([...OUR_TOOLS], `${why}, with no page`);
    return null;
  }
  pageTabId = tab.id;
  const scan = await askUntilItAnswers(tab.id, { type: PT.SCAN_REQUEST }, 'the scan');
  if (!scan || typeof scan !== 'object') {
    /* Could not look. NOT "the page has none" — said apart, the agent reports it lost the page;
     * run together it tells somebody who cannot see that the thing they asked for is not
     * there. The commonest cause is a tab older than the extension, and the way out of that is
     * to go somewhere else, which is exactly what open_site is for. */
    log('the page did not answer a scan — publishing our own tools so there is still a way out');
    schemasInPlay.clear();
    await handToTheSession([...OUR_TOOLS], `${why}, unreadable page`);
    return null;
  }
  if (scan.readable === false) {
    log(`could not read that page: ${scan.error ?? 'no reason given'}`);
    schemasInPlay.clear();
    await handToTheSession([...OUR_TOOLS], `${why}, unreadable page`);
    return scan;
  }
  await handToTheSession(toolsOf(scan), why);
  return scan;
};

/** A page settles, and only then is it read.
 *
 * `complete` ALONE IS NOT THE ANSWER, and this is measured rather than argued. A tab that has
 * just been created fires `complete` for the empty document it starts life as, before it has
 * gone anywhere at all — so a wait on the first `complete` returns in a few hundred
 * milliseconds, the scan that follows finds no content script yet, and the phone reports a
 * page with no tools on a page that is still arriving. The same is true of a tab being
 * navigated: nothing has committed by the time the call returns, so the first `complete` is
 * the page being LEFT.
 *
 * So the wait is for a `complete` on OUR tab at somewhere it was not. `wasAt` is where it was
 * before we sent it, and it is compared rather than trusted: a redirect means the url we asked
 * for is not necessarily the url that arrives.
 *
 * @param {number} tabId @param {string} [wasAt] @param {number} [ms]
 * @returns {Promise<'settled'|'timed out'>} */
const waitForThePage = async (tabId, wasAt = '', ms = PAGE_LOAD_MS) => {
  const wait = OneWait.create({ ms });
  const settled = (id, info, tab) => {
    if (id !== tabId || info.status !== 'complete') return;
    const now = String(tab?.url ?? '');
    // An empty document is never the page we were waiting for. Nor is the one we just left.
    if (!now || KnownSites.isBlankPage(now) || now === wasAt) return;
    wait.settled();
  };
  chrome.tabs.onUpdated.addListener(settled);
  const how = await wait.promise;
  chrome.tabs.onUpdated.removeListener(settled);
  // A grace window after `complete`: a page that has just fired it is still wiring its own
  // scripts up, and a scan in that instant reports a page with nothing on it.
  if (how === 'settled') await new Promise((done) => setTimeout(done, 400));
  return how;
};

/** Put a page in front of the person. @param {string} said */
const openSite = async (said) => {
  const where = KnownSites.resolve(said) ?? KnownSites.searchFor(said);
  if (!where) {
    return { ok: false, text: `I did not understand "${said}" as somewhere to go.` };
  }
  const tabs = await chrome.tabs.query({});
  const ours = chrome.runtime.getURL('');
  const theirs = tabs.filter((tab) => !String(tab.url ?? tab.pendingUrl ?? '').startsWith(ours));
  const tab = theirs.find((one) => one.id === pageTabId) ?? theirs.find((one) => one.active) ?? KnownSites.pickBlankTab(theirs);
  const how = GoingThere.how(tab);

  /* From here until the window below closes, a tab coming forward is OUR doing. Read as the
   * person losing the key, it would end the turn of somebody still speaking — which is exactly
   * what open_site used to do, mid-sentence. */
  handedOverAt = Date.now();

  // Where it was, so the wait below can tell the page we are going to from the page we are
  // leaving — and from the empty document a brand new tab starts life as.
  const wasAt = String(tab?.url ?? '');

  let id = tab?.id;
  if (how === 'open a tab') {
    const made = await chrome.tabs.create({ url: where, active: true });
    id = made.id;
  } else {
    await chrome.tabs.update(/** @type {number} */ (id), { url: where, active: true });
  }
  if (id === undefined) return { ok: false, text: 'I could not open a tab.' };
  pageTabId = id;
  log(`${how}: ${where}`);

  const settled = await waitForThePage(id, wasAt);
  const scan = await readThePageAndPublish('a new page');
  const here = Orientation.arrived(scan?.title, scan?.url ?? where);
  return {
    ok: true,
    text:
      settled === 'timed out'
        ? `${here} It is still loading, so there may be more of it in a moment.`
        : here,
  };
};

/** What does this page say now? @returns {Promise<{ok: boolean, text: string}>} */
const readThePage = async () => {
  const tab = await findPageTab();
  if (!tab || tab.id === undefined) return { ok: false, text: VoiceLines.NO_PAGE.text };
  const page = await askUntilItAnswers(tab.id, { type: PT.READ_REQUEST }, 'the read');
  if (!page) return { ok: false, text: 'That page did not answer.' };
  if (page.error) return { ok: false, text: `I could not read that page: ${page.error}` };

  /* The page arrives ALREADY SHAPED. The content script hands the reading to the hands brick
   * with our own Readable.results and Readable.shape as its two ways of saying it, so the
   * choice between "a page of results" and "a page of prose" is made where the DOM is, by the
   * thing that can see both. Formatting it a second time here would be this half guessing at a
   * decision the other half already made properly. */
  const howMany = AfterTheAction.onScreen(page.results, page.of);
  // Marked as somebody else's words on the way in. A page can write a sentence aimed at the
  // model, or at the person; reported either way, obeyed neither.
  return { ok: true, text: [howMany, Readable.untrusted(String(page.text ?? ''))].filter(Boolean).join(' ') };
};

/** Put one value into one field. Nothing is committed, so nothing is asked about.
 *
 * The answer is the CONTROL's own, read back after the page has taken it: what was asked for
 * is our intention, what the control holds is the fact. A select given a value it has no
 * option for keeps what it had, and that read-back is the only way the model learns it did
 * not go in — otherwise it moves on to the next field believing this one is done.
 *
 * @param {{tool?: unknown, field?: unknown, value?: unknown}} args */
const fillOneField = async (args) => {
  const tab = await findPageTab();
  if (!tab || tab.id === undefined) return { ok: false, text: VoiceLines.NO_PAGE.text };
  let result = null;
  try {
    result = await Promise.race([
      chrome.tabs.sendMessage(tab.id, {
        type: PT.FILL_REQUEST,
        tool: args?.tool,
        field: args?.field,
        value: args?.value,
      }),
      new Promise((done) => setTimeout(() => done(null), PRESS_MS)),
    ]);
  } catch (error) {
    // Filling a box does not navigate, so a rejection here is the page being gone, not a
    // press that worked. Said as that rather than as a timeout nobody can act on.
    log(`fill_in: the page did not take it — ${String(error?.message ?? error).slice(0, 160)}`);
    return { ok: false, text: 'That page is not there any more. Say so and read the page again.' };
  }
  if (!result) return ToolResult.timedOut('fill_in');
  return ToolResult.capped(result);
};

/** Run one of the page's own tools, or ask about it first.
 *  @param {string} name @param {object} args @param {Tool|undefined} tool */
const runOnThePage = async (name, args, tool, knownSchema) => {
  const tab = await findPageTab();
  if (!tab || tab.id === undefined) return { ok: false, text: VoiceLines.NO_PAGE.text };

  /* The schema this tool was OFFERED with, and nothing later.
   *
   * Doing the action republishes the page's tools, which clears this map — so looking it up
   * afterwards found nothing and the DONE line came back "search ran with {search: (hidden)}"
   * about an ordinary search term. The masking rule behind that is right and stays: a value no
   * schema describes is a value nothing can vouch for.
   *
   * For a GATED action the gap is wider and worse, which the reviewer caught. Park and press
   * are two separate turns with a person speaking in between; by then the map can hold a
   * DIFFERENT page's tool under the same name, whose schema does not mark the password this
   * one had. Masking would then read a schema that describes something else and print the
   * secret in full. So a parked action carries the schema it was asked about with, and it is
   * passed back in here rather than looked up again. */
  const schema = knownSchema ?? schemasInPlay.get(name);

  /* The gate. A tool the page marked as committing something is NOT run: it is parked, and the
   * model is handed the sentence it must say — which contains the values about to be sent, so
   * that what is agreed to is what happens. The press comes later, through confirm_action, and
   * only on the person's own words. */
  if (tool && Gating.mustAskOutLoud(tool)) {
    parked = { name, args, at: Date.now(), schema: tool.inputSchema };
    return {
      ok: false,
      text: Consent.question(tool.description, args, tool.inputSchema),
    };
  }

  const was = await chrome.tabs.get(tab.id).catch(() => null);
  const wasAt = String(was?.url ?? '');

  /* Sent ONCE and never retried, and the failure is read rather than assumed.
   *
   * A press that navigates kills its own message port — Chrome answers with "the page keeping
   * the extension port is moved into back/forward cache, so the message channel is closed",
   * in thirteen milliseconds. Treated as a timeout, that becomes "it took too long and I do
   * not know whether it went through" about an action that plainly DID go through, said to
   * somebody who cannot look at the screen to check. A rejection is not a timeout, and the
   * page itself says which of the two happened: if it moved, the press landed. */
  let result = null;
  let refused = '';
  try {
    result = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: PT.EXECUTE_REQUEST, name, args, askedBy: 'phone' }),
      new Promise((done) => setTimeout(() => done('timed out'), PRESS_MS)),
    ]);
  } catch (error) {
    refused = String(error?.message ?? error).slice(0, 200);
  }

  // Whatever happened, let the page settle and publish what is there NOW — before the model is
  // answered, or its next response is built against the page it has already left.
  const moved = await waitForThePage(tab.id, wasAt, MOVED_MS);
  const now = await chrome.tabs.get(tab.id).catch(() => null);
  const wentSomewhere = Boolean(now && wasAt && now.url && now.url !== wasAt);
  await readThePageAndPublish('after an action');

  /* The page side answers `moved: true` when it wins its own race with pagehide — it pressed,
   * and the page is going. ToolResult.capped keeps only ok and text, so it is read here, off
   * the raw answer, before anything trims it. */
  const itSaysItMoved = Boolean(result && typeof result === 'object' && result.moved === true);
  if (result && result !== 'timed out' && !itSaysItMoved) return ToolResult.capped(result);

  if (itSaysItMoved || wentSomewhere || moved === 'settled') {
    /* The port died because the page went away, which is the press working. Said as DONE, with
     * where they are now and an instruction not to do it again: a model told "I do not know"
     * about something that happened will helpfully try it a second time. */
    log(`${name}: the page moved — it went through`);
    /* And how many things are on the page now.
     *
     * A count is what tells somebody who cannot see the screen that the page in front of them
     * IS the answer to what they asked: "nine results" cannot be mistaken for a page that did
     * not load. It costs one read, on a page we have just waited for. */
    const page = now?.id === undefined ? null : await askUntilItAnswers(now.id, { type: PT.READ_REQUEST }, 'the read');
    const count = AfterTheAction.onScreen(page?.results, page?.of);
    return {
      ok: true,
      text: [
        AfterTheAction.wentThrough(name, Consent.written(args, schema)),
        count,
        Orientation.arrived(now?.title, now?.url),
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  if (refused) {
    // It did not move and the page refused the message. Said as what it is, not as a timeout.
    log(`${name}: the page did not take it — ${refused}`);
    return { ok: false, text: `The page did not take that. Tell them plainly that it did not happen.` };
  }
  return ToolResult.timedOut(name);
};

/** Press what was parked, if their own words say yes. */
const pressWhatWasParked = async () => {
  if (!parked) {
    return { ok: false, text: 'There is nothing waiting to be confirmed. Call the tool first.' };
  }
  if (Date.now() - parked.at > PARK_LIFETIME_MS) {
    parked = null;
    return { ok: false, text: 'That question is too old to answer now. Ask it again.' };
  }
  /* Their answer has to have been said AFTER the question was parked. Without the timestamp
   * the model can park an action and confirm it in the same breath, using a "yes" the person
   * said about something else entirely. */
  if (heardAt < parked.at) {
    return { ok: false, text: 'I have not heard their answer yet. Ask, and wait for them.' };
  }
  const answer = Consent.readAnswer(lastHeardFromPerson);
  if (answer !== 'yes') {
    const was = parked;
    parked = null;
    log(`not confirmed (${answer}) — ${was.name} was not pressed`);
    return {
      ok: false,
      text:
        answer === 'no'
          ? 'They said no. Nothing was sent. Say so plainly and stop.'
          : 'That was not a clear yes, so nothing was sent. Ask them again in plain words.',
    };
  }
  const doIt = parked;
  parked = null;
  log(`confirmed by their own words — pressing ${doIt.name}`);
  // The page will ask the extension to confirm this press before it runs it. This is the one
  // press that may be answered yes, and it is answered yes exactly once.
  pressToken = { name: doIt.name, at: Date.now() };
  const pressed = await runOnThePage(doIt.name, doIt.args, undefined, doIt.schema);
  // Whatever happened, the token does not outlive the press it was minted for.
  pressToken = null;
  return pressed;
};

/** Answer one tool call. Every path answers, whatever happens inside it: a call that never
 *  comes back leaves the model waiting and the person in silence.
 *  @param {string} call @param {string} name @param {object} args */
const answerTheCall = async (call, name, args) => {
  let result;
  try {
    if (name === 'open_site') result = await openSite(String(args?.site ?? ''));
    else if (name === 'read_page') result = await readThePage();
    else if (name === 'fill_in') result = await fillOneField(args);
    else if (name === 'confirm_action') result = await pressWhatWasParked();
    else {
      /* Which tool this IS decides whether it may run at all, so it is read from the page
       * rather than remembered: the list the model is holding can be a page old, and a gated
       * tool remembered as ungated is the whole product failing quietly. */
      const tab = await findPageTab();
      const scan = tab?.id === undefined
        ? null
        : await askUntilItAnswers(tab.id, { type: PT.SCAN_REQUEST }, 'the scan');
      const tool = (scan?.synthesized ?? []).find((one) => one.name === name);
      result = await runOnThePage(name, args, tool);
    }
  } catch (error) {
    log(ToolResult.threw(name, error));
    result = { ok: false, text: `That went wrong on the page: ${String(error).slice(0, 160)}` };
  }
  log(ToolResult.written(name, result));
  send({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: call, output: JSON.stringify(result) },
  });
  // The model is asked for its answer only now — after the page settled and its tools were
  // published, which is the whole of the one path.
  send({ type: 'response.create' });
};

/* A page the person navigated themselves is still a new page. Coalesced, because a single
 * load fires several of these and republishing on each one sends three lists the session has
 * to take in order. */
const republish = Coalesce.after(400, () => {
  if (theLine.isUp) void readThePageAndPublish('the page changed');
});

/* Push to talk, on this page. Held, not toggled: letting go is what ends a turn, and a key
 * that is up is a microphone that is off.
 *
 * This is only half of it. The phone hears Space when the phone tab has focus; the content
 * script hears it on whatever page the person is actually looking at, which is where somebody
 * who cannot see the screen lives. Both feed this same machine, so the two of them cannot open
 * two turns, and a release that goes missing on one side still closes the turn. */
const talkKeyOnPhone = PushToTalk.create({
  /* Forty-five seconds. Nobody says one thing for that long on purpose, so this is not a limit
   * on speaking — it is the last thing standing when every other way of noticing a lost
   * release has been taken away at once, which one hung page does. Time is all that still
   * passes. */
  limitMs: 45000,
  onTooLong: () => sayOutLoud(VoiceLines.HELD_TOO_LONG),
  onStart: () => {
    if (microphone) microphone.enabled = true;
    turn.held();
    state('listening — let go when you are done', 'talking');
  },
  onStop: () => {
    if (microphone) microphone.enabled = false;
    state(theLine.isUp ? 'connected, hold Space to talk' : 'not connected', theLine.isUp ? 'live' : '');
    /* Letting go means "that was my turn" — and whether to ask for an answer is the machine's
     * decision, not this handler's. Nothing said is nothing to answer; something said but not
     * yet taken by the server waits for it rather than asking about the turn before. */
    const next = turn.released();
    if (next === 'nothing') log('nothing was said — not asking for an answer');
    if (next === 'waiting') log('waiting for the session to take the audio');
  },
});

/* ============================ the key, held on the PAGE ============================
 *
 * This is the product. Somebody who cannot see the screen lives on the site, not on a pinned
 * tab they never look at — so the space bar has to work where they are. The content script
 * hears it there and reports it here; the phone tab's own listeners below are the other half,
 * for a helper sitting at this page.
 *
 * BOTH feed the one machine, which is what makes them safe together: two reports of the same
 * press are one turn, and a release that goes missing on one side is still closed by the other.
 */

/** The tab holding the key, its window, and whether Chrome had the screen when it began. */
let holding = /** @type {number|null} */ (null);
let holdingWindow = /** @type {number|null} */ (null);
let wasFocused = false;

/** When WE last moved them to another tab. A focus change we caused is not evidence about
 *  the key. */
let handedOverAt = 0;

/** Stop the turn, unless the reason is a guess we ourselves caused.
 *  @param {StopReason} why */
const closeTheHeldTurn = (why) => {
  if (why !== 'released' && Handover.expected(handedOverAt, Date.now())) {
    log('a tab moved because WE moved it — the key is not lost, the turn stands');
    return;
  }
  if (talkKeyOnPhone.stop(why)) {
    holding = null;
    holdingWindow = null;
    if (why !== 'released') log(`the turn ended because ${why}`);
  }
};

/* sendResponse is the THIRD argument, and taking only two of them is how the gate said nobody
 * had answered while this very listener was logging that it had.
 *
 * From a live run: the person said yes, the phone minted the press token, the page asked to
 * confirm, this listener printed "confirming the press of Search — they said yes to this one"
 * — and then threw ReferenceError on the next line, because sendResponse was never a name in
 * this function. Nothing went back, the page read the silence as nobody listening (which is
 * correct and is the safe direction), and the form sat there filled in and unsent while the
 * product told somebody who had just agreed that it could not press for them.
 *
 * `node --check` cannot catch it: the file parses perfectly. It was found by reading the
 * listener against a log that said two contradictory things one second apart. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === PT.TALK_START) {
    holding = sender.tab?.id ?? null;
    holdingWindow = sender.tab?.windowId ?? null;
    void chrome.windows.getLastFocused().then((window) => {
      wasFocused = window?.focused === true;
    });
    talkKeyOnPhone.start();
    return false;
  }

  if (message?.type === PT.TALK_STOP) {
    closeTheHeldTurn(message.why ?? 'released');
    return false;
  }

  if (message?.type === PT.CONFIRM_REQUEST) {
    /* Yes for exactly the press a person agreed to, and no for everything else.
     *
     * Answered synchronously — sendResponse after this listener has returned reaches nobody,
     * and a confirmation that arrives too late is a confirmation that never came. */
    const mine =
      message.askedBy === 'phone' &&
      pressToken !== null &&
      Date.now() - pressToken.at < PRESS_TOKEN_MS;
    if (!mine) {
      /* NOT OURS, so this phone says NOTHING — it does not answer "no".
       *
       * Measured with two phone tabs open, which a helper can make by duplicating the tab: the
       * one WITHOUT the token answered first, the page took that as the answer, and a person
       * who had just said yes out loud was told "the human declined to press Save note". A
       * missing answer is already a refusal at the far end, and it is the HONEST one — nothing
       * is pressed either way, and only one of the two sentences puts words in their mouth.
       *
       * So silence here, and the phone that actually holds the yes answers. */
      log(`not ours to confirm: "${message.label}" — leaving it unanswered`);
      return false;
    }
    log(`confirming the press of "${message.label}" — they said yes to this one`);
    // Spent. One yes is one press: a token left lying around would confirm the next thing the
    // page asks about, which nobody agreed to.
    pressToken = null;
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === PT.NO_TALK_FLAG) {
    /* The page could not read the talk flag, so it correctly left the space bar alone. Printed
     * here rather than swallowed: this is the failure that made the key do nothing on a page
     * with nothing anywhere to say why, and this log is where a sighted helper is looking. */
    log(`${message.host ?? 'a page'} cannot read the talk flag — the space bar is not ours there`);
    return false;
  }

  return false;
});

/* Every way a held key goes missing while the person is on a page. Each one is a decision
 * about two facts, and each decision lives in src/shared/holding-the-key.js where it can be
 * tested — what is here is the chrome.* wiring, which cannot be. */
chrome.windows.onFocusChanged.addListener((movedTo) => {
  const why = HoldingTheKey.windowFocusMoved({ holding, holdingWindow, wasFocused, movedTo });
  if (why) closeTheHeldTurn('lost-sight');
});
chrome.tabs.onRemoved.addListener((id) => {
  if (HoldingTheKey.tabWasRemoved(holding, id)) closeTheHeldTurn('lost-sight');
});

window.addEventListener('keydown', (event) => {
  if (!PushToTalk.claims(theLine.isUp, event.code)) return;
  // Not the page's space bar while a session is live: it would scroll under the person.
  event.preventDefault();
  if (event.repeat) return; // a held key repeats; one press is one turn
  talkKeyOnPhone.start();
});
window.addEventListener('keyup', (event) => {
  if (event.code !== PushToTalk.KEY) return;
  event.preventDefault();
  talkKeyOnPhone.stop();
});
/* Every way this page can stop seeing the key. Each one leaves a microphone open on somebody
 * who believes they have stopped talking, so all of them are the same stop. */
window.addEventListener('blur', () => talkKeyOnPhone.lostSight());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') talkKeyOnPhone.lostSight();
});

/* The tab listeners are registered HERE, last, and that is not tidiness.
 *
 * They call closeTheHeldTurn and read `holding`, both declared above with `let` and `const` —
 * which are in the temporal dead zone until this file has finished evaluating. A tab
 * activation arriving in that window would throw a ReferenceError inside a listener nobody is
 * watching, which is the quietest way for a key to stop working. Registered after everything
 * they touch exists, there is no such window. */
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === 'complete' && id === pageTabId) republish();
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  // A different tab in front of the page holding the key is a real loss — and the one case
  // the person causes themselves. Unless we caused it, which closeTheHeldTurn knows about.
  if (HoldingTheKey.tabCameForward(holding, tabId)) closeTheHeldTurn('lost-sight');
  pageTabId = tabId;
  republish();
});

byId('connect').addEventListener('click', () => void connect());

/* And connect by itself. The person this is built for does not press a button to start their
 * browser's voice — the tab opens, the line comes up, and it says so out loud. The button is
 * for the helper, and for coming back after a line that could not reconnect. */
void connect();
