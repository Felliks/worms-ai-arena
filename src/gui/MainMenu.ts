/**
 * MainMenu.ts
 *
 * The themed Worms-Armageddon-style front end: main menu, quick play, battle
 * setup, the model-connection manager (game->team->worm cascade) and the team/
 * persona editor. It only reads/writes ArenaConfig + Settings and fires the
 * existing start callback; it never touches engine/agent/anti-cheat code.
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts" />
///<reference path="../environment/Maps.ts" />
///<reference path="../system/AssetManager.ts" />
///<reference path="ArenaConfig.ts" />
///<reference path="MenuAudio.ts" />

module MainMenu
{
    var rootEl: any = null;
    var stageEl: any = null;
    var backBtn: any = null;
    var startCallback: any = null;
    var screen = "home";

    var MODES = [
        { id: "ai-vs-ai", label: "AI vs AI" },
        { id: "ai-vs-human", label: "AI vs Human" },
        { id: "multi-ai", label: "Multiple AI teams" },
        { id: "ffa", label: "Free-for-all" },
        { id: "all-vs-me", label: "Everyone vs Me" }
    ];

    // ---- tiny DOM helper -----------------------------------------------------
    function el(tag, opts, kids)
    {
        var node = document.createElement(tag);
        if (opts)
        {
            if (opts.class) { node.className = opts.class; }
            if (opts.text != null) { node.textContent = opts.text; }
            if (opts.html != null) { node.innerHTML = opts.html; }
            if (opts.attrs) { for (var a in opts.attrs) { node.setAttribute(a, opts.attrs[a]); } }
            if (opts.style) { for (var s in opts.style) { node.style[s] = opts.style[s]; } }
            if (opts.on) { for (var ev in opts.on) { node.addEventListener(ev, opts.on[ev]); } }
        }
        if (kids)
        {
            for (var i = 0; i < kids.length; i++)
            {
                var k = kids[i];
                if (k == null) { continue; }
                node.appendChild(typeof k == "string" ? document.createTextNode(k) : k);
            }
        }
        return node;
    }

    function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }

    var toastTimer = null;
    export function toast(message, isError)
    {
        var existing = document.getElementById("waToast");
        if (existing) { existing.parentNode.removeChild(existing); }
        var t = el("div", { class: "wa-toast" + (isError ? " wa-toast-err" : ""), text: message, attrs: { id: "waToast" } });
        document.body.appendChild(t);
        if (toastTimer) { clearTimeout(toastTimer); }
        toastTimer = setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, isError ? 5200 : 2600);
    }

    function playClick() { try { MenuAudio.click(); } catch (e) { } }

    // ---- lifecycle -----------------------------------------------------------
    export function show(callback)
    {
        startCallback = callback;
        ArenaConfig.load();
        // Audio is already loaded at boot; Settings.SOUND only gates playback, so
        // honour the saved preference for menu click sounds.
        Settings.SOUND = !!ArenaConfig.current.sound;

        var oldStart = document.getElementById("startMenu");
        if (oldStart && oldStart.parentNode) { oldStart.parentNode.removeChild(oldStart); }

        if (rootEl && rootEl.parentNode) { rootEl.parentNode.removeChild(rootEl); }

        backBtn = el("button", { class: "wbtn wbtn-ghost wbtn-sm", text: "← Back", style: { display: "none" }, on: { click: function () { playClick(); go("home"); } } });

        var header = el("div", { class: "wa-header" }, [
            el("div", { class: "wa-logo" }, [
                el("span", { class: "wa-logo-main", text: "WORMS" }),
                el("span", { class: "wa-logo-sub", text: "A.I. ARENA" })
            ]),
            backBtn,
            el("div", { class: "wa-header-spacer" }),
            el("div", { class: "wa-pill", text: "LLM battle royale · turn-based" })
        ]);

        stageEl = el("div", { class: "wa-stage" });

        var footer = el("div", { class: "wa-footer" }, [
            el("span", { class: "wa-link", text: "Local 2-player", on: { click: function () { playClick(); startLocalGame(); } } }),
            el("span", { text: "·" }),
            el("span", { class: "wa-link", text: "Tutorial", on: { click: function () { playClick(); startTutorial(); } } }),
            el("div", { class: "wa-footer-spacer" }),
            el("span", { class: "wa-link", text: "Reset settings", on: { click: function () { ArenaConfig.reset(); toast("Settings reset to defaults"); go(screen); } } }),
            el("span", { text: "·" }),
            el("span", { html: "Art &amp; sounds © Team17 (not bundled – see ASSETS.md)" })
        ]);

        rootEl = el("div", { attrs: { id: "wormsMenu" } }, [header, stageEl, footer]);
        document.body.appendChild(rootEl);
        try { MenuAudio.init(); } catch (e) { }
        go("home");
    }

    export function hide()
    {
        if (rootEl && rootEl.parentNode) { rootEl.parentNode.removeChild(rootEl); }
        rootEl = null;
    }

    function go(name)
    {
        screen = name;
        clear(stageEl);
        if (backBtn) { backBtn.style.display = (name == "home") ? "none" : ""; }
        if (name == "home") { renderHome(); }
        else if (name == "setup") { renderSetup(); }
        else if (name == "connections") { renderConnections(); }
        else if (name == "teams") { renderTeams(); }
        stageEl.scrollTop = 0;
    }

    // ---- shared controls -----------------------------------------------------
    function panel(titleText, narrow)
    {
        var p = el("div", { class: "wa-panel" + (narrow ? " wa-narrow" : "") });
        if (titleText) { p.appendChild(el("div", { class: "wa-panel-title", text: titleText })); }
        stageEl.appendChild(p);
        return p;
    }

    function field(labelText, control, hint)
    {
        var kids = [el("label", { text: labelText }), control];
        if (hint) { kids.push(el("div", { class: "wa-hint", text: hint })); }
        return el("div", { class: "wa-field" }, kids);
    }

    function stepper(value, min, max, onChange)
    {
        var valEl = el("div", { class: "wa-stepper-val", text: String(value) });
        function setv(v) { v = Math.max(min, Math.min(max, v)); valEl.textContent = String(v); onChange(v); }
        return el("div", { class: "wa-stepper" }, [
            el("button", { text: "−", on: { click: function () { playClick(); setv(Number(valEl.textContent) - 1); } } }),
            valEl,
            el("button", { text: "+", on: { click: function () { playClick(); setv(Number(valEl.textContent) + 1); } } })
        ]);
    }

    function segmented(options, currentId, onChange)
    {
        var wrap = el("div", { class: "wa-seg" });
        for (var i = 0; i < options.length; i++)
        {
            (function (opt)
            {
                var b = el("button", { text: opt.label, class: opt.id == currentId ? "wa-on" : "" , on: { click: function ()
                {
                    playClick();
                    var btns = wrap.querySelectorAll("button");
                    for (var j = 0; j < btns.length; j++) { btns[j].className = ""; }
                    b.className = "wa-on";
                    onChange(opt.id);
                } } });
                wrap.appendChild(b);
            })(options[i]);
        }
        return wrap;
    }

    function connectionOptions(selectedId, includeInherit)
    {
        var sel = el("select", { class: "wa-select" });
        if (includeInherit)
        {
            sel.appendChild(el("option", { text: "Inherit ↓", attrs: { value: "" } }));
        }
        var conns = ArenaConfig.current.connections;
        for (var i = 0; i < conns.length; i++)
        {
            var o = el("option", { text: conns[i].name, attrs: { value: conns[i].id } });
            if (conns[i].id == selectedId) { o.setAttribute("selected", "selected"); }
            sel.appendChild(o);
        }
        sel.value = selectedId || "";
        return sel;
    }

    // ---- HOME ----------------------------------------------------------------
    function renderHome()
    {
        var c = ArenaConfig.current;
        var p = panel("");

        p.appendChild(el("div", { class: "wa-help", html: "Pick a <b>connection</b>, choose how many <b>teams</b>, and hit <b>Play</b>. The <b>Demo</b> connection needs no API key. Tune everything else in Battle Setup, Connections and Teams." }));
        p.appendChild(el("div", { class: "wa-spacer" }));

        var modeSel = el("select", { class: "wa-select" });
        for (var i = 0; i < MODES.length; i++)
        {
            var o = el("option", { text: MODES[i].label, attrs: { value: MODES[i].id } });
            modeSel.appendChild(o);
        }
        modeSel.value = c.mode;
        modeSel.addEventListener("change", function () { c.mode = modeSel.value; ArenaConfig.applyModeKinds(); ArenaConfig.save(); });

        var connSel = connectionOptions(c.globalConnectionId, false);
        connSel.addEventListener("change", function () { c.globalConnectionId = connSel.value; ArenaConfig.save(); });

        var teamsStep = stepper(c.numTeams, 1, 8, function (v) { ArenaConfig.ensureTeams(v); ArenaConfig.save(); });

        var playRow = el("div", { class: "wa-play-row" }, [
            el("div", { class: "wa-field wa-grow" }, [el("label", { text: "Connection (model)" }), connSel]),
            el("div", { class: "wa-field wa-grow" }, [el("label", { text: "Mode" }), modeSel]),
            el("div", { class: "wa-field" }, [el("label", { text: "Teams" }), teamsStep]),
            el("button", { class: "wbtn wbtn-primary wbtn-xl", text: "▶ PLAY", on: { click: function () { playClick(); play(); } } })
        ]);
        p.appendChild(playRow);

        p.appendChild(el("div", { class: "wa-section-title", text: "One-click presets" }));
        var presetRow = el("div", { class: "wa-inline" });
        var presets = ArenaConfig.PRESETS;
        for (var k = 0; k < presets.length; k++)
        {
            (function (preset)
            {
                presetRow.appendChild(el("button", { class: "wbtn wbtn-accent wbtn-sm", text: preset.name, attrs: { title: preset.note }, on: { click: function ()
                {
                    playClick();
                    ArenaConfig.applyPreset(preset);
                    toast("Preset: " + preset.name);
                    go("home");
                } } }));
            })(presets[k]);
        }
        p.appendChild(presetRow);

        p.appendChild(el("div", { class: "wa-section-title", text: "Customise" }));
        p.appendChild(el("div", { class: "wa-cards" }, [
            card("⚙ Battle Setup", "Mode, teams, worms, map, turn time, weapons, presets.", function () { go("setup"); }),
            card("⚡ Connections", "Add OpenAI-compatible endpoints (OpenRouter, Ollama, your own). Keys stay in your browser.", function () { go("connections"); }),
            card("\u{1F41B} Teams & Personas", "Edit team & worm names, personalities, strategies and per-worm models.", function () { go("teams"); })
        ]));
    }

    function card(title, desc, onClick)
    {
        return el("div", { class: "wa-card", on: { click: function () { playClick(); onClick(); } } }, [
            el("span", { class: "wa-card-title", text: title }),
            el("span", { class: "wa-card-desc", text: desc })
        ]);
    }

    // ---- BATTLE SETUP --------------------------------------------------------
    function renderSetup()
    {
        var c = ArenaConfig.current;
        var p = panel("⚙ Battle Setup");

        p.appendChild(el("div", { class: "wa-section-title", text: "Mode" }));
        p.appendChild(segmented(MODES, c.mode, function (id) { c.mode = id; ArenaConfig.applyModeKinds(); ArenaConfig.save(); renderSetupSlots(slotsBox); }));

        p.appendChild(el("div", { class: "wa-section-title", text: "Teams" }));
        var teamsStep = stepper(c.numTeams, 1, 8, function (v) { ArenaConfig.ensureTeams(v); ArenaConfig.save(); renderSetupSlots(slotsBox); });
        p.appendChild(field("Number of teams", teamsStep, "Max 8. Total worms are capped by the map's spawn points."));
        var slotsBox = el("div");
        p.appendChild(slotsBox);
        renderSetupSlots(slotsBox);

        p.appendChild(el("div", { class: "wa-section-title", text: "Worms & timing" }));
        var maxW = ArenaConfig.maxWormsPerTeam(c.map, c.numTeams);
        if (c.wormsPerTeam > maxW) { c.wormsPerTeam = maxW; }
        var wormStep = stepper(c.wormsPerTeam, 1, maxW, function (v) { c.wormsPerTeam = v; ArenaConfig.save(); });
        var hpInput = el("input", { class: "wa-input", attrs: { type: "number", min: "10", max: "300", value: String(c.wormHealth || 80) }, on: { change: function () { c.wormHealth = Number(hpInput.value) || 80; ArenaConfig.save(); } } });
        var turnInput = el("input", { class: "wa-input", attrs: { type: "number", min: "5", max: "600", value: String(c.turnTimeSec || 45) }, on: { change: function () { c.turnTimeSec = Number(turnInput.value) || 45; ArenaConfig.save(); } } });
        p.appendChild(el("div", { class: "wa-row" }, [
            field("Worms per team (max " + maxW + ")", wormStep),
            field("Worm health", hpInput),
            field("Turn time (seconds)", turnInput)
        ]));

        p.appendChild(el("div", { class: "wa-section-title", text: "Map" }));
        p.appendChild(renderMapPicker(c));

        p.appendChild(el("div", { class: "wa-section-title", text: "Agent behaviour" }));
        var langInput = el("input", { class: "wa-input", attrs: { value: c.chatLanguage || "English" }, on: { change: function () { c.chatLanguage = langInput.value || "English"; ArenaConfig.save(); } } });
        var memSel = el("select", { class: "wa-select" });
        ["none", "sliding", "summary", "full"].forEach(function (m) { memSel.appendChild(el("option", { text: m, attrs: { value: m } })); });
        memSel.value = c.memoryStrategy;
        memSel.addEventListener("change", function () { c.memoryStrategy = memSel.value; ArenaConfig.save(); });
        var winInput = el("input", { class: "wa-input", attrs: { type: "number", min: "0", max: "200", value: String(c.memoryWindow) }, on: { change: function () { c.memoryWindow = Number(winInput.value) || 14; ArenaConfig.save(); } } });
        var batchInput = el("input", { class: "wa-input", attrs: { type: "number", min: "1", max: "12", value: String(c.maxBatchesPerTurn) }, on: { change: function () { c.maxBatchesPerTurn = Number(batchInput.value) || 4; ArenaConfig.save(); } } });
        p.appendChild(el("div", { class: "wa-row" }, [
            field("Trash-talk language", langInput),
            field("Memory strategy", memSel),
            field("Memory window", winInput),
            field("Max decisions/turn", batchInput)
        ]));

        var soundChk = el("input", { attrs: { type: "checkbox" } });
        soundChk.checked = !!c.sound;
        soundChk.addEventListener("change", function () { c.sound = soundChk.checked; ArenaConfig.save(); });
        p.appendChild(el("div", { class: "wa-checkline", style: { marginTop: "12px" } }, [soundChk, el("label", { text: "Enable in-game sound effects" })]));

        p.appendChild(el("div", { class: "wa-section-title", text: "Weapons (ammo, 0 = disabled)" }));
        p.appendChild(renderWeapons(c));

        p.appendChild(el("div", { class: "wa-spacer" }));
        p.appendChild(el("div", { class: "wa-inline", style: { marginTop: "14px" } }, [
            el("button", { class: "wbtn wbtn-primary", text: "▶ Play this battle", on: { click: function () { playClick(); play(); } } }),
            el("button", { class: "wbtn wbtn-ghost", text: "Back to menu", on: { click: function () { playClick(); go("home"); } } })
        ]));
    }

    function renderSetupSlots(box)
    {
        clear(box);
        var c = ArenaConfig.current;
        for (var i = 0; i < c.numTeams; i++)
        {
            (function (idx)
            {
                var t = c.teams[idx];
                var seg = segmented(
                    [{ id: "llm", label: "AI (text)" }, { id: "vlm", label: "AI (vision)" }, { id: "human", label: "Human" }],
                    t.kind,
                    function (id) { t.kind = id; ArenaConfig.save(); }
                );
                box.appendChild(el("div", { class: "wa-inline", style: { margin: "6px 0" } }, [
                    el("span", { class: "wa-color-chip", style: { background: t.color } }),
                    el("span", { style: { minWidth: "150px", fontWeight: "bold" }, text: t.name }),
                    seg
                ]));
            })(i);
        }
    }

    function renderMapPicker(c)
    {
        var grid = el("div", { class: "wa-maps" });
        var keys = [];
        try { for (var m in Maps) { if (Maps[m] && Maps[m].terrainImage) { keys.push(m); } } } catch (e) { }
        for (var i = 0; i < keys.length; i++)
        {
            (function (key)
            {
                var def = Maps[key];
                var img = el("img", {});
                try { var asset = AssetManager.getImage(def.smallImage); if (asset) { img.src = asset.src; } } catch (e) { }
                var cardEl = el("div", { class: "wa-map" + (c.map == key ? " wa-on" : "") }, [img, el("div", { class: "wa-map-name", text: def.name })]);
                cardEl.addEventListener("click", function ()
                {
                    playClick();
                    c.map = key;
                    var maxW = ArenaConfig.maxWormsPerTeam(c.map, c.numTeams);
                    if (c.wormsPerTeam > maxW) { c.wormsPerTeam = maxW; }
                    ArenaConfig.save();
                    var all = grid.querySelectorAll(".wa-map");
                    for (var j = 0; j < all.length; j++) { all[j].className = "wa-map"; }
                    cardEl.className = "wa-map wa-on";
                });
                grid.appendChild(cardEl);
            })(keys[i]);
        }
        return grid;
    }

    function defaultWeapons()
    {
        try
        {
            var wm = new WeaponManager();
            var list = wm.getListOfWeapons();
            var out = [];
            for (var i = 0; i < list.length; i++) { out.push({ name: list[i].name, ammo: list[i].ammo }); }
            return out;
        }
        catch (e)
        {
            return [
                { name: "Shotgun", ammo: 99 }, { name: "Grenade", ammo: 20 }, { name: "Holy Grenade", ammo: 2 },
                { name: "Dynamite", ammo: 5 }, { name: "Jetpack", ammo: 5 }, { name: "Minigun", ammo: 4 },
                { name: "Ninja Rope", ammo: 50 }, { name: "Drill", ammo: 3 }, { name: "Bazooka", ammo: 15 }
            ];
        }
    }

    function renderWeapons(c)
    {
        var weapons = defaultWeapons();
        if (!c.weaponAmmo) { c.weaponAmmo = {}; }
        var grid = el("div", { class: "wa-row" });
        for (var i = 0; i < weapons.length; i++)
        {
            (function (wpn)
            {
                var cur = (c.weaponAmmo[wpn.name] != null) ? c.weaponAmmo[wpn.name] : wpn.ammo;
                var input = el("input", { class: "wa-input", attrs: { type: "number", min: "0", max: "99", value: String(cur) }, on: { change: function ()
                {
                    c.weaponAmmo[wpn.name] = Math.max(0, Math.min(99, Number(input.value) || 0));
                    ArenaConfig.save();
                } } });
                grid.appendChild(el("div", { class: "wa-field", style: { minWidth: "120px", maxWidth: "150px" } }, [el("label", { text: wpn.name }), input]));
            })(weapons[i]);
        }
        return grid;
    }

    // ---- CONNECTIONS ---------------------------------------------------------
    function renderConnections()
    {
        var c = ArenaConfig.current;
        var p = panel("⚡ Model Connections");
        p.appendChild(el("div", { class: "wa-help", html: "A connection is any OpenAI-compatible endpoint (Base URL + API key + model). Keys are stored only in this browser (localStorage) and sent to the local server per request. The <b>Demo</b> connection runs a scripted bot with no key." }));

        var list = el("div");
        p.appendChild(list);
        function refresh()
        {
            clear(list);
            for (var i = 0; i < c.connections.length; i++)
            {
                (function (conn)
                {
                    var isDefault = c.globalConnectionId == conn.id;
                    var maskedKey = conn.apiKey ? ("key ••••" + String(conn.apiKey).slice(-4)) : (conn.id == ArenaConfig.MOCK_MODEL ? "no key needed" : "no key");
                    var sub = conn.id == ArenaConfig.MOCK_MODEL ? "Scripted demo bot" : ((conn.baseURL || "(default OpenAI)") + " · " + (conn.model || "auto model") + " · " + maskedKey);
                    var actions = el("div", { class: "wa-inline" }, [
                        isDefault ? el("span", { class: "wa-tag-default", text: "GLOBAL DEFAULT" }) : el("button", { class: "wbtn wbtn-sm wbtn-ghost", text: "Set default", on: { click: function () { c.globalConnectionId = conn.id; ArenaConfig.save(); refresh(); toast(conn.name + " is the global default"); } } }),
                        conn.id == ArenaConfig.MOCK_MODEL ? null : el("button", { class: "wbtn wbtn-sm", text: "Edit", on: { click: function () { openConnForm(conn, refresh); } } }),
                        conn.id == ArenaConfig.MOCK_MODEL ? null : el("button", { class: "wbtn wbtn-sm wbtn-danger", text: "Delete", on: { click: function () { ArenaConfig.removeConnection(conn.id); refresh(); } } })
                    ]);
                    list.appendChild(el("div", { class: "wa-conn" }, [
                        el("div", { class: "wa-conn-main" }, [el("div", { class: "wa-conn-name", text: conn.name }), el("div", { class: "wa-conn-sub", text: sub })]),
                        actions
                    ]));
                })(c.connections[i]);
            }
        }
        refresh();

        p.appendChild(el("div", { class: "wa-spacer" }));
        p.appendChild(el("div", { class: "wa-inline" }, [
            el("button", { class: "wbtn wbtn-accent", text: "+ Add connection", on: { click: function () { playClick(); openConnForm(null, refresh); } } }),
            el("button", { class: "wbtn wbtn-ghost", text: "Back to menu", on: { click: function () { playClick(); go("home"); } } })
        ]));

        var formHost = el("div");
        p.appendChild(formHost);

        function openConnForm(existing, onDone)
        {
            playClick();
            clear(formHost);
            var working = existing ? existing : { name: "", baseURL: "", apiKey: "", model: "" };

            var nameInput = el("input", { class: "wa-input", attrs: { value: working.name || "", placeholder: "e.g. My OpenRouter" } });
            var baseInput = el("input", { class: "wa-input", attrs: { value: working.baseURL || "", placeholder: "https://openrouter.ai/api/v1" } });
            var keyInput = el("input", { class: "wa-input", attrs: { type: "password", value: working.apiKey || "", placeholder: "sk-..." } });
            var modelInput = el("input", { class: "wa-input", attrs: { value: working.model || "", placeholder: "model id (or leave blank to auto-pick)", list: "waModelList" } });
            var modelList = el("datalist", { attrs: { id: "waModelList" } });
            var status = el("span", { class: "wa-hint" });

            var tmplSel = el("select", { class: "wa-select" });
            tmplSel.appendChild(el("option", { text: "Template…", attrs: { value: "" } }));
            ArenaConfig.CONNECTION_TEMPLATES.forEach(function (tpl, idx) { tmplSel.appendChild(el("option", { text: tpl.name, attrs: { value: String(idx) } })); });
            tmplSel.addEventListener("change", function ()
            {
                var tpl = ArenaConfig.CONNECTION_TEMPLATES[Number(tmplSel.value)];
                if (tpl) { if (!nameInput.value) { nameInput.value = tpl.name; } baseInput.value = tpl.baseURL; modelInput.value = tpl.model || ""; }
            });

            var testBtn = el("button", { class: "wbtn wbtn-sm", text: "Test & list models", on: { click: function ()
            {
                playClick();
                status.textContent = "Testing…";
                testConnection(baseInput.value.trim(), keyInput.value.trim(), function (ok, models, errMsg)
                {
                    if (ok)
                    {
                        status.textContent = "✓ Connected – " + models.length + " models";
                        clear(modelList);
                        for (var i = 0; i < models.length; i++) { modelList.appendChild(el("option", { attrs: { value: models[i] } })); }
                        if (!modelInput.value && models.length) { modelInput.value = models[0]; }
                    }
                    else
                    {
                        status.textContent = "✗ " + (errMsg || "Could not connect");
                    }
                });
            } } });

            var form = el("div", { class: "wa-panel wa-narrow", style: { marginTop: "14px", maxWidth: "100%" } }, [
                el("div", { class: "wa-panel-title", text: existing ? "Edit connection" : "New connection" }),
                field("Name", nameInput),
                field("Quick template", tmplSel),
                field("Base URL", baseInput, "OpenAI-compatible /v1 endpoint. Leave blank for api.openai.com."),
                field("API key", keyInput, "Stored only in this browser."),
                el("div", { class: "wa-inline" }, [modelInput, testBtn]),
                status,
                modelList,
                el("div", { class: "wa-spacer" }),
                el("div", { class: "wa-inline" }, [
                    el("button", { class: "wbtn wbtn-primary wbtn-sm", text: "Save", on: { click: function ()
                    {
                        if (!nameInput.value.trim()) { toast("Give the connection a name", true); return; }
                        var patch = { name: nameInput.value.trim(), baseURL: baseInput.value.trim(), apiKey: keyInput.value.trim(), model: modelInput.value.trim() };
                        if (existing) { ArenaConfig.updateConnection(existing.id, patch); }
                        else { ArenaConfig.addConnection(patch); }
                        clear(formHost);
                        onDone();
                        toast("Connection saved");
                    } } }),
                    el("button", { class: "wbtn wbtn-ghost wbtn-sm", text: "Cancel", on: { click: function () { clear(formHost); } } })
                ])
            ]);
            formHost.appendChild(form);
        }
    }

    function testConnection(baseURL, apiKey, cb)
    {
        try
        {
            fetch("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseURL: baseURL, apiKey: apiKey }) })
                .then(function (r) { return r.json(); })
                .then(function (data) { cb(!!data.ok, data.models || [], data.error); })
                .catch(function (err) { cb(false, [], err.message); });
        }
        catch (e) { cb(false, [], e.message); }
    }

    // ---- TEAMS & PERSONAS ----------------------------------------------------
    function renderTeams()
    {
        var c = ArenaConfig.current;
        var p = panel("\u{1F41B} Teams & Personas");
        p.appendChild(el("div", { class: "wa-help", html: "Edit team and worm names, personalities and strategies. Assign a connection at any level – a worm inherits its team's, and a team inherits the global. The badge shows where each worm's model comes from." }));

        for (var i = 0; i < c.numTeams; i++)
        {
            p.appendChild(renderTeamCard(i));
        }

        p.appendChild(el("div", { class: "wa-spacer" }));
        p.appendChild(el("button", { class: "wbtn wbtn-ghost", text: "Back to menu", on: { click: function () { playClick(); go("home"); } } }));
    }

    function renderTeamCard(idx)
    {
        var c = ArenaConfig.current;
        var t = c.teams[idx];
        var wormsBox = el("div", { class: "wa-worms" });

        var nameInput = el("input", { class: "wa-input wa-team-name", attrs: { value: t.name }, on: { change: function () { t.name = nameInput.value; ArenaConfig.save(); } } });
        var colorInput = el("input", { attrs: { type: "color", value: toHexColor(t.color) }, style: { width: "34px", height: "30px", border: "none", background: "none", cursor: "pointer" }, on: { change: function () { t.color = colorInput.value; chip.style.background = t.color; ArenaConfig.save(); } } });
        var chip = el("span", { class: "wa-color-chip", style: { background: t.color } });

        var presetSel = el("select", { class: "wa-select", style: { maxWidth: "180px" } });
        presetSel.appendChild(el("option", { text: "Load ready-made…", attrs: { value: "" } }));
        ArenaConfig.DEFAULT_TEAMS.forEach(function (dt, di) { presetSel.appendChild(el("option", { text: dt.name, attrs: { value: String(di) } })); });
        presetSel.addEventListener("change", function ()
        {
            if (presetSel.value === "") { return; }
            var src = ArenaConfig.DEFAULT_TEAMS[Number(presetSel.value)];
            if (src)
            {
                var fresh = JSON.parse(JSON.stringify(src));
                t.name = fresh.name; t.color = fresh.color;
                t.personality = fresh.worms[0] ? fresh.worms[0].persona.title : t.personality;
                t.worms = [];
                for (var w = 0; w < fresh.worms.length; w++)
                {
                    t.worms.push({ name: fresh.worms[w].name, connectionId: null, persona: fresh.worms[w].persona, systemPrompt: "", strategy: "" });
                }
                ArenaConfig.save();
                go("teams");
            }
        });

        var connSel = connectionOptions(t.connectionId, true);
        connSel.addEventListener("change", function () { t.connectionId = connSel.value || null; ArenaConfig.save(); refreshWorms(); });

        var toggleBtn = el("button", { class: "wbtn wbtn-sm wbtn-ghost", text: "Worms ▾", on: { click: function () { playClick(); wormsBox.className = "wa-worms" + (wormsBox.className.indexOf("wa-open") == -1 ? " wa-open" : ""); } } });

        var head = el("div", { class: "wa-team-head" }, [
            chip, colorInput, nameInput,
            el("div", { class: "wa-field", style: { margin: "0", minWidth: "170px" } }, [el("label", { text: "Team connection" }), connSel]),
            presetSel,
            toggleBtn
        ]);

        function refreshWorms()
        {
            clear(wormsBox);
            var wormsPer = t.worms.length;
            for (var w = 0; w < wormsPer; w++)
            {
                wormsBox.appendChild(renderWormRow(idx, w));
            }
            if (wormsPer == 0) { wormsBox.appendChild(el("div", { class: "wa-hint", text: "This team uses default worms (set worms-per-team in Battle Setup)." })); }
        }
        refreshWorms();

        return el("div", { class: "wa-team" }, [head, wormsBox]);
    }

    function renderWormRow(teamIdx, wormIdx)
    {
        var c = ArenaConfig.current;
        var t = c.teams[teamIdx];
        var wd = t.worms[wormIdx];
        if (!wd.persona) { wd.persona = { title: "", strategy: "", chat: "" }; }

        var eff = ArenaConfig.effectiveConnection(teamIdx, wormIdx);
        var badge = el("span", { class: "wa-badge wa-badge-" + eff.source, text: "model: " + (eff.connection ? eff.connection.name : "none") + " (" + eff.source + ")" });

        var nameInput = el("input", { class: "wa-input", attrs: { value: wd.name || "" }, on: { change: function () { wd.name = nameInput.value; ArenaConfig.save(); } } });
        var titleInput = el("input", { class: "wa-input", attrs: { value: wd.persona.title || "" }, on: { change: function () { wd.persona.title = titleInput.value; ArenaConfig.save(); } } });
        var stratInput = el("input", { class: "wa-input", attrs: { value: wd.persona.strategy || "" }, on: { change: function () { wd.persona.strategy = stratInput.value; ArenaConfig.save(); } } });
        var chatInput = el("input", { class: "wa-input", attrs: { value: wd.persona.chat || "" }, on: { change: function () { wd.persona.chat = chatInput.value; ArenaConfig.save(); } } });
        var sysInput = el("textarea", { class: "wa-textarea", attrs: { placeholder: "Optional extra system instructions for this worm…" }, on: { change: function () { wd.systemPrompt = sysInput.value; ArenaConfig.save(); } } });
        sysInput.value = wd.systemPrompt || "";

        var connSel = connectionOptions(wd.connectionId, true);
        connSel.addEventListener("change", function ()
        {
            wd.connectionId = connSel.value || null;
            ArenaConfig.save();
            var neweff = ArenaConfig.effectiveConnection(teamIdx, wormIdx);
            badge.className = "wa-badge wa-badge-" + neweff.source;
            badge.textContent = "model: " + (neweff.connection ? neweff.connection.name : "none") + " (" + neweff.source + ")";
        });

        return el("div", { class: "wa-worm" }, [
            el("div", { class: "wa-worm-head" }, [el("strong", { text: "Worm " + (wormIdx + 1) }), badge]),
            el("div", { class: "wa-row" }, [field("Name", nameInput), field("Personality", titleInput)]),
            el("div", { class: "wa-row" }, [field("Strategy / tactic", stratInput), field("Chat style", chatInput)]),
            el("div", { class: "wa-row" }, [
                el("div", { class: "wa-field", style: { minWidth: "180px", maxWidth: "220px" } }, [el("label", { text: "Worm connection" }), connSel]),
                field("Custom system prompt (optional)", sysInput)
            ])
        ]);
    }

    function toHexColor(c)
    {
        if (typeof c == "string" && c.charAt(0) == "#" && (c.length == 7)) { return c; }
        return "#1e88e5";
    }

    // ---- launch --------------------------------------------------------------
    function startLocalGame()
    {
        Settings.ARENA_TEAM_TYPES = ["human", "human"];
        Settings.ARENA_TEAM_MODELS = [];
        Settings.ARENA_AUTO_START = false;
        Settings.SOUND = !!ArenaConfig.current.sound;
        ArenaConfig.runtime = null;
        if (typeof ArenaControllerInstance != "undefined") { ArenaControllerInstance.enabled = false; }
        try { MenuAudio.stop(); } catch (e) { }
        hide();
        if (startCallback) { startCallback(); }
    }

    function startTutorial()
    {
        Settings.ARENA_TEAM_TYPES = [];
        Settings.ARENA_AUTO_START = false;
        ArenaConfig.runtime = null;
        if (typeof ArenaControllerInstance != "undefined") { ArenaControllerInstance.enabled = false; }
        try { if (typeof Tutorial != "undefined") { GameInstance.tutorial = new Tutorial(); } } catch (e) { }
        try { MenuAudio.stop(); } catch (e) { }
        hide();
        if (startCallback) { startCallback(); }
    }

    export function play()
    {
        ArenaConfig.applyToSettings();
        if (typeof ArenaControllerInstance != "undefined") { ArenaControllerInstance.enabled = true; }
        try { MenuAudio.stop(); } catch (e) { }
        hide();
        if (startCallback) { startCallback(); }
        try { ArenaConfig.applyWeaponAmmo(); } catch (e) { }
    }
}
