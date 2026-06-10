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

    var master: any = null;      // master Gain -> Compressor -> Limiter -> Destination
    var limiter: any = null;
    var comp: any = null;

    var scene = "none";          // "none" | "menu" | "game"
    var pending = "none";        // requested scene awaiting unlock
    var disposables: any[] = []; // nodes + sequences/loops owned by the current scene

    var bar = 0;                 // global bar counter driving the form

    var MASTER_LEVEL = 0.82;
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

    function ensureMaster()
    {
        if (!T) { return null; }
        if (!master)
        {
            limiter = new T.Limiter(-1).toDestination();
            // Gentle glue, not a brick wall: a low ratio keeps the drums punchy
            // and the sidechain pump audible instead of squashing it flat.
            comp = new T.Compressor({ threshold: -18, ratio: 2.2, attack: 0.02, release: 0.18 }).connect(limiter);
            master = new T.Gain(muted ? 0 : MASTER_LEVEL).connect(comp);
        }
        return master;
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
    export function enterGame() { request("game"); }
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
            try { master.gain.rampTo(muted ? 0 : MASTER_LEVEL, 0.25); }
            catch (e) { try { master.gain.value = muted ? 0 : MASTER_LEVEL; } catch (e2) { } }
        }
    }

    export function toggleMute() { setMuted(!muted); return muted; }

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
        // Duck to silence before swapping so the rebuild + Transport restart does
        // not click, then fade the new scene in smoothly.
        try { master.gain.value = 0; } catch (e) { }
        try { T.Transport.stop(); T.Transport.position = 0; } catch (e) { }

        try
        {
            if (name == "menu") { buildMenu(); }
            else if (name == "game") { buildGame(); }
        }
        catch (e) { }

        try { T.Transport.start("+0.05"); } catch (e) { }
        try { master.gain.rampTo(muted ? 0 : MASTER_LEVEL, FADE); } catch (e) { }
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
        var bus = ensureMaster();
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
    var GAME_A = ["Am", "G", "F", "E"];
    var GAME_B = ["F", "C", "G", "Am"];
    // Distorted-saw LEAD theme: 4 bars at 8th-note resolution (A-minor hook).
    var GAME_THEME = [
        "A4", null, "C5", null, "E5", null, null, "D5",   // bar 1
        "C5", null, "B4", null, "A4", null, null, null,   // bar 2
        "A4", null, "C5", null, "E5", null, "G5", "F5",   // bar 3
        "E5", null, "D5", null, "C5", "B4", "A4", null    // bar 4
    ];

    // Per-bar state derived from the form.
    function gameBlock() { return Math.floor((bar % 16) / 4); }
    function gameProg() { return (gameBlock() <= 1) ? GAME_A : GAME_B; }
    function gameSemi() { return (gameBlock() == 3) ? 2 : 0; }   // +2 climax
    function gameFull() { return gameBlock() >= 1; }
    function gameLead() { var b = gameBlock(); return b == 1 || b == 3; }
    function gameChordName() { return gameProg()[bar % 4]; }

    function buildGame()
    {
        var bus = ensureMaster();
        var BPM = 126;
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
                        tom.triggerAttackRelease(tomRoots[k % 4], "16n", time + barLen * 0.5 + (barLen / 16) * k, 0.5 + k * 0.05);
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
            var r = tr(ROOT[gameChordName()], gameSemi());
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
                stab.triggerAttackRelease(trc(POWER[gameChordName()], gameSemi()), "8n", time, 0.7);
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
            lead.triggerAttackRelease(tr(note, gameSemi()), "8n", time, 0.7);
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
            var tones = trc(TRIAD[gameChordName()], gameSemi());
            arp.triggerAttackRelease(octaveUp(at(tones, arpStep)), "16n", time, 0.4);
            arpStep++;
        }, [0, 1, 2, 3], "16n")).start(0);
    }
}
