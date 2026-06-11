///<reference path="../system/Physics.ts"/>
///<reference path="../system/AssetManager.ts"/>
///<reference path="../Worm.ts"/>
///<reference path="../Game.ts"/>
///<reference path="../Main.ts"/>
///<reference path="../llm/ArenaTelemetry.ts"/>
///<reference path="BaseWeapon.ts"/>

class MeleeWeapon extends BaseWeapon
{
    attackAnimation: SpriteDefinition;
    rangePx: number;
    damage: number;
    impulseScale: number;
    verticalImpulse: number;
    mode: string;
    terrainCarve: string;

    constructor(name, ammo, iconSpriteDef, takeOutAnimation: SpriteDefinition, aimAnimation: SpriteDefinition, attackAnimation: SpriteDefinition)
    {
        super(name, ammo, iconSpriteDef, takeOutAnimation, aimAnimation);

        this.attackAnimation = attackAnimation;
        this.rangePx = 70;
        this.damage = 30;
        this.impulseScale = 30;
        this.verticalImpulse = -6;
        this.mode = "aim";
        this.terrainCarve = "none";
    }

    activate(worm: Worm)
    {
        if (super.activate(worm) == false)
        {
            return false;
        }

        this.worm.setSpriteDef(this.attackAnimation, true, true);
        this.performAttack();
        setTimeout(() =>
        {
            if (this.getIsActive() == false)
            {
                return;
            }
            this.deactivate();
            GameInstance.state.tiggerNextTurn();
        }, 450);
        return true;
    }

    deactivate()
    {
        this.setIsActive(false);
        if (this.worm && this.worm.isDead == false)
        {
            this.worm.setSpriteDef(this.attackAnimation, false);
            this.worm.swapSpriteSheet(this.takeAimAnimations);
        }
    }

    attackDirection()
    {
        if (this.mode == "up")
        {
            return new b2Vec2(0, -1);
        }
        if (this.mode == "horizontal")
        {
            return new b2Vec2(this.worm.direction, 0);
        }
        return this.worm.target.getTargetDirection().Copy();
    }

    carveTerrain(originPx, direction)
    {
        if (this.terrainCarve == "vertical")
        {
            GameInstance.terrain.addRectToDeformBatch(originPx.x, originPx.y - 120, 34, 125);
            return;
        }
        if (this.terrainCarve == "line")
        {
            for (var d = 24; d <= this.rangePx; d += 24)
            {
                GameInstance.terrain.addToDeformBatch(originPx.x + direction.x * d, originPx.y + direction.y * d, 16);
            }
        }
    }

    performAttack()
    {
        var origin = this.worm.getRayOrigin();
        var originPx = Physics.vectorMetersToPixels(origin.Copy());
        var direction = this.attackDirection();
        direction.Normalize();
        this.carveTerrain(originPx, direction);

        var hit = Physics.shotRayWithFixture(origin, direction.Copy(), this.worm.body);
        if (!hit)
        {
            if (typeof ArenaTelemetry != "undefined")
            {
                ArenaTelemetry.addNote(this.name + " missed: no worm or terrain in the short attack lane.");
            }
            return;
        }

        var dx = Physics.metersToPixels(hit.point.x - origin.x);
        var dy = Physics.metersToPixels(hit.point.y - origin.y);
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > this.rangePx)
        {
            if (typeof ArenaTelemetry != "undefined")
            {
                ArenaTelemetry.addNote(this.name + " missed: first hit was " + Math.round(distance) + " px away, beyond its " + this.rangePx + " px range.");
            }
            return;
        }

        var hitWorm = hit.body.GetUserData();
        if (hitWorm instanceof Worm)
        {
            if (this.damage > 0)
            {
                hitWorm.hit(this.damage, this.worm);
            }
            var force = direction.Copy();
            force.Multiply(this.impulseScale);
            force.y += this.verticalImpulse;
            hitWorm.body.ApplyImpulse(force, hitWorm.body.GetPosition());
            if (typeof ArenaTelemetry != "undefined")
            {
                ArenaTelemetry.addNote(this.name + " hit `" + hitWorm.name + "` at " + Math.round(distance) + " px for " + this.damage + " damage plus shove/fall risk.");
            }
            return;
        }

        if (typeof ArenaTelemetry != "undefined")
        {
            ArenaTelemetry.addNote(this.name + " struck terrain at " + Math.round(distance) + " px.");
        }
    }
}

class BaseballBat extends MeleeWeapon
{
    constructor(ammo)
    {
        super(
            "Baseball Bat",
            ammo,
            Sprites.weaponIcons.baseballBat,
            Sprites.worms.takeNinjaRope,
            Sprites.worms.aimNinjaRope,
            Sprites.worms.baseballBatFire
        );

        this.rangePx = 86;
        this.damage = 30;
        this.impulseScale = 46;
        this.verticalImpulse = -10;
        this.mode = "aim";
    }
}

class Prod extends MeleeWeapon
{
    constructor(ammo)
    {
        super(
            "Prod",
            ammo,
            Sprites.weaponIcons.prod,
            Sprites.worms.prod,
            Sprites.worms.prod,
            Sprites.worms.prod
        );

        this.rangePx = 48;
        this.damage = 0;
        this.impulseScale = 18;
        this.verticalImpulse = -2;
        this.mode = "horizontal";
    }
}

class FirePunch extends MeleeWeapon
{
    constructor(ammo)
    {
        super(
            "Fire Punch",
            ammo,
            Sprites.weaponIcons.firePunch,
            Sprites.worms.firePunch,
            Sprites.worms.firePunch,
            Sprites.worms.firePunch
        );

        this.rangePx = 118;
        this.damage = 30;
        this.impulseScale = 34;
        this.verticalImpulse = -35;
        this.mode = "up";
        this.terrainCarve = "vertical";
    }
}

class DragonBall extends MeleeWeapon
{
    constructor(ammo)
    {
        super(
            "Dragon Ball",
            ammo,
            Sprites.weaponIcons.dragonBall,
            Sprites.worms.dragonBall,
            Sprites.worms.dragonBall,
            Sprites.worms.dragonBall
        );

        this.rangePx = 165;
        this.damage = 30;
        this.impulseScale = 42;
        this.verticalImpulse = -5;
        this.mode = "horizontal";
        this.terrainCarve = "line";
    }
}
