import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

describe("browser game source contracts", () => {
  it("describes every inventory item with tactical use and low-level primitives for agents", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    for (const weapon of ["Shotgun", "Hand Grenade", "Holy Grenade", "Dynamite", "Jet Pack", "Minigun", "Ninja Rope", "Drill", "Bazooka"]) {
      expect(snapshot).toContain(weapon);
    }
    expect(snapshot).toContain("tactical use");
    expect(snapshot).toContain("facts:");
    expect(snapshot).toContain("agent primitives");
    expect(snapshot).toContain("consumes one Jet Pack ammo");
    expect(snapshot).toContain("screen-relative");
    expect(snapshot).not.toContain("best when no sane shot exists");
    expect(snapshot).not.toContain("Use 40-120");
    expect(snapshot).not.toContain("terrain-opening shot for the next turn");
    expect(controller).toContain("weaponUseGuidance");
    expect(controller).toContain("ArenaSnapshot.weaponUseGuidance");
    expect(controller).toContain("Ninja Rope");
  });

  it("always writes server event logs and mirrors to console only when opted in", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    // Server-side telemetry is unconditional.
    expect(controller).toContain("postAgentEvent(\"agent-request\"");
    expect(controller).toContain("postAgentEvent(\"agent-decision\"");
    expect(controller).toContain("postAgentEvent(\"engine-feedback\"");
    // The verbose console mirror is gated so the public build's console stays clean.
    expect(controller).toContain("console.log(\"[Arena] \" + label + \"\\n\" + rendered)");
    expect(controller).toContain("!Settings.ARENA_DEBUG_LOGS");
    expect(controller).not.toContain("console.groupCollapsed");
  });

  it("only preloads bundled default sounds that exist locally", () => {
    const assetManager = fs.readFileSync(path.join(root, "src", "system", "AssetManager.ts"), "utf8");
    const match = assetManager.match(/var bundledAudioToBeLoaded = \[([\s\S]*?)\];/);

    expect(match).toBeTruthy();
    const bundledSounds = Array.from(match![1].matchAll(/data\/sounds\/([^"']+?\.wav|[^"']+?\.WAV)/g), (m) => m[1]);
    expect(bundledSounds.length).toBeGreaterThan(0);
    for (const sound of bundledSounds) {
      expect(fs.existsSync(path.join(root, "data", "sounds", sound))).toBe(true);
    }
    expect(assetManager).toContain("originalPackAudioToBeLoaded");
    expect(assetManager).toContain('Settings.ASSET_PACK != "default"');
  });

  it("surfaces start-of-turn self orientation before the agent chooses actions", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");

    expect(snapshot).toContain("## Start-of-turn self orientation");
    expect(snapshot).toContain("Initial facing");
    expect(snapshot).toContain("Weapon in hand");
    expect(snapshot).toContain("Aim elevation");
    expect(snapshot).toContain("Wind at turn start");
  });

  it("captures a fresh VLM screenshot for every same-worm continuation request", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    expect(controller).toContain("scheduleSameTurnAiContinuation");
    expect(controller).toContain("sameTurnResumeTimer");
    expect(controller).toContain('postAgentEvent("agent/continue-same-turn"');
    expect(controller).toContain('postAgentEvent("agent/continue-same-turn/resume"');
    expect(controller).toContain("Waiting for render/physics settle before fresh VLM screenshot");
    expect(controller).toContain("Fresh same-turn VLM screenshot will be captured in runAiTurn.");
    expect(controller).toContain("payload.screenshotDataUrl = ArenaSnapshot.captureVision(this.game)");
  });

  it("normalizes persona labels before injecting them into prompts", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");
    const arenaConfig = fs.readFileSync(path.join(root, "src", "gui", "ArenaConfig.ts"), "utf8");

    expect(controller).toContain("replace(/^Personality tendency:");
    expect(arenaConfig).toContain("replace(/^Personality tendency:");
    expect(controller).not.toContain('"- Personality tendency: " + profile.tactic');
  });

  it("does not request missing default menu music or background assets", () => {
    const menuAudio = fs.readFileSync(path.join(root, "src", "gui", "MenuAudio.ts"), "utf8");

    expect(menuAudio).toContain('Settings.ASSET_PACK != "default"');
    expect(menuAudio).toContain("if (hasExternalAssetPack)");
    expect(menuAudio).toContain("startProcedural();");
    expect(menuAudio).toContain("linear-gradient(to bottom");
  });

  it("has an agent jetpack thrust primitive that applies physics without keyboard timing", () => {
    const jetPack = fs.readFileSync(path.join(root, "src", "weapons", "JetPack.ts"), "utf8");
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    expect(jetPack).toContain("applyAiThrust");
    expect(jetPack).toContain("ApplyImpulse");
    expect(controller).toContain("applyAiThrust");
    expect(controller).toContain("ropeSwing");
    expect(controller).toContain("rope_swing");
  });

  it("has a drowned-worm fail-safe so turn advancement cannot wait forever underwater", () => {
    const wormManager = fs.readFileSync(path.join(root, "src", "WormManager.ts"), "utf8");
    const gameState = fs.readFileSync(path.join(root, "src", "GameStateManager.ts"), "utf8");
    const game = fs.readFileSync(path.join(root, "src", "Game.ts"), "utf8");

    expect(wormManager).toContain("forceOutOfBoundsDeaths");
    expect(wormManager).toContain("waterLine");
    // Drowned worms sink and disappear: the body becomes a sensor (drops through
    // the world floor) and is pushed downward, rather than freezing on the surface.
    expect(wormManager).toContain("worm.sunk = true");
    expect(wormManager).toContain("SetSensor(true)");
    expect(wormManager).toContain("SetLinearVelocity(new b2Vec2(0, 4))");
    expect(gameState).toContain("forceOutOfBoundsDeaths");
    expect(game).toContain("forceOutOfBoundsDeaths");
  });

  it("keeps a dead worm's airborne grenade/rocket updating so it detonates instead of deadlocking the turn", () => {
    const worm = fs.readFileSync(path.join(root, "src", "Worm.ts"), "utf8");

    // A worm can die (drown/splash) while a throwable it launched is still in flight. If the dead
    // branch of Worm.update() stops driving that projectile, its fuse freezes, it never detonates,
    // the weapon stays active, areAllWeaponsDeactived() never becomes true, and the match deadlocks
    // with the grenade frozen in the sky. The dead branch must keep updating the orphaned projectile.
    const deadBranch = worm.slice(worm.indexOf("orphanWeapon"));
    expect(worm).toContain("orphanWeapon");
    expect(deadBranch).toContain("getIsActive()");
    expect(deadBranch).toContain("instanceof ThrowableWeapon");
    expect(deadBranch).toContain("instanceof ProjectileWeapon");
    expect(deadBranch).toContain("orphanWeapon.update()");
  });

  it("never lets the camera follow a dead worm, so it pans to the worm whose turn it is", () => {
    const wormManager = fs.readFileSync(path.join(root, "src", "WormManager.ts"), "utf8");
    const player = fs.readFileSync(path.join(root, "src", "Player.ts"), "utf8");

    // findFastestMovingWorm must skip dead worms (a sinking corpse keeps velocity > 3).
    const fastest = wormManager.slice(wormManager.indexOf("findFastestMovingWorm"));
    expect(fastest).toContain("isDead");
    // The per-player camera follow must also skip dead worms.
    expect(player).toContain("currentWorm.isDead == false");
  });

  it("applies explosion damage at most once per worm body even if multiple fixtures overlap", () => {
    const effects = fs.readFileSync(path.join(root, "src", "animation", "Effects.ts"), "utf8");

    expect(effects).toContain("var affectedWorms = []");
    expect(effects).toContain("affectedWorms.indexOf(worm) != -1");
    expect(effects).toContain("affectedWorms.push(worm)");
    expect(effects).toContain("worm.hit(damage, entityThatCausedExplosion)");
  });

  it("warns agents about allies on the same side or height before risky explosive shots", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");

    expect(snapshot).toContain("nearSameHeight");
    expect(snapshot).toContain("same-side ally caution");
    expect(snapshot).toContain("horizontal/low-arc explosives toward that side can endanger them");
  });

  it("keys AI turns by the engine physical turn serial, not only player/worm identity", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");
    const gameState = fs.readFileSync(path.join(root, "src", "GameStateManager.ts"), "utf8");

    expect(gameState).toContain("physicalTurnSerial");
    expect(gameState).toContain("getPhysicalTurnSerial()");
    expect(controller).toContain("this.game.state.getPhysicalTurnSerial()");
    expect(controller).not.toContain('var turnKey = player.id + ":" + worm.name + ":" + player.getTeam().currentWorm;');
  });

  it("enforces the configured same-turn AI batch limit in browser controller payload and continuation logic", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");
    const settings = fs.readFileSync(path.join(root, "src", "Settings.ts"), "utf8");

    expect(settings).toContain("ARENA_MAX_BATCHES_PER_TURN");
    expect(controller).toContain("maxSameTurnBatches: Settings.ARENA_MAX_BATCHES_PER_TURN");
    expect(controller).toContain("turnContext.sameTurnBatch >= Settings.ARENA_MAX_BATCHES_PER_TURN");
    expect(controller).toContain('postAgentEvent("agent/max-batches-per-turn"');
    expect(controller).toContain("this.game.state.timerTiggerNextTurn()");
  });

  it("does not advertise unsupported say actions in the browser snapshot action primitive list", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");
    const serverAgent = fs.readFileSync(path.join(root, "server", "agent.ts"), "utf8");

    expect(serverAgent).not.toContain('"say",');
    expect(snapshot).not.toContain("`say`, `inspect_inventory`");
  });

  it("never lets model observeMs shorten fuse/projectile observation below weapon-safe defaults", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    expect(controller).toContain("fireProfile.ballistic ? Math.max(action.observeMs || 0, fireProfile.observeMs)");
    expect(controller).not.toContain("var observeMs = action.observeMs || fireProfile.observeMs");
    expect(controller).not.toContain("if (elapsed >= observeMs)");
  });

  it("treats successful agent streams without a final decision as controller errors instead of staying busy", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    expect(controller).toContain("finishDecision()");
    expect(controller).toContain('throw new Error("Agent response stream ended without final decision")');
    expect(controller).toContain("this.clearAiTurn(turnContext)");
    expect(controller).toContain("this.busy = false");
  });

  it("does not recurse forever when every team is dead and starts from player/worm zero", () => {
    const game = fs.readFileSync(path.join(root, "src", "Game.ts"), "utf8");
    const gameState = fs.readFileSync(path.join(root, "src", "GameStateManager.ts"), "utf8");
    const team = fs.readFileSync(path.join(root, "src", "Team.ts"), "utf8");

    expect(gameState).toContain("this.currentPlayerIndex = -1");
    expect(team).toContain("this.currentWorm = -1");
    expect(gameState).toContain("for (var attempts = 0; attempts < this.players.length; attempts++)");
    expect(game).toContain("No contest");
    const nextTurnBody = game.slice(game.indexOf("nextTurn()"), game.indexOf("update()", game.indexOf("nextTurn()")));
    expect(nextTurnBody).not.toContain("this.nextTurn()");
  });

  it("only the current player may run per-player camera tracking, while fastest-worm tracking remains global once", () => {
    const player = fs.readFileSync(path.join(root, "src", "Player.ts"), "utf8");

    expect(player).toContain("var isCurrentPlayer = GameInstance.state.getCurrentPlayer() == this");
    const cameraBlock = player.slice(player.indexOf("var isCurrentPlayer"));
    expect(cameraBlock).toContain("if (isCurrentPlayer && GameInstance.state.physicsWorldSettled");
    expect(cameraBlock).toContain("findFastestMovingWorm()");
    expect(cameraBlock).toContain("currentWorm.isDead == false");
  });

  it("online disconnect turn advancement deterministically reassigns authority to a remaining client", () => {
    const gameLobby = fs.readFileSync(path.join(root, "src", "networking", "GameLobby.ts"), "utf8");

    expect(gameLobby).toContain("assignTurnAuthorityAfterDisconnect");
    expect(gameLobby).toContain("GameInstance.lobby.client_GameLobby.currentPlayerId = replacement.id");
    expect(gameLobby).toContain("GameInstance.state.tiggerNextTurn()");
  });

  it("keeps a stable local-start selector for browser QA", () => {
    const mainMenu = fs.readFileSync(path.join(root, "src", "gui", "MainMenu.ts"), "utf8");
    const browserQa = fs.readFileSync(path.join(root, "scripts", "browser-qa.ts"), "utf8");

    expect(browserQa).toContain("#startLocal");
    expect(mainMenu).toContain('attrs: { id: "startLocal" }');
  });

  it("browser QA waits for the current thought-bubble arena UI, not the removed overlay panel", () => {
    const browserQa = fs.readFileSync(path.join(root, "scripts", "browser-qa.ts"), "utf8");

    expect(browserQa).toContain("#arenaThoughtBubble");
    expect(browserQa).not.toContain("#arenaAgentOverlay");
  });
});
