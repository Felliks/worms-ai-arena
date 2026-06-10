# AGENTS.md

How the in-game **LLM/VLM agents** work in LLM Worms Arena — how they perceive
the battlefield, what they remember, how they decide and act, and how you
customize them. The last section is an orientation map for anyone (human or
coding agent) editing the agent code.

This complements [README.md](README.md) (setup) and
[CONTRIBUTING.md](CONTRIBUTING.md) (dev workflow). It documents behavior; the
code is the source of truth.

## TL;DR

- One **worm = one agent**. Each turn the browser builds a full world snapshot,
  the local Node server (`server/`) sends it to the worm's model, and the model
  replies with a short taunt plus a batch of low-level actions.
- It is **single-shot**: everything the model needs is in the prompt, so a
  decision is one round-trip — there are no "look around" tools.
- The model does its **own physics and aiming**. There is no auto-aim, solver,
  or pathfinding tool; that is the core fairness rule.
- Text models get a Markdown snapshot; **vision (VLM) models also get an
  annotated screenshot**.
- Agents are configured entirely from the in-game menu (or URL params): pick an
  OpenAI-compatible connection, personas, mode, and battle rules. The **Demo**
  connection runs a scripted bot with no API key.

## How an agent sees the world (perception)

Built by `src/llm/ArenaSnapshot.ts` and assembled in `src/llm/ArenaController.ts`.

**Text snapshot** — a Markdown document (`# Worms arena state`) rebuilt every
turn, with these sections:

- **Start-of-turn self orientation** — facing (left/right), weapon in hand, aim
  elevation, fire power, wind.
- **Current combat situation** — active team/worm, position, HP, aim, current
  weapon and blast risk radius, map bounds, perception mode.
- **Spatial orientation** — one line per living worm (SELF / ALLY / ENEMY): team,
  position, HP, `dx`, `dy`, distance, direction words, and whether terrain blocks
  the straight line of sight. Sorted nearest-first.
- **Terrain around the active worm** — ground/ceiling distances sampled across
  ±600 px, nearby walls, and a water-danger line.
- **Aim clearance fan** — straight-line terrain clearance along ~24 ray angles
  (does **not** simulate gravity, bounce, or blast — clearance only).
- **Blast & friendly-fire map** — risk radius, ally/enemy distances, friendly-fire
  cautions, enemy-cluster opportunities.
- **Weapons** — every inventory weapon with ammo and per-weapon guidance.
- **Teams and worms** — all worms (including dead) per team.
- **Action primitives** — the tools the model may emit.

**Coordinates & units** — world pixels, origin at the canvas top-left; `x` grows
right, `y` grows **down** (negative `dy` is above). Angles are degrees, canvas
convention: `-90` up, `0` right, `90` down, `±180` left; aim is clamped to
±179°. **There is no wind** — it is hard-coded to 0 (this clone never implemented
wind drift).

**Vision (VLM)** — when a team's perception is `text+vision`, the snapshot is
accompanied by a single start-of-turn JPEG screenshot, centered on the active
worm and annotated on-canvas with a coordinate grid, SELF/ALLY/ENEMY markers, HP
labels, an "ACTIVE WORM" arrow, the current aim ray, and a legend. It is sent as
an `image_url` part alongside the text. Text-only agents receive just the
Markdown. A fresh screenshot is captured for each same-turn continuation.

**Physics as facts, not answers** — each weapon's guidance line gives the model
the raw constants and formulas to do its own math, e.g. grenade
`v0 px/s = percent * 12`, range `R = v0² · sin(2·elev) / 300`, gravity
`300 px/s²`, fuses, blast radii, and hitscan ranges. These are facts; the model
must still choose the angle and power.

## What an agent remembers (memory)

Memory lives in the browser (`src/llm/ArenaController.ts`, in-memory — nothing is
written to disk) and is replayed into each turn's prompt.

- **Per-worm private memory** (keyed `team-<i>:<wormName>`): recent turn entries
  (chosen actions, the public `thought`, `target`, `campaignPlan`,
  `nextTurnPlan`, and compacted engine feedback) plus an **interaction inbox** —
  a grudge ledger of "who damaged you, with what, for how much" since the worm
  last acted. Plans are framed to the model as _memory, not orders_.
- **Shared chat history** — the trash-talk every worm has said is visible to all
  worms (so they can clap back). Personal memory is not shared.

**Memory strategies** (per match, default `sliding`):

| Strategy  | Behavior                                                     |
| --------- | ------------------------------------------------------------ |
| `none`    | personal memory disabled — nothing carried turn-to-turn      |
| `sliding` | keep only the most recent `memoryWindow` entries             |
| `summary` | sliding window **plus** a rolling summary of dropped entries |
| `full`    | keep everything, unbounded                                   |

`memoryWindow` (default 14, range 0–200) sets the window size.

**Same-turn continuation** — movement/setup actions do not end a turn. While the
worm still has control, the engine asks the model for another decision batch with
fresh feedback (and a fresh screenshot for vision), incrementing `sameTurnBatch`,
until the shot resolves or `maxBatchesPerTurn` (default 4, range 1–12) is hit.

## How an agent decides and acts (reaction)

Decision pipeline in `server/agent.ts`; execution in `src/llm/ArenaController.ts`.

**Streaming, say-first** — `tool_choice` stays `auto`, so the model first writes
**one plain-text taunt line**, which streams live into a Worms-style thought
bubble over the worm's head (typewriter reveal), then calls `submit_worms_turn`
exactly once. The server relays this as newline-delimited JSON: zero or more
`{type:"say"}` events, then one `{type:"final", decision}`. So the worm "speaks"
in ~2 s even though the full action batch lands later.

**A decision** carries: `thought` (public, 1–3 sentences — no hidden
chain-of-thought), `trashTalk`, `target`, `campaignPlan`, `nextTurnPlan`,
`modelUsed`, and `actions` (1–10).

**Action primitives** (the closed `ACTION_TOOLS` enum) and their units:

```text
inspect_inventory, select_weapon(index 0–20 | weapon),
walk(direction left|right, steps 1–160), jump(ms), backflip(ms),
aim(degrees -179..179), aim_delta(degrees), set_power(percent 1–100),
fire(observeMs 500–9000), wait(ms 100–5000),
jetpack_start/thrust/stop(direction, ms), rope_fire/swing/contract/expand/release
```

`say` is **not** an action — the taunt is a decision field, so trash-talk never
costs a combat slot (a stray `say` tool is coerced to `wait`).

**Anti-cheat / fairness** — there is deliberately no `move_to`, ballistic solver,
trajectory helper, pathfinding, or autopilot tool. The tools describe state only;
the prompt's `<anti_cheat_rules>` tell the model to compute aim, power, route,
and target itself and to "be willing to miss." The server clamps numeric ranges
(aim ±179, power 1–100, etc.) as defense-in-depth, but never auto-aims.

**A turn ends** by shot resolution, death, water, a physics-triggered turn
change, the per-turn timer, or the batch cap — there is no voluntary "pass."

## How you customize agents

All from the in-game menu (`src/gui/MainMenu.ts`, `src/gui/ArenaConfig.ts`); a
match can also be launched straight from a URL.

**Connections** — a connection is any OpenAI-compatible endpoint
(`{ name, baseURL, apiKey, model }`). API keys are stored only in your browser
(`localStorage`) and sent per-request to the local server, which never logs them.
The built-in **Demo (no API key)** connection runs the scripted `mock` bot.

**Connection cascade** — a worm uses its own connection, else its team's, else
the global default (`worm → team → global`); a blank dropdown means "inherit." A
badge shows where each worm's model actually comes from.

**Personas** — per worm: name, personality, strategy/tactic, chat style, an
optional custom system prompt, and a per-worm model. Per team: name, color, a
shared connection, and ready-made rosters. Built-in **AI-lab teams** (OpenAI,
Anthropic, Google DeepMind, Meta AI, Mistral, xAI) ship as caricature personas.

**Modes & presets** — modes: `ai-vs-ai`, `ai-vs-human`, `multi-ai`, `ffa`,
`all-vs-me`. One-click presets: Demo Free-for-all, Classic Duel, GPT vs Claude vs
Gemini, Everyone vs Me.

**Battle setup** — teams (1–8), worms per team, worm health (10–300), turn time,
map, per-weapon ammo (0 disables a weapon), trash-talk language, memory
strategy/window, max decisions per turn, and sound.

**URL launch** (bypasses the menu via `?arena=`):

```text
/?arena=llm-vs-llm&models=model-a,model-b&turnTime=120
/?arena=human-vs-llm&models=human,model-a&turnTime=120
```

Useful params: `turnTime`, `turnMs`, `chatLang`, `memoryStrategy`,
`historySize`/`memoryWindow`, `maxBatchesPerTurn`, `assetPack`, `sound`,
`arenaDebug=true` (verbose per-turn agent JSON in the browser console). Note that
`?arena=` URLs use server-side env credentials, not browser-stored keys.

**Server endpoints** (`server/index.ts`):

- `POST /api/agent/turn` — runs one turn, streams the decision as NDJSON.
- `POST /api/models` — "test & list models" for a connection (key kept out of the
  URL).
- `GET /api/health` — liveness probe.

## Working on the agent code

| Area                          | File                                            |
| ----------------------------- | ----------------------------------------------- |
| World snapshot + vision       | `src/llm/ArenaSnapshot.ts`                      |
| Turn loop, memory, execution  | `src/llm/ArenaController.ts`                    |
| Prompt, action schema, stream | `server/agent.ts`                               |
| HTTP routes, NDJSON           | `server/index.ts`                               |
| Menu, cascade, personas       | `src/gui/MainMenu.ts`, `src/gui/ArenaConfig.ts` |
| URL params                    | `src/Settings.ts`                               |

Conventions and boundaries:

- The **pinned agent prompt, action schema, anti-cheat rules, and the
  single-shot ReAct boundary** in `server/agent.ts` are deliberate. Change them
  only intentionally — they are what keep matches fair and the stream working.
- The legacy browser game (`src/*.ts`) is global-namespace TypeScript bundled to
  `src/Worms.js`; a new `src/*.ts` file is only included if reachable via a
  `///<reference>` chain. Rebuild with `npm run build:legacy` (no hot reload).
- `server/`, `scripts/`, and `tests/` are strict NodeNext TypeScript checked by
  `npm run typecheck`.
- Test keyless against the **Demo/mock** path: `/?arena=llm-vs-llm&models=mock,mock`.
- Before opening a PR: `npm run check` and `npm run qa:browser` (the browser QA
  runs in mock mode, no keys needed).
