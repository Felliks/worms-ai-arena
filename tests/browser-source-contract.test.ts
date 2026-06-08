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

  it("writes complete arena debug payloads to console and server event logs", () => {
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    expect(controller).toContain("postAgentEvent(\"agent-request\"");
    expect(controller).toContain("postAgentEvent(\"agent-decision\"");
    expect(controller).toContain("postAgentEvent(\"engine-feedback\"");
    expect(controller).toContain("console.log(\"[Arena] \" + label + \"\\n\" + rendered)");
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
    expect(wormManager).toContain("SetLinearVelocity(new b2Vec2(0, 0))");
    expect(gameState).toContain("forceOutOfBoundsDeaths");
    expect(game).toContain("forceOutOfBoundsDeaths");
  });

  it("applies explosion damage at most once per worm body even if multiple fixtures overlap", () => {
    const effects = fs.readFileSync(path.join(root, "src", "animation", "Effects.ts"), "utf8");

    expect(effects).toContain("var affectedWorms = []");
    expect(effects).toContain("affectedWorms.indexOf(worm) != -1");
    expect(effects).toContain("affectedWorms.push(worm)");
    expect(effects).toContain("worm.hit(maxDamage * distanceFromEpicenter, entityThatCausedExplosion)");
  });

  it("warns agents about allies on the same side or height before risky explosive shots", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");

    expect(snapshot).toContain("nearSameHeight");
    expect(snapshot).toContain("same-side ally caution");
    expect(snapshot).toContain("horizontal/low-arc explosives toward that side can endanger them");
  });
});
