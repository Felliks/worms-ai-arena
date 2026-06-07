/**
 * MenuAudio.ts
 * Front-menu music + UI click sounds + the themed menu background.
 *
 * Audio is INDEPENDENT of Settings.SOUND (which gates the in-game pipeline).
 * If an original asset pack provides music/<menu>.ogg it is used; otherwise a
 * small, self-contained Web Audio ambient pad + click blips are synthesised so
 * the menu always has sound without bundling any copyrighted audio. The mute
 * toggle (persisted) controls everything. Nothing here touches gameplay code.
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts" />

module MenuAudio
{
    var audioEl = null;
    var muteBtn = null;
    var started = false;
    var muted = false;
    var initialised = false;
    var realMusic = false;

    // Web Audio (procedural fallback) state.
    var ctx = null;
    var masterGain = null;
    var ambientGain = null;
    var ambientNodes = [];
    var ambientOn = false;

    function storageGet()
    {
        try { return window.localStorage.getItem("wormsMenuMuted") == "true"; }
        catch (e) { return false; }
    }
    function storageSet(value)
    {
        try { window.localStorage.setItem("wormsMenuMuted", value ? "true" : "false"); }
        catch (e) { }
    }

    function ensureCtx()
    {
        if (!ctx)
        {
            var AC = window["AudioContext"] || window["webkitAudioContext"];
            if (!AC) { return null; }
            try { ctx = new AC(); } catch (e) { return null; }
            masterGain = ctx.createGain();
            masterGain.gain.value = muted ? 0 : 1;
            masterGain.connect(ctx.destination);
        }
        if (ctx.state == "suspended") { try { ctx.resume(); } catch (e) { } }
        return ctx;
    }

    // A soft, slow ambient pad (warm drone + gentle filter movement). Original,
    // synthesised – not derived from any copyrighted track.
    function startProcedural()
    {
        if (ambientOn || muted) { return; }
        var c = ensureCtx();
        if (!c) { return; }
        ambientOn = true;

        var now = c.currentTime;
        var lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 650;
        lp.Q.value = 0.6;

        ambientGain = c.createGain();
        ambientGain.gain.setValueAtTime(0.0001, now);
        ambientGain.gain.linearRampToValueAtTime(0.11, now + 3.5);
        ambientGain.connect(lp);
        lp.connect(masterGain);

        ambientNodes = [];
        var freqs = [110.0, 164.81, 220.0, 329.63]; // A2 · E3 · A3 · E4 – open, calm
        for (var i = 0; i < freqs.length; i++)
        {
            var o = c.createOscillator();
            o.type = (i % 2 == 0) ? "triangle" : "sine";
            o.frequency.value = freqs[i];
            o.detune.value = (i - 1.5) * 5;
            var g = c.createGain();
            g.gain.value = 0.22 / (i + 1);
            o.connect(g);
            g.connect(ambientGain);
            o.start();
            ambientNodes.push(o);
        }

        // slow cutoff sweep for movement
        var lfo = c.createOscillator();
        lfo.frequency.value = 0.045;
        var lfoGain = c.createGain();
        lfoGain.gain.value = 220;
        lfo.connect(lfoGain);
        lfoGain.connect(lp.frequency);
        lfo.start();
        ambientNodes.push(lfo);
    }

    function stopProcedural()
    {
        if (!ambientOn) { return; }
        ambientOn = false;
        var c = ctx;
        if (ambientGain && c)
        {
            try
            {
                ambientGain.gain.cancelScheduledValues(c.currentTime);
                ambientGain.gain.setValueAtTime(ambientGain.gain.value, c.currentTime);
                ambientGain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.6);
            } catch (e) { }
        }
        for (var i = 0; i < ambientNodes.length; i++)
        {
            try { ambientNodes[i].stop(c ? c.currentTime + 0.7 : 0); } catch (e) { }
        }
        ambientNodes = [];
    }

    // Short UI click blip.
    export function click()
    {
        if (muted) { return; }
        var c = ensureCtx();
        if (!c) { return; }
        var t = c.currentTime;
        var o = c.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(660, t);
        o.frequency.exponentialRampToValueAtTime(430, t + 0.07);
        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
        o.connect(g);
        g.connect(masterGain);
        o.start(t);
        o.stop(t + 0.12);
    }

    export function init()
    {
        if (initialised || typeof document == "undefined") { return; }
        initialised = true;
        muted = storageGet();

        var base = Settings.getAssetPackBase();
        var hasExternalAssetPack = Settings.ASSET_PACK && Settings.ASSET_PACK != "default";

        audioEl = null;
        if (hasExternalAssetPack)
        {
            audioEl = document.createElement("audio");
            audioEl.loop = true;
            audioEl.preload = "auto";
            audioEl.volume = 0.45;
            audioEl.style.display = "none";
            var ogg = document.createElement("source");
            ogg.setAttribute("src", base + "music/menu.ogg");
            ogg.setAttribute("type", "audio/ogg");
            var mp3 = document.createElement("source");
            mp3.setAttribute("src", base + "music/menu.mp3");
            mp3.setAttribute("type", "audio/mpeg");
            audioEl.appendChild(ogg);
            audioEl.appendChild(mp3);
            document.body.appendChild(audioEl);

            // If a real pack track plays, use it and drop the synth; if every
            // source fails, fall back to the synthesised ambient.
            audioEl.addEventListener("playing", function () { realMusic = true; stopProcedural(); });
            audioEl.addEventListener("error", function () { if (!muted && !realMusic) { startProcedural(); } });
        }

        buildToggle();
        applyMenuBackground(base, hasExternalAssetPack);

        var startOnGesture = function ()
        {
            startMusic();
            document.removeEventListener("click", startOnGesture);
            document.removeEventListener("keydown", startOnGesture);
        };
        document.addEventListener("click", startOnGesture);
        document.addEventListener("keydown", startOnGesture);
    }

    function startMusic()
    {
        if (started || muted) { return; }
        started = true;
        ensureCtx(); // unlock audio on this gesture
        if (audioEl)
        {
            var p = audioEl.play();
            if (p && typeof p["catch"] == "function")
            {
                // No playable pack source (or autoplay blocked) -> synth fallback.
                p["catch"](function () { if (!realMusic && !muted) { startProcedural(); } });
            }
        }
        else
        {
            startProcedural();
        }
    }

    export function stop()
    {
        if (audioEl) { try { audioEl.pause(); } catch (e) { } }
        stopProcedural();
        if (ctx) { try { ctx.suspend(); } catch (e) { } }
        if (muteBtn) { muteBtn.style.display = "none"; }
        if (typeof document != "undefined" && document.body)
        {
            var b = document.body;
            b.className = (" " + b.className + " ").replace(" worms-menu-bg ", " ").replace(/^\s+|\s+$/g, "");
            b.style.backgroundImage = "";
        }
    }

    function applyMute()
    {
        storageSet(muted);
        if (muteBtn) { muteBtn.innerHTML = muted ? "&#128263;" : "&#128266;"; }
        if (masterGain && ctx)
        {
            try { masterGain.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime); } catch (e) { }
        }
        if (muted)
        {
            if (audioEl) { try { audioEl.pause(); } catch (e) { } }
            stopProcedural();
        }
        else
        {
            started = false;
            startMusic();
        }
    }

    function buildToggle()
    {
        muteBtn = document.createElement("div");
        muteBtn.id = "menuMusicToggle";
        muteBtn.title = "Toggle menu sound";
        muteBtn.innerHTML = muted ? "&#128263;" : "&#128266;";
        muteBtn.onclick = function () { muted = !muted; applyMute(); };
        document.body.appendChild(muteBtn);
    }

    function applyMenuBackground(base, hasExternalAssetPack)
    {
        if (typeof document == "undefined" || !document.body) { return; }
        var b = document.body;
        if ((" " + b.className + " ").indexOf(" worms-menu-bg ") == -1)
        {
            b.className = (b.className + " worms-menu-bg").replace(/^\s+/, "");
        }
        b.style.backgroundImage = hasExternalAssetPack
            ? "url('" + base + "images/menu/background.png'), linear-gradient(to bottom, #2a3357 0%, #201610 100%)"
            : "linear-gradient(to bottom, #2a3357 0%, #201610 100%)";
    }
}
