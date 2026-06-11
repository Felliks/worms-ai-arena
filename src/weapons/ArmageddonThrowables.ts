///<reference path="BaseWeapon.ts"/>
///<reference path="ThrowableWeapon.ts"/>

class FragmentingThrowableWeapon extends ThrowableWeapon
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

    constructor(name, ammo, iconSpriteDef, weaponSpriteDef: SpriteDefinition, fragmentSpriteDef: SpriteDefinition, takeOutAnimation: SpriteDefinition, takeAimAnimation: SpriteDefinition)
    {
        super(name, ammo, iconSpriteDef, weaponSpriteDef, takeOutAnimation, takeAimAnimation);

        this.fragmentSpriteDef = fragmentSpriteDef;
        this.fragmentCount = 5;
        this.fragmentFuseMs = 1300;
        this.fragmentSpeed = 10;
        this.fragmentExplosionRadius = 28;
        this.fragmentEffectedRadius = Physics.pixelToMeters(70);
        this.fragmentExplosiveForce = 35;
        this.fragmentMaxDamage = 15;
        this.fragments = [];
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

    detonate()
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
        Physics.removeToFastAcessList(this.body);
        Physics.world.DestroyBody(this.body);
        this.body = null;
        this.fixture = null;
        this.spawnFragments(origin, inheritedVelocity);
    }

    spawnFragments(origin, inheritedVelocity)
    {
        var first = -160;
        var step = this.fragmentCount > 1 ? 140 / (this.fragmentCount - 1) : 0;
        for (var i = 0; i < this.fragmentCount; i++)
        {
            var deg = first + (step * i);
            var rad = deg * Math.PI / 180;
            var velocity = new b2Vec2(
                Math.cos(rad) * this.fragmentSpeed + inheritedVelocity.x * 0.25,
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
        fixDef.density = ThrowableWeapon.DENSITY;
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
        super.beginContact(contact);
    }

    update()
    {
        if (!this.getIsActive())
        {
            return;
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

            if (this.fragments.length == 0)
            {
                GameInstance.state.tiggerNextTurn();
                this.deactivate();
            }
            return;
        }

        super.update();
    }

    draw(ctx)
    {
        if (this.fragments && this.fragments.length > 0)
        {
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
            return;
        }

        super.draw(ctx);
    }
}

class BananaBomb extends FragmentingThrowableWeapon
{
    constructor(ammo)
    {
        super(
            "Banana Bomb",
            ammo,
            Sprites.weaponIcons.bananaBomb,
            Sprites.weapons.banana,
            Sprites.weapons.bananaClusterlet,
            Sprites.worms.takeOutGernade,
            Sprites.worms.aimGernade
        );

        this.explosionRadius = 100;
        this.effectedRadius = Physics.pixelToMeters(180);
        this.explosiveForce = 95;
        this.maxDamage = 75;
        this.detonationTimer = new Timer(5000);
        this.impactSound = "GRENADEIMPACT";
        this.fragmentCount = 5;
        this.fragmentFuseMs = 1700;
        this.fragmentSpeed = 11;
        this.fragmentExplosionRadius = 90;
        this.fragmentEffectedRadius = Physics.pixelToMeters(160);
        this.fragmentExplosiveForce = 80;
        this.fragmentMaxDamage = 75;
    }
}

class ClusterBomb extends FragmentingThrowableWeapon
{
    constructor(ammo)
    {
        super(
            "Cluster Bomb",
            ammo,
            Sprites.weaponIcons.clusterBomb,
            Sprites.weapons.cluster,
            Sprites.weapons.clusterlet,
            Sprites.worms.takeOutGernade,
            Sprites.worms.aimGernade
        );

        this.explosionRadius = 34;
        this.effectedRadius = Physics.pixelToMeters(95);
        this.explosiveForce = 38;
        this.maxDamage = 30;
        this.detonationTimer = new Timer(4000);
        this.impactSound = "GRENADEIMPACT";
        this.fragmentCount = 5;
        this.fragmentFuseMs = 1200;
        this.fragmentSpeed = 10;
        this.fragmentExplosionRadius = 34;
        this.fragmentEffectedRadius = Physics.pixelToMeters(95);
        this.fragmentExplosiveForce = 42;
        this.fragmentMaxDamage = 30;
    }
}
