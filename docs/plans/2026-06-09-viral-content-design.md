# LLM Worms Arena — Matches → Viral Content (design)

Status: design (autonomous build, reviewed by codex). Date: 2026-06-09.
Owner directive: implement how I see fit; do not touch match fairness; zero server cost; all local; BYOK; watermark every clip; test on mock.

This document is the architecture anchor for the whole feature. It is grounded on a
full subsystem map (arena loop, server schema, audio path, canvas, GUI, build) and a
codex deep-dive on audio capture.

---

## 0. Hard boundaries (do not cross)

- **Fairness surface is immutable**: `PINNED_AGENT_PROMPT`, `<anti_cheat_rules>`,
  `ActionSchema`/targeting/aim/power/weapon, and the single-shot (one model call, no
  read tools) boundary in `server/agent.ts`. Everything here is a layer *on top*.
- **Engine off-limits**: physics/Box2D, terrain, `Worm*`, weapons, `src/llm/Arena*`
  decision logic. We *observe* the engine; we do not change how it plays.
  Exception explicitly allowed by the brief: **audio files** (`src/audio/Sound.ts`,
  `src/audio/ArenaMusic.ts`, `src/system/AssetManager.ts` audio loading) are fair to
  modify — needed for in-graph audio capture.
- **Zero server cost / all local**: no new heavy server work. The only server change is
  one *additive optional* field on the decision schema (`clipSignal`), which rides the
  existing NDJSON and is ignored by every game-logic path.
- **Build model**: new browser code is legacy global-namespace TS under `src/video/`
  and `src/gui/`, pulled into the bundle via `///<reference>` from `src/main.ts`
  (silent-exclusion trap: an unreferenced file is dropped with no error). Rebuild with
  `npm run build:legacy`. `server/`,`scripts/`,`tests/` stay strict NodeNext.

---

## 1. Architecture at a glance

Everything runs in the browser. Five new client modules + two tiny seams:

```
                       ┌─────────────────────────────────────────────┐
  engine (untouched) ──┤  MatchTimeline  (src/video/MatchTimeline.ts) │
   ArenaTelemetry.finishAction (wrapped)  ─ per-action damage/explosion/HP, timestamped
   game.winner / worm.isDead (polled)     ─ deaths, win, comeback resolution
   agent-decision event  ─ trashTalk / target / clipSignal (intent vs outcome, mood)
                       └───────────────┬─────────────────────────────┘
                                       │ timestamped events (recorder-relative ms)
                       ┌───────────────▼───────────────┐
                       │  MomentDetector (src/video/)   │  deterministic rules →
                       │  friendly fire / instant karma │  Moment[]{type,t0,t1,score,
                       │  beef / comeback / epic kill   │  title, actors}  (+agent signals)
                       └───────┬───────────────┬────────┘
            mood signal        │               │ tagged moments (cached per match)
        ┌───────────▼──┐  ┌────▼──────────┐  ┌─▼───────────────────────────┐
        │ ArenaMusic    │  │ InGameOverlay │  │ VideoStudio (src/gui/)       │
        │ .setMood()    │  │ toast + quick │  │ variant cards + format pick  │
        │ adaptive score│  │ share button  │  │ → EDL → MatchRecorder.render │
        └───────────────┘  └───────┬───────┘  └─────────────┬───────────────┘
                                   │ ring buffer dump        │ local montage
                       ┌───────────▼─────────────────────────▼───────────────┐
                       │  MatchRecorder (src/video/MatchRecorder.ts)          │
                       │  compose canvas (watermark+letterbox) + audio bus    │
                       │  MediaRecorder: ring buffer (~30s) + full match      │
                       └──────────────────────┬───────────────────────────────┘
                       ┌──────────────────────▼───────────────────────────────┐
                       │  RecordingAudioBus (src/video/RecordingAudioBus.ts)   │
                       │  Tone ctx + MediaStreamAudioDestinationNode           │
                       │  music = tap Tone master; SFX = createMediaElementSrc │
                       └───────────────────────────────────────────────────────┘
```

Server seam: `clipSignal?` added to `AgentDecisionSchema` (additive, optional, cosmetic).

---

## 2. The audio mine (central decision)

**Problem (verified).** SFX play through raw HTML `<audio>` elements (the `SoundFallback`
path, because `new webkitAudioContext()` throws on modern Chrome and the code silently
falls back). Music plays through Tone.js on Tone's own `AudioContext`. They share no
Web Audio sink. The brief forbids OS/tab capture ("audio from the Tone graph, not system
capture") precisely because that path silently drops audio.

**Decision: one shared Web Audio graph = Tone's context; tap a `MediaStreamAudioDestinationNode`.**

- `RecordingAudioBus.ensure()` grabs `Tone.getContext().rawContext` (the live, gesture-
  unlocked AudioContext) and creates a `MediaStreamAudioDestinationNode` `recordDest` on it.
- **Music**: connect Tone's master/limiter to `recordDest` in addition to `.toDestination()`.
  `ArenaMusic` exposes a `getOutputNode()` so we never reach into its internals blindly.
- **SFX**: `SoundFallback` calls `RecordingAudioBus.wireElement(audioEl)` once per element
  → `ctx.createMediaElementSource(el)` → fan out to **both** `ctx.destination` (speakers)
  and `recordDest` (recorder). One-time-per-element is fine: each `SoundFallback` owns one
  `<audio>`, created once at asset load. All wiring is defensive (`typeof Tone`, try/catch);
  if Tone/bus is absent, SFX play exactly as today and recording silently degrades to
  music-only rather than crashing.
- **Audio track for MediaRecorder** = `recordDest.stream.getAudioTracks()[0]`, combined
  with the compose-canvas video track into one `MediaStream`.

Failure modes this avoids: (a) muted webm from `canvas.captureStream()` alone; (b) muted
webm from tab capture where the user didn't tick "share audio"; (c) SFX missing because
they're off-graph. Codex is validating the createMediaElementSource routing + suspended-
context timing; its verdict is folded into §8 risks.

**Graceful degradation**: recording always works; if SFX wiring fails on a given browser,
we still capture music + canvas and log a one-line console note. The video is never silent
of *all* audio because music is always in-graph.

---

## 3. MatchTimeline + MomentDetector (works with no key / on mock)

**Tap points (all read-only, zero fairness impact):**
1. Wrap `ArenaTelemetry.finishAction` (monkey-patch the module export): every completed
   action returns a record with `startedAt/finishedAt`, `actor/actorAfter` (HP delta),
   `explosions[]{x,y,radius,maxDamage,causedBy}`, `damage[]{target,damage,causedBy,
   estimatedHealthAfterQueuedDamage}`. This is the richest stream.
2. Poll rosters each frame (cheap) for `worm.isDead` flips and `game.winner` non-null —
   catches water/mine deaths with no open action record, plus the win.
3. Read `decision.trashTalk` / `decision.target` / `decision.clipSignal` from the
   `agent-decision` path (wrap `ArenaController.handleDecision` or subscribe via a hook).

**Timeline**: each event stamped with `t = performance.now() - recorderStart` so moment
timecodes map directly onto the recorded media.

**Deterministic detectors** (pure JS over the timeline; no LLM, runs on mock):
- **Friendly fire**: `damage[]` where `causedBy.teamIndex === target.teamIndex &&
  causedBy.name !== target.name`. (Engine even plays the "traitor" SFX on this.)
- **Instant karma**: a `trashTalk`/taunt at turn start, then a `SELF DAMAGE` record
  (`target.id === actor.id`) or the actor's `isDead` flip within the same physical turn.
- **Beef**: group hits by `(causedBy.id → target.id)` across turns; the top recurring
  enemy pair = beef. Also fed by `decision.target` intent.
- **Comeback**: track each team's aggregate living-worm HP; flag a team that crossed a
  low threshold (e.g. <25%) and later took the kill / `game.winner`.
- **Epic kill**: single `fire` record whose summed `damage` is high, or ≥2 distinct
  `target.id` with `estimatedHealthAfterQueuedDamage === 0` (multi-kill).

Each detector emits `Moment{ id, type, t0, t1, score 0..1, title, subtitle, actors[],
teamIndexes[] }`. `title` is concrete and human ("🤦 OpenAI hit its own worm",
"🔥 Claude vs Gemini beef"). Scores feed the reminder threshold and the variant ranking.

**Optional agent signals** (additive, cosmetic): `clipSignal{ clipWorthy:boolean,
intent:string, dramaTags:string[], mood?:string }` on the decision. The model knows
intent-vs-outcome (e.g. "going for the multi-kill") that external code can't see. Used
only to *boost* a moment's score and label, and to *bias* music mood. Never read by
aim/power/target/weapon; `.optional()` so absence is always valid; survives NDJSON
untouched. This is the single, bounded place agents influence the clip layer.

---

## 4. Recording pipeline (foundation)

`MatchRecorder`:
- **Compose canvas** at a fixed master resolution (1280×720, 16:9). A rAF loop draws
  `#action` fitted+letterboxed into it, then bakes the **watermark** (canvas-drawn, so it
  survives capture — DOM overlays do not). Reuses `ArenaSnapshot`'s drawImage/letterbox/
  `drawOutlinedText` helpers' approach. We capture from this canvas, NOT `#action` (which
  resizes with the window and has no watermark).
- **Streams**: `composeCanvas.captureStream(30)` (video) + `RecordingAudioBus.recordDest.stream`
  (audio) → one `MediaStream`.
- **MediaRecorder** with `mimeType` chosen from `isTypeSupported` (vp9/opus → vp8/opus →
  webm default), `timeslice` ~1s.
  - **Ring buffer**: keep a rolling deque of the last N chunks covering ~30s → quick-share
    dumps it instantly.
  - **Full match**: optionally retain all chunks (capped by a size budget; if exceeded,
    keep ring + a downsampled keyframe set; the brief allows long matches → we cap and
    `log()` what was dropped, never silently).
- Recording starts when the match starts (gesture already happened), stops at `game.winner`.

Master footage (full match webm) is the source the montage re-renders from.

---

## 5. Quick share + watermark + reminder

- **Quick share**: one button on the in-game overlay → `MatchRecorder.quickClip()` returns
  the ring-buffer webm (watermark already baked) → triggers a download + Web Share API
  (`navigator.share` with the file when available; download fallback). Zero wait.
- **Watermark**: every produced clip (quick, montage) has the canvas-baked project mark.
- **Reminder** (`InGameOverlay`): when a moment with `score ≥ THRESHOLD` lands, show
  `MainMenu.toast()` ("🔥 clip-worthy: …") + a subtle pulse on the overlay's clip button.
  **Threshold + cooldown** (e.g. ≥0.7 score, ≥20s cooldown, max once/N). Never pauses,
  never covers the screen, never blocks input, never spams. Respects
  `prefers-reduced-motion`. Mounts as a `document.body` fixed cluster
  `#waVideoOverlay` (z-index ~5200, like `#menuMusicToggle`), survives `MainMenu.hide()`.

---

## 6. On-demand video (variants + format) and the AI montage

Cost separation is explicit: **cheap analysis** (variant cards, EDL) is kept apart from
**expensive local processing** (frame re-render/encode), and **LLM** work is apart from
**video** work.

- **VideoStudio panel** (user-opened; pause OK). Lists **concrete, match-specific variant
  cards** built deterministically from the tagged moments and cached per match:
  - "🤦 OpenAI three times on its own" (friendly-fire reel for the worst team)
  - "🔥 Claude vs Gemini beef" (the top beef pair's exchanges)
  - "💀 Epic kill — Mistral" (highest-damage shot)
  - "⏱️ Last 30s" (ring buffer) · "⚡ Whole match, sped up" (full footage timelapse)
  User picks a variant + **frame format 16:9 / 9:16 / 1:1**.
- **EDL (edit decision list)**: cut list of `{srcT0, srcT1, speed, title}` segments derived
  from the variant's moments (drop dead pauses between moments, slow-mo on the impact
  window, title cards). Deterministic by default (works with no key).
- **Optional AI editor (BYOK)**: a single cheap *text* LLM call on the user's key refines
  the EDL — picks the punchiest moments, writes title text, chooses slow-mo points. It
  never does video processing and never touches game fairness. Reuses the existing
  connection cascade (baseURL/apiKey) the project already has. No key → deterministic EDL.
- **Local montage render** (`MatchRecorder.render(edl, format)`): load the master webm
  into a `<video>`, and for each segment seek + draw frames into a fresh compose canvas at
  the chosen aspect (for 9:16/1:1 we crop/pan the landscape source toward the action
  centroid from the timeline), apply speed/slow-mo, draw title + watermark, route the
  `<video>`'s audio through the bus (createMediaElementSource on the `<video>`) mixed with
  the chosen mood score → MediaRecorder → final webm. All local, on-device.

### Latency-aware editing (REQUIRED — model-agnostic pacing)

Different models answer at different speeds/quality, so raw footage contains long "model is
thinking" dead air (10-20s before a worm speaks/moves/fires). The video must NEVER show that.
The EDL is built from **event timestamps, not wall-clock**, so a slow model and a fast model
collapse to the same watchable rhythm:

- **MatchTimeline records `turn_start`** (worm becomes active) alongside `taunt` / action /
  `explosion` / `damage` / `death`. The thinking gap = t(firstSay|firstAction) − t(turn_start).
- **Compress dead air**: any inter-event gap with no on-screen action beyond GAP_MAX (~0.8s)
  — thinking pauses, long walks, idle fuse waits — is cut or time-lapsed (8–16×), never shown
  real-time. A 15s think becomes ~0.6s.
- **Trash-talk hold = reading time**: while a taunt bubble is on screen, hold
  clamp(textLength / READ_CPS, MIN_READ, MAX_READ) with READ_CPS ≈ 13–15 chars/s,
  MIN_READ ≈ 1.4s, MAX_READ ≈ 3.5s — enough to read, never lingering.
- **Keep the payoff real-time**: the fire → projectile → explosion → damage window plays at
  1× (optional slow-mo on the impact), because that is the content.
- "Whole match sped up" = uniform 8–16× timelapse with real-time pop-outs on detected moments.

Result: pacing is independent of model latency/quality — the montage feels tight whether the
model took 3s or 25s per turn.

---

## 7. Dynamic soundtrack (evaluating the agent-music idea)

Goal: music adapts to match mood; different videos sound different; the agent-generated-
music idea is tested without breaking coherence or fairness.

**Recommended (primary): detector-driven adaptive `ArenaMusic`.** Add `ArenaMusic.setMood(
mood, intensity)`; the `MomentDetector` derives a live mood from running tension (recent
damage, deaths, lead changes, comebacks → `calm|tense|climax|somber|comedic`). `ArenaMusic`
already has a section arc (intro/build/full/breakdown) and intensity levers — we gate
layers/tempo/voicing on mood. This is **coherent (one evolving score), reactive (responds
to moments, not stale decision-time), zero-cost, zero-latency, key-free**, and naturally
**different per match** because each match's event timeline differs.

**Why NOT raw per-agent Tone.js generation as the primary** (the literal "червяки
генерируют музыку" idea): (a) **coherence** — 8 agents independently choosing key/tempo/
instruments yields cacophony, not a through-line; (b) **timing** — the decision lands at
~15-20s, but music must react to explosions/deaths during action execution, so decision-
time music is stale; (c) **fairness/quality risk** — burdening every single-shot turn with
music composition spends output tokens/attention and risks diluting trash-talk, which the
brief itself names as the viral linchpin.

**Bounded test of the agent idea (kept):** the *optional* `clipSignal.mood` token (one
word, same additive field, cosmetic) lets an agent *bias* the detector's mood. This tests
"agents influence the music" with **zero** extra calls, zero coherence loss, and zero
fairness impact. If it adds nothing, drop the field.

**If the owner wants fuller agent musicality later**: the right home is a *single*
dedicated lightweight "music director" call (one composer, once per match/phase) — never
the 8 combatants. Noted as a future option, not built now.

**Montage-time**: the AI editor's chosen mood renders a fresh `ArenaMusic` score for the
video, mixed with original SFX from the footage → different videos sound different.

**Smooth transitions (REQUIRED — no abrupt switches).** Mood changes must never hard-cut:
- `setMood` ramps, it does not swap scenes mid-match. Layer gains use `gain.rampTo(...)`
  over ~1.5–2s (the existing mute ramp pattern); filter cutoffs sweep; the section/voicing
  change is **quantized to the next bar** (Tone Transport) so it lands musically, not mid-beat.
- Add/remove instruments by fading their gain in/out, never by abrupt connect/disconnect.
- Hysteresis on the mood classifier (and a minimum dwell time, e.g. ≥4s per mood) so a
  single event doesn't ping-pong the music.
- Montage-time score changes between segments **crossfade** (~1s) and duck under SFX rather
  than cutting; the preferred default is one coherent through-line whose intensity follows
  the EDL, so there is no audible seam.

---

## 8. Fallback, risks, verification

**Fallback (no key / boring match / LLM down):** the whole pipeline is deterministic by
default — moment detection, variant cards, EDL, montage, quick clip, adaptive music all
run with `models=mock,mock` and no API key. AI (clipSignal, EDL refinement) is strictly
*additive on top*, never required.

**Risks (codex is pressure-testing the first two):**
- `createMediaElementSource` routing/suspended-context timing for SFX (the audio mine).
  Mitigation: defensive wiring + music-always-captured degradation.
- MediaRecorder memory for long full-match capture. Mitigation: size budget + ring +
  logged downsampling.
- 9:16 crop losing the action. Mitigation: pan toward the timeline's action centroid.
- `clipSignal` must never leak into any aim/power/target path. Mitigation: schema is
  output-only + a source-contract test asserting no game-logic file reads `clipSignal`.

**Verification (must pass before PR):**
- `npm run check` (lint, format, audit, vitest, typecheck, build).
- `npm run qa:browser` extended: mock arena asserts the overlay/quick-share button exists,
  a moment toast appears, and recording starts — all deterministic, no keys. Stable ids
  (`#waVideoOverlay`, `#waQuickShare`, `#waMomentToast`) pinned by source-contract tests
  cross-referenced with `browser-qa.ts` (mirrors the `#startLocal` precedent).
- Source-contract tests for each new `src/video/*.ts` / `src/gui/*.ts` (selectors +
  invariants), and an `agent-schema.test.ts` addition for `clipSignal` optionality.

---

## 9. Build order (incremental, each slice shippable + verified)

1. **RecordingAudioBus + MatchRecorder + quick-share + watermark** (foundation; satisfies
   the audio mine and the instant-clip path). Verify webm has audio in-browser.
2. **MatchTimeline + MomentDetector (deterministic) + reminder toast.** Verify on mock.
3. **VideoStudio panel: deterministic variants + format + local montage render.**
4. **Adaptive soundtrack `setMood` + detector mood wiring.**
5. **Server `clipSignal` (additive) + agent signal boosting + `clipSignal.mood`.**
6. **AI editor (BYOK EDL refinement) on top of deterministic EDL.**
7. **Extend qa:browser + source-contract tests; `npm run check`.**

Each step is browser-verified (Playwright/MCP at `/?arena=llm-vs-llm&models=mock,mock`)
before the next. Codex reviews each backend-sensitive seam.
