# Codex handoff — full re-review, bug hunt, browser test & fix

You are Codex, the backend/correctness copilot on this repo. Read this whole file, then do an
**independent, exhaustive review of ALL the code and ALL the recent changes**, **find every bug,
edge case, shortcoming and regression yourself**, **verify behaviour in a real browser**, and
**fix everything you find**. Do not trust the descriptions below as proof of correctness — they
tell you *what was attempted and where*, so you know where to look. The claims may be wrong or
incomplete; your job is to confirm or refute each one against the actual code and a running
browser, and repair anything broken, sloppy, or half-done.

Be adversarial. Assume there are bugs. Hunt for: silent failures, race conditions, leaks (audio
nodes / object URLs / MediaRecorder / Tone disposables), NaN/undefined propagation, unhandled
promise rejections, off-by-one, wrong units (px vs metres, ms vs s), state that leaks across
matches, things that work on `mock` but break on a real model, things that work once but not on
re-entry, and anything that only *looks* done. Then fix them, and re-verify in the browser.

---

## 0. How to run + browser-test (this is the proven harness — use it)

- Dev server: `PORT=8791 npm run dev` (builds the legacy bundle, then serves Express on 8791).
- Rebuild the browser bundle after editing any `src/**` file: `npm run build:legacy` (the bundle
  `src/Worms.js` is generated; never hand-edit it). `server/**` changes need a dev-server restart.
- **Browser testing MUST be headless `chrome` channel** (the bundled Chromium crashes here):
  `chromium.launch({ headless: true, channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required','--no-sandbox'] })`.
  Do NOT rely on a visible window — it gets closed mid-run. Drive it from a throwaway node script.
- Deterministic match with no keys: navigate to
  `http://127.0.0.1:8791/?arena=llm-vs-llm&models=mock,mock&sound=true` and click once
  (`page.mouse.click(200,200)`) to satisfy autoplay, then wait for
  `window.MatchRecorder.isRecording()`.
- Useful in-page globals (legacy single-namespace bundle): `GameInstance`, `ArenaControllerInstance`,
  `ArenaConfig`, `ArenaMusic`, `MatchRecorder`, `MatchTimeline`, `VideoCapture`, `VideoOverlay`,
  `VideoStudio`, `PauseMenu`, `Settings`, `Tone`.
- To inspect a rendered clip: call `MatchRecorder.render({platform, segments}, cb)`, load the blob
  into a `<video>`, seek, draw to a canvas, `toDataURL` → write a PNG and LOOK at it. To check audio
  is really captured: attach a `Tone.Meter` to `Tone.getDestination()`, or decode a clip in a
  `<video>` and read `webkitAudioDecodedByteCount`/`webkitVideoDecodedByteCount`.
- BYOK routes (`/api/music/direct`, `/api/montage/edit`) need a real OpenAI-compatible connection.
  Test against the owner's proxy `http://152.42.140.87:8317`, model `claude-sonnet-4-6` (the latest
  sonnet — confirm via `GET {base}/v1/models`). **The API key is the owner's; never commit it** —
  set it via the in-app menu Connections, `OPENAI_API_KEY` in `.env`, or pass it in the test body.
  In-browser, BYOK reads the connection from `ArenaConfig.current.connections` — that is only
  populated via the menu, NOT the `?arena=` URL, so inject one in a test if needed.

### Gates that MUST pass before you call it done
- `npm run check` (lint + format:check + audit + vitest + typecheck + build) — green.
- `npm run qa:browser` — green (`ok:true`, 0 pageErrors/failedRequests). If it fails on a blank
  canvas, kill stray Chrome (`pkill -9 -f ms-playwright`) and retry — many headless instances
  starve the game's first paint (a CPU artifact, not a code bug), but confirm that's the cause.

---

## 1. Hard constraints (do not break)

- **Match fairness is immutable**: `server/agent.ts` `PINNED_AGENT_PROMPT` / `<anti_cheat_rules>` /
  `<shot_physics>` / `<safety_guidelines>`, the `ActionSchema`/targeting/aim/power/weapon path, and
  the single-shot (one model call, no read tools) boundary. The added `clipSignal` field MUST stay
  output-only and never feed any aim/power/target/weapon decision. Verify it doesn't.
- **All client-side, zero added server cost, BYOK.** No telemetry/uploads. Watermark on every clip.
- **Build model**: browser code is legacy global-namespace TS bundled into `src/Worms.js` via
  `///<reference>` walk from `src/main.ts` (NOT type-checked by tsc). A new `src/*.ts` file is
  silently excluded unless referenced. `server/`,`scripts/`,`tests/` are strict NodeNext (typecheck +
  eslint). Because legacy code is untyped and only smoke-tested, scrutinise it harder.
- **Engine off-limits in principle** (physics/Box2D, `Worm*`, weapons, `src/llm/Arena*` decision
  logic). The video layer OBSERVES the engine via runtime monkey-patches; it must never change a
  decision. Two engine bug-fixes were made deliberately (see §6) — review them especially.
- ⚠️ **A parallel Codex `--yolo` session has been editing `src/animation/Sprite.ts`, `src/Worm.ts`
  and weapon files concurrently.** Expect churn/conflicts there. Reconcile carefully; do not assume
  those files are in the state described. The video/music/Maps work is not touched by that session.

---

## 2. Everything that was added/changed — review every line of it

### New browser modules (legacy, wired from `src/main.ts`, rebuilt via `npm run build:legacy`)
- `src/video/RecordingAudioBus.ts` — one Web Audio capture graph on **Tone's rawContext** + a
  `MediaStreamAudioDestinationNode`. Music: `Tone.getDestination().connect(captureBus)`. SFX: each
  `SoundFallback` `<audio>` is wired via `createMediaElementSource` to both speakers and capture
  (WeakMap-guarded; only when `ctx.state==="running"`). Reason: SFX are `<audio>` (not Web Audio) in
  modern Chrome because `new webkitAudioContext()` throws; a fresh AudioContext can't hear Tone.
- `src/video/MatchTimeline.ts` — read-only observer: monkey-patches `ArenaTelemetry.finishAction` +
  `ArenaController.prototype.handleDecision`, polls `game.winner`/`worm.isDead`. Deterministic
  moments (friendly_fire/instant_karma/beef/comeback/epic_kill/multi_kill), `turn_start`, taunt
  events, mood signal, `getScenarios()` (EDL templates incl. a taunt segment then the action),
  `getTauntAt`/`tauntWindowMs` (for the rendered, streamed bubble), `actionCentroid`, `clipSignal.mood`.
- `src/video/MatchRecorder.ts` — captures a 16:9 MASTER compose canvas (`#action` fitted +
  subtle watermark) via `captureStream(30)` + the audio track; MediaRecorder timeslice ring (~30s) +
  full buffer; async `quickClip`/`fullClip` (flush then assemble; init chunk prepended); `pauseCapture`;
  `render(opts,cb,progress)` re-letterboxes the master into the chosen platform aspect with **cover
  (fill, crop to centre)** for vertical/square, EDL segments (rate/slow-mo), a **Worms-style streamed
  trash-talk bubble at the top** (`drawWormBubble`, word-wrapped, typed-in via `getTauntAt`), and the
  audio routed through Web Audio. MP4-preferred (`pickMime`), webm fallback. Platforms: tiktok/
  instagram/shorts (9:16), youtube/reddit/facebook (16:9).
- `src/video/VideoCapture.ts` — gameloop tick: auto-start recording at arena match start, throttled
  compose (~45fps), `MatchTimeline.tick`, `ArenaMusic.setMood`, moment hints (≥0.7 score + cooldown),
  stop at winner + post-roll, and the **BYOK music-director request** at start + every ~90s.
- `src/gui/VideoOverlay.ts` — ONE icon-only clip button `#waClipButton` that pulses + badges on
  moments; opens the studio.
- `src/gui/VideoStudio.ts` — opening pauses the match + recorder; platform picker (format icons),
  scenario list from the log, optional BYOK AI-editor checkbox, **in-panel video preview** with
  Download/Share, Custom Download = raw 16:9 master.
- `src/gui/PauseMenu.ts` — in-game ⏸ button + **Esc** → pause menu (gates the gameloop): Resume,
  **trash-talk language picker** (15 langs w/ flag icons; sets `Settings.ARENA_CHAT_LANGUAGE` + live
  `teamConfigs[].chatLanguage`, UI stays English), Music/Sound toggles, Main menu.

### New server modules (strict NodeNext)
- `server/music.ts` — BYOK **music DIRECTOR**: the LLM composes a FULL Tone.js soundtrack spec
  (genre, bpm, scale, every instrument track w/ synth+fx+step pattern, arrangement sections) via a
  **forced tool call** (`submit_soundtrack`) — regex-free structured output for the Claude proxy.
  No key → `{ok:false}`. Route `POST /api/music/direct`.
- `server/montage.ts` — BYOK **AI editor**: refines the highlight EDL (order + title) via a forced
  tool call (`submit_montage_edit`). No key → `{refined:false}`. Route `POST /api/montage/edit`.

### Modified files (allowed surfaces)
- `src/audio/Sound.ts` — `SoundFallback.load()` registers its `<audio>` with `RecordingAudioBus`.
- `src/audio/ArenaMusic.ts` — **generic LLM-spec Tone.js renderer** `buildFromSpec` (drums/bass/lead/
  chord/pad via mapped synths + fx + scale-degree patterns + section arrangement); **DJ-style
  crossfade** on re-compose (`sceneBus()` per-scene gain + `recomposeGame` overlap fade + tempo ramp +
  per-scene local state); **procedural per-match generation** (`seedGame`/`reseedMaterial`) and the
  original darksynth `buildGame` as the **fallback** when there's no key; master `moodFilter` +
  `setMood`; `applyDirectorSpec`/`getMusicSeed`.
- `src/main.ts` — `///<reference>`s for the new modules; gameloop now: pause gate
  (`VideoStudio.isPaused() || PauseMenu.isPaused()` skips step/update/arena), then draw, then
  `PauseMenu.tick()` + `VideoCapture.tick()`.
- `src/animation/Sprite.ts` — `setCurrentFrame` now ignores non-finite writes (a worm whose
  `target.previousSpriteFrame` is undefined was vanishing because `draw()` skips when `currentFrameY`
  is NaN). **Also being edited by the parallel session — reconcile.**
- `src/environment/Maps.ts` — runtime **spawn validator** (`validateSpawn` + terrain-bitmap helpers):
  drops each worm onto a real top surface with open headroom (no sealed pockets, jetpack-escapable),
  nudging x when roofed; hardcoded `spawnPionts` arrays untouched; engine untouched.
- `server/agent.ts` — additive **optional** `clipSignal` on the decision schema (raw + strict +
  `normalizeClipSignal`); `mockDecision` populates it (mood varies by turnId); one cosmetic line in
  `<final_output>`. Must stay fairness-neutral.
- `server/index.ts` — the two new routes.
- `css/menu.css` — overlay/studio/pause/badge/preview/caption styles.
- `scripts/browser-qa.ts` — asserts `#waClipButton` appears + `MatchRecorder` auto-records on mock.

Design rationale: `docs/plans/2026-06-09-viral-content-design.md`.

---

## 3. Intended behaviour (so you can tell working from broken)

- A mock or real arena match auto-records to an MP4 (master 16:9) with **game audio (music + SFX)**.
- One in-game 🎬 button pulses on clip-worthy moments; clicking it pauses the match and opens the
  studio. Pick a platform (format adapts) + a scenario built from the match log; Generate re-renders
  locally into that platform aspect (vertical = fullscreen cover, not letterboxed) with a Worms-style
  **trash-talk bubble that streams in at the top**, then plays the action; preview in-panel, then
  Download/Share. Optional BYOK AI-editor reorders moments + writes a title.
- ⏸ / Esc opens a pause menu (freezes the match) with a trash-talk language picker (UI stays English).
- Music: with a key, the LLM composes a unique full soundtrack per match and re-composes every ~90s,
  **crossfading smoothly** (no silence gap); without a key, a procedural soundtrack that is unique per
  match and evolves. Mood opens/closes a master filter (no tempo gimmick).
- Worms always spawn somewhere reachable (not buried, not in sealed pockets); worms don't vanish.
- Everything degrades gracefully with no key / on mock / if Tone is absent.

---

## 4. Areas that are inherently risky — review these hardest (find the bugs yourself)

(These are where subtle bugs are most likely. This is NOT a list of known bugs — verify each area
end-to-end in the browser and fix whatever is actually wrong.)
- **Audio capture**: `createMediaElementSource` re-routing + suspended-context timing + cross-origin;
  whether ALL SFX (not just some) and music actually reach the recorded file; node/stream leaks.
- **MediaRecorder lifecycle**: MP4 vs webm timeslice, ring init-chunk validity, `requestData`/`onstop`
  ordering, the full-match memory budget, object-URL leaks, double-fire of callbacks.
- **render()**: blobs with no duration metadata, seek accuracy across segments, the safety cap, the
  cover-crop centring, the streamed-bubble timing vs the EDL taunt window, frames where the worm is
  off the crop, very long taunts, fonts/measure.
- **ArenaMusic generic renderer + crossfade**: arbitrary LLM specs (bad synth names, empty patterns,
  huge arrays, weird scales), the dual-bus crossfade (do old + new scenes truly not clobber? are old
  disposables fully freed? Transport shared-tempo correctness?), menu↔game scene swaps after a
  crossfade, mute during a crossfade, re-entry across matches (`enterGame` resets), Tone v15 API use.
- **Moment detector monkey-patches**: are they truly side-effect-free and seen by callers? any
  double-count, missed reset across matches, or interference with the turn loop?
- **Spawn validator**: coordinate-space identity (px vs metres vs buffer offset), water line, pool
  exhaustion, performance of per-pixel reads, worms still ending up stuck on any map (test several).
- **Sprite fix**: confirm it actually cures the vanishing worm and doesn't freeze legitimate frames;
  reconcile with the parallel session's edits.
- **BYOK**: tool-call parsing for the real proxy, validation/clamping of the LLM JSON, graceful
  fallback on every failure mode, no key leakage to logs.
- **clipSignal / fairness**: prove it never influences gameplay.
- **i18n / icons**: language switch actually changes subsequent taunts; UI stays English; emoji/flags
  render; nothing overflows on mobile (390px) or in clips.

---

## 5. Deliverable

Work autonomously. Review everything, **find the bugs yourself**, fix them in the working tree,
browser-verify each fix with the harness in §0, and make `npm run check` + `npm run qa:browser` pass.
Add source-contract/unit tests where it makes sense (the legacy modules currently have none).
At the end, report: what you reviewed, what you found, what you fixed (with file:line), how you
verified each fix in the browser, and anything you deliberately left (with justification).
