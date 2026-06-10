/**
 * RecordingAudioBus.ts
 *
 * One shared Web Audio capture graph so a MediaRecorder gets ALL game audio
 * (Tone.js music + HTML <audio> SFX) without OS/tab capture. This is the fix for
 * the "silent recording" mine: the two audio sources do not share a context, so
 * we route both into a single MediaStreamAudioDestinationNode on Tone's own
 * rawContext and tap it.
 *
 * Design verified by codex (MDN browser-compat + Web Audio reroute semantics):
 *   - ctx = Tone.getContext().rawContext  (a new AudioContext would NOT hear Tone)
 *   - captureBus (Gain) -> captureDest (MediaStreamAudioDestinationNode)
 *   - MUSIC: Tone.getDestination().connect(captureBus)  (still also hits speakers)
 *   - SFX : createMediaElementSource(el) -> ctx.destination (restore speakers)
 *                                        -> captureBus      (capture)
 *           wrapped once per element (WeakMap), because an element can only be
 *           source-wrapped once and the wrap steals its direct output.
 *
 * Everything is defensive: if Tone is absent or wrapping throws, the game audio
 * keeps working unchanged and capture silently degrades (music-only or none)
 * rather than breaking playback.
 *
 *  License: Apache 2.0
 */
///<reference path="../audio/ArenaMusic.ts"/>

module RecordingAudioBus
{
    var ctx: any = null;
    var captureDest: any = null;   // MediaStreamAudioDestinationNode
    var captureBus: any = null;    // GainNode feeding captureDest
    var musicTapped = false;
    var active = false;
    var wrapped: any = null;       // WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>
    var pending: any[] = [];       // elements registered before ensure()

    function toneRawContext()
    {
        try
        {
            var T = (typeof window != "undefined") ? window["Tone"] : null;
            if (T && T.getContext) { return T.getContext().rawContext; }
        }
        catch (e) { }
        return null;
    }

    export function isAvailable()
    {
        if (toneRawContext()) { return true; }
        return (typeof window != "undefined") && !!(window["AudioContext"] || window["webkitAudioContext"]);
    }

    // Build (idempotent) the capture graph and return its MediaStream, or null.
    // Must be called from a user-gesture context so the AudioContext can resume.
    export function ensure()
    {
        try
        {
            if (!ctx)
            {
                ctx = toneRawContext();
                if (!ctx)
                {
                    var AC = window["AudioContext"] || window["webkitAudioContext"];
                    if (!AC) { return null; }
                    ctx = new AC();
                }
            }
            if (ctx.state == "suspended" && ctx.resume)
            {
                try
                {
                    var p = ctx.resume();
                    if (p && p.then) { p.then(function () { flushPending(); })["catch"](function () { }); }
                }
                catch (e) { }
            }

            if (!captureDest)
            {
                captureDest = ctx.createMediaStreamDestination();
                captureBus = ctx.createGain();
                captureBus.gain.value = 1;
                captureBus.connect(captureDest);
                tapMusic();
            }
            active = true;

            // Wrap any SFX elements registered before the graph existed.
            flushPending();
            return captureDest.stream;
        }
        catch (e) { return null; }
    }

    function flushPending()
    {
        if (pending.length)
        {
            var list = pending;
            pending = [];
            for (var i = 0; i < list.length; i++) { wrap(list[i]); }
        }
    }

    function tapMusic()
    {
        if (musicTapped) { return; }
        // Preferred: tap Tone's master destination (post everything ArenaMusic plays).
        try
        {
            var T = window["Tone"];
            if (T && T.getDestination)
            {
                T.getDestination().connect(captureBus);
                musicTapped = true;
            }
        }
        catch (e) { }
        // Fallback: ask ArenaMusic to connect its limiter, if Tone tap failed.
        try
        {
            if (!musicTapped && typeof ArenaMusic != "undefined" && ArenaMusic.connectRecorder)
            {
                if (ArenaMusic.connectRecorder(captureBus)) { musicTapped = true; }
            }
        }
        catch (e) { }
    }

    // Called by SoundFallback for every <audio> element it owns. Wires it into
    // the capture graph if the graph is live, else remembers it for ensure().
    export function register(el)
    {
        if (!el) { return; }
        try
        {
            if (active && captureBus) { wrap(el); }
            else { pending.push(el); }
        }
        catch (e) { }
    }

    function wrap(el)
    {
        try
        {
            if (!ctx || !captureBus) { return; }
            // Only reroute a live element once the context is actually running.
            // createMediaElementSource steals the element's direct output, so wiring
            // it into a suspended graph would mute the SFX. Defer until running.
            if (ctx.state !== "running")
            {
                if (pending.indexOf(el) < 0) { pending.push(el); }
                return;
            }
            if (!wrapped) { wrapped = (typeof WeakMap != "undefined") ? new WeakMap() : null; }
            if (wrapped && wrapped.has(el)) { return; }
            var src = ctx.createMediaElementSource(el);
            src.connect(ctx.destination);  // reroute steals speaker output - restore it
            src.connect(captureBus);       // and feed the recorder
            if (wrapped) { wrapped.set(el, src); }
        }
        catch (e)
        {
            // createMediaElementSource throws on double-wrap or cross-origin media;
            // ignore so the element keeps playing as a bare <audio>.
        }
    }

    export function getStream()
    {
        return captureDest ? captureDest.stream : null;
    }

    export function getAudioTrack()
    {
        var s = getStream();
        return (s && s.getAudioTracks && s.getAudioTracks().length) ? s.getAudioTracks()[0] : null;
    }

    export function isActive() { return active; }
}
