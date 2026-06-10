/**
 * RayBased Weapons.js
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
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

class RayWeapon extends BaseWeapon
{
    damageToTerrainRadius: number;
    damgeToWorm: number;
    forceScaler: number;

    constructor(name, ammo, iconSpriteDef, takeOutAnimation: SpriteDefinition, takeAimAnimation: SpriteDefinition)
    {
        super(
            name,
            ammo,
          iconSpriteDef,
          takeOutAnimation,
          takeAimAnimation
        );

        //Amount of the terrain to cut out
        this.damageToTerrainRadius = 30; //px

        //Health removed from worm when shot hits
        this.damgeToWorm = 10;

 
    }

    update()
    {
        super.update();
        return this.getIsActive();
    }

    // Authoritative cleanup. Hitscan weapons (Shotgun/Minigun) otherwise clear isActive only deep
    // inside a post-fire setTimeout in update(); if the owner worm dies before that fires, update()
    // stops running and isActive stays true forever, so areAllWeaponsDeactived() never becomes true
    // and the match deadlocks. Whatever deactivates the weapon (death sequence, turn-timer expiry,
    // weapon switch) now reliably clears the active state here.
    deactivate()
    {
        this.setIsActive(false);
        if (this.worm && this.worm.isDead == false)
        {
            this.worm.swapSpriteSheet(this.takeAimAnimations);
        }
        super.deactivate();
    }

}
