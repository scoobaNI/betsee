# Betsee launch film

A four-minute launch film built from the real Betsee interfaces: Betsee Desk (the native chat app),
the Director, the ecosystem (Approvals, Policy Studio) and the Keycloak step-up. White, calm,
narrated; every frame is a pure function of time, so the film renders frame by frame, identically
on every run.

```text
capture/capture.mjs   drives the real apps, saves 2x screenshots + part rectangles to captures/
capture/live.mjs      records the Director live, frame by frame on Playwright's clock (captures/live/)
audio/narration.json  the narration, voice and model (ElevenLabs), and a gentle tempo
audio/narrate.mjs     voices runs of lines as one take each (with character timestamps) into out/vo/
audio/trim_vo.py      trims each take, gently tightens it (rubberband), and records line, phrase and word times
stage/acts.json       the acts: lead, narration lines with their pauses, tail
stage/plan.py         acts.json + measured lines -> stage/timeline.json
stage/                the film: film.js, lib.js, scenes/*.js, film.css, fonts/ (Mona Sans, OFL)
render/render.mjs     headless Chromium -> ffmpeg; stills, cue export, or the whole film
audio/score.py        the mix: ElevenLabs score + narration + sound effects at the scenes' cues
out/                  vo/, music/, sfx/ (committed, paid); cues.json, mix.wav, renders (ignored)
```

## How the timing works

The narration drives everything. ElevenLabs returns a timestamp for every character, so
`trim_vo.py` knows where each line, phrase and word starts; `plan.py` lays the acts end to end from
those lengths; each scene places its motion against its own lines (`ctx.vo(id)`,
`ctx.phrase(id, k)`, `ctx.word(id, "Underneath")`), so a highlight lands on the word that names it.
The score is generated from a composition plan whose sections follow the acts. Scenes register their sound cues with `ctx.cue`; `render.mjs --cues` exports them and
`score.py` puts one fixed sample at each, so identical decisions sound identical. Re-voicing the
narration re-times the whole film without touching a scene.

## Build

1. Captures. Start the three UIs from `web/` and the Compose stack (for the Keycloak theme):

   ```sh
   VITE_BETSEE_MOCK=1 npm run dev -w @betsee/director    # :5174
   VITE_BETSEE_MOCK=1 npm run dev -w @betsee/ecosystem   # :5173
   npm run dev -w @betsee/desk                           # :1430
   node film/capture/capture.mjs
   ```

   The Director and the ecosystem run on their seeded mock worlds; the capture launches the same
   scenarios as the Director's command palette. `node film/capture/live.mjs` then records the
   Director live (about 15 minutes, ~330 MB of frames, gitignored): Motion's Web Animations are
   switched off so its animations run on the fake clock too. The Desk talks to a stub governing service whose
   chats are fixtures in agent-host's event shape.

2. Voice, music, effects (ElevenLabs, a paid plan for library voices and music):

   ```sh
   ELEVENLABS_API_KEY=... node film/audio/narrate.mjs [--force] [--voice <id>] [line ...]
   python3 film/audio/trim_vo.py && python3 film/stage/plan.py
   ```

   The score (`out/music/score-b.mp3`; `score-a.mp3` is the earlier take) came from the Music API
   and the effects (`out/sfx/`) from Sound Effects; both are committed, so a rebuild does not spend
   credits. 192 kbps output needs the
   Creator plan; 128 kbps works on Starter.

3. Mix: `node film/render/render.mjs --cues && python3 film/audio/score.py` writes `out/mix.wav`
   (-16 LUFS, the score about 10 dB under the voice), and `python3 film/audio/subtitles.py`
   writes `out/betsee-launch.srt`.

4. Render: `node film/render/render.mjs --workers 8` writes `out/betsee-launch.mp4` (1920x1080,
   60 fps, H.264, AAC). It needs an ffmpeg with libx264; Fedora's has none, so point `FFMPEG` at
   one, for example the binary of the `imageio-ffmpeg` Python package. Fedora's own players cannot
   decode H.264 either; for local viewing transcode to AV1/WebM (`libsvtav1` + `libopus` are in
   the system ffmpeg).

   Each frame waits two animation frames before its screenshot: without that, Chromium could reuse
   stale raster tiles of a large moving layer and ghost text into the frame.

   `node film/render/render.mjs --stills 12.5,30` writes review stills to `out/stills/`, and
   `stage/index.html?t=12.5` (served from the repository root) shows one frame in a browser.

## Credits

Interface icons: Streamline (CC BY 4.0) and Remix Icon (Apache-2.0), as in the apps. Headshots:
Unsplash, see `web/apps/director/public/people/CREDITS.md`. Type: Mona Sans (SIL OFL,
`stage/fonts/mona-sans-LICENSE`), JetBrains Mono, Urbanist, Inter (SIL OFL). Voice, music and
sound effects: ElevenLabs.
