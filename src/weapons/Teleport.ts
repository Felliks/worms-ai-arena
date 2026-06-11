///<reference path="../system/Graphics.ts"/>
///<reference path="../system/AssetManager.ts"/>
///<reference path="../system/Physics.ts"/>
///<reference path="../environment/Terrain.ts"/>
///<reference path="../animation/Sprite.ts"/>
///<reference path="BaseWeapon.ts"/>

class TeleportEffect
{
    sprite: Sprite;
    x: number;
    y: number;
    finished: bool;

    constructor(x, y)
    {
        this.sprite = new Sprite(Sprites.particleEffects.magicHit, true);
        this.x = x;
        this.y = y;
        this.finished = false;
    }

    update()
    {
        this.sprite.update();
        this.finished = this.sprite.finished;
    }

    draw(ctx)
    {
        this.sprite.draw(ctx, this.x - this.sprite.getFrameWidth() / 2, this.y - this.sprite.getFrameHeight() / 2);
    }
}

class Teleport extends BaseWeapon
{
    static mouseTrackingInstalled = false;
    static mouseWorldX = 0;
    static mouseWorldY = 0;

    destinationCursor: Sprite;

    constructor(ammo)
    {
        super(
            "Teleport",
            ammo,
            Sprites.weaponIcons.iconTeleport,
            Sprites.worms.takeOutTeleport,
            Sprites.worms.readyTeleport
        );

        this.requiresAiming = false;
        this.destinationCursor = new Sprite(Sprites.weapons.redTarget);
        Teleport.ensureMouseTracking();
    }

    static ensureMouseTracking()
    {
        if (Teleport.mouseTrackingInstalled || typeof document == "undefined")
        {
            return;
        }
        Teleport.mouseTrackingInstalled = true;
        document.addEventListener("mousemove", function (evt: any)
        {
            Teleport.updateMouseWorld(evt);
        }, false);
        document.addEventListener("mousedown", function (evt: any)
        {
            Teleport.updateMouseWorld(evt);
        }, false);
    }

    static updateMouseWorld(evt)
    {
        if (typeof GameInstance == "undefined" || !GameInstance || !GameInstance.actionCanvas || !GameInstance.camera)
        {
            return;
        }
        var rect = GameInstance.actionCanvas.getBoundingClientRect();
        Teleport.mouseWorldX = Math.round(GameInstance.camera.getX() + evt.clientX - rect.left);
        Teleport.mouseWorldY = Math.round(GameInstance.camera.getY() + evt.clientY - rect.top);
    }

    terrainAlphaAt(x, y)
    {
        if (!GameInstance || !GameInstance.terrain || !GameInstance.terrain.bufferCanvasContext)
        {
            return 0;
        }
        if (x < 0 || y < 0 || x >= GameInstance.terrain.bufferCanvas.width || y >= GameInstance.terrain.bufferCanvas.height)
        {
            return 0;
        }
        return GameInstance.terrain.bufferCanvasContext.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
    }

    validateDestination(worm, x, y)
    {
        var tx = Math.round(Number(x));
        var ty = Math.round(Number(y));
        if (!isFinite(tx) || !isFinite(ty))
        {
            return { ok: false, reason: "destination coordinates are not finite numbers", x: 0, y: 0 };
        }
        if (!GameInstance || !GameInstance.terrain)
        {
            return { ok: false, reason: "terrain is not ready", x: tx, y: ty };
        }

        var terrain = GameInstance.terrain;
        var radius = worm && worm.fixture ? Math.ceil(worm.fixture.GetShape().GetRadius() * Physics.worldScale) : 16;
        var minX = radius + 2;
        var maxX = terrain.getWidth() - radius - 2;
        var minY = (radius * 2) + 2;
        var maxY = terrain.getHeight() - 2;
        if (tx < minX || tx > maxX || ty < minY || ty > maxY)
        {
            return { ok: false, reason: "destination is outside map bounds", x: tx, y: ty };
        }

        var waterLine = terrain.getWaterLine();
        if (ty >= waterLine - 2)
        {
            return { ok: false, reason: "destination is below water line " + Math.round(waterLine), x: tx, y: ty };
        }

        var step = Math.max(4, Math.floor(radius / 2));
        for (var sx = -radius; sx <= radius; sx += step)
        {
            for (var sy = -radius * 2; sy <= 0; sy += step)
            {
                var nx = tx + sx;
                var ny = ty + sy;
                var dx = sx / radius;
                var dy = (sy + radius) / radius;
                if ((dx * dx) + (dy * dy) > 1.15)
                {
                    continue;
                }
                if (this.terrainAlphaAt(nx, ny) > 16)
                {
                    return { ok: false, reason: "terrain overlap around worm footprint", x: tx, y: ty };
                }
            }
        }

        return { ok: true, reason: "ok", x: tx, y: ty };
    }

    attemptTeleport(worm, x, y)
    {
        if (this.ammo <= 0)
        {
            return {
                ok: false,
                moved: false,
                ammoConsumed: false,
                turnEnded: false,
                reason: "Teleport rejected: no Teleport ammo remains; does not consume ammo",
                x: Math.round(Number(x) || 0),
                y: Math.round(Number(y) || 0)
            };
        }

        var validation = this.validateDestination(worm, x, y);
        if (!validation.ok)
        {
            return {
                ok: false,
                moved: false,
                ammoConsumed: false,
                turnEnded: false,
                reason: "Teleport rejected at (" + validation.x + ", " + validation.y + "): " + validation.reason + "; does not consume ammo",
                x: validation.x,
                y: validation.y
            };
        }

        this.ammo--;
        this.worm = worm;
        this.setIsActive(false);
        var meters = Physics.vectorPixelToMeters(new b2Vec2(validation.x, validation.y));
        worm.body.SetPosition(meters);
        worm.body.SetLinearVelocity(new b2Vec2(0, 0));
        worm.body.SetAngularVelocity(0);
        worm.canJump = 0;
        worm.setSpriteDef(Sprites.worms.readyTeleport);
        worm.finished = true;
        if (worm.arrow)
        {
            worm.arrow.finished = true;
        }
        if (GameInstance && GameInstance.camera)
        {
            GameInstance.camera.panToPosition(new b2Vec2(validation.x, validation.y));
        }
        if (GameInstance && GameInstance.particleEffectMgmt)
        {
            GameInstance.particleEffectMgmt.add(new TeleportEffect(validation.x, validation.y - 20));
        }
        GameInstance.state.tiggerNextTurn();

        return {
            ok: true,
            moved: true,
            ammoConsumed: true,
            turnEnded: true,
            reason: "Teleport succeeded to (" + validation.x + ", " + validation.y + "); turn ends immediately with no retreat time",
            x: validation.x,
            y: validation.y
        };
    }

    activate(worm)
    {
        var result = this.attemptTeleport(worm, Teleport.mouseWorldX, Teleport.mouseWorldY);
        if (!result.ok)
        {
            AssetManager.getSound("cantclickhere").play();
            if (typeof Notify != "undefined")
            {
                Notify.display("Teleport rejected", result.reason, 2600);
            }
            return false;
        }
        return true;
    }

    draw(ctx)
    {
        if (!this.isActive && GameInstance && GameInstance.state && GameInstance.state.getCurrentPlayer
            && GameInstance.state.getCurrentPlayer().getTeam().getCurrentWorm().getWeapon() == this
            && Client.isClientsTurn())
        {
            var x = Teleport.mouseWorldX;
            var y = Teleport.mouseWorldY;
            this.destinationCursor.draw(ctx, x - this.destinationCursor.getFrameWidth() / 2, y - this.destinationCursor.getFrameHeight() / 2);
        }
    }
}
