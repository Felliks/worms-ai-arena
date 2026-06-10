/**
 * VideoCapture.ts
 *
 * Orchestrator wired into the main gameloop (one tick() call). It:
 *   - auto-starts MatchRecorder when an arena match begins (after the menu
 *     gesture, so the audio context is already unlocked);
 *   - drives the per-frame compose + MatchTimeline poll;
 *   - surfaces unobtrusive "clip-worthy" hints (score threshold + cooldown);
 *   - stops the recorder shortly after a winner is decided (post-roll keeps the
 *     victory fanfare) and enables the "create video" button.
 *
 * Everything is guarded so a missing module or an unsupported browser simply
 * disables the feature without affecting gameplay.
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts"/>
///<reference path="../Game.ts"/>
///<reference path="MatchRecorder.ts"/>
///<reference path="MatchTimeline.ts"/>
///<reference path="../gui/VideoOverlay.ts"/>

module VideoCapture
{
    var phase = "idle";          // idle | recording | ended
    var lastMusicReqAt = -1000000; // last music-director request (match-relative ms)
    var musicVariation = -1;     // bumped each refresh so the LLM evolves the track
    var MUSIC_REFRESH_MS = 90000; // re-ask the director for fresh material every 90s
    var seenMomentCount = 0;
    var lastHintAt = -100000;
    var endedAt = 0;
    var lastComposeAt = 0;       // throttle the 1280x720 copy below the 60fps gameloop

    var COMPOSE_MIN_MS = 22;     // ~45fps: bounds capture cost, keeps frames fresh

    var HINT_THRESHOLD = 0.7;    // only nudge for genuinely juicy moments
    var HINT_COOLDOWN_MS = 18000;
    var POST_ROLL_MS = 2600;     // keep the victory sound in the recording

    function now()
    {
        return (typeof performance != "undefined" && performance.now) ? performance.now() : Date.now();
    }

    function matchActive()
    {
        return typeof GameInstance != "undefined"
            && GameInstance.state
            && GameInstance.state.isStarted
            && !GameInstance.winner;
    }

    // Only auto-capture the AI arena matches (the viral surface). Local human
    // games are left alone.
    function isArenaMatch()
    {
        return typeof ArenaControllerInstance != "undefined" && ArenaControllerInstance.enabled;
    }

    function resetCaptureState()
    {
        phase = "idle";
        lastMusicReqAt = -1000000;
        musicVariation = -1;
        seenMomentCount = 0;
        lastHintAt = -100000;
        endedAt = 0;
        lastComposeAt = 0;
    }

    export function tick()
    {
        if (typeof MatchRecorder == "undefined" || !MatchRecorder.isSupported) { return; }

        // If a caller starts another arena match in the same page after a completed
        // match, do not leave this singleton stuck in the old ended phase.
        if (phase == "ended" && matchActive() && isArenaMatch() && !MatchRecorder.isRecording())
        {
            resetCaptureState();
        }

        if (phase == "idle")
        {
            if (matchActive() && isArenaMatch())
            {
                if (MatchRecorder.start())
                {
                    phase = "recording";
                    seenMomentCount = 0;
                    lastHintAt = -100000;
                    if (typeof VideoOverlay != "undefined")
                    {
                        VideoOverlay.init();
                        VideoOverlay.setCreateEnabled(false);
                        VideoOverlay.setVisible(true);
                    }
                }
            }
            return;
        }

        if (phase == "recording")
        {
            // Compose the recorded frame from the freshly-drawn game canvas (throttled).
            var nowMs = now();
            if (nowMs - lastComposeAt >= COMPOSE_MIN_MS) { lastComposeAt = nowMs; try { MatchRecorder.composeFrame(); } catch (e) { } }
            // Poll deaths / winner / team HP for the moment detector + soundtrack mood.
            try { if (typeof MatchTimeline != "undefined") { MatchTimeline.tick(); } } catch (e) { }

            // Drive the adaptive soundtrack from match tension (ArenaMusic applies its
            // own hysteresis + dwell + smooth ramp, so calling every frame is safe).
            try { if (typeof ArenaMusic != "undefined" && ArenaMusic.setMood && typeof MatchTimeline != "undefined") { ArenaMusic.setMood(MatchTimeline.getMood()); } } catch (e) { }

            // Ask the BYOK music director for a fresh LLM-composed Tone.js soundtrack at
            // match start and every ~90s after, so the music keeps generating + evolving.
            if (now() - lastMusicReqAt > MUSIC_REFRESH_MS) { lastMusicReqAt = now(); musicVariation++; requestMusicDirector(musicVariation); }

            surfaceHints();

            if (typeof GameInstance != "undefined" && GameInstance.winner)
            {
                phase = "ended";
                endedAt = now();
                if (typeof MatchRecorder != "undefined")
                {
                    MatchRecorder.stop(POST_ROLL_MS, function ()
                    {
                        if (typeof VideoOverlay != "undefined") { VideoOverlay.setCreateEnabled(true); }
                    });
                }
            }
            return;
        }

        if (phase == "ended")
        {
            // Keep composing briefly so the final frame stays fresh while post-roll
            // is still recording.
            var nowEnd = now();
            if (nowEnd - endedAt < POST_ROLL_MS + 500 && (nowEnd - lastComposeAt >= COMPOSE_MIN_MS))
            {
                lastComposeAt = nowEnd;
                try { MatchRecorder.composeFrame(); } catch (e) { }
            }
            return;
        }
    }

    function surfaceHints()
    {
        if (typeof MatchTimeline == "undefined" || typeof VideoOverlay == "undefined") { return; }
        var moments = MatchTimeline.getMoments();
        if (moments.length <= seenMomentCount) { return; }

        // Consider only moments discovered since last check; nudge for the best.
        var best = null;
        for (var i = seenMomentCount; i < moments.length; i++)
        {
            if (!best || moments[i].score > best.score) { best = moments[i]; }
        }
        seenMomentCount = moments.length;

        if (best && best.score >= HINT_THRESHOLD && (now() - lastHintAt) >= HINT_COOLDOWN_MS)
        {
            lastHintAt = now();
            VideoOverlay.flashMoment(best.title);
        }
    }

    export function getPhase() { return phase; }

    function musicConnection()
    {
        try
        {
            if (typeof ArenaConfig == "undefined" || !ArenaConfig.current) { return null; }
            var conns = ArenaConfig.current.connections || [];
            for (var i = 0; i < conns.length; i++)
            {
                var c = conns[i];
                if (c && c.baseURL && String(c.baseURL).trim()) { return c; }
            }
        }
        catch (e) { }
        return null;
    }

    // Ask the optional BYOK music-director agent for a Tone.js soundtrack spec for
    // this matchup. On success the battle music is regenerated from it; on no key /
    // failure the procedural per-match generation already playing is kept.
    function requestMusicDirector(variation)
    {
        try
        {
            if (typeof ArenaMusic == "undefined" || !ArenaMusic.applyDirectorSpec) { return; }
            var matchup: any[] = [];
            if (typeof GameInstance != "undefined" && GameInstance.players)
            {
                var cfgs = (typeof ArenaControllerInstance != "undefined") ? ArenaControllerInstance.teamConfigs : null;
                for (var i = 0; i < GameInstance.players.length; i++)
                {
                    var team = GameInstance.players[i].getTeam();
                    var cfg = (cfgs && cfgs[i]) ? cfgs[i] : null;
                    matchup.push({ name: team.name, model: cfg ? cfg.model : "", persona: cfg ? cfg.personality : "" });
                }
            }
            var body: any = { matchup: matchup, mood: (typeof MatchTimeline != "undefined") ? MatchTimeline.getMood() : "tense", variation: variation || 0 };
            var conn = musicConnection();
            if (conn) { body.baseURL = conn.baseURL; body.apiKey = conn.apiKey; body.model = conn.model; }

            fetch("/api/music/direct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
                .then(function (r) { return r.json(); })
                .then(function (data) { if (data && data.ok && data.spec) { try { ArenaMusic.applyDirectorSpec(data.spec); } catch (e) { } } })
                ["catch"](function () { });
        }
        catch (e) { }
    }
}
