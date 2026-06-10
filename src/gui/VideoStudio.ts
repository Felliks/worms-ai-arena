/**
 * VideoStudio.ts
 *
 * The single entry point for making a shareable video. Opened from the one
 * in-game clip button (which pulses on clip-worthy moments). Opening PAUSES the
 * match (and the recorder) and shows a themed panel where the user picks:
 *   - a target PLATFORM (TikTok / Instagram / Shorts / YouTube / Facebook) — the
 *     clip format (aspect + MP4) adapts to it;
 *   - a SCENARIO template built from this match's log (last 30s, whole match
 *     sped up, highlights, friendly fire, beef, epic hits, multi-kills, comeback);
 *   - or Custom Download (the raw 16:9 master).
 *
 * Generate re-renders the master locally into the chosen platform format + the
 * scenario's edit list (dead air between moments is cut, impacts slow-mo'd) and
 * shares/downloads the MP4. Closing resumes the match.
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts"/>
///<reference path="../audio/Sound.ts"/>
///<reference path="../video/MatchRecorder.ts"/>
///<reference path="../video/MatchTimeline.ts"/>
///<reference path="ArenaConfig.ts"/>
///<reference path="MainMenu.ts"/>

module VideoStudio
{
    var rootEl: any = null;
    var paused = false;
    var busy = false;
    var selectedPlatform = "";
    var selectedScenarioId = "";
    var platformRow: any = null;
    var scenarioList: any = null;
    var statusEl: any = null;
    var genBtn: any = null;
    var aiChk: any = null;
    var previewEl: any = null;
    var previewUrl: any = null;

    // First user connection with a real Base URL (not the no-key demo). Used to let
    // the optional AI editor run on the user's own key; null -> deterministic edit.
    function activeConnection()
    {
        try
        {
            if (typeof ArenaConfig == "undefined" || !ArenaConfig.current) { return null; }
            var conns = ArenaConfig.current.connections || [];
            for (var i = 0; i < conns.length; i++)
            {
                var c = conns[i];
                if (c && c.baseURL && String(c.baseURL).trim()) { return c; }
            }
        }
        catch (e) { }
        return null;
    }

    function el(tag, opts, kids)
    {
        var node = document.createElement(tag);
        if (opts)
        {
            if (opts.id) { node.id = opts.id; }
            if (opts["class"]) { node.className = opts["class"]; }
            if (opts.html != null) { node.innerHTML = opts.html; }
            if (opts.text != null) { node.textContent = opts.text; }
            if (opts.title) { node.title = opts.title; }
            if (opts.on) { for (var ev in opts.on) { node.addEventListener(ev, opts.on[ev]); } }
        }
        if (kids) { for (var i = 0; i < kids.length; i++) { if (kids[i]) { node.appendChild(kids[i]); } } }
        return node;
    }
    function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }
    function revokePreviewUrl()
    {
        if (!previewUrl) { return; }
        try { URL.revokeObjectURL(previewUrl); } catch (e) { }
        previewUrl = null;
    }

    export function isPaused() { return paused; }
    export function isOpen() { return !!rootEl; }

    export function open()
    {
        if (rootEl || typeof MatchRecorder == "undefined") { return; }
        paused = true;
        try { MatchRecorder.pauseCapture(); } catch (e) { }
        try { if (typeof ArenaMusic != "undefined" && ArenaMusic.setPreviewDucked) { ArenaMusic.setPreviewDucked(true); } } catch (e) { }
        try { if (typeof Sound != "undefined" && Sound.setSfxDucked) { Sound.setSfxDucked(true); } } catch (e) { }
        selectedPlatform = MatchRecorder.getPlatform ? MatchRecorder.getPlatform() : "tiktok";

        var title = el("div", { "class": "wa-panel-title", text: "Make a clip" });
        var sub = el("div", { "class": "wa-help", text: "Pick where you'll post it and what to show. The format adapts automatically." });

        platformRow = el("div", { "class": "wa-vs-platforms" });
        scenarioList = el("div", { "class": "wa-vs-scenarios" });
        statusEl = el("div", { "class": "wa-vs-status", text: "" });
        previewEl = el("div", { "class": "wa-vs-preview" });
        previewEl.style.display = "none";

        genBtn = el("button", { "class": "wbtn wbtn-primary wbtn-xl", html: "&#127916; Generate &amp; Share", on: { click: function () { generate(); } } });
        var customBtn = el("button", { "class": "wbtn wbtn-ghost", html: "&#11015; Custom download (raw 16:9)", on: { click: function () { customDownload(); } } });
        var closeBtn = el("button", { "class": "wbtn wbtn-ghost", text: "✕ Close", on: { click: function () { close(); } } });

        var actions = el("div", { "class": "wa-vs-actions" }, [genBtn, customBtn, closeBtn]);

        var conn = activeConnection();
        aiChk = document.createElement("input");
        aiChk.type = "checkbox";
        aiChk.checked = !!conn;
        if (!conn) { aiChk.disabled = true; }
        var aiText = document.createElement("span");
        aiText.textContent = conn ? "✨ AI editor — pick the best moments + a title (uses your key)" : "✨ AI editor — add a connection to enable";
        var aiRow = el("label", { "class": "wa-vs-ai" });
        aiRow.appendChild(aiChk);
        aiRow.appendChild(aiText);

        var panel = el("div", { "class": "wa-panel wa-narrow wa-vs-panel" }, [title, sub, platformRow, scenarioList, aiRow, statusEl, previewEl, actions]);
        rootEl = el("div", { id: "waVideoStudio", "class": "wa-vs-backdrop" }, [panel]);
        document.body.appendChild(rootEl);

        renderPlatforms();
        renderScenarios();
    }

    export function close()
    {
        revokePreviewUrl();
        if (rootEl && rootEl.parentNode) { rootEl.parentNode.removeChild(rootEl); }
        rootEl = null;
        platformRow = null;
        scenarioList = null;
        statusEl = null;
        genBtn = null;
        aiChk = null;
        previewEl = null;
        busy = false;
        paused = false;
        try { if (typeof ArenaMusic != "undefined" && ArenaMusic.setPreviewDucked) { ArenaMusic.setPreviewDucked(false); } } catch (e) { }
        try { if (typeof Sound != "undefined" && Sound.setSfxDucked) { Sound.setSfxDucked(false); } } catch (e) { }
        try { MatchRecorder.resumeCapture(); } catch (e) { }
    }

    function renderPlatforms()
    {
        clear(platformRow);
        var ids = MatchRecorder.listPlatforms ? MatchRecorder.listPlatforms() : ["tiktok"];
        for (var i = 0; i < ids.length; i++)
        {
            (function (pid)
            {
                var info = MatchRecorder.getPlatformInfo(pid);
                var on = pid == selectedPlatform;
                // A format icon (vertical/landscape) makes the aspect readable at a glance.
                var aspectIcon = info.aspect == "9:16" ? "📱" : (info.aspect == "1:1" ? "⬛" : "🖥️");
                var b = el("button", {
                    "class": "wbtn wbtn-sm wa-vs-plat" + (on ? " wa-vs-on" : ""),
                    text: aspectIcon + " " + info.label + " · " + info.aspect,
                    on: { click: function () { selectedPlatform = pid; renderPlatforms(); } }
                });
                platformRow.appendChild(b);
            })(ids[i]);
        }
    }

    function renderScenarios()
    {
        clear(scenarioList);
        var scns = (typeof MatchTimeline != "undefined" && MatchTimeline.getScenarios) ? MatchTimeline.getScenarios() : [];
        if (!selectedScenarioId && scns.length) { selectedScenarioId = scns[0].id; }
        for (var i = 0; i < scns.length; i++)
        {
            (function (s)
            {
                var on = s.id == selectedScenarioId;
                var card = el("button", {
                    "class": "wa-vs-card" + (on ? " wa-vs-on" : ""),
                    on: { click: function () { selectedScenarioId = s.id; renderScenarios(); } }
                }, [
                    el("span", { "class": "wa-vs-ico", text: s.icon || "🎞️" }),
                    el("span", { "class": "wa-vs-meta" }, [
                        el("span", { "class": "wa-vs-title", text: s.title }),
                        el("span", { "class": "wa-vs-sub", text: s.subtitle || "" })
                    ])
                ]);
                scenarioList.appendChild(card);
            })(scns[i]);
        }
        if (!scns.length)
        {
            scenarioList.appendChild(el("div", { "class": "wa-help", text: "No moments captured yet — play a bit, then come back." }));
        }
    }

    function selectedScenario()
    {
        var scns = MatchTimeline.getScenarios();
        for (var i = 0; i < scns.length; i++) { if (scns[i].id == selectedScenarioId) { return scns[i]; } }
        return scns.length ? scns[0] : null;
    }

    function setStatus(text, isErr)
    {
        if (statusEl) { statusEl.textContent = text || ""; statusEl.className = "wa-vs-status" + (isErr ? " wa-vs-err" : ""); }
    }

    function generate()
    {
        if (busy) { return; }
        var scn = selectedScenario();
        if (!scn) { setStatus("Pick a scenario first.", true); return; }
        busy = true;
        if (genBtn) { genBtn.disabled = true; }
        try { MatchRecorder.setPlatform(selectedPlatform); } catch (e) { }

        if (aiChk && aiChk.checked) { refineThenRender(scn); }
        else { setStatus("Rendering… 0%"); doRender(scn.id, scn.segments, null); }
    }

    // Optional BYOK pass: let the user's model pick + order the best moments and
    // write a title; on any failure / no key, fall back to the deterministic edit.
    function refineThenRender(scn)
    {
        var moments = (typeof MatchTimeline != "undefined") ? MatchTimeline.getMoments() : [];
        if (!moments.length) { setStatus("Rendering… 0%"); doRender(scn.id, scn.segments, null); return; }
        setStatus("AI editor is choosing the best moments…");

        var body: any = {
            scenarioId: scn.id,
            platform: selectedPlatform,
            maxClips: 8,
            moments: moments.map(function (m) { return { id: m.id, type: m.type, t0: m.t0, t1: m.t1, score: m.score, title: m.title, subtitle: m.subtitle }; })
        };
        var conn = activeConnection();
        if (conn) { body.baseURL = conn.baseURL; body.apiKey = conn.apiKey; body.model = conn.model; }

        var fellBack = false;
        var fallback = function () { if (!fellBack) { fellBack = true; setStatus("Rendering… 0%"); doRender(scn.id, scn.segments, null); } };

        fetch("/api/montage/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(function (data)
            {
                if (!data || !data.refined || !data.order || !data.order.length) { fallback(); return; }
                var byId: any = {};
                for (var i = 0; i < moments.length; i++) { byId[moments[i].id] = moments[i]; }
                var slow: any = {};
                (data.slowmo || []).forEach(function (id) { slow[id] = true; });
                var segs: any[] = [];
                for (var j = 0; j < data.order.length; j++)
                {
                    var m = byId[data.order[j]];
                    if (m && typeof MatchTimeline != "undefined" && MatchTimeline.segmentsForMoment)
                    {
                        segs = segs.concat(MatchTimeline.segmentsForMoment(m, slow[m.id] ? 0.6 : 1));
                    }
                }
                if (!segs.length) { fallback(); return; }
                fellBack = true;
                setStatus("Rendering AI cut… 0%");
                doRender(scn.id, segs, data.title || null);
            })
            ["catch"](function () { fallback(); });
    }

    function doRender(scenarioId, segments, aiTitle)
    {
        MatchRecorder.render(
            { platform: selectedPlatform, segments: segments },
            function (blob)
            {
                busy = false;
                if (genBtn) { genBtn.disabled = false; }
                if (!blob) { setStatus("Could not render this clip. Try another scenario.", true); return; }
                var ext = MatchRecorder.fileExt ? MatchRecorder.fileExt() : "mp4";
                var name = "llm-worms-arena-" + selectedPlatform + "-" + scenarioId + "." + ext;
                showPreview(blob, name, aiTitle);
                setStatus("Done ✓ — " + (Math.round(blob.size / 1048576 * 10) / 10) + " MB" + (aiTitle ? (" · “" + aiTitle + "”") : "") + " · preview below, then Download / Share.");
            },
            function (p) { setStatus((aiTitle ? "Rendering AI cut… " : "Rendering… ") + Math.round((p || 0) * 100) + "%"); }
        );
    }

    // Show the rendered clip in-panel with a real player, then Download / Share - no
    // forced download. Autoplay (with sound; allowed after the user's click to open).
    function showPreview(blob, name, aiTitle)
    {
        if (!previewEl) { return; }
        revokePreviewUrl();
        clear(previewEl);
        try
        {
            previewUrl = URL.createObjectURL(blob);
            var v = document.createElement("video");
            v.src = previewUrl;
            v.controls = true;
            v.autoplay = true;
            v.loop = true;
            (v as any).playsInline = true;
            v.className = "wa-vs-preview-video";
            try { v.play(); } catch (e) { }
            var dl = el("button", { "class": "wbtn wbtn-primary", html: "&#11015; Download", on: { click: function () { MatchRecorder.download(blob, name); } } }, false);
            var sh = el("button", { "class": "wbtn wbtn-accent", html: "&#128228; Share", on: { click: function () { MatchRecorder.share(blob, name, aiTitle || "LLM Worms Arena"); } } }, false);
            var row = el("div", { "class": "wa-vs-actions" }, [dl, sh]);
            previewEl.appendChild(v);
            previewEl.appendChild(row);
            previewEl.style.display = "block";
        }
        catch (e) { }
    }

    function customDownload()
    {
        if (busy) { return; }
        MatchRecorder.fullClip(function (blob)
        {
            if (!blob) { setStatus("No footage to export yet.", true); return; }
            var ext = MatchRecorder.fileExt ? MatchRecorder.fileExt() : "mp4";
            MatchRecorder.download(blob, "llm-worms-arena-master." + ext);
            setStatus("Downloaded the raw 16:9 master ✓");
        });
    }
}
