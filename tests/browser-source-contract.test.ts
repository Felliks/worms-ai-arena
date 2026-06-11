import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("browser game source contracts", () => {
  it("describes every inventory item with tactical use and low-level primitives for agents", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");

    for (const weapon of ["Shotgun", "Hand Grenade", "Holy Grenade", "Dynamite", "Jet Pack", "Minigun", "Ninja Rope", "Drill", "Bazooka", "Teleport"]) {
      expect(snapshot).toContain(weapon);
    }
    expect(snapshot).toContain("tactical use");
    expect(snapshot).toContain("facts:");
    expect(snapshot).toContain("agent primitives");
    expect(snapshot).toContain("consumes one Jet Pack ammo");
    expect(snapshot).toContain("screen-relative");
    expect(snapshot).toContain("teleport(x,y)");
    expect(snapshot).toContain("invalid teleport coordinates return feedback");
    expect(snapshot).not.toContain("best when no sane shot exists");
    expect(snapshot).not.toContain("Use 40-120");
    expect(snapshot).not.toContain("terrain-opening shot for the next turn");
    expect(controller).toContain("weaponUseGuidance");
    expect(controller).toContain("ArenaSnapshot.weaponUseGuidance");
    expect(controller).toContain("Ninja Rope");
    expect(controller).toContain("attemptTeleport");
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

  it("exposes teleport as a validated inventory utility that succeeds by ending the turn", () => {
    const weaponManager = fs.readFileSync(path.join(root, "src", "weapons", "WeaponManager.ts"), "utf8");
    const teleport = fs.readFileSync(path.join(root, "src", "weapons", "Teleport.ts"), "utf8");
    const controller = fs.readFileSync(path.join(root, "src", "llm", "ArenaController.ts"), "utf8");
    const sprites = fs.readFileSync(path.join(root, "src", "animation", "SpriteDefinitions.ts"), "utf8");
    const mainMenu = fs.readFileSync(path.join(root, "src", "gui", "MainMenu.ts"), "utf8");

    expect(weaponManager).toContain("new Teleport(2)");
    expect(teleport).toContain("class Teleport extends BaseWeapon");
    expect(teleport).toContain("validateDestination");
    expect(teleport).toContain("attemptTeleport");
    expect(teleport).toContain("does not consume ammo");
    expect(teleport).toContain("GameInstance.state.tiggerNextTurn()");
    expect(teleport).toContain("terrain overlap around worm footprint");
    expect(teleport).toContain("destination is below water line");
    expect(controller).toContain('if (tool == "teleport")');
    expect(controller).toContain("this.attemptTeleport(player, worm, action.x, action.y)");
    expect(controller).toContain("Teleport rejected");
    expect(controller).toContain("Teleport succeeded");
    expect(sprites).toContain("iconTeleport");
    expect(sprites).toContain("takeOutTeleport");
    expect(sprites).toContain("readyTeleport");
    expect(mainMenu).toContain('{ name: "Teleport", ammo: 2 }');
  });

  it("connects low-risk Worms Armageddon weapons through existing aim/power/fire primitives", () => {
    const readOptional = (relativePath: string) => {
      const full = path.join(root, relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    };
    const weaponManager = fs.readFileSync(path.join(root, "src", "weapons", "WeaponManager.ts"), "utf8");
    const thrown = readOptional(path.join("src", "weapons", "ArmageddonThrowables.ts"));
    const projectile = fs.readFileSync(path.join(root, "src", "weapons", "ProjectileWeapon.ts"), "utf8");
    const sprites = fs.readFileSync(path.join(root, "src", "animation", "SpriteDefinitions.ts"), "utf8");
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");
    const mainMenu = fs.readFileSync(path.join(root, "src", "gui", "MainMenu.ts"), "utf8");
    const serverAgent = fs.readFileSync(path.join(root, "server", "agent.ts"), "utf8");

    expect(weaponManager).toContain("new BananaBomb(3)");
    expect(weaponManager).toContain("new ClusterBomb(6)");
    expect(weaponManager).toContain("new Mortar(8)");
    expect(thrown).toContain("class FragmentingThrowableWeapon extends ThrowableWeapon");
    expect(thrown).toContain("class BananaBomb extends FragmentingThrowableWeapon");
    expect(thrown).toContain("class ClusterBomb extends FragmentingThrowableWeapon");
    expect(thrown).toContain("spawnFragments");
    expect(projectile).toContain("class FragmentingProjectileWeapon extends ProjectileWeapon");
    expect(projectile).toContain("class Mortar extends FragmentingProjectileWeapon");

    for (const sprite of ["bananaBomb", "clusterBomb", "mortar", "clusterlet", "bananaClusterlet"]) {
      expect(sprites).toContain(sprite);
    }
    for (const asset of [
      "data/images/banana.png",
      "data/images/cluster.png",
      "data/images/mortar.png",
      "data/images/clustlet.png",
      "data/images/hclustlt.png",
      "data/images/weaponicons/iconbanana.png",
      "data/images/weaponicons/iconcluster.png",
      "data/images/weaponicons/iconmortar.png",
    ]) {
      expect(fs.existsSync(path.join(root, asset))).toBe(true);
    }

    for (const weapon of ["Banana Bomb", "Cluster Bomb", "Mortar"]) {
      expect(snapshot).toContain(weapon);
      expect(mainMenu).toContain(weapon);
      expect(serverAgent).toContain(weapon);
    }
    expect(snapshot).toContain("agent primitives: aim, set_power, fire");
  });

  it("connects every additional safe Worms Armageddon weapon without new agent primitives", () => {
    const readOptional = (relativePath: string) => {
      const full = path.join(root, relativePath);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    };
    const weaponManager = fs.readFileSync(path.join(root, "src", "weapons", "WeaponManager.ts"), "utf8");
    const ray = readOptional(path.join("src", "weapons", "ArmageddonRayWeapons.ts"));
    const melee = readOptional(path.join("src", "weapons", "MeleeWeapons.ts"));
    const blowtorch = fs.readFileSync(path.join(root, "src", "weapons", "Blowtorch.ts"), "utf8");
    const sprites = fs.readFileSync(path.join(root, "src", "animation", "SpriteDefinitions.ts"), "utf8");
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");
    const mainMenu = fs.readFileSync(path.join(root, "src", "gui", "MainMenu.ts"), "utf8");
    const serverAgent = fs.readFileSync(path.join(root, "server", "agent.ts"), "utf8");

    for (const weapon of [
      "new Uzi(6)",
      "new Handgun(6)",
      "new BaseballBat(4)",
      "new Prod(6)",
      "new FirePunch(3)",
      "new DragonBall(3)",
      "new Blowtorch(3)",
    ]) {
      expect(weaponManager).toContain(weapon);
    }

    expect(ray).toContain("class Uzi extends TimedRayWeapon");
    expect(ray).toContain("class Handgun extends TimedRayWeapon");
    expect(melee).toContain("class BaseballBat extends MeleeWeapon");
    expect(melee).toContain("class Prod extends MeleeWeapon");
    expect(melee).toContain("class FirePunch extends MeleeWeapon");
    expect(melee).toContain("class DragonBall extends MeleeWeapon");
    expect(blowtorch).toContain("class Blowtorch extends BaseWeapon");
    expect(blowtorch).toContain("addToDeformBatch");

    for (const sprite of [
      "uzi",
      "handgun",
      "baseballBat",
      "prod",
      "firePunch",
      "dragonBall",
      "blowTorch",
    ]) {
      expect(sprites).toContain(sprite);
    }

    for (const asset of [
      "data/images/wuzi.png",
      "data/images/wuzif.png",
      "data/images/wuzilnk.png",
      "data/images/whandg.png",
      "data/images/whandf.png",
      "data/images/wprod.png",
      "data/images/wbatfrd.png",
      "data/images/wfist.png",
      "data/images/wfirbl1.png",
      "data/images/wblowlk.png",
      "data/images/wbloww.png",
      "data/images/weaponicons/iconuzi.png",
      "data/images/weaponicons/iconhandgun.png",
      "data/images/weaponicons/iconbaseball.png",
      "data/images/weaponicons/iconprod.png",
      "data/images/weaponicons/iconfirepnch.png",
      "data/images/weaponicons/icondragball.png",
    ]) {
      expect(fs.existsSync(path.join(root, asset))).toBe(true);
    }

    for (const weapon of [
      "Uzi",
      "Handgun",
      "Baseball Bat",
      "Prod",
      "Fire Punch",
      "Dragon Ball",
      "Blowtorch",
    ]) {
      expect(snapshot).toContain(weapon);
      expect(mainMenu).toContain(weapon);
      expect(serverAgent).toContain(weapon);
    }
    expect(snapshot).toContain("No new agent primitive is required");
  });

  it("keeps the expanded in-game weapons menu scrollable after the larger inventory", () => {
    const weaponsMenu = fs.readFileSync(path.join(root, "src", "gui", "WeaponsMenu.ts"), "utf8");
    const css = fs.readFileSync(path.join(root, "css", "custom.css"), "utf8");
    const menuRule = css.match(/#weaponsMenu\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(weaponsMenu).toContain("weaponsMenuContent");
    expect(weaponsMenu).toContain("outerWidth()");
    expect(weaponsMenu).not.toContain('moveAmountInPx = "-275px"');
    expect(menuRule).toContain("top: 50%");
    expect(menuRule).toContain("transform: translateY(-50%)");
    expect(menuRule).not.toContain("bottom:");
    expect(menuRule).not.toContain("top: auto");
    expect(css).toContain("#weaponsMenuContent");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("grid-template-columns");
    expect(css).toContain("max-height: calc(100vh");
    expect(css).toContain("box-sizing: border-box");
  });

  it("shows agents current height above water and future rising-water pressure", () => {
    const snapshot = fs.readFileSync(path.join(root, "src", "llm", "ArenaSnapshot.ts"), "utf8");

    expect(snapshot).toContain("## Water and sudden-death pressure");
    expect(snapshot).toContain("Physical turn serial");
    expect(snapshot).toContain("Current water line");
    expect(snapshot).toContain("Active worm");
    expect(snapshot).toContain("px above water");
    expect(snapshot).toContain("Rising water: enabled");
    expect(snapshot).toContain("automatic rise amount");
    expect(snapshot).toContain("Next rise");
    expect(snapshot).toContain("unsafe after");
    expect(snapshot).toContain("more rises if position does not improve");
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

  it("browser QA uses headless Chrome channel with autoplay and sandbox flags", () => {
    const browserQa = fs.readFileSync(path.join(root, "scripts", "browser-qa.ts"), "utf8");

    expect(browserQa).toContain('channel: "chrome"');
    expect(browserQa).toContain('headless: true');
    expect(browserQa).toContain("--autoplay-policy=no-user-gesture-required");
    expect(browserQa).toContain("--no-sandbox");
  });

  it("resets video capture session state when a new arena match starts after an ended match", () => {
    const capture = fs.readFileSync(path.join(root, "src", "video", "VideoCapture.ts"), "utf8");

    expect(capture).toContain("resetCaptureState()");
    expect(capture).toContain('phase == "ended" && matchActive() && isArenaMatch()');
    expect(capture).toContain("lastMusicReqAt = -1000000");
    expect(capture).toContain("musicVariation = -1");
  });

  it("revokes VideoStudio preview object URLs when replacing previews or closing the studio", () => {
    const studio = fs.readFileSync(path.join(root, "src", "gui", "VideoStudio.ts"), "utf8");

    expect(studio).toContain("previewUrl");
    expect(studio).toContain("revokePreviewUrl()");
    expect(studio).toContain("URL.revokeObjectURL(previewUrl)");
    expect(studio).toContain("revokePreviewUrl();\n        if (rootEl");
    expect(studio).toContain("revokePreviewUrl();\n        clear(previewEl)");
  });

  it("ducks live ArenaMusic while VideoStudio preview audio is active", () => {
    const studio = fs.readFileSync(path.join(root, "src", "gui", "VideoStudio.ts"), "utf8");
    const music = fs.readFileSync(path.join(root, "src", "audio", "ArenaMusic.ts"), "utf8");

    expect(music).toContain("setPreviewDucked");
    expect(music).toContain("previewDucked");
    expect(music).toContain("targetMasterLevel()");
    expect(studio).toContain("ArenaMusic.setPreviewDucked(true)");
    expect(studio).toContain("ArenaMusic.setPreviewDucked(false)");
  });

  it("ducks all live game SFX while VideoStudio preview audio is active", () => {
    const studio = fs.readFileSync(path.join(root, "src", "gui", "VideoStudio.ts"), "utf8");
    const sound = fs.readFileSync(path.join(root, "src", "audio", "Sound.ts"), "utf8");

    expect(sound).toContain("setSfxDucked");
    expect(sound).toContain("sfxDucked");
    expect(sound).toContain("activeGains");
    expect(sound).toContain("SoundFallback.instances");
    expect(studio).toContain("Sound.setSfxDucked(true)");
    expect(studio).toContain("Sound.setSfxDucked(false)");
  });

  it("preserves taunt preroll segments when AI montage reorders moments", () => {
    const studio = fs.readFileSync(path.join(root, "src", "gui", "VideoStudio.ts"), "utf8");
    const timeline = fs.readFileSync(path.join(root, "src", "video", "MatchTimeline.ts"), "utf8");

    expect(timeline).toContain("export function segmentsForMoment");
    expect(timeline).toContain("taunt:");
    expect(timeline).toContain("TAUNT_PREROLL_MS");
    expect(timeline).toContain("localStartMs");
    expect(timeline).toContain("showThoughtBubble");
    expect(studio).toContain("MatchTimeline.segmentsForMoment");
    expect(studio).not.toContain("segs.push({ t0: Math.max(0, m.t0 / 1000), t1: m.t1 / 1000");
  });

  it("does not speed up rendered clips because accelerated music and trash-talk are unreadable", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");
    const timeline = fs.readFileSync(path.join(root, "src", "video", "MatchTimeline.ts"), "utf8");

    expect(recorder).toContain("video.playbackRate = 1");
    expect(recorder).not.toContain("video.playbackRate = Math.max");
    expect(timeline).not.toContain("Whole match, sped up");
    expect(timeline).not.toContain("fullRate");
  });

  it("keeps the last death and its last trash-talk in generated clips", () => {
    const capture = fs.readFileSync(path.join(root, "src", "video", "VideoCapture.ts"), "utf8");
    const timeline = fs.readFileSync(path.join(root, "src", "video", "MatchTimeline.ts"), "utf8");

    expect(capture).toContain("POST_ROLL_MS = 6500");
    expect(timeline).toContain("finalDeathMomentAdded");
    expect(timeline).toContain('addMoment("final_death"');
    expect(timeline).toContain("latestDeathBefore");
    expect(timeline).toContain("Last Death");
    expect(timeline).not.toContain("Final death");
  });

  it("draws rendered trash-talk bubbles from segment-local taunt metadata", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");

    expect(recorder).toContain("function drawSegmentTaunt");
    expect(recorder).toContain("seg.taunt");
    expect(recorder).toContain("drawFrame(seg)");
    expect(recorder).toContain("tauntLocalStartMs");
    expect(recorder).toContain("drawWormBubble(octx, ow, oh, seg.taunt");
  });

  it("renders trash-talk bubbles with the same screen-space metadata and style as the in-game wa-bubble", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");
    const timeline = fs.readFileSync(path.join(root, "src", "video", "MatchTimeline.ts"), "utf8");
    const css = fs.readFileSync(path.join(root, "css", "custom.css"), "utf8");

    expect(css).toContain(".wa-bubble");
    expect(timeline).toContain("screenX");
    expect(timeline).toContain("screenY");
    expect(timeline).toContain("teamColor");
    expect(recorder).toContain("screenX");
    expect(recorder).toContain("screenY");
    expect(recorder).toContain("teamColor");
    expect(recorder).toContain("rgba(14, 15, 22, 0.92)");
    expect(recorder).toContain("drawWormBubble(octx, ow, oh, seg.taunt");
    expect(recorder).not.toContain("rgba(250,244,214,0.97)");
  });

  it("cleans MediaRecorder capture tracks after live recording and local render sessions", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");

    expect(recorder).toContain("recordVideoTrack");
    expect(recorder).toContain("stopLiveTracks()");
    expect(recorder).toContain("renderTracks");
    expect(recorder).toContain("renderTracks[i].stop()");
  });

  it("routes MatchRecorder.render through one terminal callback path", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");

    expect(recorder).toContain("finishRender");
    expect(recorder).toContain("failRender");
    expect(recorder).toContain("stopping");
    expect(recorder).toContain("video.onerror = function () { failRender(); }");
    expect(recorder).not.toContain("video.onerror = function () { cleanup(); cb(null); };");
  });

  it("normalizes render EDL segments against decoded master duration before starting playback", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");

    expect(recorder).toContain("normalizeSegments");
    expect(recorder).toContain("segmentsStartAfterTimeline");
    expect(recorder).toContain("durationSec");
    expect(recorder).toContain("fallbackDurationSec");
    expect(recorder).toContain("if (!segs.length) { failRender(); return; }");
  });

  it("guards render segment startup against duplicate seeked and fallback timer paths", () => {
    const recorder = fs.readFileSync(path.join(root, "src", "video", "MatchRecorder.ts"), "utf8");

    expect(recorder).toContain("segmentStarted");
    expect(recorder).toContain("startSegment");
    expect(recorder).not.toContain("var onSeeked = function ()");
  });

  it("keeps clipSignal out of gameplay and agent action execution code", () => {
    const allowed = new Set([path.join(root, "src", "video", "MatchTimeline.ts")]);
    const files = walkFiles(path.join(root, "src")).filter((file) => file.endsWith(".ts") && !allowed.has(file));

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      expect(text.includes("clipSignal"), path.relative(root, file)).toBe(false);
    }
  });

  it("drains pending SFX audio elements after the shared capture context resumes", () => {
    const bus = fs.readFileSync(path.join(root, "src", "video", "RecordingAudioBus.ts"), "utf8");

    expect(bus).toContain("flushPending()");
    expect(bus).toContain("p.then(function () { flushPending(); })");
    expect(bus).toContain("if (pending.length)");
    expect(bus).toContain("for (var i = 0; i < list.length; i++) { wrap(list[i]); }");
  });
});
