///<reference path="../Game.ts"/>
///<reference path="../system/Physics.ts"/>
///<reference path="../system/Utilies.ts"/>

module ArenaSnapshot
{
    function round(value)
    {
        return Math.round(value * 10) / 10;
    }

    function wormPosition(worm)
    {
        var pos = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
        return {
            x: Math.round(pos.x),
            y: Math.round(pos.y)
        };
    }

    function currentAimDegrees(worm)
    {
        return Math.round(Utilies.toDegrees(Utilies.vectorToAngle(worm.target.getTargetDirection().Copy())));
    }

    function facingName(worm)
    {
        return worm.direction == Worm.DIRECTION.right ? "right" : "left";
    }

    function aimDirectionWords(degrees)
    {
        if (degrees <= -135 || degrees >= 135)
        {
            return "leftward";
        }
        if (degrees >= -45 && degrees <= 45)
        {
            return "rightward";
        }
        if (degrees < -45 && degrees > -135)
        {
            return "upward";
        }
        return "downward";
    }

    function terrainAlphaAt(game, x, y)
    {
        if (!game.terrain || !game.terrain.bufferCanvasContext)
        {
            return 0;
        }

        if (x < 0 || y < 0 || x >= game.terrain.bufferCanvas.width || y >= game.terrain.bufferCanvas.height)
        {
            return 0;
        }

        return game.terrain.bufferCanvasContext.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
    }

    function isSolid(game, x, y)
    {
        return terrainAlphaAt(game, x, y) > 16;
    }

    function terrainBetween(game, from, to)
    {
        var solidSamples = 0;
        var firstSolid = null;
        var steps = 28;

        for (var i = 1; i < steps; i++)
        {
            var t = i / steps;
            var x = from.x + ((to.x - from.x) * t);
            var y = from.y + ((to.y - from.y) * t);
            if (terrainAlphaAt(game, x, y) > 16)
            {
                solidSamples++;
                if (!firstSolid)
                {
                    firstSolid = { x: Math.round(x), y: Math.round(y) };
                }
            }
        }

        if (solidSamples == 0)
        {
            return "clear straight-line view";
        }

        return solidSamples + " terrain samples block straight-line view; first near (" + firstSolid.x + ", " + firstSolid.y + ")";
    }

    function distance(from, to)
    {
        var dx = to.x - from.x;
        var dy = to.y - from.y;
        return Math.round(Math.sqrt((dx * dx) + (dy * dy)));
    }

    function directionWords(dx, dy)
    {
        var horizontal = Math.abs(dx) < 35 ? "same x" : (dx > 0 ? "right" : "left");
        var vertical = Math.abs(dy) < 35 ? "same height" : (dy > 0 ? "below" : "above");
        return horizontal + ", " + vertical;
    }

    function firstSolidBelow(game, x, y)
    {
        var height = game.terrain.getHeight();
        for (var sampleY = Math.max(0, Math.round(y)); sampleY < height; sampleY += 6)
        {
            if (isSolid(game, x, sampleY))
            {
                return sampleY;
            }
        }
        return null;
    }

    function firstSolidAbove(game, x, y)
    {
        for (var sampleY = Math.min(game.terrain.getHeight() - 1, Math.round(y)); sampleY >= 0; sampleY -= 6)
        {
            if (isSolid(game, x, sampleY))
            {
                return sampleY;
            }
        }
        return null;
    }

    function firstWall(game, pos, dir)
    {
        var step = dir < 0 ? -8 : 8;
        var maxDistance = 520;
        for (var offset = step; Math.abs(offset) <= maxDistance; offset += step)
        {
            var x = pos.x + offset;
            if (x < 0 || x >= game.terrain.getWidth())
            {
                return { distance: Math.abs(offset), note: "map boundary" };
            }

            if (isSolid(game, x, pos.y - 20) || isSolid(game, x, pos.y - 48))
            {
                return { distance: Math.abs(offset), note: "terrain wall/ledge at body height near x " + Math.round(x) };
            }
        }

        return null;
    }

    function terrainProfile(game, pos)
    {
        var offsets = [-600, -420, -260, -150, -80, 0, 80, 150, 260, 420, 600];
        var lines = [];
        var mapWidth = game.terrain.getWidth();
        var mapHeight = game.terrain.getHeight();
        var waterLine = mapHeight - 150;

        for (var i = 0; i < offsets.length; i++)
        {
            var offset = offsets[i];
            var x = Math.max(0, Math.min(mapWidth - 1, pos.x + offset));
            var below = firstSolidBelow(game, x, pos.y - 30);
            var above = firstSolidAbove(game, x, pos.y - 70);
            var groundText = below == null ? "no solid ground below before water/bottom" : "ground " + Math.round(below - pos.y) + " px from active center";
            var overheadText = above == null ? "open sky above sample" : "overhead/ceiling terrain " + Math.round(pos.y - above) + " px above active center";
            var label = offset == 0 ? "under active worm" : (offset < 0 ? Math.abs(offset) + " px left" : offset + " px right");
            var waterText = below == null || below > waterLine ? "water/bottom danger" : "land";
            lines.push("- " + label + " at x " + Math.round(x) + ": " + groundText + "; " + overheadText + "; " + waterText + ".");
        }

        var leftWall = firstWall(game, pos, -1);
        var rightWall = firstWall(game, pos, 1);
        lines.push("- Left movement/shot-height obstruction: " + (leftWall ? leftWall.note + " after " + leftWall.distance + " px" : "no body-height wall within 520 px") + ".");
        lines.push("- Right movement/shot-height obstruction: " + (rightWall ? rightWall.note + " after " + rightWall.distance + " px" : "no body-height wall within 520 px") + ".");
        lines.push("- Water danger: y near " + waterLine + " and below is unsafe; map bottom is y " + mapHeight + ".");

        return lines.join("\n");
    }

    function firstSolidAlongRay(game, pos, degrees, maxDistance)
    {
        var radians = Utilies.toRadians(degrees);
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        var width = game.terrain.getWidth();
        var height = game.terrain.getHeight();

        for (var rayDistance = 24; rayDistance <= maxDistance; rayDistance += 8)
        {
            var x = pos.x + (cos * rayDistance);
            var y = pos.y + (sin * rayDistance);
            if (x < 0 || y < 0 || x >= width || y >= height)
            {
                return { distance: rayDistance, kind: "map boundary", x: Math.round(x), y: Math.round(y) };
            }

            if (isSolid(game, x, y))
            {
                return { distance: rayDistance, kind: "terrain", x: Math.round(x), y: Math.round(y) };
            }
        }

        return null;
    }

    function aimClearanceFan(game, pos, currentAim)
    {
        var angles = [-165, -150, -135, -120, -105, -90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];
        var lines = [];
        var maxDistance = 720;
        var safeThreshold = 180;
        var pointBlankThreshold = 80;
        var currentClearance = firstSolidAlongRay(game, pos, currentAim, maxDistance);
        var safeAngles = [];
        var pointBlankAngles = [];

        lines.push("- Current aim " + currentAim + " degrees: " + formatRayClearance(currentClearance, maxDistance) + ".");
        for (var i = 0; i < angles.length; i++)
        {
            var hit = firstSolidAlongRay(game, pos, angles[i], maxDistance);
            lines.push("- " + angles[i] + " degrees: " + formatRayClearance(hit, maxDistance) + ".");
            if (!hit || hit.distance >= safeThreshold)
            {
                safeAngles.push(angles[i]);
            }
            if (hit && hit.distance <= pointBlankThreshold)
            {
                pointBlankAngles.push(angles[i]);
            }
        }

        lines.push("- This is straight-line visibility/clearance only. It does not simulate gravity, bounce, projectile speed, blast, or correct shot power.");
        lines.push("- If intended explosive fire has terrain/boundary under ~180 px along the muzzle direction, expect a point-blank explosion or self damage unless you move/jump/choose another plan.");
        if (safeAngles.length == 0)
        {
            lines.push("- DANGER FLAG: no sampled aim lane has " + safeThreshold + "+ px of muzzle clearance. Explosive fire from this position is very likely to hit nearby terrain and damage self; consider movement, jump/backflip, drilling, waiting, or a non-explosive/ray weapon if line of fire is clear.");
        } else
        {
            lines.push("- Sampled aim lanes with " + safeThreshold + "+ px muzzle clearance: " + safeAngles.join(", ") + " degrees.");
        }
        if (pointBlankAngles.length > 0)
        {
            lines.push("- Point-blank terrain lanes <= " + pointBlankThreshold + " px: " + pointBlankAngles.join(", ") + " degrees. Avoid explosive fire in these lanes unless intentionally self-destructive.");
        }
        return lines.join("\n");
    }

    function formatRayClearance(hit, maxDistance)
    {
        if (!hit)
        {
            return "clear for at least " + maxDistance + " px";
        }

        return hit.kind + " after " + Math.round(hit.distance) + " px near (" + hit.x + ", " + hit.y + ")";
    }

    export function weaponUseGuidance(weapon)
    {
        var name = String(weapon.name || "");
        if (name == "Shotgun")
        {
            return "tactical use facts: straight ray weapon with up to two shots before turn ends; needs line/aim clearance to matter; risk: wastes shots into terrain if blocked; agent primitives: aim, fire, optionally aim again and fire again.";
        }
        if (name == "Hand Grenade")
        {
            return "tactical use facts: thrown explosive with 4 sec fuse and bounce; can arc/drop and bounce; risk: short throws and nearby walls cause self/friendly splash; agent primitives: aim, set_power, fire, observeMs 6500-9000.";
        }
        if (name == "Holy Grenade")
        {
            return "tactical use facts: large high-damage thrown explosive with longer fuse; large blast affects clusters and terrain pockets; risk: very large blast makes friendly/self damage likely near allies or close walls; agent primitives: aim, set_power, fire, observeMs 8000-9000.";
        }
        if (name == "Dynamite")
        {
            return "tactical use facts: places explosive at current worm position; risk: nearly guaranteed self-damage if used alone or while trapped; agent primitives: select_weapon, fire, then movement is risky because fuse is short.";
        }
        if (name == "Jet Pack")
        {
            return "tactical use facts: manual flight/repositioning over gaps, water danger, and walls; activation consumes one Jet Pack ammo and starts finite fuel; thrust is screen-relative: up decreases y, left decreases x, right increases x; feedback reports dx/dy and fuel; risk: fuel waste, ceiling impacts, water falls; agent primitives: jetpack_start, jetpack_thrust direction up/left/right/up_left/up_right with ms, jetpack_stop.";
        }
        if (name == "Minigun")
        {
            return "tactical use facts: short burst ray weapon ending the turn; needs a straight lane; risk: digs terrain/whiffs if line is blocked; agent primitives: aim, fire.";
        }
        if (name == "Ninja Rope")
        {
            return "tactical use facts: manual rope movement using current aim to hook overhead/side terrain; feedback says attached/no anchor and reports movement; risk: misses if aimed into empty sky, bad release can drop into water; agent primitives: aim, rope_fire, rope_contract/rope_expand, rope_swing left/right with ms, rope_release.";
        }
        if (name == "Drill")
        {
            return "tactical use facts: drills terrain downward around the worm for repositioning or digging out; risk: can drop you toward water or waste turn if used in open air; agent primitives: select_weapon, fire, wait/observe.";
        }
        if (name == "Bazooka")
        {
            return "tactical use facts: direct projectile explosive with immediate terrain contact detonation; needs muzzle clearance and open direction to avoid instant wall hit; risk: close wall/ground impacts cause self-hit; agent primitives: aim, set_power, fire, observeMs 6500-9000.";
        }
        return "tactical use facts: unknown inventory item; inspect current state and avoid using it if the primitive is unclear.";
    }

    function weaponInfo(weapon)
    {
        var parts = [
            "`" + weapon.name + "`",
            "ammo " + weapon.ammo,
            "requires aiming " + weapon.requiresAiming,
            weaponUseGuidance(weapon)
        ];
        var lowerName = String(weapon.name || "").toLowerCase();
        if (lowerName == "jet pack")
        {
            parts.push("mobility tool facts: `jetpack_start`, `jetpack_thrust`, and `jetpack_stop`; activation consumes ammo, thrust consumes fuel, feedback reports movement/fuel");
        }
        if (lowerName == "ninja rope")
        {
            parts.push("mobility tool facts: aim first, then use `rope_fire`, `rope_contract`/`rope_expand`, `rope_swing`, and `rope_release`; feedback reports attached/no anchor and movement");
        }

        if (typeof weapon.explosionRadius == "number")
        {
            parts.push("blast/terrain radius " + weapon.explosionRadius + " px");
        }

        if (typeof weapon.maxDamage == "number")
        {
            parts.push("max center damage " + weapon.maxDamage);
        }

        if (typeof weapon.damageToTerrainRadius == "number")
        {
            parts.push("ray terrain radius " + weapon.damageToTerrainRadius + " px");
        }

        return parts.join(", ");
    }

    function blastAndFriendlyFireMap(living, currentBlastRadius)
    {
        var lines = [];
        var radius = currentBlastRadius || 0;
        var cautionDistance = radius > 0 ? Math.max(140, Math.round(radius * 2.4)) : 180;
        var clusterDistance = radius > 0 ? Math.max(120, Math.round(radius * 2.1)) : 160;
        var self = null;
        var allies = [];
        var enemies = [];

        for (var i = 0; i < living.length; i++)
        {
            if (living[i].relation == "SELF")
            {
                self = living[i];
            } else if (living[i].relation == "ALLY")
            {
                allies.push(living[i]);
            } else if (living[i].relation == "ENEMY")
            {
                enemies.push(living[i]);
            }
        }

        lines.push("- Active weapon risk radius: " + radius + " px. Distances below are pairwise map distances only, not projectile landing predictions.");

        if (radius > 0)
        {
            lines.push("- Rule of thumb: if a friendly worm is within about " + cautionDistance + " px of a likely impact area, explosive shots can create friendly fire. You still choose the aim and power yourself.");
        } else
        {
            lines.push("- Current weapon has no known blast radius; still watch ray/terrain obstruction and friendly bodies on the line of fire.");
        }

        if (allies.length == 0)
        {
            lines.push("- No living allies besides the active worm.");
        } else
        {
            var allySideNotes = [];
            for (var a = 0; a < allies.length; a++)
            {
                var ally = allies[a];
                var nearSameColumn = Math.abs(ally.dx) <= 220;
                var nearSameSide = Math.abs(ally.dx) <= 360;
                var nearSameHeight = Math.abs(ally.dy) <= 90 && Math.abs(ally.dx) <= 700;
                if (ally.dy > 80 && nearSameColumn)
                {
                    allySideNotes.push("`" + ally.name + "` is below you at dx " + ally.dx + ", dy " + ally.dy + "; falling/bouncing explosives in this vertical lane risk friendly fire.");
                } else if (ally.dy > 120 && nearSameSide)
                {
                    allySideNotes.push("`" + ally.name + "` is below-" + (ally.dx >= 0 ? "right" : "left") + " at dx " + ally.dx + ", dy " + ally.dy + "; shots toward that side can endanger them if they drop short/long.");
                } else if (nearSameHeight)
                {
                    allySideNotes.push("same-side ally caution: `" + ally.name + "` is " + (ally.dx >= 0 ? "right" : "left") + " of you at dx " + ally.dx + ", dy " + ally.dy + "; horizontal/low-arc explosives toward that side can endanger them if the shot lands short/long or bounces.");
                } else if (Math.abs(ally.dx) <= cautionDistance && Math.abs(ally.dy) <= cautionDistance)
                {
                    allySideNotes.push("`" + ally.name + "` is close to the active worm at dx " + ally.dx + ", dy " + ally.dy + "; avoid local blasts.");
                }
            }

            if (allySideNotes.length == 0)
            {
                lines.push("- No obvious ally directly below or beside the active worm inside the coarse caution lanes.");
            } else
            {
                for (var noteIndex = 0; noteIndex < allySideNotes.length; noteIndex++)
                {
                    lines.push("- Ally caution lane: " + allySideNotes[noteIndex]);
                }
            }
        }

        if (enemies.length > 0 && allies.length > 0)
        {
            for (var e = 0; e < enemies.length; e++)
            {
                var enemy = enemies[e];
                var nearestAlly = null;
                var nearestAllyDistance = Infinity;
                for (var n = 0; n < allies.length; n++)
                {
                    var allyCandidate = allies[n];
                    var dx = allyCandidate.x - enemy.x;
                    var dy = allyCandidate.y - enemy.y;
                    var pairDistance = Math.round(Math.sqrt((dx * dx) + (dy * dy)));
                    if (pairDistance < nearestAllyDistance)
                    {
                        nearestAllyDistance = pairDistance;
                        nearestAlly = allyCandidate;
                    }
                }

                if (nearestAlly && nearestAllyDistance <= cautionDistance)
                {
                    lines.push("- Target-adjacent friendly caution: ENEMY `" + enemy.name + "` is " + nearestAllyDistance + " px from ALLY `" + nearestAlly.name + "`; blast weapons may hit both if aimed at that cluster.");
                } else if (nearestAlly)
                {
                    lines.push("- Enemy `" + enemy.name + "` nearest ally separation: " + nearestAllyDistance + " px from `" + nearestAlly.name + "`.");
                }
            }
        }

        if (enemies.length > 1)
        {
            for (var e1 = 0; e1 < enemies.length; e1++)
            {
                for (var e2 = e1 + 1; e2 < enemies.length; e2++)
                {
                    var edx = enemies[e2].x - enemies[e1].x;
                    var edy = enemies[e2].y - enemies[e1].y;
                    var enemyPairDistance = Math.round(Math.sqrt((edx * edx) + (edy * edy)));
                    if (enemyPairDistance <= clusterDistance)
                    {
                        lines.push("- Enemy cluster opportunity: `" + enemies[e1].name + "` and `" + enemies[e2].name + "` are " + enemyPairDistance + " px apart.");
                    }
                }
            }
        }

        if (self)
        {
            lines.push("- Self location reminder: active worm `" + self.name + "` is the origin for dx/dy; any immediate terrain hit near origin can damage self.");
        }

        return lines.join("\n");
    }

    function relationName(playerIndex, currentPlayerIndex, worm, currentWorm)
    {
        if (worm == currentWorm)
        {
            return "SELF";
        }
        return playerIndex == currentPlayerIndex ? "ALLY" : "ENEMY";
    }

    function collectLivingWorms(game, currentPlayerIndex, currentWorm, currentPos)
    {
        var entries = [];
        for (var p = 0; p < game.players.length; p++)
        {
            var player = game.players[p];
            var team = player.getTeam();
            for (var i = 0; i < team.worms.length; i++)
            {
                var worm = team.worms[i];
                if (worm.isDead)
                {
                    continue;
                }
                var pos = wormPosition(worm);
                var dx = pos.x - currentPos.x;
                var dy = pos.y - currentPos.y;
                entries.push({
                    name: worm.name,
                    team: team.name,
                    teamIndex: p,
                    relation: relationName(p, currentPlayerIndex, worm, currentWorm),
                    x: pos.x,
                    y: pos.y,
                    hp: Math.round(worm.health),
                    dx: dx,
                    dy: dy,
                    distance: distance(currentPos, pos),
                    direction: directionWords(dx, dy),
                    obstruction: worm == currentWorm ? "self" : terrainBetween(game, currentPos, pos)
                });
            }
        }

        entries.sort(function (a, b)
        {
            return a.distance - b.distance;
        });

        return entries;
    }

    export function toMarkdown(game, teamConfig, previousFeedback)
    {
        var currentPlayerIndex = game.state.currentPlayerIndex;
        var currentPlayer = game.state.getCurrentPlayer();
        var currentWorm = currentPlayer.getTeam().getCurrentWorm();
        var currentPos = wormPosition(currentWorm);
        var weapon = currentWorm.getWeapon();
        var weaponList = currentPlayer.getTeam().getWeaponManager().getListOfWeapons();
        var living = collectLivingWorms(game, currentPlayerIndex, currentWorm, currentPos);
        var currentBlastRadius = typeof weapon.explosionRadius == "number" ? weapon.explosionRadius : (typeof weapon.damageToTerrainRadius == "number" ? weapon.damageToTerrainRadius : 0);
        var aimDegrees = currentAimDegrees(currentWorm);
        var forcePercent = round(weapon.getForceIndicator().getForcePercentage ? weapon.getForceIndicator().getForcePercentage() : 1);
        var facing = facingName(currentWorm);
        var markdown = "";

        markdown += "# Worms arena state\n\n";
        markdown += "## Start-of-turn self orientation\n\n";
        markdown += "- Initial facing: `" + facing + "`. This is the worm body's current left/right orientation at the moment control starts.\n";
        markdown += "- Weapon in hand: " + weaponInfo(weapon) + ".\n";
        markdown += "- Aim elevation: " + aimDegrees + " degrees, currently pointing " + aimDirectionWords(aimDegrees) + ". Canvas aim coordinates: -90 is straight up, 0 is right, 90 is down, 180/-180 is left.\n";
        markdown += "- Fire power / force at turn start: " + forcePercent + " percent.\n";
        markdown += "- Wind at turn start: speed 0, direction none. This clone does not implement wind drift.\n\n";

        markdown += "## Current combat situation\n\n";
        markdown += "- Turn: team index `" + currentPlayerIndex + "`, team `" + currentPlayer.getTeam().name + "`.\n";
        markdown += "- Active worm: `" + currentWorm.name + "` at (" + currentPos.x + ", " + currentPos.y + "), HP " + Math.round(currentWorm.health) + ", facing " + facing + ".\n";
        markdown += "- Aim angle: " + aimDegrees + " degrees in canvas coordinates; -90 is up, 0 is right, 90 is down, 180/-180 is left.\n";
        markdown += "- Current weapon: " + weaponInfo(weapon) + ", force percent " + forcePercent + ".\n";
        markdown += "- Current blast/ray risk radius: " + currentBlastRadius + " px. This is only weapon metadata, not a trajectory helper.\n";
        markdown += "- Wind: speed 0, direction none. This clone does not implement wind drift.\n";
        markdown += "- Map bounds: width " + game.terrain.getWidth() + ", height " + game.terrain.getHeight() + ". Water is near the bottom of the visible terrain.\n";
        markdown += "- Your perception mode: " + teamConfig.perception + ".\n\n";
        markdown += "- Visible chat language: " + (teamConfig.chatLanguage || "English") + ". Use this language for `say` and trash talk only; keep tool/action fields in English.\n\n";

        markdown += "## Spatial orientation\n\n";
        markdown += "Coordinate rules: x increases right; y increases downward. Negative dy means above you; positive dy means below you.\n\n";
        for (var entryIndex = 0; entryIndex < living.length; entryIndex++)
        {
            var entry = living[entryIndex];
            markdown += "- " + entry.relation + " `" + entry.name + "` [" + entry.team + "] at (" + entry.x + ", " + entry.y + "), HP " + entry.hp + ": dx " + entry.dx + ", dy " + entry.dy + ", distance " + entry.distance + " px, direction " + entry.direction + ", line: " + entry.obstruction + ".\n";
        }
        markdown += "\n";

        markdown += "## Terrain around active worm\n\n";
        markdown += terrainProfile(game, currentPos) + "\n\n";

        markdown += "## Aim clearance fan\n\n";
        markdown += aimClearanceFan(game, currentPos, aimDegrees) + "\n\n";

        markdown += "## Blast and friendly-fire map\n\n";
        markdown += blastAndFriendlyFireMap(living, currentBlastRadius) + "\n\n";

        markdown += "## Non-ballistic safety notes\n\n";
        markdown += "- These notes do not compute where a projectile will land. They only describe current positions and weapon blast metadata.\n";
        for (var riskIndex = 0; riskIndex < living.length; riskIndex++)
        {
            var risk = living[riskIndex];
            if (risk.relation == "SELF")
            {
                markdown += "- SELF blast caution: active worm is always 0 px from its own muzzle; avoid very low-power shots into nearby terrain.\n";
            } else if (currentBlastRadius > 0 && risk.distance <= currentBlastRadius * 2.2)
            {
                markdown += "- " + risk.relation + " close-range blast caution: `" + risk.name + "` is " + risk.distance + " px from active worm; current weapon radius is " + currentBlastRadius + " px.\n";
            }
        }
        markdown += "- If a line says terrain blocks straight-line view near the active worm, a direct shot may hit that terrain immediately.\n\n";

        markdown += "## Weapons\n\n";
        for (var w = 0; w < weaponList.length; w++)
        {
            markdown += "- " + w + ": " + weaponInfo(weaponList[w]) + ".\n";
        }

        markdown += "\n## Teams and worms\n\n";
        for (var p = 0; p < game.players.length; p++)
        {
            var player = game.players[p];
            var team = player.getTeam();
            markdown += "### Team " + p + ": " + team.name + "\n";
            for (var i = 0; i < team.worms.length; i++)
            {
                var worm = team.worms[i];
                var pos = wormPosition(worm);
                markdown += "- " + worm.name + ": (" + pos.x + ", " + pos.y + "), HP " + Math.round(worm.health) + ", " + (worm.isDead ? "dead" : "alive") + ".";
                if (worm != currentWorm && !worm.isDead)
                {
                    markdown += " From active worm: dx " + (pos.x - currentPos.x) + ", dy " + (pos.y - currentPos.y) + "; " + terrainBetween(game, currentPos, pos) + ".";
                }
                markdown += "\n";
            }
            markdown += "\n";
        }

        if (previousFeedback)
        {
            markdown += previousFeedback + "\n";
        }

        markdown += "## Action primitives\n\n";
        markdown += "Return a batch of low-level actions only. Available tools: `say`, `inspect_inventory`, `select_weapon`, `walk`, `jump`, `backflip`, `aim`, `aim_delta`, `set_power`, `fire`, `wait`, `jetpack_start`, `jetpack_thrust`, `jetpack_stop`, `rope_fire`, `rope_swing`, `rope_contract`, `rope_expand`, `rope_release`.\n";
        markdown += "There is no voluntary end-turn/pass tool. The game ends this worm turn through shot resolution, death, water, mine/physics turn change, or timer expiration. If control remains, the same worm receives fresh feedback while time remains.\n";
        markdown += "`walk` accepts 1-160 primitive steps. Small counts are short key holds; large counts are longer key holds. Terrain may block actual movement; feedback reports dx/dy.\n";
        markdown += "`Jet Pack` and `Ninja Rope` are manual low-level mobility tools. Jetpack screen-relative directions: `up` decreases y, `left` decreases x, `right` increases x, `up_left`, `up_right`. Rope: aim, fire, contract/expand, `rope_swing` left/right, release.\n";
        markdown += "No inventory item is a default move. Inputs for your own action mix: current state, personal memory, inventory, and feedback.\n";
        markdown += "No `move_to`, no computed trajectory helper, no autopilot.\n";

        return markdown;
    }

    export function captureVision(game)
    {
        var source = game.actionCanvas;
        var currentPlayerIndex = game.state.currentPlayerIndex;
        var currentPlayer = game.state.getCurrentPlayer();
        var currentWorm = currentPlayer.getTeam().getCurrentWorm();
        var currentPos = wormPosition(currentWorm);
        var originalCameraX = game.camera.getX();
        var originalCameraY = game.camera.getY();
        var originalPan = game.camera.toPanOrNotToPan;
        var originalPanX = game.camera.panPosition.x;
        var originalPanY = game.camera.panPosition.y;
        var originalPanSpeed = game.camera.panSpeed;

        function clamp(value, min, max)
        {
            return Math.max(min, Math.min(max, value));
        }

        var captureCameraX = clamp(Math.round(currentPos.x - (source.width / 2)), 0, Math.max(0, game.camera.levelWidth - source.width));
        var captureCameraY = clamp(Math.round(currentPos.y - (source.height / 2)), 0, Math.max(0, game.camera.levelHeight - source.height));
        game.camera.cancelPan();
        game.camera.setX(captureCameraX);
        game.camera.setY(captureCameraY);
        game.draw();

        var maxLongEdge = 1280;
        var scale = Math.min(1, maxLongEdge / Math.max(source.width, source.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        var ctx = canvas.getContext("2d");
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        var cameraX = Math.round(game.camera.getX());
        var cameraY = Math.round(game.camera.getY());

        function screenX(worldX)
        {
            return Math.round((worldX - cameraX) * scale);
        }

        function screenY(worldY)
        {
            return Math.round((worldY - cameraY) * scale);
        }

        function visibleOnCanvas(x, y, margin)
        {
            return x >= -margin && y >= -margin && x <= canvas.width + margin && y <= canvas.height + margin;
        }

        function drawOutlinedText(text, x, y, fill, align)
        {
            ctx.save();
            ctx.textAlign = align || "left";
            ctx.lineWidth = Math.max(3, Math.round(4 * scale));
            ctx.strokeStyle = "rgba(0,0,0,0.88)";
            ctx.fillStyle = fill || "#fff";
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
            ctx.restore();
        }

        function drawMarker(worldX, worldY, radius, color, label, labelY)
        {
            var x = screenX(worldX);
            var y = screenY(worldY);
            if (!visibleOnCanvas(x, y, 80))
            {
                return;
            }

            ctx.save();
            ctx.lineWidth = Math.max(2, Math.round(3 * scale));
            ctx.strokeStyle = "#000";
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(2, Math.round(2 * scale));
            ctx.beginPath();
            ctx.moveTo(x - radius * 1.8, y);
            ctx.lineTo(x + radius * 1.8, y);
            ctx.moveTo(x, y - radius * 1.8);
            ctx.lineTo(x, y + radius * 1.8);
            ctx.stroke();

            drawOutlinedText(label, x + radius + 4, labelY || (y - radius - 6), color, "left");
            ctx.restore();
        }

        function drawActiveArrow(worldX, worldY)
        {
            var x = screenX(worldX);
            var y = screenY(worldY);
            if (!visibleOnCanvas(x, y, 100))
            {
                return;
            }

            ctx.save();
            ctx.fillStyle = "#00E5FF";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = Math.max(2, Math.round(3 * scale));
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - 18, y - 28);
            ctx.lineTo(x - 7, y - 28);
            ctx.lineTo(x - 7, y - 56);
            ctx.lineTo(x + 7, y - 56);
            ctx.lineTo(x + 7, y - 28);
            ctx.lineTo(x + 18, y - 28);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            drawOutlinedText("ACTIVE WORM", x + 22, y - 36, "#00E5FF", "left");
            ctx.restore();
        }

        ctx.save();
        ctx.font = Math.max(11, Math.round(13 * scale)) + "px Sans-Serif";
        ctx.textAlign = "left";
        ctx.strokeStyle = "rgba(255,255,255,0.42)";
        ctx.fillStyle = "rgba(255,255,255,0.9)";

        var firstGridWorldX = Math.ceil(cameraX / 100) * 100;
        for (var worldX = firstGridWorldX; worldX <= cameraX + source.width; worldX += 100)
        {
            var scaledX = screenX(worldX);
            ctx.lineWidth = worldX % 500 == 0 ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(scaledX, 0);
            ctx.lineTo(scaledX, canvas.height);
            ctx.stroke();
            if (scaledX > 44)
            {
                drawOutlinedText(String(worldX), scaledX + 4, 15, "rgba(255,255,255,0.95)", "left");
            }
        }

        var firstGridWorldY = Math.ceil(cameraY / 100) * 100;
        for (var worldY = firstGridWorldY; worldY <= cameraY + source.height; worldY += 100)
        {
            var scaledY = screenY(worldY);
            ctx.lineWidth = worldY % 500 == 0 ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(0, scaledY);
            ctx.lineTo(canvas.width, scaledY);
            ctx.stroke();
            if (scaledY > 24)
            {
                drawOutlinedText(String(worldY), 4, scaledY + 15, "rgba(255,255,255,0.95)", "left");
            }
        }

        ctx.font = Math.max(12, Math.round(15 * scale)) + "px Sans-Serif";
        for (var p = 0; p < game.players.length; p++)
        {
            var player = game.players[p];
            var team = player.getTeam();
            for (var i = 0; i < team.worms.length; i++)
            {
                var worm = team.worms[i];
                if (worm.isDead)
                {
                    continue;
                }
                var pos = wormPosition(worm);
                var relation = worm == currentWorm ? "SELF" : (p == currentPlayerIndex ? "ALLY" : "ENEMY");
                var label = relation + " " + worm.name + " HP " + Math.round(worm.health) + " (" + pos.x + "," + pos.y + ")";
                var markerColor = relation == "SELF" ? "#00E5FF" : team.color;
                drawMarker(pos.x, pos.y - 26, relation == "SELF" ? 9 : 7, markerColor, label, screenY(pos.y - 54));
            }
        }

        var aimAngle = currentAimDegrees(currentWorm);
        var aimRadians = Utilies.toRadians(aimAngle);
        var aimStartX = screenX(currentPos.x);
        var aimStartY = screenY(currentPos.y - 28);
        var aimLength = Math.round(150 * scale);
        drawActiveArrow(currentPos.x, currentPos.y - 80);
        ctx.strokeStyle = "#00E5FF";
        ctx.lineWidth = Math.max(2, Math.round(3 * scale));
        ctx.beginPath();
        ctx.moveTo(aimStartX, aimStartY);
        ctx.lineTo(aimStartX + (Math.cos(aimRadians) * aimLength), aimStartY + (Math.sin(aimRadians) * aimLength));
        ctx.stroke();
        drawOutlinedText("CURRENT AIM " + aimAngle + " deg", aimStartX + 10, aimStartY - 12, "#00E5FF", "left");

        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(8, 24, Math.min(canvas.width - 16, 560), 92);
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 1;
        ctx.strokeRect(8, 24, Math.min(canvas.width - 16, 560), 92);
        ctx.font = Math.max(12, Math.round(14 * scale)) + "px Sans-Serif";
        drawOutlinedText("VLM START-OF-TURN SCREENSHOT", 18, 44, "#fff", "left");
        drawOutlinedText("Grid labels are world coordinates. x -> right, y -> down.", 18, 64, "#fff", "left");
        drawOutlinedText("Cyan ACTIVE WORM arrow + SELF marker identify you. Team colors mark allies/enemies. No aim solving.", 18, 84, "#fff", "left");
        drawOutlinedText("Active: " + currentWorm.name + " HP " + Math.round(currentWorm.health) + " at (" + currentPos.x + "," + currentPos.y + ")", 18, 104, "#00E5FF", "left");
        ctx.restore();

        var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        game.camera.setX(originalCameraX);
        game.camera.setY(originalCameraY);
        game.camera.toPanOrNotToPan = originalPan;
        game.camera.panPosition.x = originalPanX;
        game.camera.panPosition.y = originalPanY;
        game.camera.panSpeed = originalPanSpeed;
        game.draw();
        return dataUrl;
    }
}
