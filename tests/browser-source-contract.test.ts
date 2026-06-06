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
    expect(snapshot).toContain("best when");
    expect(snapshot).toContain("agent primitives");
    expect(controller).toContain("weaponUseGuidance");
    expect(controller).toContain("ArenaSnapshot.weaponUseGuidance");
    expect(controller).toContain("Ninja Rope");
  });

  it("surfaces start-of-turn self orientation before the agent chooses actions", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");

    expect(snapshot).toContain("## Start-of-turn self orientation");
    expect(snapshot).toContain("Initial facing");
    expect(snapshot).toContain("Weapon in hand");
    expect(snapshot).toContain("Aim elevation");
    expect(snapshot).toContain("Wind at turn start");
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
});
