/**
 * Sound.js
 * Sound wraps the Web audio api. When a sound file is loaded 
 * one of these is created using the sound buffer. It allows for a 
 * cleaner and simple api for doing basic things like playing sound, controling volume etc
 *
 * SoundFallback use just the simple Audio tag, works ok but not as feature full as web audio api.
 * 
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="../system/Utilies.ts"/>
declare var webkitAudioContext; 

class Sound
{
    static context;
    static sfxDucked = false;
    static activeGains: any[] = [];

    source;
    buffer;
    playing;
    gainEntry;

    constructor(buffer)
    {
        this.buffer = buffer;
        this.playing = false;


    }

    static effectiveSfxVolume(volume)
    {
        return Sound.sfxDucked ? 0 : volume;
    }

    static setSfxDucked(ducked)
    {
        Sound.sfxDucked = !!ducked;
        for (var i = Sound.activeGains.length - 1; i >= 0; i--)
        {
            var entry = Sound.activeGains[i];
            if (!entry || !entry.gain || !entry.gain.gain)
            {
                Sound.activeGains.splice(i, 1);
                continue;
            }
            try { entry.gain.gain.value = Sound.effectiveSfxVolume(entry.volume || 0); }
            catch (e) { Sound.activeGains.splice(i, 1); }
        }
        try
        {
            if (typeof SoundFallback != "undefined" && SoundFallback.setDucked)
            {
                SoundFallback.setDucked(Sound.sfxDucked);
            }
        }
        catch (e) { }
    }

    play(volume = 1, time = 0, allowSoundOverLay = false)
    {
        if (Settings.SOUND && this.buffer != null)
        {
            // if sound is playing don't replay it
            if (this.playing == false || allowSoundOverLay == true)
            {
                this.source = Sound.context.createBufferSource();
                this.source.buffer = this.buffer;

                var gainNode = Sound.context.createGainNode();
                this.source.connect(gainNode);
                gainNode.connect(Sound.context.destination);
                gainNode.gain.value = Sound.effectiveSfxVolume(volume);
                var gainEntry = { gain: gainNode, volume: volume };
                this.gainEntry = gainEntry;
                Sound.activeGains.push(gainEntry);
                this.source.noteOn(time);
                this.playing = true;
                var bufferLenght = this.buffer.duration;
                var done = false;
                var finish = () => {
                    if (done) { return; }
                    done = true;
                    this.playing = false;
                    var idx = Sound.activeGains.indexOf(gainEntry);
                    if (idx >= 0) { Sound.activeGains.splice(idx, 1); }
                    try { this.source.disconnect(); } catch (e) { }
                    try { gainNode.disconnect(); } catch (e) { }
                };
                try { this.source.onended = finish; } catch (e) { }

                setTimeout(finish, bufferLenght * 1000 + 50);
            }

        }
    }

    isPlaying()
    {
        return this.playing;
    }

    pause()
    {
        if (Settings.SOUND && this.buffer != null) {
            if (this.source && typeof(this.source.noteOff) !== 'undefined') {
                this.source.noteOff(0);
            } else if (this.source && typeof(this.source.stop) !== 'undefined') {
                this.source.stop(0);
            }
            this.playing = false;
            if (this.gainEntry)
            {
                var idx = Sound.activeGains.indexOf(this.gainEntry);
                if (idx >= 0) { Sound.activeGains.splice(idx, 1); }
            }
        }
    }


}

//SoundFallback use just the simple Audio tag, works ok but not as feature full as web audio api.
class SoundFallback extends Sound
{
    static instances: any[] = [];

    audio: HTMLAudioElement;
    counted;
    baseVolume;
    wasPlayingBeforeDuck;

    constructor(soundSrc)
    {
        super(soundSrc);
        this.load(soundSrc);
        SoundFallback.instances.push(this);
    }

    static setDucked(ducked)
    {
        for (var i = 0; i < SoundFallback.instances.length; i++)
        {
            var s = SoundFallback.instances[i];
            if (!s || !s.audio) { continue; }
            try
            {
                if (ducked)
                {
                    s.wasPlayingBeforeDuck = !s.audio.paused && !s.audio.ended;
                    s.audio.volume = 0;
                    if (s.wasPlayingBeforeDuck) { s.audio.pause(); }
                }
                else
                {
                    s.audio.volume = s.baseVolume != null ? s.baseVolume : 1;
                    if (s.wasPlayingBeforeDuck && !s.audio.ended)
                    {
                        var p = s.audio.play();
                        if (p && p["catch"]) { p["catch"](function () { }); }
                    }
                    s.wasPlayingBeforeDuck = false;
                }
            }
            catch (e) { }
        }
    }

    load(soundSrc)
    {
        // Count this sound exactly once toward the asset loader, whether it
        // loads or errors. Some engines can fire both loadeddata and error, so
        // guard against a double-increment (which, with isReady()'s threshold,
        // could otherwise leave the loader stuck above 100%).
        this.counted = false;
        var markCounted = () =>
        {
            if (!this.counted)
            {
                this.counted = true;
                AssetManager.numAssetsLoaded++;
            }
        };

          this.audio = <HTMLAudioElement>document.createElement("Audio");
        this.baseVolume = 1;
        this.wasPlayingBeforeDuck = false;

        // When the sound loads sucesfully tell the asset manager
        $(this.audio).on("loadeddata", () =>
        {
            markCounted();
            Logger.log(" Sound loaded " + this.audio.src );
        });

        this.audio.onerror = () => {
            Logger.error( " Sound failed to load " + this.audio.src);
            // Still count it so the asset loader can reach 100% and the game can
            // start even when an asset pack is missing this sound.
            markCounted();
        }

        this.audio.src = soundSrc;
        $('body').append(this.audio);

        // Register this <audio> with the recording capture graph so SFX are
        // included in match clips. Defensive: no-op if the recorder isn't loaded.
        try { if (typeof RecordingAudioBus != "undefined") { RecordingAudioBus.register(this.audio); } } catch (e) { }
    }

    play(volume = 1, time = 0, allowSoundOverLay = false)
    {
        if (Settings.SOUND)
        {
            // if sound is playing don't replay it
            //if (this.playing == false || allowSoundOverLay == true)
            {

                this.baseVolume = volume;
                this.audio.volume = Sound.effectiveSfxVolume(volume);
                var p = this.audio.play();
                if (p && p["catch"]) { p["catch"](function () { }); }
                this.playing = true;
            }

        } else
        {
            Logger.debug("Sounds are currently disabled");
        }
    }

    isPlaying()
    {
        return this.playing;
    }

    pause()
    {
        if (Settings.SOUND)
        {
            this.audio.pause();
            this.playing = false;
        }
    }
}

