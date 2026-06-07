/**
 * AssetManager.js
 * This manages the loading of image and sound assets. 
 * The loaded images and sounds are then acessable from any where by the following. 
 * AssetManager.images["myImageName"] no need for the full url or the extenision
 * 
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="../audio/Sound.ts"/>
declare var BufferLoader;

module AssetManager
{
    export var numAssetsLoaded: number = 0;

    // Placing an image url in the below array
    // will make sure its is loaded before the game starts.
    // you can then acess the image by AssetManager.getImage("placeHolderImage")
    // no need for the full url or the extenision
    var imagesToBeLoaded = [
        Settings.REMOTE_ASSERT_SERVER + "data/images/menu/stick.png"
    ];

    var bundledAudioToBeLoaded = [
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/CursorSelect.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/explosion1.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/explosion2.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/explosion3.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/WalkExpand.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/WalkCompress.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/drill.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/TIMERTICK.WAV",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/holygrenade.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/StartRound.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/JetPackLoop1.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/JetPackLoop2.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/fuse.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/NinjaRopeFire.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/NinjaRopeImpact.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/ROCKETPOWERUP.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/HOLYGRENADEIMPACT.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/GRENADEIMPACT.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/WormLanding.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/THROWPOWERUP.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/THROWRELEASE.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/SHOTGUNRELOAD.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/ShotGunFire.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/MiniGunFire.wav"
    ];

    var originalPackAudioToBeLoaded = [
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/JUMP1.WAV",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/hurry.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/ohdear.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/fire.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/victory.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/ow1.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/ow2.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/ow3.wav",
         Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/byebye.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/traitor.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/youllregretthat.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/justyouwait.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/watchthis.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/fatality.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/laugh.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/incoming.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/grenade.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/Speech/Irish/yessir.wav",
       Settings.REMOTE_ASSERT_SERVER + "data/sounds/cantclickhere.wav",
        Settings.REMOTE_ASSERT_SERVER + "data/sounds/fanfare/Ireland.wav"
    ];

    var audioToBeLoaded = bundledAudioToBeLoaded.slice(0);

    export var images = [];
    export var sounds = [];

    export function isReady()
    {
        // Use >= (not ==) so a defensive over-count can never leave isReady()
        // permanently false (which would dead-button the menu).
        return (numAssetsLoaded) >= imagesToBeLoaded.length + audioToBeLoaded.length;
    }

    export function getPerAssetsLoaded()
    {
        //Logger.debug(" ImagesToLoad {0} AudioToLoad {1} and totalsofar {2}".format(imagesToBeLoaded.length, audioToBeLoaded.length, numAssetsLoaded));
        return ((numAssetsLoaded) / (imagesToBeLoaded.length + audioToBeLoaded.length)) * 100;
    }

    export function getImage(s)
    {
        return images[s];
    }

    export function getSound(s): Sound
    {
        //If sound not found
        if (sounds[s] == null)
        {
            return new Sound(null);
        }

        return sounds[s];
    }

    // Rewrites a default-pack ("data/...") asset url to the active pack's
    // directory. For the default pack this is a no-op, so behaviour is unchanged.
    function resolvePackUrl(url)
    {
        var base = Settings.getAssetPackBase();
        if (base == "data/")
        {
            return url;
        }
        // Anchor on the known "<REMOTE_ASSERT_SERVER>data/" prefix so the rewrite
        // can't mis-target if the server path itself ever contains "data/".
        var prefix = Settings.REMOTE_ASSERT_SERVER + "data/";
        if (url.indexOf(prefix) == 0)
        {
            return Settings.REMOTE_ASSERT_SERVER + base + url.substring(prefix.length);
        }
        return url.replace("data/", base);
    }

    var missingAssetHintShown = false;
    function notifyMissingAsset(url)
    {
        if (missingAssetHintShown)
        {
            return;
        }
        missingAssetHintShown = true;
        Logger.error("Asset pack '" + Settings.ASSET_PACK + "' is missing files (e.g. " + url +
            "). Run `npm run fetch:assets:original` to install the original Worms assets locally. Falling back to placeholders.");
    }

    export function loadImages(sources)
    {

        var images = [];
        var loadedImages = 0;
        var numImages = 0;
        // get num of sources
        for (var src in sources)
        {
            numImages++;
        }

        var finalizeIfDone = function ()
        {
            if (loadedImages >= numImages)
            {
                for (var img in images)
                {
                    AssetManager.images[img] = images[img];
                }
                Logger.log("Loaded " + loadedImages + " image assets.");
            }
        };

        for (var src in sources)
        {
            var name = sources[src].match("[a-z,A-Z,0-9]+[.]png")[0].replace(".png", "");

            if (images[name] == null)
            {
                images[name] = new Image();

                if (Settings.BUILD_MANIFEST_FILE)
                {
                    $('body').append(images[name]);
                }

                // Capture per-asset state so the active-pack url can fall back
                // to the default-pack url if the pack is missing this file.
                (function (imgEl, fallbackUrl)
                {
                    imgEl.onload = function ()
                    {
                        loadedImages++;
                        finalizeIfDone();
                        numAssetsLoaded++;
                    };

                    imgEl.onerror = function ()
                    {
                        // Active pack does not have this asset: retry the default
                        // pack once before giving up.
                        if (!imgEl.triedFallback && imgEl.src.indexOf(fallbackUrl) == -1)
                        {
                            imgEl.triedFallback = true;
                            notifyMissingAsset(fallbackUrl);
                            imgEl.src = fallbackUrl;
                            return;
                        }

                        // Even the fallback failed: keep the loader progressing so
                        // the game can still start (this image will just be blank).
                        loadedImages++;
                        finalizeIfDone();
                        numAssetsLoaded++;
                    };
                })(images[name], sources[src]);
            } else
            {
                Logger.error("Image " + sources[src] + " has the same name as" + images[name].src);
            }

            images[name].src = resolvePackUrl(sources[src]);
        }

    }

    export function addSpritesDefToLoadList()
    {
        // Load all sprites
        for (var sprite in Sprites.worms)
        {
            imagesToBeLoaded.push(Settings.REMOTE_ASSERT_SERVER + "data/images/" + Sprites.worms[sprite].imageName + ".png");
        }

        for (var sprite in Sprites.weaponIcons)
        {
            imagesToBeLoaded.push(Settings.REMOTE_ASSERT_SERVER + "data/images/weaponicons/" + Sprites.weaponIcons[sprite].imageName + ".png");
        }

        for (var sprite in Sprites.weapons)
        {
            imagesToBeLoaded.push(Settings.REMOTE_ASSERT_SERVER + "data/images/" + Sprites.weapons[sprite].imageName + ".png");
        }

        for (var sprite in Sprites.particleEffects)
        {
            imagesToBeLoaded.push(Settings.REMOTE_ASSERT_SERVER + "data/images/" + Sprites.particleEffects[sprite].imageName + ".png");
        }

        for (var map in Maps)
        {
            imagesToBeLoaded.push(Settings.REMOTE_ASSERT_SERVER + "data/images/levels/" + Maps[map].terrainImage + ".png");
            imagesToBeLoaded.push(Settings.REMOTE_ASSERT_SERVER + "data/images/levels/" + Maps[map].smallImage + ".png");
        }


    }

    export function loadAssets()
    {
        // Always load audio so the in-game/menu sound toggle works at any time:
        // Settings.SOUND gates *playback* (see Sound.play), not loading. Missing
        // sounds are handled gracefully by the fault-tolerant loader, so this is
        // safe even when only a subset of the sound files is on disk.
        addSpritesDefToLoadList();
        loadImages(imagesToBeLoaded);
        audioToBeLoaded = bundledAudioToBeLoaded.slice(0);
        if (Settings.ASSET_PACK && Settings.ASSET_PACK != "default")
        {
            audioToBeLoaded = audioToBeLoaded.concat(originalPackAudioToBeLoaded);
        }

        if (audioToBeLoaded.length > 0)
        {
            loadSounds(audioToBeLoaded);
        }
    }

    export function loadSounds(sources)
    {
        // Resolve every sound url against the active asset pack.
        var resolved = [];
        for (var r = 0; r < sources.length; r++)
        {
            resolved.push(resolvePackUrl(sources[r]));
        }

        //First lets try load our audio using the web audio API
        try
        {
            if (Settings.BUILD_MANIFEST_FILE)
            {
                throw "LOL"
            }

            Sound.context = new webkitAudioContext();
            var bufferLoader = new BufferLoader(Sound.context, resolved, function (bufferList)
            {
                for (var i = 0; i < bufferList.length; i++)
                {
                    var entry = bufferList[i];
                    // entry.buffer may be null for a missing/undecodable sound;
                    // Sound treats a null buffer as a safe no-op so playback is
                    // simply silent and the loader never stalls.
                    if (entry && entry.name)
                    {
                        sounds[entry.name] = new Sound(entry.buffer);
                    }
                    numAssetsLoaded++;
                }
            });
            bufferLoader.load();

        }
         catch (e) //web Auido api failed so lets try the normal audio tag
        {
            console.log('Web Audio API is not supported in this browser');
            try
            {
                var testForAudio = new Audio();

                for (var src in sources)
                {
                    var name = sources[src].match("[a-z,A-Z,0-9]+[.]")[0].replace(".", "")
                    var url = resolved[src];

                    // If IE use mp3 instead
                    if ($.browser.msie)
                    {
                        url = url.replace(".wav", ".mp3");
                        url = url.replace(".WAV", ".mp3");
                    }

                    //Hmm seems like IE9 doesn't like loading anymore then 40 audio files in parallel.
                    //I have 44 audio assets :( #FuckYouInternetExplorer
                    if ($.browser.msie &&  parseInt(src) >=  40)
                    {
                        numAssetsLoaded += sources.length-parseInt(src);
                        break;
                    }

                    sounds[name] = new SoundFallback(url);
                }
            } catch (e) // All HTML5 audio failed, this is not good :(
            {
                alert("The browser or device your using doesn't seem to like any type of HTML5 audio, sorry");
                numAssetsLoaded += sources.length; // To tell the loader everything is finished
            }
        }
    }

}
