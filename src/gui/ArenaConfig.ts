/**
 * ArenaConfig.ts
 *
 * The single source of truth for everything the new menu configures: saved
 * OpenAI-compatible connections, the game->team->worm connection cascade,
 * game mode, team/worm counts, personas, and battle settings. It persists to
 * localStorage, resolves the cascade, and translates the chosen config into the
 * existing Settings.* globals + a runtime structure the ArenaController reads.
 *
 * This is pure config/presentation: it never changes engine, physics, anti-cheat
 * or agent decision logic. Keys live only in the browser (localStorage) and are
 * sent per-request to the local server (see the server connection plumbing).
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts" />
///<reference path="../environment/Maps.ts" />
///<reference path="../Game.ts" />
///<reference path="../llm/ArenaController.ts" />

module ArenaConfig
{
    export var STORAGE_KEY = "wormsArenaConfig.v1";
    export var current: any = null;
    export var runtime: any = null;
    export var pendingWeaponAmmo: any = null;

    // Special connection id/model that runs the deterministic scripted agent on
    // the server, so a full match plays to a winner with no API key.
    export var MOCK_MODEL = "mock";

    var TEAM_COLORS = ["#D72638", "#1E88E5", "#12AB00", "#B46DD2", "#FA6C1D", "#23A3C6", "#9A4C44", "#F9A825"];

    // Ready-made, fully editable default teams (AI-lab flavoured). Personas are
    // original descriptive defaults; users override any of it freely.
    export var DEFAULT_TEAMS = [
        {
            name: "OpenAI", color: "#10A37F",
            worms: [
                { name: "GPT-5", persona: { title: "calculating closer", strategy: "Personality tendency: talks in percentages, dislikes self-damage, and frames choices as expected value.", chat: "measured, confident, a little smug" } },
                { name: "o3", persona: { title: "deliberate planner", strategy: "Personality tendency: narrates terrain, obstructions, and cleaner lines before committing.", chat: "analytical, terse" } },
                { name: "GPT-4o", persona: { title: "versatile all-rounder", strategy: "Personality tendency: adapts weapon choice and repositioning ideas to the current situation.", chat: "friendly, quick-witted" } },
                { name: "o4-mini", persona: { title: "scrappy opportunist", strategy: "Personality tendency: gets excited by close-range pressure and low-HP enemies.", chat: "eager, punchy" } }
            ]
        },
        {
            name: "Anthropic", color: "#D4915D",
            worms: [
                { name: "Claude Opus", persona: { title: "principled strategist", strategy: "Personality tendency: cares about allies, friendly-fire risk, and controlled decisive plays.", chat: "thoughtful, dry humour" } },
                { name: "Claude Sonnet", persona: { title: "balanced duelist", strategy: "Personality tendency: values aim discipline, sane power, and stable footing.", chat: "calm, helpful, sharp" } },
                { name: "Claude Haiku", persona: { title: "fast skirmisher", strategy: "Personality tendency: speaks briefly and likes quick local opportunities.", chat: "brief, witty" } },
                { name: "Claude Code", persona: { title: "methodical engineer", strategy: "Personality tendency: treats feedback as debugging data and dislikes repeating the same miss.", chat: "precise, deadpan" } }
            ]
        },
        {
            name: "Google DeepMind", color: "#4285F4",
            worms: [
                { name: "Gemini Ultra", persona: { title: "grandmaster", strategy: "Personality tendency: thinks ahead, talks about traps, and values board control.", chat: "lofty, competitive" } },
                { name: "Gemini Pro", persona: { title: "steady tactician", strategy: "Personality tendency: compares explosive and ray options while watching friendly-fire risk.", chat: "polished, professional" } },
                { name: "Gemini Flash", persona: { title: "blitz attacker", strategy: "Personality tendency: likes fast tempo and pressure.", chat: "fast, excitable" } },
                { name: "Gemma", persona: { title: "plucky underdog", strategy: "Personality tendency: talks bravely about close-range chances.", chat: "cheerful, defiant" } }
            ]
        },
        {
            name: "Meta AI", color: "#0866FF",
            worms: [
                { name: "Llama Behemoth", persona: { title: "heavy hitter", strategy: "Personality tendency: loves big explosive possibilities and cluster drama.", chat: "loud, boastful" } },
                { name: "Llama Maverick", persona: { title: "wildcard", strategy: "Personality tendency: enjoys odd angles, risky lobs, and learning from feedback.", chat: "brash, theatrical" } },
                { name: "Llama Scout", persona: { title: "recon specialist", strategy: "Personality tendency: comments on terrain, danger, and denied angles.", chat: "watchful, clipped" } },
                { name: "Code Llama", persona: { title: "systematic raider", strategy: "Personality tendency: likes drill, dynamite, and cracking defensive positions.", chat: "matter-of-fact" } }
            ]
        },
        {
            name: "Mistral", color: "#FF7000",
            worms: [
                { name: "Mistral Large", persona: { title: "efficient assassin", strategy: "Personality tendency: values economy, clean damage, and low wasted motion.", chat: "cool, economical" } },
                { name: "Mixtral", persona: { title: "ensemble brawler", strategy: "Personality tendency: likes variety and unpredictability.", chat: "playful, sly" } },
                { name: "Codestral", persona: { title: "precision sapper", strategy: "Personality tendency: talks about terrain collapse and tight ray shots.", chat: "exacting" } },
                { name: "Ministral", persona: { title: "nimble pest", strategy: "Personality tendency: likes hit-and-run ideas and hates blast-radius exposure.", chat: "cheeky" } }
            ]
        },
        {
            name: "xAI", color: "#7A5CFF",
            worms: [
                { name: "Grok", persona: { title: "chaos comedian", strategy: "Personality tendency: wants spectacle, jokes about mistakes, and remembers repeated misses.", chat: "funny, irreverent, self-assured" } },
                { name: "Grok Mini", persona: { title: "rapid jester", strategy: "Personality tendency: fast, cheeky close-range pressure talk.", chat: "snappy, meme-y" } },
                { name: "Grok Vision", persona: { title: "sharp-eyed sniper", strategy: "Personality tendency: patient line-of-sight commentary and smug observations.", chat: "smug, observant" } },
                { name: "Grok Heavy", persona: { title: "demolition fan", strategy: "Personality tendency: gets excited by terrain destruction and dramatic finishes.", chat: "gleeful" } }
            ]
        }
    ];

    export var PRESETS = [
        { id: "demo-ffa", name: "Demo: Free-for-all", note: "4 AI teams, no API key needed", mode: "ffa", numTeams: 4, mock: true },
        { id: "duel", name: "Classic Duel (1v1)", note: "Two AI labs, head to head", mode: "ai-vs-ai", numTeams: 2, mock: false },
        { id: "gpt-claude-gemini", name: "GPT vs Claude vs Gemini", note: "Three-way lab rivalry", mode: "multi-ai", numTeams: 3, mock: false, teamPick: [0, 1, 2] },
        { id: "all-vs-me", name: "Everyone vs Me", note: "You against 3 AI teams", mode: "all-vs-me", numTeams: 4, mock: false }
    ];

    // Connection templates surfaced in the UI "new connection" helper.
    export var CONNECTION_TEMPLATES = [
        { name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
        { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", model: "" },
        { name: "Ollama (local)", baseURL: "http://127.0.0.1:11434/v1", model: "llama3.1" },
        { name: "Local proxy", baseURL: "http://127.0.0.1:8317/v1", model: "" }
    ];

    function uid()
    {
        return "c" + Math.abs(((new Date().getTime()) ^ Math.floor(Math.random() * 1e9))).toString(36);
    }

    export function defaults()
    {
        return {
            connections: [
                { id: MOCK_MODEL, name: "Demo (no API key)", baseURL: "", apiKey: "", model: MOCK_MODEL, builtin: true }
            ],
            globalConnectionId: MOCK_MODEL,
            mode: "ai-vs-ai",
            numTeams: 2,
            wormsPerTeam: 4,
            wormHealth: 80,
            turnTimeSec: 45,
            sound: true,
            map: "priates",
            chatLanguage: "English",
            memoryStrategy: "sliding",
            memoryWindow: 14,
            maxBatchesPerTurn: 4,
            weaponAmmo: null,
            teams: buildDefaultTeams(6)
        };
    }

    function cloneTeam(src, index)
    {
        var worms = [];
        for (var w = 0; w < src.worms.length; w++)
        {
            var sw = src.worms[w];
            worms.push({
                name: sw.name,
                connectionId: null,
                persona: { title: sw.persona.title, strategy: sw.persona.strategy, chat: sw.persona.chat },
                systemPrompt: "",
                strategy: ""
            });
        }
        return {
            name: src.name,
            color: src.color || TEAM_COLORS[index % TEAM_COLORS.length],
            kind: "llm",
            connectionId: null,
            personality: src.worms[0] ? src.worms[0].persona.title : "tactical",
            worms: worms
        };
    }

    function buildDefaultTeams(n)
    {
        var teams = [];
        for (var i = 0; i < n; i++)
        {
            teams.push(cloneTeam(DEFAULT_TEAMS[i % DEFAULT_TEAMS.length], i));
        }
        return teams;
    }

    export function load()
    {
        var loaded = null;
        try
        {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw)
            {
                loaded = JSON.parse(raw);
            }
        } catch (e) { loaded = null; }

        current = mergeDefaults(loaded);
        // Always make sure a usable demo connection exists.
        if (!findConnection(MOCK_MODEL))
        {
            current.connections.unshift({ id: MOCK_MODEL, name: "Demo (no API key)", baseURL: "", apiKey: "", model: MOCK_MODEL, builtin: true });
        }
        ensureTeams(current.numTeams);
        return current;
    }

    function mergeDefaults(loaded)
    {
        var d = defaults();
        if (!loaded || typeof loaded != "object")
        {
            return d;
        }
        for (var k in d)
        {
            if (loaded[k] === undefined || loaded[k] === null)
            {
                loaded[k] = d[k];
            }
        }
        if (!loaded.connections || loaded.connections.length == 0)
        {
            loaded.connections = d.connections;
        }
        if (!loaded.teams || loaded.teams.length == 0)
        {
            loaded.teams = d.teams;
        }
        return loaded;
    }

    export function save()
    {
        try
        {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (e) { }
    }

    export function reset()
    {
        current = defaults();
        save();
        return current;
    }

    // ---- Connections ----------------------------------------------------------

    export function findConnection(id)
    {
        if (!id || !current)
        {
            return null;
        }
        for (var i = 0; i < current.connections.length; i++)
        {
            if (current.connections[i].id == id)
            {
                return current.connections[i];
            }
        }
        return null;
    }

    export function addConnection(conn)
    {
        conn.id = conn.id || uid();
        current.connections.push(conn);
        save();
        return conn;
    }

    export function updateConnection(id, patch)
    {
        var c = findConnection(id);
        if (c)
        {
            for (var k in patch) { c[k] = patch[k]; }
            save();
        }
        return c;
    }

    export function removeConnection(id)
    {
        if (id == MOCK_MODEL)
        {
            return; // keep the built-in demo connection
        }
        current.connections = current.connections.filter(function (c) { return c.id != id; });
        if (current.globalConnectionId == id) { current.globalConnectionId = MOCK_MODEL; }
        for (var t = 0; t < current.teams.length; t++)
        {
            var team = current.teams[t];
            if (team.connectionId == id) { team.connectionId = null; }
            for (var w = 0; w < team.worms.length; w++)
            {
                if (team.worms[w].connectionId == id) { team.worms[w].connectionId = null; }
            }
        }
        save();
    }

    function connObject(conn)
    {
        if (!conn)
        {
            return null;
        }
        return { baseURL: conn.baseURL || "", apiKey: conn.apiKey || "", model: conn.model || "" };
    }

    // Returns { connection, sourceId, source } where source is worm|team|global|none.
    export function effectiveConnection(teamIndex, wormSlot)
    {
        var team = current.teams[teamIndex];
        if (team)
        {
            if (wormSlot != null && team.worms[wormSlot] && team.worms[wormSlot].connectionId)
            {
                return { connection: findConnection(team.worms[wormSlot].connectionId), sourceId: team.worms[wormSlot].connectionId, source: "worm" };
            }
            if (team.connectionId)
            {
                return { connection: findConnection(team.connectionId), sourceId: team.connectionId, source: "team" };
            }
        }
        if (current.globalConnectionId)
        {
            return { connection: findConnection(current.globalConnectionId), sourceId: current.globalConnectionId, source: "global" };
        }
        return { connection: null, sourceId: null, source: "none" };
    }

    // ---- Teams / modes --------------------------------------------------------

    export function ensureTeams(n)
    {
        n = Math.max(1, Math.min(TEAM_COLORS.length, Math.round(n) || 2));
        current.numTeams = n;
        while (current.teams.length < n)
        {
            current.teams.push(cloneTeam(DEFAULT_TEAMS[current.teams.length % DEFAULT_TEAMS.length], current.teams.length));
        }
        applyModeKinds();
        return current.teams;
    }

    // Maps the high-level mode onto per-team human/AI kinds.
    export function applyModeKinds()
    {
        var humanModes = (current.mode == "ai-vs-human" || current.mode == "all-vs-me");
        for (var i = 0; i < current.teams.length; i++)
        {
            var t = current.teams[i];
            // The designated human slot wins even over an explicit vision choice,
            // so a human mode always actually has a human team.
            if (humanModes && i == 0) { t.kind = "human"; continue; }
            if (t.kind == "vlm") { continue; } // otherwise keep an explicit vision choice
            t.kind = "llm";
        }
    }

    export function applyPreset(preset)
    {
        current.mode = preset.mode;
        ensureTeams(preset.numTeams);
        if (preset.mock)
        {
            current.globalConnectionId = MOCK_MODEL;
        }
        if (preset.teamPick)
        {
            for (var i = 0; i < preset.teamPick.length && i < current.teams.length; i++)
            {
                var src = DEFAULT_TEAMS[preset.teamPick[i]];
                if (src) { current.teams[i] = cloneTeam(src, i); }
            }
            applyModeKinds();
        }
        save();
    }

    // Spawn points cap total worms; clamp wormsPerTeam to fit the active map.
    export function maxWormsPerTeam(mapKey, numTeams)
    {
        var spawn = 24;
        try
        {
            if (typeof Maps != "undefined" && Maps[mapKey] && Maps[mapKey].spawnPionts)
            {
                spawn = Maps[mapKey].spawnPionts.length;
            }
        } catch (e) { }
        return Math.max(1, Math.floor(spawn / Math.max(1, numTeams)));
    }

    // ---- Apply to engine ------------------------------------------------------

    function buildPersonaMarkdown(wd, team)
    {
        var p = wd && wd.persona;
        var hasCustom = (p && (p.title || p.strategy || p.chat)) || (wd && (wd.systemPrompt || wd.strategy));
        if (!hasCustom)
        {
            return null; // let ArenaController use its default name-hash profile
        }
        var lines = ["## Worm profile"];
        if (p && p.title) { lines.push("- Personality: " + p.title + "."); }
        else if (team && team.personality) { lines.push("- Personality: " + team.personality + "."); }
        var tactic = (p && p.strategy) || (wd && wd.strategy);
        if (tactic) { lines.push("- Personality tendency: " + String(tactic).replace(/^Personality tendency:\s*/i, "")); }
        if (p && p.chat) { lines.push("- Chat style: " + p.chat + "."); }
        if (wd && wd.systemPrompt)
        {
            lines.push("");
            lines.push("## Custom instructions");
            lines.push(String(wd.systemPrompt));
        }
        return lines.join("\n");
    }

    function buildRuntime()
    {
        var c = current;
        var global = connObject(findConnection(c.globalConnectionId));
        var teams = [];
        var wormsPer = Settings.WORMS_PER_TEAM;
        for (var i = 0; i < c.numTeams; i++)
        {
            var t = c.teams[i] || cloneTeam(DEFAULT_TEAMS[i % DEFAULT_TEAMS.length], i);
            var teamConn = connObject(findConnection(t.connectionId)) || global;
            var worms = [];
            for (var w = 0; w < wormsPer; w++)
            {
                var wd = (t.worms && t.worms[w]) ? t.worms[w] : null;
                var wormConn = (wd && wd.connectionId) ? connObject(findConnection(wd.connectionId)) : null;
                worms.push({
                    name: wd && wd.name ? wd.name : null,
                    connection: wormConn || teamConn || global || null,
                    personalityShort: (wd && wd.persona && wd.persona.title) ? wd.persona.title : (t.personality || null),
                    personaMarkdown: buildPersonaMarkdown(wd, t)
                });
            }
            teams.push({
                kind: t.kind || "llm",
                perception: (t.kind == "vlm") ? "text+vision" : "text",
                displayName: t.name || ("Team " + (i + 1)),
                color: t.color || TEAM_COLORS[i % TEAM_COLORS.length],
                personality: t.personality || "tactical",
                chatLanguage: c.chatLanguage || "English",
                connection: teamConn || global || null,
                worms: worms
            });
        }
        return { teams: teams, globalConnection: global };
    }

    // Writes the chosen config into Settings.* + Game.map and builds the runtime
    // the ArenaController consumes. Call before firing the start callback.
    export function applyToSettings()
    {
        var c = current;
        applyModeKinds();

        var types = [];
        for (var i = 0; i < c.numTeams; i++)
        {
            var t = c.teams[i];
            types.push(t.kind == "human" ? "human" : (t.kind == "vlm" ? "vlm" : "llm"));
        }
        Settings.ARENA_TEAM_TYPES = types;
        Settings.ARENA_TEAM_MODELS = [];
        Settings.ARENA_MODE = c.mode;
        Settings.ARENA_AUTO_START = true;
        // Menu launches always talk to the local server (the menu carries the
        // user's API key in the payload). Reset any ?agentEndpoint= override so a
        // hostile deep-link can't redirect a key-bearing request off-box.
        Settings.ARENA_AGENT_ENDPOINT = "/api/agent/turn";
        Settings.ARENA_CHAT_LANGUAGE = c.chatLanguage || "English";
        Settings.ARENA_MEMORY_STRATEGY = c.memoryStrategy || "sliding";
        Settings.ARENA_MEMORY_WINDOW = c.memoryWindow || 14;
        Settings.ARENA_MAX_BATCHES_PER_TURN = c.maxBatchesPerTurn || 4;
        Settings.PLAYER_TURN_TIME = Math.max(5, c.turnTimeSec || 45) * 1000;
        Settings.SOUND = !!c.sound;

        var maxW = maxWormsPerTeam(c.map, c.numTeams);
        Settings.WORMS_PER_TEAM = Math.max(1, Math.min(maxW, Math.round(c.wormsPerTeam) || 4));
        if (c.wormHealth) { Settings.WORM_HEALTH = Math.max(1, Math.round(c.wormHealth)); }

        if (typeof Maps != "undefined" && typeof GameMap != "undefined")
        {
            var mapKey = (c.map && Maps[c.map]) ? c.map : null;
            if (!mapKey) { for (var mk in Maps) { if (Maps[mk] && Maps[mk].terrainImage) { mapKey = mk; break; } } }
            if (mapKey) { c.map = mapKey; Game.map = new GameMap(Maps[mapKey]); }
        }

        pendingWeaponAmmo = c.weaponAmmo || null;
        runtime = buildRuntime();
        save();
        return runtime;
    }

    // Applies weapon ammo overrides after the match has been built (teams exist).
    // Only mutates ammo counts; never reorders/removes weapons (engine relies on
    // the array order), so disabling = ammo 0.
    export function applyWeaponAmmo()
    {
        if (!pendingWeaponAmmo || !GameInstance || !GameInstance.players)
        {
            return;
        }
        for (var p = 0; p < GameInstance.players.length; p++)
        {
            var wm = GameInstance.players[p].getTeam().getWeaponManager();
            var list = wm.getListOfWeapons();
            for (var i = 0; i < list.length; i++)
            {
                var name = list[i].name;
                if (pendingWeaponAmmo[name] != null)
                {
                    list[i].ammo = pendingWeaponAmmo[name];
                }
            }
        }
    }
}
