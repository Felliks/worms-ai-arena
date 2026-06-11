/**
 * ProjectileWeapon
 * Projectiles explode when they collide with the terrain.
 * thats the main different between them and throwable weapons
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="../system/Graphics.ts"/>
///<reference path="../system/AssetManager.ts"/>
///<reference path="../system/Physics.ts"/>
///<reference path="BaseWeapon.ts"/>

class ProjectileWeapon extends BaseWeapon
{

    body;
    fixture;
    image;
    listener;
    terrainRef;
    effectedRadius;
    explosiveForce;
    explosionRadius;
    isLive;
    maxDamage: number;

    projectileSprite: Sprite;

    constructor (name : string, ammo : number, iconSpriteDef, weaponSpriteDef: SpriteDefinition, takeOutAnimation: SpriteDefinition, takeAimAnimation: SpriteDefinition)
    {
        super(
            name,
            ammo,
          iconSpriteDef,
          takeOutAnimation,
          takeAimAnimation
        );


        this.projectileSprite = new Sprite(weaponSpriteDef);

        // Force/worm damge radius
        this.effectedRadius = Physics.pixelToMeters(60);

        // The area in pxiels that get cut out of the terrain
        this.explosionRadius = 70;

        // force scaler
        this.explosiveForce = 60

        this.maxDamage = 50;

        //Max force this weapon can be thrown with
        this.forceIndicator.setMaxForce(120);


    }

    //Gets the direction of aim from the target and inital velocity
    // The creates the box2d physics body at that pos with that inital v
    setupDirectionAndForce(worm: Worm)
    {
        var initalVelocity = worm.target.getTargetDirection().Copy();
        initalVelocity.Multiply(1.5);

        var initalPosition = worm.body.GetPosition();
        initalPosition.Add(initalVelocity);

        initalVelocity = worm.target.getTargetDirection().Copy();
        initalVelocity.Multiply(this.forceIndicator.getForce());

        this.setupPhysicsBodies(initalPosition, initalVelocity);

    }

     setupPhysicsBodies(initalPosition, initalVelocity)
     {

        // Setup of physical body
        var image = this.projectileSprite.getImage();

        var fixDef = new b2FixtureDef;
        fixDef.density = 50.0;
        fixDef.friction = 3.5;
        fixDef.restitution = 0.6
        fixDef.shape = new b2CircleShape((image.width / 4) / Physics.worldScale);

        var bodyDef = new b2BodyDef;
        bodyDef.type = b2Body.b2_dynamicBody;
        bodyDef.position = initalPosition;
        bodyDef.angle = Utilies.vectorToAngle(initalVelocity);

        this.fixture = Physics.world.CreateBody(bodyDef).CreateFixture(fixDef);
        this.body = this.fixture.GetBody();
        this.body.ApplyImpulse(initalVelocity,this.body.GetPosition());

        // No constant spin: the missile sprite is a 32-frame rotation sheet and
        // draw() orients it by selecting the frame that matches its travel
        // direction. The old fixed angular velocity made the rocket tumble
        // instead of following its aim/arc.
        this.body.SetUserData(this);

        Physics.addToFastAcessList(this.body);
    }

    beginContact(contact)
    {
        if (this.isActive && this.isLive)
        {
            GameInstance.state.tiggerNextTurn();
            var animation : ParticleEffect = Effects.explosion(
                this.body.GetPosition(),
                this.explosionRadius,
                this.effectedRadius,
                this.explosiveForce,
                this.maxDamage,
                this.worm
           );
             
            this.deactivate();
        }

    }

    deactivate()
    {
        super.deactivate();
        Logger.debug(this.name + " was deactivated ");
       // Set this object to dead so it can be cleaned up       
       this.isLive = false;
    }

    activate(worm: Worm)
    {
        //FIXME: Hack some how activate gets called on the opisite team if they used a bazzoka before hand.
        // doesnt happen for any other weapon, very strange. This is a temp fix. Investage later
        if (GameInstance.state.getCurrentPlayer().getTeam().getCurrentWorm() == worm && this.ammo > 0 && this.getIsActive() == false)
        {
            this.isLive = true;
            super.activate(worm);
            this.setupDirectionAndForce(worm);
        }
    }


    update()
    {
        // Water sinks the projectile instead of detonating on the underwater floor.
        if (this.isActive && this.isLive && this.body
            && typeof GameInstance != "undefined" && GameInstance.terrain
            && Physics.metersToPixels(this.body.GetPosition().y) > GameInstance.terrain.getWaterLine())
        {
            GameInstance.state.tiggerNextTurn();
            this.isLive = false;
        }

        if (!this.isLive &&  this.isActive)
        {
            //The bomb has exploded (or sunk) so remove it from the world
            Physics.removeToFastAcessList(this.body);
            Physics.world.DestroyBody(this.body);
            this.isActive = false;
        }
    }

    draw(ctx)
    {
        if (this.isActive && this.isLive)
        {
            // missile.png is 32 frames of the rocket pre-rendered around a full
            // circle. Point it along its travel direction by SELECTING the matching
            // frame (the same technique the worm aim sprites use) instead of rotating
            // the canvas - that keeps the nose following the aim/arc. Empirically the
            // sheet advances 360/32 deg per frame with frame 0 at about -69 deg, so
            //   frame = round((travelAngleDeg + 69) * 32 / 360)  (wrapped to 0..31).
            var v = this.body.GetLinearVelocity();
            var total = this.projectileSprite.getTotalFrames();
            if (v.x * v.x + v.y * v.y > 0.0001)
            {
                var angleDeg = Math.atan2(v.y, v.x) * 180 / Math.PI;
                var frame = Math.round((angleDeg + 69) * total / 360);
                frame = ((frame % total) + total) % total;
                this.projectileSprite.setCurrentFrame(frame);
            }

            ctx.save()

            ctx.translate(
            this.body.GetPosition().x * Physics.worldScale,
            this.body.GetPosition().y * Physics.worldScale
            )

            this.projectileSprite.draw(ctx,
            -this.projectileSprite.getFrameWidth() / 2,
            -this.projectileSprite.getFrameHeight() / 2
            );

            ctx.restore()
        }
    }

}

class FragmentingProjectileWeapon extends ProjectileWeapon
{
    fragmentSpriteDef: SpriteDefinition;
    fragmentCount: number;
    fragmentFuseMs: number;
    fragmentSpeed: number;
    fragmentExplosionRadius: number;
    fragmentEffectedRadius;
    fragmentExplosiveForce: number;
    fragmentMaxDamage: number;
    fragments;
    turnTriggered: bool;

    constructor(name : string, ammo : number, iconSpriteDef, weaponSpriteDef: SpriteDefinition, fragmentSpriteDef: SpriteDefinition, takeOutAnimation: SpriteDefinition, takeAimAnimation: SpriteDefinition)
    {
        super(name, ammo, iconSpriteDef, weaponSpriteDef, takeOutAnimation, takeAimAnimation);

        this.fragmentSpriteDef = fragmentSpriteDef;
        this.fragmentCount = 6;
        this.fragmentFuseMs = 1400;
        this.fragmentSpeed = 12;
        this.fragmentExplosionRadius = 32;
        this.fragmentEffectedRadius = Physics.pixelToMeters(85);
        this.fragmentExplosiveForce = 42;
        this.fragmentMaxDamage = 20;
        this.fragments = [];
        this.turnTriggered = false;
    }

    activate(worm: Worm)
    {
        this.turnTriggered = false;
        this.fragments = [];
        super.activate(worm);
    }

    deactivate()
    {
        this.cleanupFragments();
        super.deactivate();
    }

    cleanupFragments()
    {
        if (!this.fragments)
        {
            return;
        }
        for (var i = this.fragments.length - 1; i >= 0; i--)
        {
            this.removeFragment(i);
        }
    }

    beginContact(contact)
    {
        if (this.fragments && this.fragments.length > 0)
        {
            var index = this.findFragmentIndexForContact(contact);
            if (index >= 0)
            {
                this.fragments[index].detonate = true;
            }
            return;
        }

        if (this.isActive && this.isLive)
        {
            var origin = this.body.GetPosition().Copy();
            var inheritedVelocity = this.body.GetLinearVelocity().Copy();
            Effects.explosion(
                origin,
                this.explosionRadius,
                this.effectedRadius,
                this.explosiveForce,
                this.maxDamage,
                this.worm
            );
            this.spawnFragments(origin, inheritedVelocity);
            this.isLive = false;
        }
    }

    spawnFragments(origin, inheritedVelocity)
    {
        var first = -165;
        var step = this.fragmentCount > 1 ? 150 / (this.fragmentCount - 1) : 0;
        for (var i = 0; i < this.fragmentCount; i++)
        {
            var deg = first + (step * i);
            var rad = deg * Math.PI / 180;
            var velocity = new b2Vec2(
                Math.cos(rad) * this.fragmentSpeed + inheritedVelocity.x * 0.20,
                Math.sin(rad) * this.fragmentSpeed + inheritedVelocity.y * 0.10
            );
            this.fragments.push(this.createFragment(origin.Copy(), velocity));
        }
    }

    createFragment(origin, velocity)
    {
        var sprite = new Sprite(this.fragmentSpriteDef);
        var image = sprite.getImage();

        var fixDef = new b2FixtureDef;
        fixDef.density = 45.0;
        fixDef.friction = 3.0;
        fixDef.restitution = 0.45;
        fixDef.shape = new b2CircleShape((image.width / 5) / Physics.worldScale);

        var bodyDef = new b2BodyDef;
        bodyDef.type = b2Body.b2_dynamicBody;
        bodyDef.position = origin;
        bodyDef.angle = Utilies.vectorToAngle(velocity);

        var fixture = Physics.world.CreateBody(bodyDef).CreateFixture(fixDef);
        var body = fixture.GetBody();
        body.SetLinearVelocity(velocity);
        body.SetUserData(this);
        Physics.addToFastAcessList(body);

        return {
            body: body,
            sprite: sprite,
            timer: new Timer(this.fragmentFuseMs),
            detonate: false
        };
    }

    findFragmentIndexForContact(contact)
    {
        var a = contact.GetFixtureA().GetBody();
        var b = contact.GetFixtureB().GetBody();
        for (var i = 0; i < this.fragments.length; i++)
        {
            if (this.fragments[i].body == a || this.fragments[i].body == b)
            {
                return i;
            }
        }
        return -1;
    }

    removeFragment(index)
    {
        var fragment = this.fragments[index];
        if (fragment && fragment.body)
        {
            Physics.removeToFastAcessList(fragment.body);
            Physics.world.DestroyBody(fragment.body);
        }
        Utilies.deleteFromCollection(this.fragments, index);
    }

    explodeFragment(index)
    {
        var fragment = this.fragments[index];
        if (!fragment || !fragment.body)
        {
            this.removeFragment(index);
            return;
        }

        Effects.explosion(
            fragment.body.GetPosition(),
            this.fragmentExplosionRadius,
            this.fragmentEffectedRadius,
            this.fragmentExplosiveForce,
            this.fragmentMaxDamage,
            this.worm
        );
        this.removeFragment(index);
    }

    finishIfResolved()
    {
        if (this.isActive && !this.turnTriggered && !this.isLive && !this.body && (!this.fragments || this.fragments.length == 0))
        {
            this.turnTriggered = true;
            GameInstance.state.tiggerNextTurn();
            this.isActive = false;
        }
    }

    update()
    {
        if (!this.isActive)
        {
            return;
        }

        if (this.isLive && this.body && typeof GameInstance != "undefined" && GameInstance.terrain
            && Physics.metersToPixels(this.body.GetPosition().y) > GameInstance.terrain.getWaterLine())
        {
            this.isLive = false;
        }

        if (!this.isLive && this.body)
        {
            Physics.removeToFastAcessList(this.body);
            Physics.world.DestroyBody(this.body);
            this.body = null;
            this.fixture = null;
        }

        if (this.fragments && this.fragments.length > 0)
        {
            for (var i = this.fragments.length - 1; i >= 0; i--)
            {
                var fragment = this.fragments[i];
                fragment.timer.update();
                if (fragment.detonate)
                {
                    this.explodeFragment(i);
                } else if (typeof GameInstance != "undefined" && GameInstance.terrain
                    && Physics.metersToPixels(fragment.body.GetPosition().y) > GameInstance.terrain.getWaterLine())
                {
                    this.removeFragment(i);
                } else if (fragment.timer.hasTimePeriodPassed(false))
                {
                    this.explodeFragment(i);
                }
            }
        }

        this.finishIfResolved();
    }

    drawFragments(ctx)
    {
        if (!this.fragments)
        {
            return;
        }
        for (var i = 0; i < this.fragments.length; i++)
        {
            var fragment = this.fragments[i];
            var sprite = fragment.sprite;
            var fc = sprite.getTotalFrames();
            var fr = Math.round(fragment.body.GetAngle() / (2 * Math.PI) * fc);
            sprite.setCurrentFrame(((fr % fc) + fc) % fc);

            ctx.save();
            ctx.translate(
                fragment.body.GetPosition().x * Physics.worldScale,
                fragment.body.GetPosition().y * Physics.worldScale
            );
            sprite.draw(ctx, -sprite.getFrameWidth() / 2, -sprite.getFrameHeight() / 2);
            ctx.restore();
        }
    }

    draw(ctx)
    {
        if (this.isActive && this.isLive && this.body)
        {
            super.draw(ctx);
        }
        this.drawFragments(ctx);
    }
}


class Bazzoka extends ProjectileWeapon
{

    constructor(ammo)
    {
        super(
            "Bazooka",
            ammo, 
            Sprites.weaponIcons.bazooka,
            Sprites.weapons.missle,
            Sprites.worms.takeOutBazooka,
            Sprites.worms.aimBazooka
            );
    }

}

class Mortar extends FragmentingProjectileWeapon
{

    constructor(ammo)
    {
        super(
            "Mortar",
            ammo,
            Sprites.weaponIcons.mortar,
            Sprites.weapons.mortar,
            Sprites.weapons.clusterlet,
            Sprites.worms.takeOutBazooka,
            Sprites.worms.aimBazooka
            );

        this.explosionRadius = 32;
        this.effectedRadius = Physics.pixelToMeters(85);
        this.explosiveForce = 38;
        this.maxDamage = 20;
        this.fragmentCount = 6;
        this.fragmentFuseMs = 1300;
        this.fragmentSpeed = 12;
        this.fragmentExplosionRadius = 32;
        this.fragmentEffectedRadius = Physics.pixelToMeters(85);
        this.fragmentExplosiveForce = 40;
        this.fragmentMaxDamage = 20;
    }

}
