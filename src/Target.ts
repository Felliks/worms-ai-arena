/**
 * Target.js
 *
 * The target or cross hairs the player rotates to aim
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="system/Graphics.ts"/>
///<reference path="system/Utilies.ts"/>
///<reference path="system/AssetManager.ts"/>
///<reference path="system/Physics.ts"/>
///<reference path="Game.ts"/>
///<reference path="Main.ts"/>
///<reference path="animation/Sprite.ts"/>
///<reference path="animation/PhysicsSprite.ts"/>

class Target extends PhysicsSprite
{
    // Aiming
    private targetDirection;
    rotationRate;
    worm: Worm;
    direction;

    //When the player walks and the aims again
    //allows me to reset the sprites current frame to what it was at previously
    previousSpriteFrame;

    constructor(worm: Worm)
    {
        super(new b2Vec2(0, 0), Physics.vectorMetersToPixels(worm.body.GetPosition()), Sprites.weapons.redTarget);
        //The direction in which the worm is aiming
        this.targetDirection = new b2Vec2(1, 0.0);
        this.rotationRate = 4;
        this.worm = worm;
        this.direction = this.worm.direction;
    }

    draw(ctx)
    {
        if (this.worm.isActiveWorm() && this.worm.getWeapon().requiresAiming)
        {

            var radius = this.worm.fixture.GetShape().GetRadius() * Physics.worldScale;
            var wormPos = Physics.vectorMetersToPixels(this.worm.body.GetPosition());
            var targetDir = this.targetDirection.Copy();

            targetDir.Multiply(95);
            targetDir.Add(wormPos);

            //ctx.beginPath(); // Start the path
            //ctx.moveTo(wormPos.x, wormPos.y); // Set the path origin
            //ctx.lineTo(targetDir.x, targetDir.y); // Set the path destination
            //ctx.closePath(); // Close the path
            //ctx.stroke();

            super.draw(ctx, targetDir.x - radius, targetDir.y - (radius * 2));
        }
    }

    getTargetDirection()
    {
        return this.targetDirection;
    }

    setTargetDirection(vector)
    {
        this.targetDirection = vector;
    }

    setAimDegrees(degrees)
    {
        var bounded = Math.max(-179, Math.min(179, Number(degrees || 0)));
        var radians = Utilies.toRadians(bounded);
        this.worm.direction = (bounded > 90 || bounded < -90) ? Worm.DIRECTION.left : Worm.DIRECTION.right;
        this.direction = this.worm.direction;
        this.targetDirection = Utilies.angleToVector(radians);

        // Snap to the static aim sprite BEFORE computing the frame. While the worm is still playing
        // the (slow) take-out animation, that sprite has fewer frames - so the aim frame would be
        // clamped to the wrong range - and Sprite.update keeps advancing it, so the held weapon sweeps
        // on its own and points wherever the animation is instead of at the crosshair. Switching to the
        // aim sheet, setting the frame, and freezing (finished=true) makes the weapon follow the aim.
        var aimSprite = this.worm.team.getWeaponManager().getCurrentWeapon().takeAimAnimations;
        if (aimSprite && this.worm.spriteDef != aimSprite)
        {
            this.worm.setSpriteDef(aimSprite);
        }

        var verticalAngle = Utilies.toDegrees(Math.asin(Math.max(-1, Math.min(1, this.targetDirection.y))));
        var frame = Math.max(0, Math.min(this.worm.getTotalFrames() - 1, 16 - (verticalAngle / 6)));
        this.previousSpriteFrame = frame;
        this.worm.setCurrentFrame(frame);
        this.worm.finished = true;
    }

    changeDirection(dir)
    {
        var td = this.targetDirection.Copy();
        var currentAngle = Utilies.toDegrees(Utilies.vectorToAngle(td));

        if (dir == Worm.DIRECTION.left && this.direction != dir)
        {
            this.direction = dir;
            var currentAngle = Utilies.toDegrees(Utilies.toRadians(180) - Utilies.vectorToAngle(td));
            this.targetDirection = Utilies.angleToVector(Utilies.toRadians(currentAngle));

        } else if (dir == Worm.DIRECTION.right && this.direction != dir)
            {

            this.direction = dir;
            var currentAngle = Utilies.toDegrees(Utilies.toRadians(-180) - Utilies.vectorToAngle(td));
            this.targetDirection = Utilies.angleToVector(Utilies.toRadians(currentAngle));
        }
    }

    // Allows the player to increase the aiming angle or decress
    aim(upOrDown: number)
    {
        upOrDown *= this.worm.direction;
        var td = this.targetDirection.Copy();
        var currentAngle = Utilies.toDegrees( Utilies.toRadians(this.rotationRate * upOrDown) + Utilies.vectorToAngle(td) );

        //Magic number 0.6 - it works anyway, not enough time. Though if upOrDown changes from 0.8 might need to change it.
         this.worm.setCurrentFrame(this.worm.getCurrentFrame() + (Utilies.sign(upOrDown * -this.worm.direction) * 0.6))
        
        //Hack: All the aiming sprite sheets are 32 or greater. 
        //This makes sure if we move the target while jumping that we don't lose 
        //correct previousSpriteFrame 
        if (this.worm.getTotalFrames() >= 32)
        {
            this.previousSpriteFrame = this.worm.getCurrentFrame();
        }

        if (this.direction == Worm.DIRECTION.right)
        {

            if (currentAngle > -90 && currentAngle < 90)
            {
                this.targetDirection = Utilies.angleToVector(Utilies.toRadians(currentAngle));
           
            }
        } else
        {

            if ( (currentAngle > 90) || (currentAngle < -90) )
            {
                this.targetDirection = Utilies.angleToVector(Utilies.toRadians(currentAngle));

            }
        }

    }

}
