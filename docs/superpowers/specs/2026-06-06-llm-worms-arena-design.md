# LLM Worms Arena MVP Design

## Goal

Build a browser MVP where any team slot can be controlled by a human, a text-only LLM, or a VLM, and the match can run to a winner without human input when all slots are models.

## Scope

The original clone is the game and visual foundation. The MVP must preserve its recognizable Worms-style feel: the same canvas game, terrain, worms, HP labels, turn timer, weapon menu, aiming, projectile physics, terrain deformation, and camera behavior. The work is to modernize the build/runtime enough to run it locally, then add LLM/VLM control on top of the existing `Player`, `Worm`, `WeaponManager`, and `InstructionChain` primitives.

No replacement game, no generated substitute art pack, and no higher-level autopilot. Any fallback assets are only allowed as a local-loading safety net if an original same-origin asset is missing, not as a redesign.

## Agent Framework Choice

Use LangGraph.js for orchestration. The game is already a state machine: current participant, snapshot, optional vision image, model/tool decision, existing game command execution, feedback, and next decision or next turn. LangGraph gives explicit graph nodes and state routing for this loop, while LangChain.js supplies model/tool bindings. DeepAgents is not chosen for MVP because its prebuilt planning/subagent/filesystem features are broader than the game needs.

References checked:
- https://docs.langchain.com/oss/javascript/langgraph/overview
- https://docs.langchain.com/oss/javascript/langchain/agents
- https://docs.langchain.com/oss/javascript/deepagents/quickstart
- https://www.typescriptlang.org/docs/handbook/namespaces.html
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- https://developers.openai.com/api/docs/guides/images-vision
- https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image

## Architecture

The browser owns the existing game simulation and renders the original Canvas. A local Node server owns model calls and exposes `POST /api/turn`. The browser sends a Markdown snapshot, prior Markdown feedback, participant config, public chat history, and optionally a grid-overlaid screenshot. The server returns public plan text, trash talk, and a list of primitive actions collected from model tool calls.

If no API key is configured, the server uses a mock model that goes through the same action schema so the MVP can be verified locally.

## Participants

Each team slot has:
- `kind`: `human`, `llm_text`, `vlm`, or `mock_model`
- `model`: provider model name when applicable
- `persona`: system prompt fragment
- `vision`: `off`, `always`, or `on_request`

The same match config supports `human vs llm`, `human vs vlm`, `llm vs vlm`, and 3+ mixed teams.

## Perception

Text perception is Markdown and includes:
- active team/worm and remaining action budget
- all teams, worms, HP, alive/dead state, positions, velocity
- selected weapon/ammo, aim angle, power
- wind, gravity note, map bounds
- terrain samples near the active worm and between active worm and targets
- straight-line obstruction notes
- previous action feedback

Vision perception is a Canvas screenshot with a coordinate grid and labels. It is sent per participant config or after a model requests it.

## Actions

The model controls only low-level primitives:
- `walk(direction, steps)` mapped to repeated existing `walkLeft` / `walkRight`
- `jump()`
- `backflip()`
- `select_weapon(weapon)` mapped to existing `WeaponManager.setCurrentWeapon`
- `aim(angle_degrees)` implemented by moving the existing incremental `Target.aim` until the requested absolute angle is reached
- `set_power(power)` implemented by charging the existing `ForceIndicator` until the requested percentage is reached
- `fire()` mapped to existing `Worm.fire` / `Player.weaponFireOrCharge`
- `say(message)`
- `end_turn()`
- `request_screenshot()`

The engine clamps unsafe values to input ranges, but it does not choose targets, solve trajectories, compute aim, or pathfind. A model can return several tool calls in one response or a batch tool call containing a chain.

## Feedback

After execution the browser produces Markdown feedback:
- movement result, blocked reason, old/new position
- jump/backflip landing position
- weapon selection/aim/power confirmation
- shot impact point, hit/miss, damage table, nearest miss delta, and observed wind drift
- turn end reason

This feedback is appended to the participant transcript and included in later decisions.

## Verification

The MVP is ready when:
- `npm test`, `npm run typecheck`, and `npm run build` pass
- the dev server runs locally
- Playwright can load the app and a mock-model match reaches a winner
- human controls are available for human team slots
- text and vision modes produce visible payloads in the UI
