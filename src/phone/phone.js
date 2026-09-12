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

  /* Once, however many ways the recording fails. A broken file can fire both an error event
   * and a rejected play(), and speechSynthesis QUEUES rather than replaces — so without this
   * the person hears the same sentence twice, at the moment something has just gone wrong. */
  let spoken = false;
  const speak = () => {
    if (spoken) return;
    spoken = true;
    try {
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch {
      // No synthesis either. The line is in the log, and that is all there is.
    }
  };

  if (!line) {
    speak();
    return;
  }
  const clip = new Audio(chrome.runtime.getURL(line.file));
  // The fallback is wired to the FAILURE rather than to a check that the file exists: a file
  // can be present and unplayable, and a missing recording must never become silence.
  clip.onerror = () => {
    log(`no recording for "${line.id}" — using the browser's own voice`);
    speak();
  };
  clip.play().catch(() => {
    log(`could not play the recording for "${line.id}" — using the browser's own voice`);
    speak();
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
const askForAnAnswer = () => {
  if (turn.answering) {
    log('they talked over the answer — cancelling it');
    send({ type: 'response.cancel' });
    send({ type: 'output_audio_buffer.clear' });
    // And ask once the session says that answer has actually stopped. Asking straight after
    // the cancel races the session's own bookkeeping: the ask arrives while the old answer is
    // still running, is refused, and the person's interruption disappears without a sound.
    turn.askWhenTheAnswerStops();
    return;
  }
  send({ type: 'response.create' });
};

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
    sayOutLoud(VoiceLines.CONNECTED);
  }

  if (event.type === 'session.updated') {
    log('session.updated ACCEPTED');
  }

  /* The person's own words, as the session heard them. This is the only evidence the consent
   * gate will ever accept, and the model has no way to write into it. */
  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    log(`you said: "${String(event.transcript ?? '').trim()}"`);
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
  // A new line is a new hello: whatever turn the last one was in the middle of went with it.
  turn.clear();

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
    if (minted.status === 401 || minted.status === 403) sayOutLoud(VoiceLines.KEY_REFUSED);
    else sayOutLoud(`I could not start. The service answered ${minted.status}.`);
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

byId('connect').addEventListener('click', () => void connect());

/* And connect by itself. The person this is built for does not press a button to start their
 * browser's voice — the tab opens, the line comes up, and it says so out loud. The button is
 * for the helper, and for coming back after a line that could not reconnect. */
void connect();
