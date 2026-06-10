/**
 *  Global settings for the whole game
 *
 *  License: Apache 2.0
 *  author:  Ciarán McCann
 *  url: http://www.ciaranmccann.me/
 */
///<reference path="system/Utilies.ts" />

module Settings
{

    //Game vars
    export var PLAYER_TURN_TIME = 120 * 1000;
    export var TURN_TIME_WARING = 10;

    // Battle knobs lifted into the UI. Defaults match the engine's original
    // literals, so behaviour is identical unless the menu/URL changes them.
    // (Team reads WORMS_PER_TEAM; Worm reads WORM_HEALTH.)
    export var WORMS_PER_TEAM = 4;
    export var WORM_HEALTH = 80;
   
    //General game settings
    export var SOUND = false;

    //Server details
    export var NODE_SERVER_IP = '96.126.111.211'; 
    export var NODE_SERVER_PORT = '8080';

    // development vars
    export var DEVELOPMENT_MODE = false; 
    export var LOG = true;

    //When I want to build the manifest file using 
    // http://westciv.com/tools/manifestR/
    export var BUILD_MANIFEST_FILE = false;

    export var REMOTE_ASSERT_SERVER = "./";

    // Asset pack selection.
    // "default"  -> bundled placeholder assets in data/ (current behaviour).
    // any other  -> overlays assets from assets/worms-<pack>/ with graceful
    //               per-asset fallback to the default pack. See ASSETS.md.
    export var ASSET_PACK = "default";

    // Base directory (relative to the page) for the active asset pack.
    // For the default pack this returns "data/" so behaviour is unchanged.
    export function getAssetPackBase()
    {
        if (ASSET_PACK && ASSET_PACK != "default")
        {
            return "assets/worms-" + ASSET_PACK + "/";
        }
        return "data/";
    }

    // The pack that assets fall back to when the active pack is missing a file.
    export function getAssetFallbackBase()
    {
        return "data/";
    }

    export var PHYSICS_DEBUG_MODE = false;
    export var RUN_UNIT_TEST_ONLY = !true;

    export var ARENA_MODE = "";
    export var ARENA_AUTO_START = false;
    export var ARENA_TEAM_TYPES = [];
    export var ARENA_TEAM_MODELS = [];
    export var ARENA_AGENT_ENDPOINT = "/api/agent/turn";
    export var ARENA_CHAT_LANGUAGE = "English";
    export var ARENA_MEMORY_WINDOW = 14;
    export var ARENA_MEMORY_STRATEGY = "sliding";
    export var ARENA_MAX_BATCHES_PER_TURN = 4;
    // Verbose per-turn agent JSON is mirrored to the browser console only when
    // this is on (enable with ?arenaDebug=true). Server-side event logs are
    // always written regardless, so default-off just keeps the public build's
    // devtools console clean.
    export var ARENA_DEBUG_LOGS = false;

    export var NETWORKED_GAME_QUALITY_LEVELS = {
        HIGH: 0,
        MEDIUM: 1,
        LOW: 2
    }

    export var NETWORKED_GAME_QUALITY = NETWORKED_GAME_QUALITY_LEVELS.HIGH;


    //Pasers commandline type arguments from the page url like this ?argName=value
    export function getSettingsFromUrl()
    {
        var argv = getUrlVars();
        var commands = ["physicsDebugDraw","devMode","unitTest","sound","arena","teams","agentEndpoint","models","turnTime","turnMs","chatLang","chatLanguage","historySize","memoryWindow","memoryStrategy","maxBatches","maxBatchesPerTurn","assetPack"]

        if (argv[commands[0]] == "true")
        {
            PHYSICS_DEBUG_MODE = true;
        }

        if (argv[commands[1]] == "true")
        {
            DEVELOPMENT_MODE = true;
        }

        // The legacy QUnit "?unitTest=true" launcher (and test.html) were removed;
        // tests now live in tests/*.test.ts (vitest). The "unitTest" entry stays in
        // the commands array above so later index-based lookups keep their offsets.

        if (argv[commands[3]] == "false")
        {
            SOUND = false;
        }

        if (argv[commands[3]] == "true")
        {
            SOUND = true;
        }

        if (argv[commands[4]])
        {
            ARENA_MODE = argv[commands[4]];
            ARENA_AUTO_START = true;
        }

        if (argv[commands[5]])
        {
            ARENA_TEAM_TYPES = decodeURIComponent(argv[commands[5]]).split(",");
        }

        if (ARENA_TEAM_TYPES.length == 0 && ARENA_MODE == "llm-vs-llm")
        {
            ARENA_TEAM_TYPES = ["llm", "llm"];
        }

        if (ARENA_TEAM_TYPES.length == 0 && ARENA_MODE == "human-vs-llm")
        {
            ARENA_TEAM_TYPES = ["human", "llm"];
        }

        if (ARENA_TEAM_TYPES.length == 0 && ARENA_MODE != "")
        {
            ARENA_TEAM_TYPES = ["llm", "llm"];
        }

        if (argv[commands[6]])
        {
            ARENA_AGENT_ENDPOINT = decodeURIComponent(argv[commands[6]]);
        }

        if (argv[commands[7]])
        {
            ARENA_TEAM_MODELS = decodeURIComponent(argv[commands[7]]).split(",");
        }

        if (argv[commands[8]])
        {
            var turnSeconds = Math.max(5, Math.round(Number(argv[commands[8]]) || 120));
            PLAYER_TURN_TIME = turnSeconds * 1000;
        }

        if (argv[commands[9]])
        {
            PLAYER_TURN_TIME = Math.max(5000, Math.round(Number(argv[commands[9]]) || PLAYER_TURN_TIME));
        }

        if (argv[commands[10]] || argv[commands[11]])
        {
            ARENA_CHAT_LANGUAGE = decodeURIComponent(argv[commands[10]] || argv[commands[11]]);
        }

        if (argv[commands[12]] || argv[commands[13]])
        {
            ARENA_MEMORY_WINDOW = Math.max(0, Math.min(200, Math.round(Number(argv[commands[12]] || argv[commands[13]]) || ARENA_MEMORY_WINDOW)));
        }

        if (argv[commands[14]])
        {
            var strategy = decodeURIComponent(argv[commands[14]]).toLowerCase();
            if (strategy == "none" || strategy == "sliding" || strategy == "summary" || strategy == "full")
            {
                ARENA_MEMORY_STRATEGY = strategy;
            }
        }

        if (argv[commands[15]] || argv[commands[16]])
        {
            ARENA_MAX_BATCHES_PER_TURN = Math.max(1, Math.min(12, Math.round(Number(argv[commands[15]] || argv[commands[16]]) || ARENA_MAX_BATCHES_PER_TURN)));
        }

        if (argv[commands[17]])
        {
            ASSET_PACK = decodeURIComponent(argv[commands[17]]);
        }

        if (argv["arenaDebug"] == "true")
        {
            ARENA_DEBUG_LOGS = true;
        }

        Logger.log(" Notice: argv are as follows " + commands);
    }

    export function getUrlVars()
    {
        var vars = {};
        window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, key, value) 
        {
            vars[key] = value;
            return true;
        });
        return vars;
    }
}
