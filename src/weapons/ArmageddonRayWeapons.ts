///<reference path="../system/Physics.ts"/>
///<reference path="../system/AssetManager.ts"/>
///<reference path="../environment/Terrain.ts"/>
///<reference path="BaseWeapon.ts"/>
///<reference path="RayWeapon.ts"/>
///<reference path="../Game.ts"/>
///<reference path="../Main.ts"/>
///<reference path="../animation/Effects.ts"/>

class TimedRayWeapon extends RayWeapon
{
    fireAnimation: SpriteDefinition;
    fireDurationTimer: Timer;
    rayIntervalTimer: Timer;
    rayCount: number;
    raysFired: number;
    soundName: string;
    terrainDamage: number;
    impulseForce: number;
    durationMs: number;

    constructor(name, ammo, iconSpriteDef, takeOutAnimation: SpriteDefinition, aimAnimation: SpriteDefinition, fireAnimation: SpriteDefinition)
    {
        super(name, ammo, iconSpriteDef, takeOutAnimation, aimAnimation);

        this.fireAnimation = fireAnimation;
        this.durationMs = 900;
        this.fireDurationTimer = new Timer(this.durationMs);
        this.rayIntervalTimer = new Timer(120);
        this.rayCount = 1;
        this.raysFired = 0;
        this.soundName = "MiniGunFire";
        this.terrainDamage = 10;
        this.impulseForce = 18;
        this.damgeToWorm = 5;
        this.damageToTerrainRadius = 12;
        this.forceScaler = 18;
    }

    activate(worm: Worm)
    {
        if (super.activate(worm) == false)
        {
            return false;
        }

        this.raysFired = 0;
        this.fireDurationTimer = new Timer(this.durationMs);
        this.rayIntervalTimer.reset();
        this.worm.swapSpriteSheet(this.fireAnimation);
        AssetManager.getSound(this.soundName).play();
        return true;
    }

    deactivate()
    {
        super.deactivate();
        this.raysFired = 0;
    }

    fireOneRay()
    {
        this.raysFired++;
        var rayHit = Physics.shotRayWithFixture(this.worm.getRayOrigin(), this.worm.target.getTargetDirection().Copy(), this.worm.body);
        if (!rayHit)
        {
            return;
        }

        var hitWorm = rayHit.body.GetUserData();
        var explosionDamage = this.terrainDamage;
        if (hitWorm instanceof Worm)
        {
            hitWorm.hit(this.damgeToWorm, this.worm);
            var force = this.worm.target.getTargetDirection().Copy();
            force.Normalize();
            force.Multiply(this.impulseForce);
            hitWorm.body.ApplyImpulse(force, hitWorm.body.GetPosition());
            explosionDamage = 0;
        }

        Effects.explosion(
            rayHit.point,
            this.damageToTerrainRadius,
            1,
            this.forceScaler,
            explosionDamage,
            this.worm,
            null
        );
    }

    finishBurst()
    {
        if (this.getIsActive() == false)
        {
            return;
        }
        this.setIsActive(false);
        GameInstance.state.tiggerNextTurn();
        this.worm.swapSpriteSheet(this.takeAimAnimations);
    }

    update()
    {
        if (super.update())
        {
            this.fireDurationTimer.update();
            this.rayIntervalTimer.update();

            if (this.raysFired == 0 || (this.raysFired < this.rayCount && this.rayIntervalTimer.hasTimePeriodPassed()))
            {
                this.fireOneRay();
            }

            if (this.raysFired >= this.rayCount || this.fireDurationTimer.hasTimePeriodPassed(false))
            {
                this.finishBurst();
            }
        }
    }
}

class Uzi extends TimedRayWeapon
{
    constructor(ammo)
    {
        super(
            "Uzi",
            ammo,
            Sprites.weaponIcons.uzi,
            Sprites.worms.uziTakeOut,
            Sprites.worms.uziAim,
            Sprites.worms.uziFire
        );

        this.rayCount = 10;
        this.durationMs = 1100;
        this.damgeToWorm = 5;
        this.damageToTerrainRadius = 12;
        this.terrainDamage = 5;
        this.forceScaler = 18;
        this.impulseForce = 10;
        this.soundName = "MiniGunFire";
    }
}

class Handgun extends TimedRayWeapon
{
    constructor(ammo)
    {
        super(
            "Handgun",
            ammo,
            Sprites.weaponIcons.handgun,
            Sprites.worms.handgunAim,
            Sprites.worms.handgunAim,
            Sprites.worms.handgunFire
        );

        this.rayCount = 6;
        this.durationMs = 900;
        this.damgeToWorm = 5;
        this.damageToTerrainRadius = 9;
        this.terrainDamage = 4;
        this.forceScaler = 12;
        this.impulseForce = 7;
        this.soundName = "ShotGunFire";
    }
}
