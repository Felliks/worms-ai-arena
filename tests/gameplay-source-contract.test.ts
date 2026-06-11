import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function spriteBlock(source: string, spriteName: string): string {
  const match = source.match(new RegExp(`${spriteName}: \\{([\\s\\S]*?)\\n\\s*\\},`));
  expect(match, `missing sprite definition ${spriteName}`).toBeTruthy();
  return match![1];
}

function pngHasTransparentPixels(relativePath: string): boolean {
  const png = PNG.sync.read(fs.readFileSync(path.join(root, relativePath)));
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] === 0) {
      return true;
    }
  }
  return false;
}

describe("gameplay source contracts", () => {
  it("keeps shotgun and minigun firing sprites aligned to the current aim frame", () => {
    const sprites = readSource("src/animation/SpriteDefinitions.ts");

    expect(spriteBlock(sprites, "shotgunFireAnimation1")).toContain("frameY: 32/2");
    expect(spriteBlock(sprites, "shotgunFirePump")).toContain("frameY: 32/2");
    expect(spriteBlock(sprites, "minigunFire")).toContain("frameY: 32/2");
  });

  it("calculates explosion damage from exact physics positions, not floored meter coordinates", () => {
    const effects = readSource("src/animation/Effects.ts");

    expect(effects).toContain("Physics.metersToPixels(epicenter.x)");
    expect(effects).toContain("Physics.metersToPixels(epicenter.y)");
    expect(effects).not.toContain("Physics.metersToPixels(Math.floor(epicenter.x))");
    expect(effects).not.toContain("Physics.metersToPixels(Math.floor(epicenter.y))");
    expect(effects).not.toContain("direction.x = Math.floor(direction.x)");
    expect(effects).not.toContain("direction.y = Math.floor(direction.y)");
  });

  it("does not invoke worm hit side effects for zero-damage explosion overlaps", () => {
    const effects = readSource("src/animation/Effects.ts");

    expect(effects).toContain("var damage = maxDamage * distanceFromEpicenter");
    expect(effects).toContain("if (damage > 0)");
    expect(effects).toContain("worm.hit(damage, entityThatCausedExplosion)");
    expect(effects).not.toContain("worm.hit(maxDamage * distanceFromEpicenter, entityThatCausedExplosion)");
  });

  it("ray weapons ignore the firing worm body and apply direct worm-hit damage", () => {
    const physics = readSource("src/system/Physics.ts");
    const rayWeapon = readSource("src/weapons/RayWeapon.ts");
    const shotgun = readSource("src/weapons/Shotgun.ts");
    const minigun = readSource("src/weapons/Minigun.ts");

    expect(physics).toContain("shotRayWithFixture");
    expect(physics).toContain("ignoredBody");
    expect(rayWeapon).toContain("return this.getIsActive()");
    expect(rayWeapon).not.toContain("this.ammo != 0");
    expect(shotgun).toContain("Physics.shotRayWithFixture");
    expect(shotgun).toContain("this.worm.getRayOrigin()");
    expect(shotgun).toContain("hitWorm.hit(this.damgeToWorm, this.worm)");
    expect(minigun).toContain("Physics.shotRayWithFixture");
    expect(minigun).toContain("this.worm.getRayOrigin()");
    expect(minigun).toContain("hitWorm.hit(this.damgeToWorm, this.worm)");
  });

  it("uses milliseconds consistently for fuse timers and countdown displays", () => {
    const timer = readSource("src/system/Timer.ts");
    const throwable = readSource("src/weapons/ThrowableWeapon.ts");
    const holyGrenade = readSource("src/weapons/HolyGrenade.ts");

    expect(timer).toContain("return (this.timePeriod - this.delta) / 1000");
    expect(timer).toContain("this.accumulatedTime += elapsed");
    expect(throwable).toContain("Math.ceil(this.detonationTimer.getTimeLeftInSec())");
    expect(throwable).not.toContain("this.detonationTimer.getTimeLeftInSec() / 10");
    expect(holyGrenade).toContain("this.detonationTimer.getTimeLeftInSec() <= 2");
    expect(holyGrenade).not.toContain("this.detonationTimer.getTimeLeftInSec()/10 <= 2");
  });

  it("prevents active weapons from firing with zero ammo or decrementing into negative ammo", () => {
    const baseWeapon = readSource("src/weapons/BaseWeapon.ts");
    const shotgun = readSource("src/weapons/Shotgun.ts");
    const minigun = readSource("src/weapons/Minigun.ts");
    const drill = readSource("src/weapons/Drill.ts");
    const jetpack = readSource("src/weapons/JetPack.ts");

    expect(baseWeapon).toContain("if (this.ammo <= 0)");
    expect(baseWeapon).toContain("if (this.getIsActive())");
    expect(baseWeapon).toContain("return false");
    expect(baseWeapon).toContain("return true");
    expect(shotgun).toContain("if (super.activate(worm) == false)");
    expect(minigun).toContain("if (super.activate(worm) == false)");
    expect(drill).toContain("if (super.activate(worm) == false)");
    expect(jetpack).toContain("if (super.activate(worm) == false)");
  });

  it("excludes weapon bodies from worm impact damage checks", () => {
    const worm = readSource("src/Worm.ts");

    expect(worm).toContain("contact.GetFixtureA().GetBody().GetUserData() instanceof BaseWeapon");
    expect(worm).toContain("contact.GetFixtureB().GetBody().GetUserData() instanceof BaseWeapon");
    expect(worm).not.toContain("contact.GetFixtureA() instanceof BaseWeapon");
    expect(worm).not.toContain("contact.GetFixtureB() instanceof BaseWeapon");
  });

  it("cleans up active non-projectile tools when their owner is dead", () => {
    const worm = readSource("src/Worm.ts");
    const deadBranch = worm.slice(worm.indexOf("orphanWeapon"));

    expect(deadBranch).toContain("orphanWeapon.deactivate()");
    expect(deadBranch).toContain("orphanWeapon.worm == this");
    expect(deadBranch).toContain("instanceof ThrowableWeapon");
    expect(deadBranch).toContain("instanceof ProjectileWeapon");
  });

  it("does not cancel live grenades or rockets when their owner drowns", () => {
    const wormManager = readSource("src/WormManager.ts");
    const drowningBranch = wormManager.slice(
      wormManager.indexOf("forceOutOfBoundsDeaths"),
      wormManager.indexOf("// Are all the worms stop", wormManager.indexOf("forceOutOfBoundsDeaths"))
    );

    expect(drowningBranch).toContain("weapon instanceof ThrowableWeapon");
    expect(drowningBranch).toContain("weapon instanceof ProjectileWeapon");
    expect(drowningBranch).toContain("weapon.deactivate()");
    expect(drowningBranch).toContain("== false");
  });

  it("deactivates toggle tools when switching away and checks all inventory weapons for active state", () => {
    const weaponManager = readSource("src/weapons/WeaponManager.ts");
    const wormManager = readSource("src/WormManager.ts");

    expect(weaponManager).toContain("currentWeapon.deactivate()");
    expect(weaponManager).toContain("currentWeapon instanceof JetPack");
    expect(weaponManager).toContain("currentWeapon instanceof NinjaRope");
    expect(wormManager).toContain("getListOfWeapons()");
    expect(wormManager).toContain("weapons[j].getIsActive()");
  });

  it("uses one canonical terrain water line for drawing, drowning, and projectile sinking", () => {
    const terrain = readSource("src/environment/Terrain.ts");
    const game = readSource("src/Game.ts");
    const wormManager = readSource("src/WormManager.ts");
    const throwable = readSource("src/weapons/ThrowableWeapon.ts");
    const projectile = readSource("src/weapons/ProjectileWeapon.ts");
    const settings = readSource("src/Settings.ts");

    expect(terrain).toContain("getWaterLine()");
    expect(terrain).toContain("baseWaterLine");
    expect(terrain).toContain("currentWaterLine");
    expect(terrain).toContain("updateWaterRiseForTurn");
    expect(terrain).toContain("waterRisePixelsPerTurn");
    expect(settings).toContain("DEFAULT_WATER_RISE_PIXELS_PER_TURN");
    expect(terrain).not.toContain("return this.bufferCanvas.height - 35");
    expect(game).toContain("this.terrain.getWaterLine()");
    expect(wormManager).toContain("GameInstance.terrain.getWaterLine()");
    expect(throwable).toContain("GameInstance.terrain.getWaterLine()");
    expect(projectile).toContain("GameInstance.terrain.getWaterLine()");
  });

  it("applies rising water by physical turn number and exposes settings through menu and URL", () => {
    const settings = readSource("src/Settings.ts");
    const arenaConfig = readSource("src/gui/ArenaConfig.ts");
    const mainMenu = readSource("src/gui/MainMenu.ts");
    const gameState = readSource("src/GameStateManager.ts");

    expect(settings).toContain("WATER_RISE_START_TURN");
    expect(settings).toContain("WATER_RISE_PIXELS_PER_TURN");
    expect(settings).toContain("DEFAULT_WATER_RISE_PIXELS_PER_TURN = 30");
    expect(settings).toContain("waterRiseStartTurn");
    expect(arenaConfig).toContain("waterRiseStartTurn");
    expect(arenaConfig).toContain("DEFAULT_WATER_RISE_PIXELS_PER_TURN");
    expect(mainMenu).toContain("Water starts rising on turn");
    expect(mainMenu).toContain("The rise amount is automatic");
    expect(mainMenu).not.toContain("Rise per turn (px)");
    expect(mainMenu).not.toContain("waterStepInput");
    expect(gameState).toContain("updateWaterRiseForTurn(this.physicalTurnSerial)");
  });

  it("keeps AI absolute aim, raycast origin, and vision overlay visually synchronized", () => {
    const worm = readSource("src/Worm.ts");
    const target = readSource("src/Target.ts");
    const controller = readSource("src/llm/ArenaController.ts");
    const snapshot = readSource("src/llm/ArenaSnapshot.ts");

    expect(worm).toContain("getMuzzlePosition()");
    expect(worm).toContain("getMuzzlePositionPixels()");
    expect(target).toContain("setAimDegrees(degrees)");
    expect(target).toContain("this.previousSpriteFrame = frame");
    expect(target).toContain("this.worm.setCurrentFrame(frame)");
    expect(controller).toContain("worm.target.setAimDegrees(bounded)");
    expect(snapshot).toContain("var currentMuzzle = currentWorm.getMuzzlePositionPixels()");
    expect(snapshot).toContain("aimClearanceFan(game, currentMuzzle, aimDegrees)");
    expect(snapshot).not.toContain("currentPos.y - 28");
  });

  it("does not connect separate circular terrain deformations with implicit canvas path lines", () => {
    const terrain = readSource("src/environment/Terrain.ts");

    expect(terrain).toContain("this.bufferCanvasContext.moveTo(tmp.xPos + tmp.radius, tmp.yPos)");
  });

  it("orients the missile by selecting the rotation frame for its travel direction, not a fixed spin", () => {
    const projectile = readSource("src/weapons/ProjectileWeapon.ts");

    // missile.png is a 32-frame rotation sheet: point the rocket by choosing the frame that matches
    // its velocity heading. The old code span the body at a constant rate and drew a single frame
    // rotated by the body angle, so the rocket never followed its aim/arc.
    expect(projectile).toContain("GetLinearVelocity()");
    expect(projectile).toContain("getTotalFrames()");
    expect(projectile).toContain("setCurrentFrame(frame)");
    // The constant tumble and the canvas rotation are both gone.
    expect(projectile).not.toContain("SetAngularVelocity(0.7)");
    expect(projectile).not.toContain("ctx.rotate(this.body.GetAngle())");
  });

  it("does not crash camera tracking after fragmenting weapons destroy their main body", () => {
    const player = readSource("src/Player.ts");
    const weaponCameraBlock = player.slice(player.lastIndexOf("else if", player.indexOf("weapon.body")), player.indexOf("this.team.update()"));

    expect(weaponCameraBlock).toContain("if (weapon.body)");
    expect(weaponCameraBlock).toContain("weapon.body.GetPosition()");
  });

  it("keeps newly imported weapon sheets transparent instead of drawing matte backgrounds", () => {
    for (const image of [
      "data/images/banana.png",
      "data/images/cluster.png",
      "data/images/mortar.png",
      "data/images/clustlet.png",
      "data/images/hclustlt.png",
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
      "data/images/wtellnk.png",
      "data/images/wtelbak.png",
      "data/images/wteldsv.png",
      "data/images/magichit.png"
    ]) {
      expect(pngHasTransparentPixels(image), `${image} should have transparent background pixels`).toBe(true);
    }
  });

  it("only plays the worm fall/jump animation above a real airborne speed, so a held weapon does not jitter on unstable terrain", () => {
    const anim = readSource("src/WormAnimationManger.ts");

    // A worm resting on a vine never settles to exactly 0 vy; with canJump == 0 the old `> 0` / `< 0`
    // checks flipped it between the fall and jump poses every frame, jerking the held weapon up/down.
    expect(anim).toContain("AIRBORNE_VY");
    expect(anim).toContain("GetLinearVelocity().y > AIRBORNE_VY");
    expect(anim).toContain("GetLinearVelocity().y < -AIRBORNE_VY");
    // The naive zero-threshold checks must be gone.
    expect(anim).not.toContain("GetLinearVelocity().y > 0)");
    expect(anim).not.toContain("GetLinearVelocity().y < 0)");
  });

  it("gives hitscan weapons an authoritative deactivate so a killed owner cannot deadlock the turn", () => {
    const ray = readSource("src/weapons/RayWeapon.ts");

    // Shotgun/Minigun otherwise clear isActive only inside a post-fire setTimeout in update(); if the
    // owner dies first, update() stops, isActive stays true forever and areAllWeaponsDeactived() never
    // becomes true. RayWeapon.deactivate() must authoritatively clear the active state.
    expect(ray).toContain("deactivate()");
    expect(ray).toContain("this.setIsActive(false)");
  });

  it("releases a dying worm's active non-throwable weapon before the death animation", () => {
    const anim = readSource("src/WormAnimationManger.ts");

    // A Drill locks the worm sprite (blocking the death callback -> orphaned attention semaphore) and a
    // Shotgun/Minigun keeps isActive true; either deadlocks the match. The death block must deactivate
    // the active non-throwable/projectile weapon first. Throwables/projectiles are intentionally left
    // for Worm.update()'s orphan handler to detonate.
    const deathBlock = anim.slice(anim.indexOf("dyingWeapon"));
    expect(anim).toContain("dyingWeapon");
    expect(deathBlock).toContain("getIsActive()");
    expect(deathBlock).toContain("instanceof ThrowableWeapon");
    expect(deathBlock).toContain("instanceof ProjectileWeapon");
    expect(deathBlock).toContain("dyingWeapon.deactivate()");
  });

  it("snaps a worm to the static aim pose when aiming so the held weapon follows the crosshair", () => {
    const target = readSource("src/Target.ts");

    // While the slow take-out animation is still playing it has fewer frames (so the aim frame is
    // clamped wrong) and keeps advancing (so the held weapon sweeps on its own, pointing at the
    // ground instead of the crosshair). setAimDegrees must switch to the aim sheet, set the frame,
    // and freeze it (finished = true) so the weapon tracks the aim.
    const aimBlock = target.slice(target.indexOf("setAimDegrees"));
    expect(aimBlock).toContain("getCurrentWeapon().takeAimAnimations");
    expect(aimBlock).toContain("setSpriteDef(aimSprite)");
    expect(aimBlock).toContain("this.worm.finished = true");
  });
});
