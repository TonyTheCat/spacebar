# The bricks, and exactly which copy of each is here

Every file in `vendor/` (and every clip in `assets/voice/`) is a COPY, not a dependency. There
is no `npm install` behind it, so the pin cannot be a version range: it is the source commit
plus the sha256 of the bytes that were copied. The checksum is the part that catches the
failure a version string does not — a lock left pointing at an old resolution while the file on
disk stayed byte-for-byte the same.

Source: `git@github.com:TonyTheCat/page-tools-synth.git`, commit **13ef018** (tip of `main`,
2026-09-12) — the voice brick moved on the day: the product's own name in the line said out
loud when there is no key, one line that had lived as a bare string in the phone, and the three
recordings the table had been documented as missing. Re-checkable in one line, from the repository root:

```sh
shasum -a 256 vendor/*.js vendor/*.d.ts assets/voice/*.mp3
```

| file here | copied from | sha256 |
|---|---|---|
| `vendor/synthesize.js` | `src/synthesize.js` | `b2fdc3778603746db0993e08d946355eb584dc491e2ae432191a2eda6e2d101b` |
| `vendor/read-results.js` | `src/read-results.js` | `922acde7a01df5900f8924c9cfd7b6fe72e20e51824037cba12f78bc01a764dd` |
| `vendor/filled-in.js` | `src/filled-in.js` | `8d7a797575d1bfe8dc103d653fd450fc6f2d6818edcd0e4207bf54a1dcad1fd9` |
| `vendor/drive-the-page.js` | `src/drive-the-page.js` | `53da7edbc79717390b9e8a7727d4a9162ee21cd3da3a11deeaf5817b4b97a572` |
| `vendor/voice-lines.js` | `src/voice-lines.js` | `2248aeb7df974b219c907de04bf24e399e82ebc4da4fc060fc80006d47f3e185` |
| `vendor/page-tools-synth.d.ts` | `src/types.d.ts` | `59fa43c18c15f6de696f2954b7b6526f75c27bd46fbea33de0af56f9dea00cf9` |
| `assets/voice/cannot-reconnect.mp3` | `assets/voice/cannot-reconnect.mp3` | `22b069099195ca130111bef5a5dbca7aeb727f88ee477f885cc60cdd6816a9e8` |
| `assets/voice/could-not-start.mp3` | `assets/voice/could-not-start.mp3` | `8e91d328d7e60eb913d62d21d19dade7986a6157d277ed86090010d8a7072e1f` |
| `assets/voice/connected.mp3` | `assets/voice/connected.mp3` | `c45c7a940d1639b280175f7d99dc7e3df94eb9442522d28755ceb7d0b19ff911` |
| `assets/voice/held-too-long.mp3` | `assets/voice/held-too-long.mp3` | `d7a941b02558f96538a710318e96ec9fbd5e7952185c51de2170dd57cc595c0f` |
| `assets/voice/not-set-up.mp3` | `assets/voice/not-set-up.mp3` | `6e6b2d80afb2abade9708079d883c1dc6ac305645a5252eb0158420e309378e8` |
| `assets/voice/allow-the-microphone.mp3` | `assets/voice/allow-the-microphone.mp3` | `3b7c375219e863d2ab9aecbb1b720a00d8d8bc64e1c497a1ec22f706f700a1dc` |
| `assets/voice/key-refused.mp3` | `assets/voice/key-refused.mp3` | `6f1d089956d326e60288f734744a1746b279249a94e4debcdadf823943664711` |
| `assets/voice/no-microphone.mp3` | `assets/voice/no-microphone.mp3` | `864062094689b79de0dde7b2cfc5395b4b75c2e7eea6545389716aceb7cda73b` |
| `assets/voice/no-page.mp3` | `assets/voice/no-page.mp3` | `bee793832f6e4b197baaa553e440eb97baaea0706888e9389917de495a712085` |
| `assets/voice/reconnecting.mp3` | `assets/voice/reconnecting.mp3` | `86efbd08a034501fffa89f5b39e92af42e4ab968c4d62ef62f81c287e76baea1` |

**The voice is one brick, never half of it.** `voice-lines.js` carries the text of each line AND
the path of its recording; the text is what a browser voice speaks when a recording is missing,
and it is what the recording was made from. Copying the words without the clips is how somebody
hears one sentence while a log says another. TEN lines, ten recordings: `key-refused`,
`no-microphone` and `no-page` used to fall back to the browser's own voice, and all three
arrive after something has already gone wrong, which is exactly when being shrill was being
heard. `allow-the-microphone` was not in the table at all — it was a bare string in the phone,
which is a sentence that can never have a recording. The fallback stays behind all of them, for
a clip that will not play.

**The clips are NOT in `vendor/`.** Each line names its own path, `assets/voice/<id>.mp3`
relative to the extension root, so they are copied to exactly that path and the table in the
brick needs no editing.

**The order these load in is part of the pin.** They are classic scripts sharing one global
scope — there is no import to fix up a wrong order. `drive-the-page.js` reads `FilledIn` and
`PageToolsResults`, so both come before it:

```
vendor/synthesize.js -> vendor/read-results.js -> vendor/filled-in.js -> vendor/drive-the-page.js
```

Put `drive-the-page.js` earlier and the failure is `ReferenceError: FilledIn is not defined`,
in the middle of a form being filled in rather than at load.

## Not copied, and why

| brick | why it is not here |
|---|---|
| `webmcp-bridge.js` | Publishes OUR list through the page's `document.modelContext`. Only needed for the "an outside agent sees our tools" half, which is not this product's demo. |
| `voice-input.js` | Speech to text in the page. The Realtime session does its own transcription, so nothing would call it. |
