/**
 * PauseMenu.ts
 *
 * In-game pause: a ⏸ button (always visible while a match runs) and the Esc key
 * open a menu that pauses the match (gates the gameloop) so the player can stop,
 * tweak settings, or switch the trash-talk language - while the UI itself stays
 * English. Icon-forward so it reads without English.
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts"/>
///<reference path="../audio/ArenaMusic.ts"/>
///<reference path="MainMenu.ts"/>

module PauseMenu
{
    var paused = false;
    var rootEl: any = null;
    var btn: any = null;
    var built = false;
    var bound = false;

    // Trash-talk languages: flag icon + the name the agent prompt expects. The UI
    // stays English; only the worms' spoken lines change to the chosen language.
    var LANGS = [
        { name: "English", flag: "🇬🇧" }, { name: "Russian", flag: "🇷🇺" },
        { name: "Ukrainian", flag: "🇺🇦" }, { name: "Spanish", flag: "🇪🇸" },
        { name: "French", flag: "🇫🇷" }, { name: "German", flag: "🇩🇪" },
        { name: "Italian", flag: "🇮🇹" }, { name: "Portuguese", flag: "🇵🇹" },
        { name: "Polish", flag: "🇵🇱" }, { name: "Turkish", flag: "🇹🇷" },
        { name: "Chinese", flag: "🇨🇳" }, { name: "Japanese", flag: "🇯🇵" },
        { name: "Korean", flag: "🇰🇷" }, { name: "Hindi", flag: "🇮🇳" },
        { name: "Arabic", flag: "🇸🇦" }
    ];
    var LANG_KEY = "wormsChatLang";

    function el(tag, opts)
    {
        var n = document.createElement(tag);
        if (opts)
        {
            if (opts.id) { n.id = opts.id; }
            if (opts["class"]) { n.className = opts["class"]; }
            if (opts.html != null) { n.innerHTML = opts.html; }
            if (opts.text != null) { n.textContent = opts.text; }
            if (opts.title) { n.title = opts.title; }
            if (opts.on) { for (var ev in opts.on) { n.addEventListener(ev, opts.on[ev]); } }
        }
        return n;
    }
    function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }

    export function isPaused() { return paused; }
    export function isOpen() { return !!rootEl; }

    function gameRunning()
    {
        return typeof GameInstance != "undefined" && GameInstance.state && GameInstance.state.isStarted && !GameInstance.winner;
    }

    // Mounted once; called every frame from the gameloop to keep the ⏸ button's
    // visibility in sync and to lazily bind Esc.
    export function tick()
    {
        if (!built) { build(); }
        if (btn) { btn.style.display = (gameRunning() || paused) ? "flex" : "none"; }
    }

    function build()
    {
        if (built || typeof document == "undefined") { return; }
        built = true;
        btn = el("button", {
            id: "waPauseButton",
            "class": "wbtn wbtn-ghost",
            html: "&#9208;",            // ⏸
            title: "Pause (Esc)",
            on: { click: function () { open(); } }
        });
        btn.style.display = "none";
        document.body.appendChild(btn);
        bindKeys();
    }

    function bindKeys()
    {
        if (bound || typeof document == "undefined") { return; }
        bound = true;
        document.addEventListener("keydown", function (e)
        {
            var k = e.key || "";
            if (k != "Escape" && e.keyCode != 27) { return; }
            // Esc closes the studio first, else toggles pause while a match runs.
            if (typeof VideoStudio != "undefined" && VideoStudio.isOpen && VideoStudio.isOpen())
            {
                try { VideoStudio.close(); } catch (err) { }
                e.preventDefault();
                return;
            }
            if (rootEl) { close(); e.preventDefault(); return; }
            if (gameRunning()) { open(); e.preventDefault(); }
        });
    }

    export function open()
    {
        if (rootEl) { return; }
        paused = true;

        var title = el("div", { "class": "wa-panel-title", html: "&#9208; Paused" });

        var resumeBtn = el("button", { "class": "wbtn wbtn-primary wbtn-xl", html: "&#9654; Resume", title: "Resume (Esc)", on: { click: function () { close(); } } });

        var langTitle = el("div", { "class": "wa-section-title", html: "🌐 Trash-talk language" });
        var langHint = el("div", { "class": "wa-help", text: "The interface stays English; the worms talk in this language." });
        var langGrid = el("div", { "class": "wa-pm-langs" });
        renderLangs(langGrid);

        var toggles = el("div", { "class": "wa-pm-toggles" }, false);
        var musicBtn = el("button", { "class": "wbtn wbtn-sm", on: { click: function () { try { ArenaMusic.toggleMute(); } catch (e) { } refreshToggles(musicBtn, soundBtn); } } });
        var soundBtn = el("button", { "class": "wbtn wbtn-sm", on: { click: function () { try { Settings.SOUND = !Settings.SOUND; } catch (e) { } refreshToggles(musicBtn, soundBtn); } } });
        toggles.appendChild(musicBtn);
        toggles.appendChild(soundBtn);
        refreshToggles(musicBtn, soundBtn);

        var homeBtn = el("button", { "class": "wbtn wbtn-ghost", html: "🏠 Main menu", title: "Leave the match", on: { click: function () { leaveToMenu(); } } });
        var actions = el("div", { "class": "wa-vs-actions" }, false);
        actions.appendChild(resumeBtn);
        actions.appendChild(homeBtn);

        var panel = el("div", { "class": "wa-panel wa-narrow" }, false);
        panel.appendChild(title);
        panel.appendChild(langTitle);
        panel.appendChild(langHint);
        panel.appendChild(langGrid);
        panel.appendChild(toggles);
        panel.appendChild(actions);

        rootEl = el("div", { id: "waPauseMenu", "class": "wa-vs-backdrop" });
        rootEl.appendChild(panel);
        document.body.appendChild(rootEl);
    }

    export function close()
    {
        if (rootEl && rootEl.parentNode) { rootEl.parentNode.removeChild(rootEl); }
        rootEl = null;
        paused = false;
    }

    function currentLang()
    {
        try { return Settings.ARENA_CHAT_LANGUAGE || "English"; } catch (e) { return "English"; }
    }

    function renderLangs(grid)
    {
        clear(grid);
        var cur = currentLang();
        for (var i = 0; i < LANGS.length; i++)
        {
            (function (lang)
            {
                var on = String(cur).toLowerCase().indexOf(lang.name.toLowerCase()) >= 0;
                var b = el("button", {
                    "class": "wa-pm-lang" + (on ? " wa-vs-on" : ""),
                    html: "<span class='wa-pm-flag'>" + lang.flag + "</span><span>" + lang.name + "</span>",
                    title: lang.name,
                    on: { click: function () { setLanguage(lang.name); renderLangs(grid); } }
                });
                grid.appendChild(b);
            })(LANGS[i]);
        }
    }

    // Switch the trash-talk language live: Settings + every team config used by the
    // controller for upcoming turns + a persisted preference. Does not touch agent
    // decision logic - only the requested chat language string.
    function setLanguage(name)
    {
        try { Settings.ARENA_CHAT_LANGUAGE = name; } catch (e) { }
        try
        {
            if (typeof ArenaControllerInstance != "undefined" && ArenaControllerInstance.teamConfigs)
            {
                var cfgs = ArenaControllerInstance.teamConfigs;
                for (var i = 0; i < cfgs.length; i++) { if (cfgs[i]) { cfgs[i].chatLanguage = name; } }
            }
        }
        catch (e) { }
        try { window.localStorage.setItem(LANG_KEY, name); } catch (e) { }
        try { if (typeof MainMenu != "undefined" && MainMenu.toast) { MainMenu.toast("🌐 Trash-talk: " + name); } } catch (e) { }
    }

    function refreshToggles(musicBtn, soundBtn)
    {
        try
        {
            var muted = (typeof ArenaMusic != "undefined" && ArenaMusic.isMuted) ? ArenaMusic.isMuted() : false;
            musicBtn.innerHTML = muted ? "🔇 Music off" : "🎵 Music on";
        }
        catch (e) { }
        try
        {
            var on = (typeof Settings != "undefined") ? !!Settings.SOUND : false;
            soundBtn.innerHTML = on ? "🔊 Sound on" : "🔈 Sound off";
        }
        catch (e) { }
    }

    function leaveToMenu()
    {
        // Clean reset to the menu (drops ?arena=). Confirm-free; it's a pause action.
        try { window.location.href = window.location.origin + window.location.pathname; }
        catch (e) { try { window.location.reload(); } catch (e2) { } }
    }
}
