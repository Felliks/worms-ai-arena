/**
 * Blowtorch.js
 *
 * Directional terrain cutter with light contact damage, modelled after the
 * Worms Armageddon utility without adding new agent primitives.
 */
///<reference path="../system/Physics.ts"/>
///<reference path="../system/Utilies.ts" />
///<reference path="../Worm.ts" />
///<reference path="../animation/Sprite.ts"/>
///<reference path="../system/Timer.ts"/>
///<reference path="../Game.ts"/>
///<reference path="../Main.ts"/>
///<reference path="../llm/ArenaTelemetry.ts"/>
///<reference path="BaseWeapon.ts"/>

class Blowtorch extends BaseWeapon
{
    useDurationTimer: Timer;
    tickTimer: Timer;
    rangePx: number;
    damage: number;
    hitCooldownMs: number;
    lastHitAt;

    constructor(ammo)
    {
        super(
            "Blowtorch",
            ammo,
            Sprites.weaponIcons.blowTorch,
            Sprites.worms.takeOutBlowtorch,
            Sprites.worms.blowtorching
        );

        this.useDurationTimer = new Timer(4300);
        this.tickTimer = new Timer(220);
        this.rangePx = 145;
        this.damage = 15;
        this.hitCooldownMs = 900;
        this.lastHitAt = {};
    }

    activate(worm: Worm)
    {
        if (super.activate(worm) == false)
        {
            return false;
        }
        this.useDurationTimer.reset();
        this.tickTimer.reset();
        this.lastHitAt = {};
        this.worm.setSpriteDef(this.takeAimAnimations, true, false);
        if (typeof ArenaTelemetry != "undefined")
        {
            ArenaTelemetry.addNote("Blowtorch started: directional tunnel, 15 damage per contact tick, ends turn after the burn.");
        }
        return true;
    }

    deactivate()
    {
        this.setIsActive(false);
        if (this.worm && this.worm.isDead == false)
        {
            this.worm.setSpriteDef(this.takeAimAnimations, false);
            this.worm.setSpriteDef(Sprites.worms.idle1, false);
        }
    }

    torchDirection()
    {
        var dir = this.worm.target.getTargetDirection().Copy();
        dir.Normalize();
        return dir;
    }

    carve(originPx, direction)
    {
        for (var d = 18; d <= this.rangePx; d += 18)
        {
            GameInstance.terrain.addToDeformBatch(originPx.x + direction.x * d, originPx.y + direction.y * d, 17);
        }
    }

    applyContactDamage(origin, direction)
    {
        var hit = Physics.shotRayWithFixture(origin, direction.Copy(), this.worm.body);
        if (!hit)
        {
            return;
        }

        var dx = Physics.metersToPixels(hit.point.x - origin.x);
        var dy = Physics.metersToPixels(hit.point.y - origin.y);
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > this.rangePx)
        {
            return;
        }

        var hitWorm = hit.body.GetUserData();
        if (hitWorm instanceof Worm)
        {
            var now = Date.now();
            var last = this.lastHitAt[hitWorm.name] || 0;
            if (now - last >= this.hitCooldownMs)
            {
                this.lastHitAt[hitWorm.name] = now;
                hitWorm.hit(this.damage, this.worm);
                var force = direction.Copy();
                force.Multiply(8);
                hitWorm.body.ApplyImpulse(force, hitWorm.body.GetPosition());
                if (typeof ArenaTelemetry != "undefined")
                {
                    ArenaTelemetry.addNote("Blowtorch hit `" + hitWorm.name + "` for 15 damage at " + Math.round(distance) + " px.");
                }
            }
        }
    }

    finishUse()
    {
        if (this.getIsActive() == false)
        {
            return;
        }
        this.deactivate();
        GameInstance.state.tiggerNextTurn();
    }

    update()
    {
        if (this.getIsActive())
        {
            this.useDurationTimer.update();
            this.tickTimer.update();
            AssetManager.getSound("drill").play();

            if (this.tickTimer.hasTimePeriodPassed())
            {
                var origin = this.worm.getRayOrigin();
                var originPx = Physics.vectorMetersToPixels(origin.Copy());
                var direction = this.torchDirection();
                this.carve(originPx, direction);
                this.applyContactDamage(origin, direction);
            }

            if (this.useDurationTimer.hasTimePeriodPassed(false))
            {
                this.finishUse();
            }
        }
    }
}
