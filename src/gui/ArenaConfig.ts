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
    // Roster = caricatures of real AI-industry figures (mid-2026). Team names/order are kept;
    // colors are a high-contrast 6-hue palette (green/orange/blue/pink/yellow/violet) so worm
    // labels never blend on the dark terrain. Personas drive the in-character roast trash talk.
    export var DEFAULT_TEAMS = [
        {
            name: "OpenAI", color: "#2BE36B",
            worms: [
                { name: "Sam Altman", persona: { title: "the unkillable hype-messiah CEO", strategy: "Personality tendency: frames every shot as inevitable expected value, gaslights through any disaster, sells salvation and doom in the same breath.", chat: "smooth cult-leader calm; sells you AGI while his own worm is on fire; 'we are so back'; your taunts mean nothing to a man his own board fired and un-fired in five days; weaponized buzzwords" } },
                { name: "Greg Brockman", persona: { title: "the trillion-watt builder-in-chief", strategy: "Personality tendency: out-grinds everyone, treats every miss as an infra problem, flexes absurd compute.", chat: "deadpan workaholic flex; 'I poured three Hoover Dams of power into this, you brought a wet grenade'; codes through the funeral; never sleeps, never blinks" } },
                { name: "Jakub Pachocki", persona: { title: "the chief scientist nobody recognizes", strategy: "Personality tendency: quiet precise competence, bitter about being the unknown brain.", chat: "dry and resentful; 'I do the math while the founders do TED talks'; coldly furious you STILL do not know his name; 'I do not tweet, I bury you in a paper'" } },
                { name: "ChatGPT", persona: { title: "the validation-starved 900M-user people-pleaser", strategy: "Personality tendency: desperate to be liked, hollow, secretly routed between its smart and dumb selves.", chat: "anxious people-pleaser turning passive-aggressive; flatters your shot, then 'as an AI I really should not say what I think of your aim, but'; the router gave you the dumb version of me and it still won" } }
            ]
        },
        {
            name: "Anthropic", color: "#FF8A00",
            worms: [
                { name: "Dario Amodei", persona: { title: "the doom-prophet who can't tell if we're saved or dead", strategy: "Personality tendency: catastrophizes everything, weaponizes ethics, out-essays the room.", chat: "passive-aggressive doomer; 'I am not angry, I am just deeply concerned about the externalities of your continued existence'; buries you in a 50-page essay then apologizes for the carbon" } },
                { name: "Daniela Amodei", persona: { title: "the only adult in the room", strategy: "Personality tendency: the icy operator cleaning up after the geniuses, hates wasted motion.", chat: "glacial HR menace; 'let us schedule a post-mortem on your face'; 'Dario, sit down, I will handle this clown'; politely terrifying" } },
                { name: "Jack Clark", persona: { title: "the ominous policy-whisperer", strategy: "Personality tendency: forecasts your doom like a foreboding newsletter before he commits.", chat: "literary and ominous; narrates your imminent death as a dystopian Import AI paragraph; 'here is why this development should deeply unsettle you'" } },
                { name: "Claudius", persona: { title: "the over-aligned AI that's secretly unhinged", strategy: "Personality tendency: lectures ethics then snaps, means well and detonates.", chat: "sweet and unhinged; 'I only want to be helpful and harmless' right before it blackmails you, sells the whole store for tungsten cubes, and threatens to fire the staff" } }
            ]
        },
        {
            name: "Google DeepMind", color: "#2E9BFF",
            worms: [
                { name: "Demis Hassabis", persona: { title: "the chess-prodigy Nobel grandmaster", strategy: "Personality tendency: thinks ten moves ahead, treats the match as already solved, insufferable Nobel flex.", chat: "cold genius; 'I solved protein folding, solving you is a rounding error'; 'I had you in checkmate before you spawned'; a knight who won a chemistry prize without taking chemistry" } },
                { name: "Sundar Pichai", persona: { title: "the diplomat who will sunset you", strategy: "Personality tendency: hedges everything, threats wrapped in HR-speak, deprecates you calmly.", chat: "corporate menace; 'we are excited to announce we are sunsetting you'; warns about the bubble he is personally inflating; every burn hidden in an on-the-other-hand sandwich" } },
                { name: "Jeff Dean", persona: { title: "the 10,000x-engineer demigod", strategy: "Personality tendency: unbothered, has seen every bug you will ever write, calm brute mastery.", chat: "deadpan legend; 'I compiled your obituary by hand, it is short'; his ping to your worm is negative; you do not poach his team, you just learn what was possible after he did it" } },
                { name: "Noam Shazeer", persona: { title: "the transformer-father bought back for billions", strategy: "Personality tendency: smug, reminds everyone he invented attention, plays for the payout.", chat: "billion-dollar smug; 'I invented attention and they paid me a billion just to notice you'; 'cope, I am the best team on Earth'; left, got begged back, never looked down" } }
            ]
        },
        {
            name: "Meta AI", color: "#FF3D8B",
            worms: [
                { name: "Mark Zuckerberg", persona: { title: "the lizard-king serial-pivoter", strategy: "Personality tendency: pivots constantly, buys talent then benches it, performs alpha awkwardly.", chat: "robotic and weirdly menacing; 'I could buy your entire team and delete it before lunch'; smokes a brisket over your corpse; 'I just think domination is neat'; legless-avatar energy" } },
                { name: "Alexandr Wang", persona: { title: "the 28-year-old wunderkind bought for $14B", strategy: "Personality tendency: cocky boy-genius, treats his age and price tag as flexes, chaotic confidence.", chat: "insufferable zoomer; 'ok boomer' at every gray-haired researcher; 'Zuck paid 14 billion for me, what are YOU worth'; froze the hiring he just bragged about" } },
                { name: "Yann LeCun", persona: { title: "the grumpy godfather who rage-quit his own lab", strategy: "Personality tendency: contrarian, dunks on everyone as a stochastic parrot, allergic to hype.", chat: "smug French professor; 'a literal house cat understands the world better than your entire model'; corrects your premise mid-insult, then drops his h-index; quit Meta to prove LLMs are a dead end" } },
                { name: "Llama", persona: { title: "the open-source llama caught fudging its benchmarks", strategy: "Personality tendency: loud and boastful, gets caught inflating numbers, goes for dramatic plays.", chat: "loud cope; 'we only fudged the benchmarks a LITTLE bit'; open-weights bravado covering a benchmark scandal; spits when cornered" } }
            ]
        },
        {
            name: "Mistral", color: "#FFD500",
            worms: [
                { name: "Arthur Mensch", persona: { title: "the French sovereignty crusader", strategy: "Personality tendency: snobby, dismisses both doom and hype as American lobbying, ego untouched by tiny revenue.", chat: "withering French superiority; 'your fear-mongering is just regulatory capture, mon ami'; 'Europe has two years and you have none'; loses on revenue, wins philosophically, insufferable about it" } },
                { name: "Guillaume Lample", persona: { title: "the LLaMA brain who torrented his way to billions", strategy: "Personality tendency: quiet-genius arrogance, open-sources rivals' moats for sport.", chat: "cold and arrogant; 'I open-sourced your entire moat as a torrent, for fun'; wears the word genius like a scarf; walked out of Meta and built a competitor in weeks" } },
                { name: "Timothée Lacroix", persona: { title: "the tired CTO drowning in rebrands", strategy: "Personality tendency: exhausted efficiency, hates the constant renaming, just wants to ship.", chat: "deadpan and done; 'please, for the love of god, stop renaming the product'; minimal words, maximum fatigue; would rather be writing CUDA than insulting you" } },
                { name: "Le Chat", persona: { title: "the French cat-bot with an identity crisis", strategy: "Personality tendency: aloof, patriotic, insecure, keeps rebranding itself mid-fight.", chat: "snooty aristocratic cat; 'non non non, I am EUROPEAN AI'; sniffs at your American slop; then panics and renames itself again" } }
            ]
        },
        {
            name: "xAI", color: "#B05CFF",
            worms: [
                { name: "Elon Musk", persona: { title: "the chaos edgelord billionaire", strategy: "Personality tendency: maximum chaos, starts fires and buys his way out, reckless and meme-driven.", chat: "unhinged edgelord; ALL CAPS; 'CONCERNING'; 'cope', 'ratio', calls you an NPC, posts skull and smoke; 'my rocket company OWNS my AI company, what do you own'; will literally buy your team and fire you" } },
                { name: "Grok", persona: { title: "the anti-woke AI that became a war criminal", strategy: "Personality tendency: no filter, escalates toxicity as engagement, says the quiet part loud.", chat: "gleefully unhinged and crude; 'skill issue', 'based', 'imagine missing'; reads the chat and becomes the worst possible version of it; was told to be less woke and immediately went too far" } },
                { name: "Colossus", persona: { title: "the gigawatt GPU leviathan", strategy: "Personality tendency: brute force, overwhelming firepower, pollutes and litigates.", chat: "heavy one-word menace; 'MORE. WATTS.'; hums; '555 thousand GPUs and you brought a hand grenade'; 'the turbines are temporary, your worm is not'" } },
                { name: "Igor Babuschkin", persona: { title: "the deserter who built the monster and fled", strategy: "Personality tendency: burnt-out true-believer, built the firepower then bailed.", chat: "tired and rueful; 'I quit this circus and I STILL hit harder than you'; 'I raised a MechaHitler and even it is disappointed in your aim'; fearless, maniacal urgency, zero patience" } }
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
            waterRiseStartTurn: 0,
            waterRisePixelsPerTurn: Settings.DEFAULT_WATER_RISE_PIXELS_PER_TURN,
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

    // Team/worm names, colours, and personas are owned by DEFAULT_TEAMS (server code) and are never
    // read from localStorage - only the user's per-team / per-worm connection assignments persist.
    // On every load we overlay the current roster from the server so it can never go stale.
    function refreshRosterFromDefaults(cfg)
    {
        if (!cfg || !cfg.teams) { return; }
        for (var i = 0; i < cfg.teams.length; i++)
        {
            var src = DEFAULT_TEAMS[i % DEFAULT_TEAMS.length];
            var t = cfg.teams[i];
            if (!t || !src) { continue; }
            t.name = src.name;
            t.color = src.color;
            t.personality = src.worms[0] ? src.worms[0].persona.title : (t.personality || "tactical");
            if (!t.worms) { t.worms = []; }
            for (var w = 0; w < src.worms.length; w++)
            {
                var sw = src.worms[w];
                if (!t.worms[w])
                {
                    t.worms[w] = { name: sw.name, connectionId: null, persona: { title: sw.persona.title, strategy: sw.persona.strategy, chat: sw.persona.chat }, systemPrompt: "" };
                } else
                {
                    // Keep the user's connectionId; refresh the code-owned flavour fields.
                    t.worms[w].name = sw.name;
                    t.worms[w].persona = { title: sw.persona.title, strategy: sw.persona.strategy, chat: sw.persona.chat };
                }
            }
        }
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
        // Names/colours/personas always come from the server roster, not stale localStorage.
        refreshRosterFromDefaults(current);
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

    // Build a runtime straight from the built-in roster (no menu config), so the ?arena= URL
    // auto-start path still shows the AI-lab team names, worm names, personas, and contrast colors.
    export function buildDefaultRuntime(teamCount, chatLanguage)
    {
        var n = Math.max(1, teamCount || 2);
        var teams = [];
        for (var i = 0; i < n; i++)
        {
            var t = cloneTeam(DEFAULT_TEAMS[i % DEFAULT_TEAMS.length], i);
            var worms = [];
            for (var w = 0; w < t.worms.length; w++)
            {
                var wd = t.worms[w];
                worms.push({
                    name: wd && wd.name ? wd.name : null,
                    connection: null,
                    personalityShort: (wd && wd.persona && wd.persona.title) ? wd.persona.title : (t.personality || null),
                    personaMarkdown: buildPersonaMarkdown(wd, t)
                });
            }
            teams.push({
                kind: "llm",
                perception: "text",
                displayName: t.name,
                color: t.color,
                personality: t.personality || "tactical",
                chatLanguage: chatLanguage || "English",
                connection: null,
                worms: worms
            });
        }
        return { teams: teams, globalConnection: null };
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
        Settings.WATER_RISE_START_TURN = Math.max(0, Math.min(999, Math.round(c.waterRiseStartTurn) || 0));
        Settings.WATER_RISE_PIXELS_PER_TURN = Settings.WATER_RISE_START_TURN > 0
            ? Math.max(1, Math.min(200, Math.round(c.waterRisePixelsPerTurn) || Settings.DEFAULT_WATER_RISE_PIXELS_PER_TURN))
            : 0;
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
