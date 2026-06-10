/**
 * ArenaMusic.ts
 * Tone.js-driven adaptive soundtrack for Worms A.I. Arena.
 *
 * Two runtime-synthesised "scenes" (no audio assets shipped):
 *   - MENU : synthwave chill — warm analog bass, a light retro beat, a lush pad
 *            and a neon melodic lead motif over an A/B chord form.
 *   - GAME : darksynth battle (Carpenter Brut / Perturbator flavour) — a pulsing
 *            16th bass, four-on-the-floor kick, gated-reverb snare, a distorted
 *            saw LEAD that states a real theme, and an arrangement that swaps
 *            chord progressions per section and transposes up +2 for the climax.
 *
 * The thing that keeps it from sounding "samey": the music is not one loop. A
 * bar counter drives a multi-section FORM (A / A+lead / B / B transposed), each
 * section has a different chord progression, a composed melodic theme states a
 * recognisable hook, and risers/fills mark the transitions. Texture also evolves
 * via slow LFOs and probability, but the structure is what the ear hears change.
 *
 * Audio is gated behind a user gesture (autoplay policy) and a persisted mute
 * toggle (localStorage "wormsMenuMuted"). If window.Tone is absent every method
 * is a safe no-op so callers degrade gracefully.
 *
 *  License: Apache 2.0
 */

module ArenaMusic
{
    // Resolved lazily so this module is harmless if Tone failed to load.
    var T: any = (typeof window != "undefined") ? window["Tone"] : null;
    var available = !!T;

    var unlocked = false;        // Tone.start() resolved on a user gesture
    var gestureBound = false;
    var muted = readMuted();
    var previewDucked = false;   // Studio preview audio should not fight the live soundtrack.

    var master: any = null;      // master Gain -> moodFilter -> Compressor -> Limiter -> Destination
    var limiter: any = null;
    var comp: any = null;
    var moodFilter: any = null;  // master-bus lowpass: opens with match tension (smooth)
    var moodEnergy = 0.45;       // 0..1 current battle intensity
    var lastMoodAt = 0;          // for min-dwell between mood changes
    var GAME_BPM = 126;

    var scene = "none";          // "none" | "menu" | "game"
    var pending = "none";        // requested scene awaiting unlock
    var disposables: any[] = []; // nodes + sequences/loops owned by the current scene

    var bar = 0;                 // global bar counter driving the form

    var MASTER_LEVEL = 0.82;
    var PREVIEW_DUCK_LEVEL = 0.08;
    var FADE = 0.6;              // scene fade-in seconds (avoids clicks on swap)

    function readMuted()
    {
        try { return window.localStorage.getItem("wormsMenuMuted") == "true"; }
        catch (e) { return false; }
    }
    function writeMuted(v)
    {
        try { window.localStorage.setItem("wormsMenuMuted", v ? "true" : "false"); }
        catch (e) { }
    }

    function targetMasterLevel()
    {
        if (muted) { return 0; }
        return previewDucked ? MASTER_LEVEL * PREVIEW_DUCK_LEVEL : MASTER_LEVEL;
    }

    function ensureMaster()
    {
        if (!T) { return null; }
        if (!master)
        {
            limiter = new T.Limiter(-1).toDestination();
            // Gentle glue, not a brick wall: a low ratio keeps the drums punchy
            // and the sidechain pump audible instead of squashing it flat.
            comp = new T.Compressor({ threshold: -18, ratio: 2.2, attack: 0.02, release: 0.18 }).connect(limiter);
            // Master-bus mood filter: brightens (opens) as match tension rises and
            // muffles (closes) when calm. Always ramped, never switched, so the
            // soundtrack adapts with no audible seam. Starts fully open (no effect).
            moodFilter = new T.Filter({ frequency: 16000, type: "lowpass", rolloff: -12 }).connect(comp);
            master = new T.Gain(targetMasterLevel()).connect(moodFilter);
        }
        return master;
    }

    // A per-scene gain between the scene's instruments and master. Re-composing the
    // soundtrack builds a NEW scene on a NEW sceneBus and crossfades the two gains
    // (DJ-style), so tracks blend instead of hard-cutting. Mute stays on master.
    function sceneBus()
    {
        ensureMaster();
        if (!sceneBusNode && T) { sceneBusNode = track(new T.Gain(1).connect(master)); }
        return sceneBusNode;
    }

    function bindGesture()
    {
        if (gestureBound || typeof document == "undefined") { return; }
        gestureBound = true;
        var go = function ()
        {
            document.removeEventListener("click", go);
            document.removeEventListener("keydown", go);
            document.removeEventListener("touchstart", go);
            unlock();
        };
        document.addEventListener("click", go);
        document.addEventListener("keydown", go);
        document.addEventListener("touchstart", go);
    }

    function unlock()
    {
        if (!T || unlocked) { return; }
        try
        {
            var done = function () { unlocked = true; build(pending); };
            var p = T.start();
            if (p && typeof p.then == "function") { p.then(done)["catch"](function () { unlocked = true; }); }
            else { done(); }
        }
        catch (e) { }
    }

    // ---- public API ----------------------------------------------------------

    export function enterMenu() { request("menu"); }
    export function enterGame() { directorSpec = null; request("game"); }
    export function leave() { request("none"); }

    function request(name)
    {
        pending = name;
        if (!available) { return; }
        if (unlocked) { build(name); }
        else { bindGesture(); }
    }

    export function isAvailable() { return available; }
    export function isMuted() { return muted; }

    export function setMuted(v)
    {
        muted = !!v;
        writeMuted(muted);
        if (master && T)
        {
            try { master.gain.rampTo(targetMasterLevel(), 0.25); }
            catch (e) { try { master.gain.value = targetMasterLevel(); } catch (e2) { } }
        }
    }

    export function toggleMute() { setMuted(!muted); return muted; }

    export function setPreviewDucked(v)
    {
        previewDucked = !!v;
        if (master && T)
        {
            try { master.gain.rampTo(targetMasterLevel(), previewDucked ? 0.35 : 0.45); }
            catch (e) { try { master.gain.value = targetMasterLevel(); } catch (e2) { } }
        }
    }

    // Short UI blip for menu clicks (independent of the scene loops).
    export function click()
    {
        if (!T || muted || !unlocked) { return; }
        try
        {
            var s = new T.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 } });
            s.volume.value = -15;
            s.connect(ensureMaster());
            s.triggerAttackRelease("C6", "32n");
            s.triggerAttackRelease("G6", "32n", "+0.05");
            setTimeout(function () { try { s.dispose(); } catch (e) { } }, 600);
        }
        catch (e) { }
    }

    // ---- adaptive mood (battle scene only) -----------------------------------

    function moodToEnergy(m)
    {
        if (m == "climax") { return 1.0; }
        if (m == "tense") { return 0.72; }
        if (m == "active") { return 0.45; }
        return 0.2; // calm
    }

    // Smoothly adapt the battle music to the match's running tension (driven by the
    // moment detector). No-op outside the game scene. Hysteresis + a minimum dwell
    // stop a single event from ping-ponging the music; the change is a slow rampTo
    // on the master filter + tempo, so there is no audible cut.
    export function setMood(m)
    {
        if (!T || scene != "game") { return; }
        var e = moodToEnergy(m);
        if (Math.abs(e - moodEnergy) < 0.12) { return; }
        var now = (typeof performance != "undefined" && performance.now) ? performance.now() : 0;
        if (now - lastMoodAt < 4000) { return; }
        lastMoodAt = now;
        moodEnergy = e;
        applyMood(1.8, 2.6);
    }

    function applyMood(filterRamp, bpmRamp)
    {
        if (!T) { return; }
        // Mood only opens/closes a gentle master filter now - NO tempo change (the
        // owner disliked the speed-up/slow-down; the music evolves by regenerating
        // material instead). bpmRamp kept in the signature for callers.
        try { if (moodFilter) { moodFilter.frequency.rampTo(800 + moodEnergy * 15200, filterRamp); } } catch (e) { }
    }

    export function getMoodEnergy() { return moodEnergy; }

    // ---- scene lifecycle -----------------------------------------------------

    function track(node) { disposables.push(node); return node; }

    function disposeScene()
    {
        // Reverse order so a modulator (LFO/Tremolo) is torn down before the node
        // it drives, never the other way round.
        for (var i = disposables.length - 1; i >= 0; i--)
        {
            try { disposables[i].dispose(); } catch (e) { }
        }
        disposables = [];
        sceneBusNode = null; // disposed above (it was tracked); next scene makes a fresh one
    }

    function build(name)
    {
        if (!T || scene == name) { return; }
        try { T.Transport.cancel(0); } catch (e) { }
        disposeScene();
        scene = name;

        if (name == "none")
        {
            try { T.Transport.stop(); } catch (e) { }
            return;
        }

        ensureMaster();
        // Reset the mood filter fully open on every (re)build so a leftover low
        // cutoff from a previous battle never muffles the menu.
        try { if (moodFilter) { moodFilter.frequency.cancelScheduledValues(0); moodFilter.frequency.value = 16000; } } catch (e) { }
        moodEnergy = 0.45;
        lastMoodAt = 0;
        // Duck to silence before swapping so the rebuild + Transport restart does
        // not click, then fade the new scene in smoothly.
        try { master.gain.value = 0; } catch (e) { }
        try { T.Transport.stop(); T.Transport.position = 0; } catch (e) { }

        try
        {
            if (name == "menu") { buildMenu(); }
            else if (name == "game") { if (directorSpec && directorSpec.tracks && directorSpec.tracks.length) { buildFromSpec(directorSpec); } else { buildGame(); } }
        }
        catch (e) { }

        try { T.Transport.start("+0.05"); } catch (e) { }
        try { master.gain.rampTo(targetMasterLevel(), FADE); } catch (e) { }
    }

    // ---- music-theory helpers ------------------------------------------------

    function at(list, i) { return list[((i % list.length) + list.length) % list.length]; }

    // Transpose a single note name by N semitones (null/rest passes through).
    function tr(note, semi)
    {
        if (!semi || note == null) { return note; }
        try { return T.Frequency(note).transpose(semi).toNote(); }
        catch (e) { return note; }
    }
    // Transpose a chord (array of note names) by N semitones.
    function trc(chord, semi)
    {
        if (!semi) { return chord; }
        var out = [];
        for (var i = 0; i < chord.length; i++) { out.push(tr(chord[i], semi)); }
        return out;
    }

    // Chord dictionaries keyed by name. POWER = root+fifth+octave (aggressive),
    // TRIAD = full triad (arps/pads), ROOT = bass note.
    var POWER = {
        "Am": ["A2", "E3", "A3"], "G": ["G2", "D3", "G3"], "F": ["F2", "C3", "F3"],
        "E": ["E2", "B2", "E3"], "C": ["C3", "G3", "C4"], "Dm": ["D2", "A2", "D3"]
    };
    var TRIAD = {
        "Am": ["A3", "C4", "E4"], "G": ["G3", "B3", "D4"], "F": ["F3", "A3", "C4"],
        "E": ["E3", "G#3", "B3"], "C": ["C4", "E4", "G4"], "Dm": ["D3", "F3", "A3"]
    };
    var ROOT = { "Am": "A1", "G": "G1", "F": "F1", "E": "E1", "C": "C2", "Dm": "D2" };

    // ---- MENU: synthwave chill -----------------------------------------------
    //
    // 16-bar A/B form (2 bars per chord):
    //   A: Am - F  - C - G   (warm, classic)
    //   B: Dm - C  - G - E   (turns darker, leans on the dominant back to A)
    var MENU_A = ["Am", "F", "C", "G"];
    var MENU_B = ["Dm", "C", "G", "E"];
    // Neon lead motif, 2 bars at 8th-note resolution (A-minor), null = rest.
    var MENU_MOTIF = ["E5", null, null, "D5", "C5", null, "A4", null, "C5", null, "D5", null, "E5", null, null, null];

    function menuChord(b)
    {
        var prog = (Math.floor(b / 8) % 2 == 0) ? MENU_A : MENU_B;
        return prog[Math.floor((b % 8) / 2) % 4];
    }

    function buildMenu()
    {
        var bus = sceneBus();
        T.Transport.bpm.value = 102;
        bar = 0;

        // --- shared effects ---
        var reverb = track(new T.Reverb({ decay: 4.5, wet: 0.3 }));
        reverb.connect(bus);
        var delay = track(new T.PingPongDelay({ delayTime: "8n.", feedback: 0.32, wet: 0.22 }));
        delay.connect(reverb);
        var chorus = track(new T.Chorus({ frequency: 0.5, delayTime: 4, depth: 0.6, wet: 0.5 }).start());
        chorus.connect(bus);

        // Bar counter (created first so instruments read an up-to-date count).
        track(new T.Loop(function () { bar++; }, "1m")).start("1m");
        function blockB() { return Math.floor(bar / 8) % 2 == 1; } // true during the B section

        // --- lush pad: one chord per bar through chorus + reverb ---
        var padFilter = track(new T.Filter({ frequency: 900, type: "lowpass", rolloff: -24 }));
        padFilter.connect(chorus); padFilter.connect(reverb);
        var padLfo = track(new T.LFO({ frequency: 0.06, min: 500, max: 1600, type: "sine" }));
        padLfo.connect(padFilter.frequency); padLfo.start(0);
        var pad = track(new T.PolySynth(T.Synth));
        pad.set({ oscillator: { type: "fatsawtooth", count: 3, spread: 30 }, envelope: { attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.6 } });
        pad.volume.value = -22;
        pad.connect(padFilter);
        track(new T.Loop(function (time)
        {
            pad.triggerAttackRelease(TRIAD[menuChord(bar)], "1m", time, 0.5);
        }, "1m")).start(0);

        // --- warm analog bass: 8th-note pulse with a soft octave bounce ---
        var bass = track(new T.MonoSynth({
            oscillator: { type: "sawtooth" },
            filter: { Q: 2, type: "lowpass" },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.45, release: 0.2 },
            filterEnvelope: { attack: 0.02, decay: 0.18, sustain: 0.3, baseFrequency: 150, octaves: 2.6 }
        }));
        bass.volume.value = -13;
        bass.connect(bus);
        track(new T.Sequence(function (time, step)
        {
            var r = ROOT[menuChord(bar)];
            var note = (step % 2 == 0) ? r : octaveUp(r);
            bass.triggerAttackRelease(note, "8n", time, 0.7);
        }, [0, 1, 2, 3, 4, 5, 6, 7], "8n")).start(0);

        // --- light retro beat: soft kick 1&3, snappy snare 2&4, airy hats ---
        var kick = track(new T.MembraneSynth({ pitchDecay: 0.04, octaves: 5, envelope: { attack: 0.001, decay: 0.4, sustain: 0 } }));
        kick.volume.value = -9; kick.connect(bus);
        track(new T.Sequence(function (time, on) { if (on) { kick.triggerAttackRelease("C1", "8n", time, 0.8); } }, [1, 0, 1, 0], "4n")).start(0);

        var snareVerb = track(new T.Reverb({ decay: 0.5, wet: 0.4 })); snareVerb.connect(bus);
        var snare = track(new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.13, sustain: 0 } }));
        snare.volume.value = -18; snare.connect(snareVerb); snare.connect(bus);
        track(new T.Sequence(function (time, on) { if (on) { snare.triggerAttackRelease("16n", time, 0.7); } }, [0, 1, 0, 1], "4n")).start(0);

        var hatFilter = track(new T.Filter(8000, "highpass")); hatFilter.connect(bus);
        var hat = track(new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }));
        hat.volume.value = -26; hat.connect(hatFilter);
        track(new T.Sequence(function (time, on) { if (on) { hat.triggerAttackRelease("16n", time, 0.5); } }, [0, 1, 0, 1, 0, 1, 0, 1], "8n")).start(0);

        // --- neon melodic lead: states the motif, an octave up in the B section ---
        var lead = track(new T.MonoSynth({
            oscillator: { type: "square" },
            filter: { Q: 3, type: "lowpass" },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.25 },
            filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, baseFrequency: 600, octaves: 2.5 },
            portamento: 0.02
        }));
        lead.volume.value = -16;
        lead.connect(delay); lead.connect(reverb); lead.connect(bus);
        track(new T.Sequence(function (time, slot)
        {
            var note = at(MENU_MOTIF, slot);
            if (note == null) { return; }
            if (blockB()) { note = tr(note, 12); } // lift the hook an octave in section B
            lead.triggerAttackRelease(note, "8n", time, 0.6);
        }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "8n")).start(0);
    }

    function octaveUp(note)
    {
        var m = ("" + note).match(/^([A-G]#?b?)(\d)$/);
        return m ? (m[1] + (parseInt(m[2], 10) + 1)) : note;
    }

    // ---- GAME: darksynth battle ----------------------------------------------
    //
    // 16-bar FORM of four 4-bar blocks (one chord per bar):
    //   block 0 : prog A, intro     (kick + pulsing bass, no lead)
    //   block 1 : prog A, full      (+ snare/hats/stabs + LEAD theme)
    //   block 2 : prog B, full      (different progression)
    //   block 3 : prog B, +2 climax (everything, lead transposed up a tone)
    //   A = Am - G - F - E  (Andalusian cadence: the iconic dark/driving descent)
    //   B = F  - C - G - Am (anthemic contrast)
    // Battle material is regenerated UNIQUELY each match (different key, tempo,
    // chord progressions and lead theme) so no two matches - and no two clips -
    // sound the same. An optional music-director agent overrides the seed via a
    // spec (applyDirectorSpec). The original fixed A-minor material below is just a
    // safe default; seedGame() replaces it per match.
    var GAME_A = ["Am", "G", "F", "E"];     // Andalusian cadence (default/fallback)
    var GAME_B = ["F", "C", "G", "Am"];
    var GAME_KEY = 0;                        // global semitone transpose for this match
    var GAME_THEME = [
        "A4", null, "C5", null, "E5", null, null, "D5",
        "C5", null, "B4", null, "A4", null, null, null,
        "A4", null, "C5", null, "E5", null, "G5", "F5",
        "E5", null, "D5", null, "C5", "B4", "A4", null
    ];
    var directorSpec: any = null;           // optional LLM-authored Tone.js music spec
    var sceneBusNode: any = null;           // gain between the current scene + master (enables crossfades)

    // Progressions over the chord dictionary's keys (Am/G/F/E/C/Dm) so bass, stabs
    // and arp voicings always resolve. Two are picked per match.
    var PROG_POOL = [
        ["Am", "G", "F", "E"], ["Am", "F", "C", "G"], ["Am", "F", "G", "E"],
        ["Am", "C", "F", "E"], ["Am", "G", "Dm", "E"], ["Am", "F", "Dm", "E"],
        ["Dm", "Am", "F", "E"], ["Am", "C", "G", "E"], ["F", "C", "G", "Am"],
        ["Am", "Dm", "G", "E"], ["Dm", "F", "C", "G"], ["Am", "F", "C", "E"]
    ];
    // A natural-minor scale (two+ octaves) the generated lead hook walks through.
    var THEME_SCALE = ["A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6", "D6", "E6"];

    function pickProg(exclude)
    {
        var i = Math.floor(Math.random() * PROG_POOL.length);
        if (exclude != null && i == exclude) { i = (i + 1) % PROG_POOL.length; }
        return i;
    }

    // Fresh 32-slot (4-bar) lead hook by a rest-gated random walk through the scale,
    // denser on strong beats - unique but always in-scale (so it harmonises).
    function genTheme()
    {
        var out = [];
        var idx = Math.floor(Math.random() * 3);
        for (var i = 0; i < 32; i++)
        {
            var strong = (i % 4 == 0);
            var p = strong ? 0.85 : (i % 2 == 0 ? 0.55 : 0.3);
            if (Math.random() < p)
            {
                var step = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(Math.random() * 8)];
                idx = Math.max(0, Math.min(THEME_SCALE.length - 1, idx + step));
                out.push(THEME_SCALE[idx]);
            }
            else { out.push(null); }
        }
        out[0] = THEME_SCALE[Math.floor(Math.random() * 3)];
        return out;
    }

    // Procedurally seed unique battle material for this match.
    function seedGame()
    {
        GAME_BPM = 116 + Math.floor(Math.random() * 18); // 116..133
        GAME_KEY = [-3, -2, -1, 0, 0, 1, 2, 3, 4][Math.floor(Math.random() * 9)];
        reseedMaterial();
    }

    // Pick NEW progressions + a NEW lead theme (keeping the match's key/tempo). Called
    // once per 16-bar form cycle so the soundtrack keeps GENERATING through the match
    // instead of looping the same 16 bars over and over.
    function reseedMaterial()
    {
        var a = pickProg(null);
        GAME_A = PROG_POOL[a];
        GAME_B = PROG_POOL[pickProg(a)];
        GAME_THEME = genTheme();
    }

    // Apply an LLM-authored Tone.js soundtrack spec and (re)build the battle scene
    // from it. The spec defines genre/tempo/scale + every instrument track + the
    // arrangement, so the music is fully agent-generated. Rebuilds live so it takes
    // effect immediately. Invalid specs are ignored (procedural fallback stays).
    export function applyDirectorSpec(spec)
    {
        try
        {
            if (!spec || typeof spec != "object" || !spec.tracks || !spec.tracks.length) { return false; }
            return recomposeGame(spec);
        }
        catch (e) { return false; }
    }

    // Swap to a new soundtrack spec with a DJ-style crossfade: build the new scene on a
    // fresh silent bus, ramp the old bus out + the new in (and the tempo across) over a
    // few seconds, then dispose the old scene. No hard cut. Outside the live game scene
    // it just stores the spec for the next build.
    function recomposeGame(spec)
    {
        if (!T) { return false; }
        if (scene != "game" || !sceneBusNode || !unlocked)
        {
            directorSpec = spec;
            return true;
        }
        try
        {
            var FADE2 = 3.6;
            var oldBus = sceneBusNode;
            var oldDisp = disposables;
            disposables = [];                                  // new scene owns a fresh disposables list
            sceneBusNode = track(new T.Gain(0).connect(master)); // silent new bus
            directorSpec = spec;
            buildFromSpec(spec, FADE2);                         // build new scene + ramp tempo
            try { oldBus.gain.rampTo(0, FADE2); } catch (e) { }
            try { sceneBusNode.gain.rampTo(1, FADE2); } catch (e) { }
            setTimeout(function ()
            {
                for (var i = oldDisp.length - 1; i >= 0; i--) { try { oldDisp[i].dispose(); } catch (e) { } }
            }, Math.round((FADE2 + 0.6) * 1000));
            return true;
        }
        catch (e)
        {
            directorSpec = spec;
            try { scene = "none"; build("game"); } catch (e2) { }
            return true;
        }
    }

    export function getMusicSeed()
    {
        if (directorSpec)
        {
            return { genre: directorSpec.genre, bpm: directorSpec.bpm, tracks: (directorSpec.tracks || []).length, sections: (directorSpec.sections || []).length, director: true };
        }
        return { bpm: GAME_BPM, key: GAME_KEY, progA: GAME_A, progB: GAME_B, director: false };
    }

    // ---- generic LLM-spec Tone.js renderer -----------------------------------

    function specMakeSynth(t)
    {
        var name = t.synth || "Synth";
        var opts: any = {};
        if (t.oscillator) { opts.oscillator = { type: t.oscillator }; }
        try
        {
            switch (name)
            {
                case "MembraneSynth": return new T.MembraneSynth();
                case "NoiseSynth": return new T.NoiseSynth();
                case "MetalSynth": return new T.MetalSynth();
                case "FMSynth": return new T.FMSynth(opts);
                case "AMSynth": return new T.AMSynth(opts);
                case "MonoSynth": return new T.MonoSynth(opts);
                case "DuoSynth": return new T.DuoSynth();
                case "PluckSynth": return new T.PluckSynth();
                case "PolySynth": return new T.PolySynth(T.Synth);
                default: return new T.Synth(opts);
            }
        }
        catch (e) { try { return new T.Synth(); } catch (e2) { return null; } }
    }

    function specMakeFx(name)
    {
        try
        {
            switch (String(name))
            {
                case "distortion": return new T.Distortion({ distortion: 0.32, wet: 0.32 });
                case "reverb": return new T.Reverb({ decay: 2.2, wet: 0.22 });
                case "delay": return new T.FeedbackDelay({ delayTime: "8n", feedback: 0.25, wet: 0.2 });
                case "chorus": return new T.Chorus({ frequency: 0.6, depth: 0.6, wet: 0.4 }).start();
                case "bitcrusher": return new T.BitCrusher(6);
                case "autofilter": return new T.AutoFilter({ frequency: "4n", depth: 0.6 }).start();
                case "phaser": return new T.Phaser({ frequency: 0.4, octaves: 3, wet: 0.3 });
                default: return null;
            }
        }
        catch (e) { return null; }
    }

    function specConnect(inst, fxList, bus)
    {
        try
        {
            if (Array.isArray(fxList) && fxList.length)
            {
                var chain = [];
                for (var i = 0; i < fxList.length; i++)
                {
                    var f = specMakeFx(fxList[i]);
                    if (f) { chain.push(track(f)); }
                }
                if (chain.length)
                {
                    for (var j = 0; j < chain.length - 1; j++) { chain[j].connect(chain[j + 1]); }
                    chain[chain.length - 1].connect(bus);
                    inst.connect(chain[0]);
                    return;
                }
            }
        }
        catch (e) { }
        try { inst.connect(bus); } catch (e) { }
    }

    function buildFromSpec(spec, crossfadeSec)
    {
        var bus = sceneBus();
        var bpm = Math.max(50, Math.min(200, spec.bpm || 120));
        // Crossfade -> RAMP the shared-Transport tempo so the outgoing + incoming scenes
        // beatmatch smoothly; a fresh build sets it directly.
        if (crossfadeSec) { try { T.Transport.bpm.rampTo(bpm, crossfadeSec); } catch (e) { try { T.Transport.bpm.value = bpm; } catch (e2) { } } }
        else { try { T.Transport.bpm.value = bpm; } catch (e) { } }
        // Per-scene local state so a crossfading old + new scene never clobber each other.
        var sBar = 0;
        var sActive: any = {};

        var rootMidi = 48;
        try { rootMidi = T.Frequency(spec.rootNote || "C2").toMidi(); } catch (e) { }
        var scale = (spec.scaleSemitones && spec.scaleSemitones.length) ? spec.scaleSemitones : [0, 2, 3, 5, 7, 8, 10];

        function degNote(d)
        {
            try
            {
                var n = scale.length;
                var oct = Math.floor(d / n);
                var idx = ((d % n) + n) % n;
                var midi = rootMidi + oct * 12 + scale[idx];
                midi = Math.max(16, Math.min(104, midi));
                return T.Frequency(midi, "midi").toNote();
            }
            catch (e) { return "C3"; }
        }
        function triad(d) { return [degNote(d), degNote(d + 2), degNote(d + 4)]; }

        // Arrangement: cycle the sections so the track develops; gate tracks per section.
        var sections = [];
        var srcSections = spec.sections || [];
        for (var s = 0; s < srcSections.length; s++)
        {
            var sec = srcSections[s];
            if (sec && Array.isArray(sec.active)) { sections.push({ bars: Math.max(1, Math.min(16, sec.bars || 4)), active: sec.active }); }
        }
        if (!sections.length)
        {
            var all = [];
            for (var a = 0; a < (spec.tracks || []).length; a++) { if (spec.tracks[a] && spec.tracks[a].name) { all.push(spec.tracks[a].name); } }
            sections.push({ bars: 8, active: all });
        }
        var totalBars = 0;
        for (var ti2 = 0; ti2 < sections.length; ti2++) { totalBars += sections[ti2].bars; }
        function applySection(bar)
        {
            var b = ((bar % totalBars) + totalBars) % totalBars;
            var acc = 0, cur = sections[0];
            for (var i = 0; i < sections.length; i++) { acc += sections[i].bars; if (b < acc) { cur = sections[i]; break; } }
            sActive = {};
            for (var k = 0; k < cur.active.length; k++) { sActive[cur.active[k]] = true; }
        }
        applySection(0);
        track(new T.Loop(function () { sBar++; applySection(sBar); }, "1m")).start("1m");

        var tracks = (spec.tracks || []).slice(0, 12);
        for (var t = 0; t < tracks.length; t++)
        {
            (function (tr)
            {
                try
                {
                    if (!tr || !Array.isArray(tr.notes) || !tr.notes.length) { return; }
                    var inst = specMakeSynth(tr);
                    if (!inst) { return; }
                    if (typeof tr.volumeDb == "number") { try { inst.volume.value = Math.max(-40, Math.min(6, tr.volumeDb)); } catch (e) { } }
                    track(inst);
                    specConnect(inst, tr.fx, bus);

                    var role = String(tr.role || "lead").toLowerCase();
                    var isDrum = /kick|snare|hat|tom|perc/.test(role);
                    var isChord = /chord|pad|stab/.test(role);
                    var spb = (tr.stepsPerBar == 4 || tr.stepsPerBar == 8 || tr.stepsPerBar == 16) ? tr.stepsPerBar : (tr.notes.length || 16);
                    var sub = (spb <= 4) ? "4n" : (spb <= 8 ? "8n" : "16n");
                    var idxArr = [];
                    for (var n = 0; n < tr.notes.length; n++) { idxArr.push(n); }

                    var seq = new T.Sequence(function (time, step)
                    {
                        if (!sActive[tr.name]) { return; }
                        var v = tr.notes[step];
                        if (v == null || v === 0 || v === false) { if (!isDrum) { return; } if (!v) { return; } }
                        try
                        {
                            if (isDrum)
                            {
                                if (tr.synth == "NoiseSynth" || tr.synth == "MetalSynth") { inst.triggerAttackRelease(sub, time, 0.9); }
                                else { inst.triggerAttackRelease(role == "kick" ? "C1" : (role == "tom" ? "G1" : "C2"), sub, time, 0.95); }
                            }
                            else if (isChord)
                            {
                                inst.triggerAttackRelease(triad(Number(v)), sub, time, 0.5);
                            }
                            else
                            {
                                inst.triggerAttackRelease(degNote(Number(v)), sub, time, 0.8);
                            }
                        }
                        catch (e) { }
                    }, idxArr, sub);
                    track(seq);
                    seq.start(0);
                }
                catch (e) { }
            })(tracks[t]);
        }
    }

    // Per-bar state derived from the form.
    function gameBlock() { return Math.floor((bar % 16) / 4); }
    function gameProg() { return (gameBlock() <= 1) ? GAME_A : GAME_B; }
    function gameSemi() { return (gameBlock() == 3) ? 2 : 0; }   // +2 climax
    function gameXpose() { return gameSemi() + GAME_KEY; }       // climax lift + match key
    function gameFull() { return gameBlock() >= 1; }
    function gameLead() { var b = gameBlock(); return b == 1 || b == 3; }
    function gameChordName() { return gameProg()[bar % 4]; }

    function buildGame()
    {
        var bus = sceneBus();
        if (!directorSpec) { seedGame(); }   // unique procedural material each match
        var BPM = GAME_BPM;
        T.Transport.bpm.value = BPM;
        bar = 0;
        var barLen = T.Time("1m").toSeconds();

        // --- shared effects ---
        var reverb = track(new T.Reverb({ decay: 1.7, wet: 0.12 }));
        reverb.connect(bus);
        var delay = track(new T.FeedbackDelay({ delayTime: "8n", feedback: 0.22, wet: 0.16 }));
        delay.connect(reverb);

        // Sidechain pump: a sawtooth LFO at the kick rate ducks the harmonic
        // layers each beat and lets them swell back -> the driving synthwave
        // "breathing". Intrinsic gain 0 so the LFO fully defines the level.
        var pumpGain = track(new T.Gain(0));
        pumpGain.connect(bus);
        var pump = track(new T.LFO({ frequency: BPM / 60, min: 0.6, max: 1, type: "sawtooth" }));
        pump.connect(pumpGain.gain); pump.start(0);

        // --- riser + tom for transitions ---
        var riserNoise = track(new T.Noise({ type: "white" })); riserNoise.start();
        var riserFilter = track(new T.Filter({ frequency: 500, type: "bandpass", Q: 1.4 }));
        var riserDrive = track(new T.Distortion({ distortion: 0.3, wet: 0.3 }));
        var riserGain = track(new T.Gain(0.0001));
        riserNoise.connect(riserFilter); riserFilter.connect(riserDrive);
        riserDrive.connect(riserGain); riserGain.connect(reverb); riserGain.connect(bus);

        var tom = track(new T.MembraneSynth({ pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.001, decay: 0.22, sustain: 0 } }));
        tom.volume.value = -8; tom.connect(reverb); tom.connect(bus);
        var tomRoots = ["A2", "G2", "F2", "E2"];

        // Arrangement loop: advance the bar, fire risers/fills at section edges.
        track(new T.Loop(function (time)
        {
            bar++;
            var pos = bar % 16;
            // Regenerate the chord progressions + lead theme at the top of every form
            // cycle so the music keeps evolving instead of looping the same 16 bars.
            if (pos == 0 && bar > 0) { try { reseedMaterial(); } catch (e) { } }
            // Riser into the two "full" entries (block 1 at bar 4, climax at bar 12).
            if (pos == 3 || pos == 11)
            {
                try
                {
                    riserGain.gain.cancelScheduledValues(time);
                    riserGain.gain.setValueAtTime(0.0001, time);
                    riserGain.gain.linearRampToValueAtTime(0.15, time + barLen * 0.96);
                    riserGain.gain.linearRampToValueAtTime(0.0001, time + barLen);
                    riserFilter.frequency.cancelScheduledValues(time);
                    riserFilter.frequency.setValueAtTime(500, time);
                    riserFilter.frequency.exponentialRampToValueAtTime(6500, time + barLen);
                }
                catch (e) { }
            }
            // Descending tom fill across the last bar, rolling back to the top.
            if (pos == 15)
            {
                try
                {
                    for (var k = 0; k < 8; k++)
                    {
                        tom.triggerAttackRelease(tr(tomRoots[k % 4], GAME_KEY), "16n", time + barLen * 0.5 + (barLen / 16) * k, 0.5 + k * 0.05);
                    }
                }
                catch (e) { }
            }
        }, "1m")).start("1m");

        // --- four-on-the-floor kick with probabilistic ghost hits ---
        var kick = track(new T.MembraneSynth({ pitchDecay: 0.03, octaves: 6, oscillator: { type: "square4" }, envelope: { attack: 0.001, decay: 0.34, sustain: 0 } }));
        kick.volume.value = -5; kick.connect(bus);
        track(new T.Sequence(function (time, on)
        {
            if (on) { kick.triggerAttackRelease("C1", "8n", time, 1); }
            else if (gameFull() && Math.random() < 0.18) { kick.triggerAttackRelease("C1", "16n", time, 0.5); }
        }, [1, 0, 1, 0, 1, 0, 1, 0], "8n")).start(0);

        // --- gated-reverb snare on 2 and 4 (big 80s snap), full sections only ---
        var snareVerb = track(new T.Reverb({ decay: 0.45, wet: 0.55 })); snareVerb.connect(bus);
        var snareFilter = track(new T.Filter(1700, "bandpass")); snareFilter.connect(snareVerb); snareFilter.connect(bus);
        var snare = track(new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } }));
        snare.volume.value = -11; snare.connect(snareFilter);
        track(new T.Sequence(function (time, on)
        {
            if (!gameFull()) { return; }
            if (on) { snare.triggerAttackRelease("8n", time, 0.9); }
            else if (bar % 16 == 15 && Math.random() < 0.6) { snare.triggerAttackRelease("16n", time, 0.5); }
        }, [0, 1, 0, 1], "4n")).start(0);

        // --- airy 16th hats, busier in the climax, silent in the intro ---
        var hatFilter = track(new T.Filter(7000, "highpass")); hatFilter.connect(bus);
        var hat = track(new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }));
        hat.volume.value = -23; hat.connect(hatFilter);
        track(new T.Sequence(function (time, on)
        {
            if (!gameFull()) { return; }
            if (on || (gameBlock() == 3 && Math.random() < 0.5)) { hat.triggerAttackRelease("16n", time, 0.6 + Math.random() * 0.3); }
        }, [0, 1, 0, 1, 0, 1, 0, 1], "8n")).start(0);

        // --- pulsing 16th synthwave bass (the relentless darksynth engine) ---
        var bass = track(new T.MonoSynth({
            oscillator: { type: "sawtooth" },
            filter: { Q: 4, type: "lowpass" },
            envelope: { attack: 0.004, decay: 0.1, sustain: 0.3, release: 0.05 },
            filterEnvelope: { attack: 0.004, decay: 0.08, sustain: 0.25, baseFrequency: 200, octaves: 3.2 }
        }));
        bass.volume.value = -9;
        var bassLfo = track(new T.LFO({ frequency: 0.03, min: 320, max: 1300, type: "triangle" }));
        var bassFilter2 = track(new T.Filter({ frequency: 700, type: "lowpass" }));
        bassLfo.connect(bassFilter2.frequency); bassLfo.start(0);
        var bassDrive = track(new T.Distortion({ distortion: 0.16, wet: 0.3 }));
        bass.connect(bassFilter2); bassFilter2.connect(bassDrive); bassDrive.connect(pumpGain);
        track(new T.Sequence(function (time, step)
        {
            var r = tr(ROOT[gameChordName()], gameXpose());
            // Octave accent on the off-16ths for movement.
            var note = (step % 4 == 2) ? octaveUp(r) : r;
            bass.triggerAttackRelease(note, "16n", time, step % 2 == 0 ? 0.95 : 0.7);
        }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "16n")).start(0);

        // --- syncopated overdriven power-chord stabs (full sections) ---
        var stabFilter = track(new T.Filter({ frequency: 2400, type: "lowpass", Q: 1 }));
        var stabDrive = track(new T.Distortion({ distortion: 0.25, wet: 0.4 }));
        stabFilter.connect(stabDrive); stabDrive.connect(delay); stabDrive.connect(pumpGain);
        var stab = track(new T.PolySynth(T.Synth));
        stab.set({ oscillator: { type: "fatsawtooth", count: 2, spread: 20 }, envelope: { attack: 0.006, decay: 0.16, sustain: 0.08, release: 0.12 } });
        stab.volume.value = -16; stab.connect(stabFilter);
        var stabPat = [1, 0, 0, 1, 0, 1, 0, 0];
        track(new T.Sequence(function (time, on)
        {
            if (on && gameFull())
            {
                stab.triggerAttackRelease(trc(POWER[gameChordName()], gameXpose()), "8n", time, 0.7);
            }
        }, stabPat, "8n")).start(0);

        // --- LEAD: distorted saw stating the theme (blocks 1 & 3, +2 in climax) ---
        var lead = track(new T.MonoSynth({
            oscillator: { type: "sawtooth" },
            filter: { Q: 2, type: "lowpass" },
            envelope: { attack: 0.006, decay: 0.18, sustain: 0.5, release: 0.12 },
            filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.5, baseFrequency: 800, octaves: 2.8 },
            portamento: 0.015
        }));
        lead.volume.value = -14;
        var leadDrive = track(new T.Distortion({ distortion: 0.3, wet: 0.35 }));
        var leadDelay = track(new T.FeedbackDelay({ delayTime: "8n.", feedback: 0.28, wet: 0.2 }));
        lead.connect(leadDrive); leadDrive.connect(leadDelay); leadDelay.connect(reverb);
        leadDrive.connect(bus);
        track(new T.Sequence(function (time, slot)
        {
            if (!gameLead()) { return; }
            var note = at(GAME_THEME, slot);
            if (note == null) { return; }
            lead.triggerAttackRelease(tr(note, gameXpose()), "8n", time, 0.7);
        }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
            16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], "8n")).start(0);

        // --- arcade arp: bright 16th triad sparkle in the climax only ---
        var arp = track(new T.FMSynth({
            harmonicity: 3, modulationIndex: 7,
            envelope: { attack: 0.002, decay: 0.08, sustain: 0.04, release: 0.06 },
            modulationEnvelope: { attack: 0.004, decay: 0.1, sustain: 0.05, release: 0.08 }
        }));
        arp.volume.value = -22;
        var arpFilter = track(new T.Filter({ frequency: 3500, type: "lowpass" }));
        arp.connect(arpFilter); arpFilter.connect(delay); arpFilter.connect(pumpGain);
        var arpStep = 0;
        track(new T.Sequence(function (time, slot)
        {
            if (gameBlock() != 3) { return; }
            var tones = trc(TRIAD[gameChordName()], gameXpose());
            arp.triggerAttackRelease(octaveUp(at(tones, arpStep)), "16n", time, 0.4);
            arpStep++;
        }, [0, 1, 2, 3], "16n")).start(0);
    }
}
