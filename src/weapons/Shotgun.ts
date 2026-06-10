/**
 *  Shotgun.js
 *
 *  License: Apache 2.0
 *  author:  Ciaran McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="../system/Graphics.ts"/>
///<reference path="../system/AssetManager.ts"/>
///<reference path="../system/Physics.ts"/>
///<reference path="../environment/Terrain.ts"/>
///<reference path="BaseWeapon.ts"/>
///<reference path="../Game.ts"/>
///<reference path="../Main.ts"/>
///<reference path="../animation/Sprite.ts"/>
///<reference path="../animation/Effects.ts"/>

class Shotgun extends RayWeapon
{
    fireAnimations: SpriteDefinition[];
    fireAnimationIndex: number;
    animationSheetChangeTimer: Timer;
    shotsTaken;
    lastShotWorm;

    constructor(ammo)
    {
        super(
            "Shotgun",
            ammo,
            Sprites.weaponIcons.shotgun,
            Sprites.worms.shotgunTakeOut,
            Sprites.worms.aimingShotgun
       )

        //Collection of three sprite sheets which
        // we will switch between to create the fire animation
        this.fireAnimations = [Sprites.worms.shotgunFirePump, Sprites.worms.aimingShotgun, Sprites.worms.shotgunFireAnimation1];
        this.fireAnimationIndex = 0;

        //Amount of the terrain to cut out
        this.damageToTerrainRadius = 30; //px

        //Health removed from worm when shot hits
        this.damgeToWorm = 30;

        this.forceScaler = 40;

        this.animationSheetChangeTimer = new Timer(300);

        this.shotsTaken = 0;

    }


    activate(worm: Worm)
    {
        if (this.getIsActive() == false)
        {
            if (super.activate(worm) == false)
            {
                return false;
            }

            this.animationSheetChangeTimer.reset();
            this.fireAnimationIndex = 0;
            AssetManager.getSound("SHOTGUNRELOAD").play(1, 0.3);
            // shotsTaken counts the barrels fired this worm-turn (2 barrels = turn ends). The single
            // Shotgun instance is shared for the whole match, so reset the count whenever a different
            // worm picks it up - otherwise a leftover count from a turn that ended after one shot
            // makes the next worm fire a single barrel and end its turn early.
            if (this.lastShotWorm !== worm)
            {
                this.shotsTaken = 0;
            }
            this.lastShotWorm = worm;
            this.shotsTaken++;
            return true;
        }

        return false;
    }

    deactivate()
    {
        super.deactivate();
        this.animationSheetChangeTimer.pause();
        this.fireAnimationIndex = 0;
        this.shotsTaken = 0;
    }

    update()
    {
        if (super.update())
        {
            this.animationSheetChangeTimer.update();

            if (this.animationSheetChangeTimer.hasTimePeriodPassed())
            {             
                this.worm.swapSpriteSheet(this.fireAnimations[this.fireAnimationIndex]);
                this.fireAnimationIndex++;
            }


            if (this.fireAnimationIndex >= this.fireAnimations.length)
            {
                var rayHit = Physics.shotRayWithFixture(this.worm.getMuzzlePosition(), this.worm.target.getTargetDirection().Copy(), this.worm.body);
                if (rayHit)
                {
                    var hitWorm = rayHit.body.GetUserData();
                    var explosionDamage = this.damgeToWorm;
                    if (hitWorm instanceof Worm)
                    {
                        hitWorm.hit(this.damgeToWorm, this.worm);
                        explosionDamage = 0;
                    }

                    Effects.explosion(rayHit.point,
                        this.damageToTerrainRadius,
                        1,
                        this.forceScaler,
                        explosionDamage,
                        this.worm,
                        AssetManager.getSound("ShotGunFire"));
                } else
                {
                    //Even if we miss the shot make a sound
                    AssetManager.getSound("ShotGunFire").play();
                }
                this.animationSheetChangeTimer.pause();
                this.fireAnimationIndex = 0;

                setTimeout(() => {
                    // If the worm already died (and the weapon was deactivated by the death sequence),
                    // do not touch the corpse's sprite or fire a spurious turn change.
                    if (this.getIsActive() == false)
                    {
                        return;
                    }
                    this.setIsActive(false);
                    this.worm.swapSpriteSheet(this.fireAnimations[this.fireAnimationIndex]);

                    if (this.shotsTaken >= 2)
                    {
                        this.shotsTaken = 0;
                        GameInstance.state.tiggerNextTurn();
                    }

                }, 400);


            }

        }



    }
}
