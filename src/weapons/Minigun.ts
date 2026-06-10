/**
 *  Minigun.js
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

class Minigun extends RayWeapon
{
    fireRate: Timer;

    constructor(ammo)
    {
        super(
            "Minigun",
            ammo,
            Sprites.weaponIcons.minigun,
            Sprites.worms.minigunTakeOut,
            Sprites.worms.minigunAim
       )


        //Amount of the terrain to cut out
        this.damageToTerrainRadius = 30; //px

        //Health removed from worm when shot hits
        this.damgeToWorm = 30;

        this.forceScaler = 30;

        this.fireRate = new Timer(300);
    }


    activate(worm: Worm)
    {
        if (super.activate(worm) == false)
        {
            return false;
        }
        this.worm.swapSpriteSheet(Sprites.worms.minigunFire);

        //Setup a timer, to stop the weapon firing after so many secounds
        setTimeout(() => {

                // If the owner already died and the death sequence deactivated the weapon, do not
                // re-pose the corpse or fire a spurious next turn.
                if (this.getIsActive() == false)
                {
                    return;
                }

                //Once finished firing, deactive weapon and singal next turn
                this.setIsActive(false);
                GameInstance.state.tiggerNextTurn();

                this.worm.swapSpriteSheet(this.takeAimAnimations);
        }, 1000);
        AssetManager.getSound("MiniGunFire").play();
        return true;
    }

    update()
    {

        if (super.update())
        {
            this.fireRate.update();       

            if (this.fireRate.hasTimePeriodPassed())
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
                       null);
                }
            }
          

        }

    }

}

