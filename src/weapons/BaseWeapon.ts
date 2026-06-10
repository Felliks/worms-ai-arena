///<reference path="../Settings.ts" />
///<reference path="../animation/SpriteDefinitions.ts" />
///<reference path="../system/AssetManager.ts" />
///<reference path="ForceIndicator.ts" />

class BaseWeapon
{
    ammo;
    name;
    iconImage;
    isActive;
    worm: Worm;
    takeOutAnimations: SpriteDefinition;
    takeAimAnimations: SpriteDefinition;
    forceIndicator: ForceIndicator;

    requiresAiming: bool;

    constructor(name: string, ammo: number, iconSprite, takeOutAnimation: SpriteDefinition, takeAimAnimation: SpriteDefinition)
    {
        this.name = name;
        this.ammo = ammo;

        this.takeOutAnimations = takeOutAnimation;
        this.takeAimAnimations = takeAimAnimation;
        //Setup the icon used in the weapon menu
        this.iconImage = AssetManager.getImage(iconSprite.imageName);

        this.requiresAiming = true;

        this.setIsActive(false);

        this.forceIndicator = new ForceIndicator(0);
    }

    getForceIndicator()
    {
        return this.forceIndicator;
    }

    getIsActive() { return this.isActive; }
    setIsActive(val) { this.isActive = val; }

    deactivate()
    {
    
    }

    activate(worm)
    {
        if (this.getIsActive())
        {
            return false;
        }

        if (this.ammo <= 0)
        {
            AssetManager.getSound("cantclickhere").play();
            return false;
        }

        this.setIsActive(true);
        this.ammo--;
        this.worm = worm;

        Logger.debug(this.name + " was activated ");
        return true;

    }

    update() { }
    draw(ctx) { }
}
