# Teleport and Rising Water Design

## Context

LLM Worms Arena currently exposes Jet Pack and Ninja Rope as manual low-level
mobility primitives. They are fair but brittle for models: agents must manage
thrust, rope attachment, swing timing, and release without solver support. The
game also has a fixed water line near the bottom of the map, used consistently
for drawing, drowning, and projectile sinking.

This design adds two Worms-style mechanics:

- A `Teleport` inventory item that moves the active worm to a model- or
  player-chosen valid location and ends the turn on success.
- Configurable rising water by physical turn number, so sudden-death pressure
  begins after a chosen turn and rises by a chosen pixel amount each turn.

The existing fairness rule stays intact: there is still no `move_to`,
pathfinding, trajectory solver, auto-aim, or automatic valid-location search for
LLM agents.

## Teleport Goals

`Teleport` should behave like a real inventory item, not a hidden agent helper.
It must appear in the weapon list, have configurable ammo in Battle Setup, be
selectable by human players, and be available to LLM/VLM agents through the same
snapshot/inventory contract as other tools.

Successful teleport:

- Consumes one `Teleport` ammo.
- Moves only the active worm.
- Clears the worm's current velocity and angular velocity.
- Shows a short teleport visual effect using assets from `WAAss`.
- Pans the camera to the destination.
- Ends the worm's turn immediately, with no retreat time.

Rejected teleport:

- Does not move the worm.
- Does not consume ammo.
- Does not end the turn.
- Adds explicit engine feedback for LLM agents explaining the rejection reason.
- Allows same-turn continuation to choose another action while time and batch
  limits remain.

## Teleport Input Contract

Server action schema adds one primitive:

```text
teleport(x 0..10000, y 0..10000)
```

The LLM chooses the destination coordinates itself from the Markdown snapshot
and optional VLM screenshot. The prompt and snapshot describe `Teleport` as a
utility with no blast, no solver, and no valid-point search. Agents are told that
invalid coordinates return feedback instead of moving.

Human players use the same selected `Teleport` inventory item. While it is in
hand, the game draws a destination cursor at the mouse/world position. Pressing
fire attempts teleport to that point. If the point is invalid, the game plays the
normal invalid-click feedback and leaves the turn active.

## Teleport Validation

Validation runs in the browser engine, not on the server. It checks the intended
worm footprint before any state mutation:

- Destination must be within map bounds.
- Destination must be above the current water line.
- The worm body center and surrounding footprint must not overlap solid terrain.
- There must be a small clear space around the worm's head/body so the worm is
  not embedded in a ceiling, wall, or floor.
- The landing point must not be inside static terrain pixels. The validator may
  use alpha samples from `Terrain.bufferCanvasContext`, matching
  `ArenaSnapshot`'s terrain sampling model.

The validator returns structured data:

```text
{ ok: boolean, reason: string, x: number, y: number }
```

The engine uses the `reason` in human notifications and LLM feedback. Example
feedback:

```text
- Teleport rejected at (4210, 1380): terrain overlap around worm footprint.
- Teleport rejected at (5600, 1880): destination is below water line 1765.
- Teleport succeeded to (3720, 1095); turn ends immediately with no retreat time.
```

The validator does not snap to a nearby valid point. If the requested coordinate
is invalid, the agent must revise the coordinate or choose a different plan.

## Assets

Use assets from `/Users/felliks/Projects/Worms-Armageddon-VLM/WAAss`:

- `WAAss/Weapon Icons/teleport.1.png` for `data/images/weaponicons/iconteleport.png`.
- `WAAss/Worms/wtellnk.png` for the take-out animation.
- `WAAss/Worms/wtelbak.png` for the held/ready animation.
- `WAAss/Worms/wteldsv.png` for a disappear/appear animation if it fits the
  existing sprite timing.
- `WAAss/Effects/magichit.png` for a short teleport effect if a lightweight
  particle/effect class is needed.

If a sprite sheet has more frames than the current animation path needs, the
implementation can use a subset by setting `frameCount` and `msPerFrame` in
`SpriteDefinitions.ts`. Sound is optional because `WAAss` does not contain audio
files in this checkout; missing audio must degrade silently like existing
missing sounds.

## Teleport Implementation Shape

Add `src/weapons/Teleport.ts` extending `BaseWeapon`.

Primary responsibilities:

- Hold the teleport inventory metadata: name, ammo, icon, take-out sprite, ready
  sprite.
- Set `requiresAiming = false` because the normal aim ray is not used.
- Expose `validateDestination(worm, x, y)` for engine and tests.
- Expose `attemptTeleport(worm, x, y)` that validates, consumes ammo only on
  success, moves the worm, emits effects, and ends the turn.
- Keep `activate(worm)` as a human-fire pathway that reads the current mouse
  world position and calls `attemptTeleport`.

`ArenaController` should call `attemptTeleport` directly for the `teleport`
primitive so an LLM rejection can be recorded in `ArenaTelemetry` without ending
the turn.

`WeaponManager` adds `Teleport` to the inventory array. Suggested default ammo:
`2`, enough for tactical escapes without replacing normal weapons.

`MainMenu.defaultWeapons()` and `ArenaConfig.applyWeaponAmmo()` should pick up
Teleport automatically because they inspect `WeaponManager`. The fallback list
should also include `Teleport` so the menu still displays if construction fails.

## Agent Prompt and Snapshot Updates

`server/agent.ts`:

- Add `teleport` to `ACTION_TOOLS`.
- Add numeric `x` and `y` fields to raw/normalized action schemas.
- Clamp `x` and `y` to safe numeric ranges.
- Explain `teleport(x,y)` in `<action_primitives>`.
- Explain that successful teleport ends the turn and rejected teleport returns
  feedback without consuming ammo.

`src/llm/ArenaSnapshot.ts`:

- Add `Teleport` to `weaponUseGuidance`.
- Include it in weapon list output with utility facts and agent primitives.
- Add action primitive text for `teleport`.
- Include current water line in the map/water section so agents can avoid
  below-water teleport requests.

`src/llm/ArenaTelemetry.ts`:

- Existing per-action notes are enough. Teleport should write success/rejection
  notes into the current action record.

## Rising Water Goals

The water line should rise by physical turn number, not real time. This avoids
LLM provider latency and same-turn continuation timing from changing game rules.

Settings:

- `waterRiseStartTurn`: physical turn number at which rising begins.
- `waterRisePixelsPerTurn`: upward movement in pixels per new physical turn.

Defaults should preserve existing behavior:

- `waterRiseStartTurn = 0`
- `waterRisePixelsPerTurn = 0`

If either value is `0`, rising water is disabled.

## Rising Water Rules

At the start of each new physical turn, after `GameStateManager.nextPlayer()`
increments `physicalTurnSerial`, the terrain computes the current water line:

```text
baseWaterLine - max(0, physicalTurnSerial - waterRiseStartTurn + 1) * waterRisePixelsPerTurn
```

The water line is clamped so it never rises above the top of the world. The
existing draw, drowning, and projectile-sinking paths continue to call
`Terrain.getWaterLine()`, so they automatically use the risen line.

When water rises, `WormManager.forceOutOfBoundsDeaths()` will kill worms whose
body position is now at or below the new water line during the next update. If
the active worm starts a turn underwater because the line rose, the existing
drowning fail-safe triggers the turn transition.

## Rising Water Configuration

Battle Setup adds a compact "Sudden death water" group:

- `Start on turn` numeric input, range `0..999`.
- `Rise per turn (px)` numeric input, range `0..200`.
- Hint: `0 disables rising water`.

URL launch adds parameters:

```text
waterRiseStartTurn=20
waterRisePixelsPerTurn=12
```

These flow through `Settings` and `ArenaConfig.applyToSettings()` like
`turnTime`, `memoryWindow`, and `maxBatchesPerTurn`.

## Testing Strategy

Use test-first implementation.

Source-contract tests should cover:

- `Teleport` is in weapon guidance, inventory contract, and action primitive
  list.
- Agent schema accepts `teleport` with `x/y`, clamps dirty coordinate values, and
  prompt text describes rejection feedback and turn-ending success.
- Browser controller executes a `teleport` action and mentions success/rejection
  feedback strings.
- Weapon manager includes `Teleport`.
- Terrain has mutable/configurable water line state rather than a fixed
  `bufferCanvas.height - 35` return.
- Settings, ArenaConfig, MainMenu, and URL parsing expose the rising-water knobs.

Verification commands:

```bash
npm test
npm run build:legacy
npm run typecheck
npm run qa:browser
```

`npm run check` remains the final pre-PR target if time allows.

## Out of Scope

- Emergency Teleport.
- Teleport crates or crate collection rules.
- Automatic valid-point search, nearest-point snapping, route planning, or any
  agent-side solver.
- New audio if no local teleport sound exists.
- Reworking Jet Pack or Ninja Rope behavior beyond adding Teleport as an
  alternate utility.
