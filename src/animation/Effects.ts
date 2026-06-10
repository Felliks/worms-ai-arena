/**
 *  Effects.js
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="../system/Utilies.ts"/>
///<reference path="../system/AssetManager.ts"/>
///<reference path="../system/Physics.ts"/>
///<reference path="../system/Physics.ts"/>
///<reference path="../Game.ts"/>
///<reference path="../Main.ts"/>
///<reference path="Sprite.ts"/>

module Effects
{

    export function explosion(epicenter,
        explosionRadius,
        effectedRadius,
        explosiveForce, 
        maxDamage, 
        entityThatCausedExplosion = null,
        soundEffectToPlay = AssetManager.getSound("explosion" + Utilies.random(1, 3)),
        particleEffectType = ParticleEffect,
       )
    {
        if (typeof ArenaTelemetry != "undefined")
        {
            ArenaTelemetry.recordExplosion(epicenter, explosionRadius, maxDamage, entityThatCausedExplosion);
        }

        var posX = Physics.metersToPixels(epicenter.x);
        var posY = Physics.metersToPixels(epicenter.y);

        GameInstance.terrain.addToDeformBatch(posX,posY,explosionRadius);

        var affectedWorms = [];
        Physics.applyToNearByObjects(
            epicenter,
            effectedRadius,
            (fixture, epicenter) =>
            {
                // Applys force to all the bodies in the radius
                if (fixture.GetBody().GetType() != b2Body.b2_staticBody && fixture.GetBody().GetUserData() instanceof Worm)
                {
                    var worm = fixture.GetBody().GetUserData();
                    if (affectedWorms.indexOf(worm) != -1)
                    {
                        return;
                    }
                    affectedWorms.push(worm);

                    var direction = fixture.GetBody().GetPosition().Copy();
                    direction.Subtract(epicenter);
                    var forceVec = direction.Copy();

                    var diff = effectedRadius - direction.Length();
                    
                    if (diff < 0)
                    {
                        diff = 0;
                    }

                    var distanceFromEpicenter = diff / effectedRadius;
                    var damage = maxDamage * distanceFromEpicenter;
                    if (damage > 0)
                    {
                        worm.hit(damage, entityThatCausedExplosion)
                    }

                    forceVec.Normalize();
                    forceVec.Multiply(explosiveForce*distanceFromEpicenter);

                    //Quick hack so grave stones are not checked by explosions
                    if (worm.isDead == true)
                    {
                        forceVec.x = 0;
                        forceVec.y /= 10;
                    }
                       
                    fixture.GetBody().ApplyImpulse(forceVec, fixture.GetBody().GetPosition());

                }
            }
         );
        var particleAnimation = new particleEffectType(posX, posY);
        GameInstance.particleEffectMgmt.add(particleAnimation);

        if(soundEffectToPlay != null)
        soundEffectToPlay.play();
        
        return particleAnimation; 
    }





}
