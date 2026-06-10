/**
 * MatchTimeline.ts
 *
 * Read-only observer of an LLM-arena match that builds a timestamped event log
 * and detects "clip-worthy" moments (friendly fire, instant karma, beef,
 * comeback, epic kill). It is a layer ON TOP of the engine: it never changes a
 * decision, aim, power, target, or any fairness-relevant behaviour.
 *
 * How it observes without touching off-limits files (src/llm/Arena*):
 *   - It monkey-patches ArenaTelemetry.finishAction at runtime to read each
 *     completed action record (damage / explosions / HP deltas), calling the
 *     original and returning its result unchanged.
 *   - It monkey-patches ArenaController.prototype.handleDecision to read the
 *     model's trashTalk / target / optional clipSignal, again pass-through.
 *   - It polls game.winner and worm.isDead each frame for deaths / win.
 *
 * Timestamps are recorder-relative (ms since MatchTimeline.reset()), so moment
 * timecodes map directly onto the recorded media.
 *
 * Works fully offline / on mock models (deterministic). Optional agent signals
 * (clipSignal) only boost scores and labels; they are never required.
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts"/>
///<reference path="../Game.ts"/>
///<reference path="../llm/ArenaController.ts"/>
///<reference path="../llm/ArenaTelemetry.ts"/>

module MatchTimeline
{
    // ---- shared recorder clock ----------------------------------------------
    var epochPerf = 0;          // performance.now() at match/record start
    var started = false;

    function perfNow()
    {
        return (typeof performance != "undefined" && performance.now) ? performance.now() : Date.now();
    }

    // Milliseconds since reset(); the canonical clip clock.
    export function now()
    {
        return Math.max(0, Math.round(perfNow() - epochPerf));
    }

    export function isStarted() { return started; }

    // ---- state ---------------------------------------------------------------
    var events: any[] = [];      // ordered {t, kind, ...}
    var moments: any[] = [];     // detected {id, type, t0, t1, score, title, ...}
    var momentSeq = 0;

    var installed = false;
    var lastWinnerTeam = -1;
    var deadSeen: any = {};      // wormId -> true (death already emitted)
    var lastTaunt: any = {};     // teamIndex -> {t, wormId, name, text, target, clip}
    var hitMatrix: any = {};     // "attackerId|victimId" -> count (beef)
    var teamLowWater: any = {};  // teamIndex -> true once team dropped below comeback threshold
    var teamHp: any = {};        // teamIndex -> last sampled aggregate HP fraction (0..1)
    var teamHpMax: any = {};     // teamIndex -> peak aggregate HP seen = the team's starting HP
    var lastActiveKey = "";      // active team:worm key, for turn_start (latency editing)
    var moodValue = 0;           // smoothed 0..1 tension for the adaptive soundtrack

    var COMEBACK_LOW = 0.25;     // team HP fraction that counts as "near death"
    var EPIC_DAMAGE = 55;        // single-shot total damage that counts as epic
    var BEEF_MIN = 3;            // repeated hits A->B to call it beef

    // ---- lifecycle -----------------------------------------------------------

    // Begin (or restart) observing. Called by MatchRecorder when capture starts.
    export function reset()
    {
        epochPerf = perfNow();
        started = true;
        events = [];
        moments = [];
        momentSeq = 0;
        lastWinnerTeam = -1;
        deadSeen = {};
        lastTaunt = {};
        hitMatrix = {};
        teamLowWater = {};
        teamHp = {};
        teamHpMax = {};
        lastActiveKey = "";
        moodValue = 0;
        install();
    }

    export function stop() { started = false; }

    function install()
    {
        if (installed) { return; }
        installed = true;

        // Observe every completed action record (pass-through wrapper).
        try
        {
            if (typeof ArenaTelemetry != "undefined" && typeof ArenaTelemetry.finishAction == "function")
            {
                var origFinish = ArenaTelemetry.finishAction;
                ArenaTelemetry.finishAction = function ()
                {
                    var record = origFinish.apply(ArenaTelemetry, arguments);
                    if (started && record) { try { ingestRecord(record); } catch (e) { } }
                    return record;
                };
            }
        }
        catch (e) { }

        // Observe the model's decision metadata (pass-through wrapper).
        try
        {
            if (typeof ArenaController != "undefined" && ArenaController.prototype && ArenaController.prototype.handleDecision)
            {
                var origHandle = ArenaController.prototype.handleDecision;
                ArenaController.prototype.handleDecision = function (config, decision, turnContext)
                {
                    if (started && decision) { try { ingestDecision(decision, turnContext); } catch (e) { } }
                    return origHandle.apply(this, arguments);
                };
            }
        }
        catch (e) { }
    }

    // ---- ingestion -----------------------------------------------------------

    function relation(attacker, victim)
    {
        if (!attacker || !victim) { return "enemy"; }
        if (attacker.teamIndex == victim.teamIndex && attacker.name == victim.name) { return "self"; }
        return attacker.teamIndex == victim.teamIndex ? "ally" : "enemy";
    }

    function currentBubbleMeta(teamIndex, wormName)
    {
        var meta: any = { screenX: null, screenY: null, canvasW: null, canvasH: null, teamColor: "" };
        try
        {
            if (typeof GameInstance == "undefined" || !GameInstance.players || teamIndex < 0 || !GameInstance.players[teamIndex]) { return meta; }
            var game = GameInstance;
            var player = game.players[teamIndex];
            var team = player && player.getTeam ? player.getTeam() : null;
            if (team && team.color) { meta.teamColor = team.color; }
            var worm = team && team.getCurrentWorm ? team.getCurrentWorm() : null;
            if ((!worm || worm.name != wormName) && team && team.worms)
            {
                for (var i = 0; i < team.worms.length; i++)
                {
                    if (team.worms[i] && team.worms[i].name == wormName)
                    {
                        worm = team.worms[i];
                        break;
                    }
                }
            }
            var canvas = game.actionCanvas;
            meta.canvasW = canvas && canvas.width ? canvas.width : ((typeof window != "undefined") ? window.innerWidth : null);
            meta.canvasH = canvas && canvas.height ? canvas.height : ((typeof window != "undefined") ? window.innerHeight : null);
            if (worm && worm.body && game.camera)
            {
                var px = Physics.vectorMetersToPixels(worm.body.GetPosition().Copy());
                meta.screenX = px.x - game.camera.getX();
                meta.screenY = px.y - game.camera.getY();
            }
        }
        catch (e) { }
        return meta;
    }

    function ingestDecision(decision, turnContext)
    {
        var teamIndex = turnContext ? turnContext.playerIndex : -1;
        var wormName = turnContext ? turnContext.wormName : "";
        var clip = decision.clipSignal && typeof decision.clipSignal == "object" ? decision.clipSignal : null;
        var bubble = currentBubbleMeta(teamIndex, wormName);
        var taunt = {
            t: now(),
            teamIndex: teamIndex,
            wormId: turnContext ? turnContext.wormId : ("team-" + teamIndex + ":" + wormName),
            name: wormName,
            text: String(decision.trashTalk || "").trim(),
            target: decision.target ? String(decision.target) : "",
            screenX: bubble.screenX,
            screenY: bubble.screenY,
            canvasW: bubble.canvasW,
            canvasH: bubble.canvasH,
            teamColor: bubble.teamColor,
            clip: clip
        };
        lastTaunt[teamIndex] = taunt;
        if (taunt.text)
        {
            events.push({
                t: taunt.t, kind: "taunt", teamIndex: teamIndex, wormId: taunt.wormId, name: wormName,
                text: taunt.text, target: taunt.target, screenX: taunt.screenX, screenY: taunt.screenY,
                canvasW: taunt.canvasW, canvasH: taunt.canvasH, teamColor: taunt.teamColor, clip: clip
            });
        }
        // An agent that flags its own turn as clip-worthy seeds a weak moment that
        // any real outcome below will strengthen. Purely cosmetic, never tactical.
        // The optional clipSignal.mood biases the (cosmetic) soundtrack mood - this
        // is the bounded test of "agents influence the music", with zero fairness
        // impact (it never touches aim/power/target/weapon/actions).
        if (clip && clip.mood)
        {
            var e = clipMoodEnergy(clip.mood);
            if (e != null) { moodValue = clamp01(Math.max(moodValue, e * 0.85)); }
        }
        if (clip && clip.clipWorthy)
        {
            bumpMood(0.25);
        }
    }

    function clipMoodEnergy(m)
    {
        if (m == "climax") { return 1.0; }
        if (m == "tense") { return 0.72; }
        if (m == "active") { return 0.45; }
        if (m == "comedic") { return 0.5; }
        if (m == "somber") { return 0.3; }
        if (m == "calm") { return 0.15; }
        return null;
    }

    function ingestRecord(record)
    {
        var t = now();
        var actor = record.actor;
        var damages = record.damage || [];
        var explosions = record.explosions || [];

        // Explosions (used for camera centroid + spectacle scoring).
        for (var e = 0; e < explosions.length; e++)
        {
            var ex = explosions[e];
            events.push({ t: t, kind: "explosion", x: ex.x, y: ex.y, radius: ex.radius, maxDamage: ex.maxDamage });
        }

        // Damage, classified by relation.
        var selfDamage = 0, friendlyDamage = 0, enemyDamage = 0;
        var kills: any[] = [];
        var killedIds: any = {};     // dedupe: a multi-pellet weapon hits one worm many times
        for (var d = 0; d < damages.length; d++)
        {
            var hit = damages[d];
            if (!hit || !hit.target) { continue; }
            var rel = relation(actor, hit.target);
            var amount = hit.damage || 0;
            if (rel == "self") { selfDamage += amount; }
            else if (rel == "ally") { friendlyDamage += amount; }
            else { enemyDamage += amount; }

            var x = hit.target.x, y = hit.target.y;
            events.push({
                t: t, kind: "damage", relation: rel, amount: amount,
                attackerId: actor ? actor.id : null, attackerName: actor ? actor.name : null,
                attackerTeam: actor ? actor.team : null, attackerTeamIndex: actor ? actor.teamIndex : -1,
                victimId: hit.target.id, victimName: hit.target.name, victimTeam: hit.target.team,
                victimTeamIndex: hit.target.teamIndex, tool: record.action ? record.action.tool : "", x: x, y: y
            });

            if (rel == "enemy" && actor)
            {
                var key = actor.id + "|" + hit.target.id;
                hitMatrix[key] = (hitMatrix[key] || 0) + 1;
            }
            if (hit.estimatedHealthAfterQueuedDamage === 0 && hit.target.id && !killedIds[hit.target.id])
            {
                killedIds[hit.target.id] = true;
                kills.push(hit.target);
            }
        }

        // --- moment: friendly fire (incl. self) ---
        if (friendlyDamage > 0 || selfDamage > 0)
        {
            var who = actor ? (actor.team + " / " + actor.name) : "a worm";
            var ffScore = clamp01(0.55 + (friendlyDamage + selfDamage) / 80);
            addMoment("friendly_fire", t - 1500, t + 2200, ffScore,
                "🤦 " + (actor ? actor.team : "Team") + " friendly fire",
                who + " damaged its own side for " + round1(friendlyDamage + selfDamage),
                actor, [actor ? actor.teamIndex : -1]);
            bumpMood(0.5);
        }

        // --- moment: instant karma (taunt then self-harm same turn) ---
        if (selfDamage > 0 && actor)
        {
            var taunt = lastTaunt[actor.teamIndex];
            if (taunt && taunt.name == actor.name && (t - taunt.t) < 60000)
            {
                addMoment("instant_karma", taunt.t - 800, t + 2500,
                    clamp01(0.7 + selfDamage / 60),
                    "😈 Instant karma — " + actor.name,
                    "Talked big, then hit itself for " + round1(selfDamage),
                    actor, [actor.teamIndex]);
                bumpMood(0.6);
            }
        }

        // --- moment: epic / multi kill ---
        if (kills.length >= 2)
        {
            addMoment("multi_kill", t - 1800, t + 2600, clamp01(0.8 + kills.length * 0.05),
                "💥 Double KO — " + (actor ? actor.name : "?"),
                (actor ? actor.team : "") + " took out " + kills.length + " worms in one shot",
                actor, [actor ? actor.teamIndex : -1]);
            bumpMood(0.85);
        }
        else if (enemyDamage >= EPIC_DAMAGE)
        {
            addMoment("epic_kill", t - 1500, t + 2400, clamp01(0.6 + enemyDamage / 120),
                "🔥 Epic hit — " + (actor ? actor.name : "?"),
                (actor ? actor.team : "") + " dealt " + round1(enemyDamage) + " damage",
                actor, [actor ? actor.teamIndex : -1]);
            bumpMood(0.7);
        }
        else if (enemyDamage > 0)
        {
            bumpMood(0.35);
        }
    }

    // ---- per-frame poll (deaths / win / team HP) -----------------------------

    export function tick()
    {
        if (!started || typeof GameInstance == "undefined" || !GameInstance.players) { return; }
        var game = GameInstance;
        var t = now();

        for (var p = 0; p < game.players.length; p++)
        {
            var team = game.players[p].getTeam();
            var hpSum = 0;
            for (var i = 0; i < team.worms.length; i++)
            {
                var worm = team.worms[i];
                if (!worm.isDead)
                {
                    hpSum += Math.max(0, worm.health || 0);
                    continue;
                }
                var wid = "team-" + p + ":" + worm.name;
                if (!deadSeen[wid])
                {
                    deadSeen[wid] = true;
                    events.push({ t: t, kind: "death", wormId: wid, name: worm.name, teamIndex: p, sunk: !!worm.sunk });
                    bumpMood(0.5);
                }
            }
            // Baseline = the peak aggregate HP ever seen (the team's starting HP),
            // so comeback detection is correct for any configured worm health.
            teamHpMax[p] = Math.max(teamHpMax[p] || 0, hpSum);
            var frac = teamHpMax[p] > 0 ? hpSum / teamHpMax[p] : 0;
            teamHp[p] = frac;
            if (frac > 0 && frac <= COMEBACK_LOW) { teamLowWater[p] = true; }
        }

        // Turn change -> record turn_start so the montage can compress the model's
        // "thinking" dead air (the gap from turn_start to the first say/action).
        try
        {
            var cp = (game.state && game.state.getCurrentPlayer) ? game.state.getCurrentPlayer() : null;
            var ci = cp ? game.players.indexOf(cp) : -1;
            var cw = (cp && cp.getTeam) ? cp.getTeam().getCurrentWorm() : null;
            if (cw)
            {
                var akey = ci + ":" + cw.name;
                if (akey != lastActiveKey)
                {
                    lastActiveKey = akey;
                    events.push({ t: t, kind: "turn_start", teamIndex: ci, name: cw.name });
                }
            }
        }
        catch (e) { }

        // Win detection + comeback resolution.
        if (game.winner)
        {
            var winTeamIndex = game.players.indexOf(game.winner);
            if (winTeamIndex != lastWinnerTeam)
            {
                lastWinnerTeam = winTeamIndex;
                var teamName = game.winner.getTeam().name;
                events.push({ t: t, kind: "win", teamIndex: winTeamIndex, teamName: teamName });
                if (teamLowWater[winTeamIndex])
                {
                    addMoment("comeback", Math.max(0, t - 9000), t + 2500, 0.9,
                        "🏆 Comeback — " + teamName,
                        teamName + " was nearly wiped out and still won",
                        null, [winTeamIndex]);
                }
            }
        }

        // Tension decays toward calm when nothing happens.
        moodValue = moodValue * 0.992;
    }

    // ---- moment helpers ------------------------------------------------------

    function addMoment(type, t0, t1, score, title, subtitle, actor, teamIndexes)
    {
        moments.push({
            id: "m" + (momentSeq++),
            type: type,
            t0: Math.max(0, Math.round(t0)),
            t1: Math.round(t1),
            score: clamp01(score),
            title: title,
            subtitle: subtitle,
            actorName: actor ? actor.name : null,
            actorTeam: actor ? actor.team : null,
            actorTeamIndex: actor ? actor.teamIndex : (teamIndexes && teamIndexes.length ? teamIndexes[0] : -1),
            teamIndexes: teamIndexes || []
        });
    }

    function bumpMood(v) { moodValue = clamp01(Math.max(moodValue, moodValue + v * 0.5)); }
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function round1(v) { return Math.round(v * 10) / 10; }

    // ---- public reads --------------------------------------------------------

    export function getEvents() { return events; }
    export function getMoments() { return moments.slice(); }
    export function getMoodValue() { return moodValue; }

    // Coarse mood label for the adaptive soundtrack / montage scoring.
    export function getMood()
    {
        if (moodValue >= 0.75) { return "climax"; }
        if (moodValue >= 0.45) { return "tense"; }
        if (moodValue >= 0.18) { return "active"; }
        return "calm";
    }

    // The action centroid over a time window — used to crop landscape footage to
    // 9:16 / 1:1 without losing the action.
    export function actionCentroid(t0, t1)
    {
        var sx = 0, sy = 0, n = 0;
        for (var i = 0; i < events.length; i++)
        {
            var ev = events[i];
            if (ev.t < t0 || ev.t > t1) { continue; }
            if (ev.kind == "explosion" || ev.kind == "damage")
            {
                sx += ev.x; sy += ev.y; n++;
            }
        }
        return n > 0 ? { x: sx / n, y: sy / n, n: n } : null;
    }

    // The top beef pair (most repeated A->B enemy hits), if any.
    export function topBeef()
    {
        var best = null, bestCount = 0;
        for (var key in hitMatrix)
        {
            if (hitMatrix[key] > bestCount)
            {
                bestCount = hitMatrix[key];
                best = key;
            }
        }
        if (!best || bestCount < BEEF_MIN) { return null; }
        var parts = best.split("|");
        return { attackerId: parts[0], victimId: parts[1], count: bestCount };
    }

    // Concrete, match-specific video scenarios derived from the log. Each carries an
    // EDL of {t0,t1 (seconds), rate} segments for MatchRecorder.render(). Moment
    // reels inherently skip the dead "thinking" air by cutting to the action windows.
    export function getScenarios()
    {
        var endMs = events.length ? events[events.length - 1].t : now();
        var endSec = Math.max(2, endMs / 1000);
        var list: any[] = [];

        list.push({
            id: "last30", icon: "⚡", title: "Last 30 seconds",
            subtitle: "The finish, instant", instant: true,
            segments: [{ t0: Math.max(0, endSec - 30), t1: endSec + 1, rate: 1 }]
        });

        var fullRate = Math.max(2, Math.round(endSec / 40));
        list.push({
            id: "full", icon: "🎬", title: "Whole match, sped up",
            subtitle: "~" + Math.max(1, Math.round(endSec / fullRate)) + "s timelapse",
            segments: [{ t0: 0, t1: endSec + 1, rate: fullRate }]
        });

        var byType: any = {};
        for (var i = 0; i < moments.length; i++)
        {
            var m = moments[i];
            (byType[m.type] = byType[m.type] || []).push(m);
        }

        // Highlights reel (top moments by score, chronological).
        if (moments.length >= 2)
        {
            var top = moments.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 6)
                .sort(function (a, b) { return a.t0 - b.t0; });
            var hsegs: any[] = [];
            for (var h = 0; h < top.length; h++) { hsegs = hsegs.concat(segmentsForMoment(top[h])); }
            list.push({ id: "highlights", icon: "⭐", title: "Highlights reel", subtitle: top.length + " best moments", segments: hsegs });
        }

        var groups: any = {
            friendly_fire: { icon: "🤦", name: "Friendly fire" },
            instant_karma: { icon: "😈", name: "Instant karma" },
            beef: { icon: "🔥", name: "Beef" },
            epic_kill: { icon: "💥", name: "Epic hits" },
            multi_kill: { icon: "💀", name: "Multi-kills" },
            comeback: { icon: "🏆", name: "Comeback" }
        };
        for (var key in groups)
        {
            var ms = byType[key];
            if (!ms || !ms.length) { continue; }
            // Slow-mo the impact-heavy reels for emphasis.
            var rate = (key == "epic_kill" || key == "multi_kill") ? 0.6 : 1;
            var segs: any[] = [];
            for (var j = 0; j < ms.length; j++) { segs = segs.concat(segmentsForMoment(ms[j], rate)); }
            list.push({ id: key, icon: groups[key].icon, title: groups[key].name + " (" + ms.length + ")", subtitle: ms[0].subtitle || "", segments: segs });
        }

        return list;
    }

    // Build segments for one moment: a short trash-talk window (so the worm's line is
    // SHOWN, not skipped) followed by the action window. Times in seconds.
    export function segmentsForMoment(moment, rate)
    {
        var segs = [];
        var taunt = null;
        for (var i = 0; i < events.length; i++)
        {
            var e = events[i];
            if (e.kind == "taunt" && e.text && e.t <= moment.t1 && (moment.actorTeamIndex < 0 || e.teamIndex == moment.actorTeamIndex))
            {
                taunt = e;
            }
        }
        var actionT0 = Math.max(0, moment.t0 / 1000);
        if (taunt)
        {
            // The clip STARTS on the trash-talk: a window long enough to stream + read
            // the line, then it ends and the action segment plays.
            var ts = taunt.t / 1000;
            var t1 = ts + tauntWindowMs(taunt.text) / 1000;
            var meta = {
                t: taunt.t, name: taunt.name, text: taunt.text, teamIndex: taunt.teamIndex, wormId: taunt.wormId,
                screenX: taunt.screenX, screenY: taunt.screenY, canvasW: taunt.canvasW, canvasH: taunt.canvasH,
                teamColor: taunt.teamColor
            };
            segs.push({ t0: Math.max(0, ts), t1: t1, rate: 1, taunt: meta });
            actionT0 = Math.max(actionT0, t1);
        }
        if (moment.t1 / 1000 > actionT0 + 0.05) { segs.push({ t0: actionT0, t1: moment.t1 / 1000, rate: rate || 1 }); }
        return segs;
    }

    function momentSegments(moment, rate) { return segmentsForMoment(moment, rate); }

    // How long a trash-talk line is shown (stream-in + a hold to read), by length.
    export function tauntWindowMs(text)
    {
        var len = text ? String(text).length : 20;
        return Math.min(5400, Math.max(2600, Math.round(len / 24 * 1000) + 1700));
    }

    // The trash-talk line active at master-time tMs (the render streams it into the
    // clip - the live bubble is a DOM overlay and is NOT in the recorded canvas). It
    // disappears after its reading window so the worm then acts cleanly.
    export function getTauntAt(tMs)
    {
        var best = null;
        for (var i = 0; i < events.length; i++)
        {
            var e = events[i];
            if (e.kind == "taunt" && e.text)
            {
                if (e.t <= tMs) { best = e; }
                else { break; }
            }
        }
        if (best && (tMs - best.t) <= tauntWindowMs(best.text)) { return best; }
        return null;
    }
}
