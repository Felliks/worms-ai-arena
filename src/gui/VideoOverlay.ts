/**
 * VideoOverlay.ts
 *
 * ONE in-game button. It sits quietly bottom-right and natively pulses (plus a
 * count badge) when a clip-worthy moment is detected — that pulse IS the
 * unobtrusive reminder (no toast spam, no pause, no screen cover). Clicking it
 * opens the VideoStudio (which pauses the match and offers platform + scenarios).
 *
 *  License: Apache 2.0
 */
///<reference path="../Settings.ts"/>
///<reference path="../video/MatchRecorder.ts"/>
///<reference path="VideoStudio.ts"/>
///<reference path="MainMenu.ts"/>

module VideoOverlay
{
    var rootEl: any = null;
    var btn: any = null;
    var badge: any = null;
    var hintEl: any = null;
    var built = false;
    var momentCount = 0;
    var hintTimer: any = null;

    function el(tag, opts)
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
        return node;
    }

    export function init()
    {
        if (built || typeof document == "undefined") { return; }
        built = true;

        rootEl = el("div", { id: "waVideoOverlay" });
        rootEl.style.display = "none";

        hintEl = el("div", { id: "waMomentHint", "class": "wa-vid-hint" });
        hintEl.style.display = "none";

        // Icon-only (clapperboard) so it reads without English; tooltip explains.
        btn = el("button", {
            id: "waClipButton",
            "class": "wbtn wbtn-accent",
            html: "&#127916;",
            title: "Make a shareable video of this match",
            on: { click: function () { onOpen(); } }
        });

        badge = el("span", { id: "waClipBadge", "class": "wa-vid-badge" });
        badge.style.display = "none";
        btn.appendChild(badge);

        rootEl.appendChild(hintEl);
        rootEl.appendChild(btn);
        document.body.appendChild(rootEl);
    }

    export function setVisible(v)
    {
        init();
        if (rootEl) { rootEl.style.display = v ? "flex" : "none"; }
    }

    // Kept for API compatibility with VideoCapture; the single button is always the
    // entry point, so there is nothing extra to enable at match end.
    export function setCreateEnabled(v) { }

    // Native attention nudge: pulse the button + bump the count badge + a brief
    // one-line hint. No blocking, no pause, no spam (caller applies the cooldown).
    export function flashMoment(title)
    {
        init();
        momentCount++;
        if (badge)
        {
            badge.textContent = String(momentCount);
            badge.style.display = "block";
        }
        if (btn)
        {
            btn.classList.remove("wa-vid-pulse");
            void btn.offsetWidth; // restart the animation
            btn.classList.add("wa-vid-pulse");
        }
        if (hintEl)
        {
            hintEl.textContent = title || "Clip-worthy moment";
            hintEl.style.display = "block";
            if (hintTimer) { clearTimeout(hintTimer); }
            hintTimer = setTimeout(function () { if (hintEl) { hintEl.style.display = "none"; } }, 2800);
        }
    }

    function onOpen()
    {
        // Opening the studio clears the "new moments" badge.
        momentCount = 0;
        if (badge) { badge.style.display = "none"; }
        if (btn) { btn.classList.remove("wa-vid-pulse"); }
        if (typeof VideoStudio != "undefined" && VideoStudio.open)
        {
            try { VideoStudio.open(); return; } catch (e) { }
        }
        // Fallback if the studio module is missing: download the master.
        try
        {
            if (typeof MatchRecorder != "undefined")
            {
                MatchRecorder.fullClip(function (blob)
                {
                    if (blob) { MatchRecorder.download(blob, "llm-worms-arena-master." + (MatchRecorder.fileExt ? MatchRecorder.fileExt() : "mp4")); }
                });
            }
        }
        catch (e) { }
    }
}
