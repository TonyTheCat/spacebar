# The bricks, and exactly which copy of each is here

Every file in `vendor/` (and every clip in `assets/voice/`) is a COPY, not a dependency. There
is no `npm install` behind it, so the pin cannot be a version range: it is the source commit
plus the sha256 of the bytes that were copied. The checksum is the part that catches the
failure a version string does not — a lock left pointing at an old resolution while the file on
disk stayed byte-for-byte the same.

Source: `git@github.com:TonyTheCat/page-tools-synth.git`, commit **48adf98** (tip of `main`,
2026-09-12). Re-checkable in one line, from the repository root:

```sh
shasum -a 256 vendor/*.js vendor/*.d.ts assets/voice/*.mp3
```

| file here | copied from | sha256 |
|---|---|---|
| `vendor/synthesize.js` | `src/synthesize.js` | `b2fdc3778603746db0993e08d946355eb584dc491e2ae432191a2eda6e2d101b` |
| `vendor/read-results.js` | `src/read-results.js` | `922acde7a01df5900f8924c9cfd7b6fe72e20e51824037cba12f78bc01a764dd` |
| `vendor/filled-in.js` | `src/filled-in.js` | `8d7a797575d1bfe8dc103d653fd450fc6f2d6818edcd0e4207bf54a1dcad1fd9` |
| `vendor/drive-the-page.js` | `src/drive-the-page.js` | `53da7edbc79717390b9e8a7727d4a9162ee21cd3da3a11deeaf5817b4b97a572` |
| `vendor/voice-lines.js` | `src/voice-lines.js` | `f32b45fa5585d7db7082d759ffc7c31cf66233a693dd70ec5a6ac932548fb8b7` |
| `vendor/page-tools-synth.d.ts` | `src/types.d.ts` | `59fa43c18c15f6de696f2954b7b6526f75c27bd46fbea33de0af56f9dea00cf9` |
| `assets/voice/cannot-reconnect.mp3` | `assets/voice/cannot-reconnect.mp3` | `22b069099195ca130111bef5a5dbca7aeb727f88ee477f885cc60cdd6816a9e8` |
| `assets/voice/connected.mp3` | `assets/voice/connected.mp3` | `c45c7a940d1639b280175f7d99dc7e3df94eb9442522d28755ceb7d0b19ff911` |
| `assets/voice/held-too-long.mp3` | `assets/voice/held-too-long.mp3` | `d7a941b02558f96538a710318e96ec9fbd5e7952185c51de2170dd57cc595c0f` |
| `assets/voice/not-set-up.mp3` | `assets/voice/not-set-up.mp3` | `506059c70b45afd3fa02e4f16768b6a8271ee752b7410e7f4dd0ff16902c486d` |
| `assets/voice/reconnecting.mp3` | `assets/voice/reconnecting.mp3` | `86efbd08a034501fffa89f5b39e92af42e4ab968c4d62ef62f81c287e76baea1` |

**The voice is one brick, never half of it.** `voice-lines.js` carries the text of each line AND
the path of its recording; the text is what a browser voice speaks when a recording is missing,
and it is what the recording was made from. Copying the words without the clips is how somebody
hears one sentence while a log says another. Five of the eight lines have recordings on purpose
— `key-refused`, `no-microphone` and `no-page` fall back to the browser's own voice, and being
shrill beats being silent.

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
