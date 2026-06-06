///<reference path="../system/Physics.ts"/>
///<reference path="../Worm.ts"/>

module ArenaTelemetry
{
    export var currentAction = null;
    export var completedActions = [];

    function wormSummary(worm)
    {
        if (!worm)
        {
            return null;
        }

        var pos = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
        var teamIndex = teamIndexForWorm(worm);
        return {
            name: worm.name,
            team: worm.team.name,
            teamIndex: teamIndex,
            id: "team-" + teamIndex + ":" + worm.name,
            health: Math.round(worm.health),
            x: Math.round(pos.x),
            y: Math.round(pos.y)
        };
    }

    function teamIndexForWorm(worm)
    {
        if (typeof GameInstance == "undefined" || !GameInstance.players)
        {
            return -1;
        }

        for (var p = 0; p < GameInstance.players.length; p++)
        {
            var worms = GameInstance.players[p].getTeam().worms;
            for (var i = 0; i < worms.length; i++)
            {
                if (worms[i] == worm)
                {
                    return p;
                }
            }
        }

        return -1;
    }

    function pixelDistance(a, b)
    {
        if (!a || !b)
        {
            return null;
        }

        var dx = a.x - b.x;
        var dy = a.y - b.y;
        return Math.round(Math.sqrt((dx * dx) + (dy * dy)));
    }

    function directionWords(dx, dy)
    {
        var horizontal = Math.abs(dx) < 35 ? "same x" : (dx > 0 ? "right" : "left");
        var vertical = Math.abs(dy) < 35 ? "same height" : (dy > 0 ? "below" : "above");
        return horizontal + ", " + vertical;
    }

    function livingWormSummaries(game)
    {
        var worms = [];
        if (!game || !game.players)
        {
            return worms;
        }

        for (var p = 0; p < game.players.length; p++)
        {
            var team = game.players[p].getTeam();
            for (var i = 0; i < team.worms.length; i++)
            {
                var worm = team.worms[i];
                if (!worm.isDead)
                {
                    worms.push(wormSummary(worm));
                }
            }
        }

        return worms;
    }

    function nearestWormsToPoint(game, point, limit)
    {
        var worms = livingWormSummaries(game);
        worms.sort(function (a, b)
        {
            return pixelDistance(a, point) - pixelDistance(b, point);
        });
        return worms.slice(0, limit || 3);
    }

    export function startAction(action, actor)
    {
        currentAction = {
            action: action,
            actor: wormSummary(actor),
            actorAfter: null,
            startedAt: Date.now(),
            finishedAt: null,
            explosions: [],
            damage: [],
            notes: []
        };
    }

    export function addNote(note)
    {
        if (currentAction)
        {
            currentAction.notes.push(note);
        }
    }

    export function recordExplosion(epicenter, explosionRadius, maxDamage, entityThatCausedExplosion)
    {
        if (!currentAction)
        {
            return;
        }

        currentAction.explosions.push({
            x: Math.round(Physics.metersToPixels(epicenter.x)),
            y: Math.round(Physics.metersToPixels(epicenter.y)),
            radius: explosionRadius,
            maxDamage: maxDamage,
            causedBy: wormSummary(entityThatCausedExplosion)
        });
    }

    export function recordDamage(worm, damage, causedBy)
    {
        if (!currentAction)
        {
            return;
        }

        var queuedDamage = (worm.damageTake || 0) + damage;
        currentAction.damage.push({
            target: wormSummary(worm),
            damage: Math.round(damage * 10) / 10,
            causedBy: wormSummary(causedBy),
            estimatedHealthAfterQueuedDamage: Math.max(0, Math.round((worm.health - queuedDamage) * 10) / 10)
        });
    }

    export function finishAction()
    {
        if (!currentAction)
        {
            return null;
        }

        currentAction.finishedAt = Date.now();
        if (typeof GameInstance != "undefined" && GameInstance.wormManager && currentAction.actor)
        {
            currentAction.actorAfter = wormSummary(GameInstance.wormManager.findWormWithName(currentAction.actor.name));
        }
        completedActions.push(currentAction);
        var record = currentAction;
        currentAction = null;
        return record;
    }

    export function formatActionFeedback(records, game)
    {
        var markdown = "## Engine feedback\n\n";
        if (!records || records.length == 0)
        {
            return markdown + "- No actions were executed.\n";
        }

        for (var i = 0; i < records.length; i++)
        {
            var record = records[i];
            markdown += "### Action " + (i + 1) + ": `" + record.action.tool + "`\n";
            if (record.actor)
            {
                markdown += "- Actor: " + record.actor.team + " / " + record.actor.name + " at (" + record.actor.x + ", " + record.actor.y + "), HP " + record.actor.health + ".\n";
            }
            if (record.actor && record.actorAfter)
            {
                var moveDx = record.actorAfter.x - record.actor.x;
                var moveDy = record.actorAfter.y - record.actor.y;
                var moved = pixelDistance(record.actorAfter, record.actor);
                markdown += "- After action: (" + record.actorAfter.x + ", " + record.actorAfter.y + "), HP " + record.actorAfter.health + ", moved " + moved + " px; delta dx " + moveDx + ", dy " + moveDy + " (" + directionWords(moveDx, moveDy) + ").\n";
            }

            if (record.notes.length > 0)
            {
                for (var n = 0; n < record.notes.length; n++)
                {
                    markdown += "- " + record.notes[n] + "\n";
                }
            }

            if (record.explosions.length == 0 && record.damage.length == 0 && record.action.tool == "fire")
            {
                var noteText = record.notes.join(" ");
                if (/Drill/i.test(noteText))
                {
                    markdown += "- Drill produced no explosion or worm damage during the observation window. Use the after-action position and next state snapshot to judge whether it dug useful terrain or dropped you.\n";
                } else
                {
                    markdown += "- Shot produced no recorded explosion or damage during the observation window. Treat this as a miss or a projectile still resolving.\n";
                    markdown += "- Wind is not modelled by this clone; do not blame wind for this miss.\n";
                }
            }

            for (var e = 0; e < record.explosions.length; e++)
            {
                var explosion = record.explosions[e];
                var actorDistance = pixelDistance(explosion, record.actor);
                markdown += "- Explosion at (" + explosion.x + ", " + explosion.y + "), radius " + explosion.radius;
                if (actorDistance != null)
                {
                    markdown += ", " + actorDistance + " px from actor";
                    if (actorDistance <= explosion.radius)
                    {
                        markdown += " (actor inside blast radius)";
                    }
                }
                markdown += ".\n";

                if (record.actor)
                {
                    var explosionDx = explosion.x - record.actor.x;
                    var explosionDy = explosion.y - record.actor.y;
                    markdown += "- Explosion relative to actor: dx " + explosionDx + ", dy " + explosionDy + " (" + directionWords(explosionDx, explosionDy) + ").\n";
                }

                var nearest = nearestWormsToPoint(game, explosion, 3);
                if (nearest.length > 0)
                {
                    var nearestLines = [];
                    for (var nw = 0; nw < nearest.length; nw++)
                    {
                        var nearestWorm = nearest[nw];
                        var distanceToExplosion = pixelDistance(nearestWorm, explosion);
                        var relation = record.actor && nearestWorm.team == record.actor.team
                            ? (nearestWorm.name == record.actor.name ? "SELF" : "ALLY")
                            : "ENEMY";
                        nearestLines.push(relation + " `" + nearestWorm.name + "` " + distanceToExplosion + " px away");
                    }
                    markdown += "- Nearest worms to explosion: " + nearestLines.join("; ") + ".\n";
                    if (nearest[0])
                    {
                        var nearestDistance = pixelDistance(nearest[0], explosion);
                        if (nearestDistance > explosion.radius)
                        {
                            markdown += "- Miss feedback: no living worm was inside the " + explosion.radius + " px blast radius; nearest worm was " + nearestDistance + " px away.\n";
                        }
                    }
                    for (var rw = 0; rw < nearest.length; rw++)
                    {
                        var relativeWorm = nearest[rw];
                        var targetDx = explosion.x - relativeWorm.x;
                        var targetDy = explosion.y - relativeWorm.y;
                        var targetDistance = pixelDistance(relativeWorm, explosion);
                        markdown += "- Explosion relative to `" + relativeWorm.name + "`: dx " + targetDx + ", dy " + targetDy + " (" + directionWords(targetDx, targetDy) + "), distance " + targetDistance + " px. This is post-shot feedback only, not an aim solution.\n";
                    }
                }
            }

            for (var d = 0; d < record.damage.length; d++)
            {
                var hit = record.damage[d];
                var relation = "ENEMY HIT";
                if (record.actor && hit.target.team == record.actor.team && hit.target.name == record.actor.name)
                {
                    relation = "SELF DAMAGE";
                } else if (record.actor && hit.target.team == record.actor.team)
                {
                    relation = "FRIENDLY FIRE";
                }
                markdown += "- " + relation + ": hit " + hit.target.team + " / " + hit.target.name + " for " + hit.damage + " damage; estimated HP after queued damage " + hit.estimatedHealthAfterQueuedDamage + ".\n";
            }

            if (record.damage.length > 0)
            {
                var selfDamage = 0;
                var friendlyDamage = 0;
                var enemyDamage = 0;
                for (var s = 0; s < record.damage.length; s++)
                {
                    var damageHit = record.damage[s];
                    if (record.actor && damageHit.target.team == record.actor.team && damageHit.target.name == record.actor.name)
                    {
                        selfDamage += damageHit.damage;
                    } else if (record.actor && damageHit.target.team == record.actor.team)
                    {
                        friendlyDamage += damageHit.damage;
                    } else
                    {
                        enemyDamage += damageHit.damage;
                    }
                }
                markdown += "- Damage summary: enemy " + Math.round(enemyDamage * 10) / 10 + ", friendly " + Math.round(friendlyDamage * 10) / 10 + ", self " + Math.round(selfDamage * 10) / 10 + ".\n";
                if (selfDamage > 0 || friendlyDamage > 0)
                {
                    markdown += "- Safety lesson: your last shot damaged your own team. Correct aim, power, position, or weapon choice next turn.\n";
                }
            }

            markdown += "\n";
        }

        return markdown;
    }
}
