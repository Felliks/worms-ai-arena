/**
 * MatchRecorder.ts
 *
 * Records the live match to a webm with game audio (via RecordingAudioBus) and a
 * baked-in watermark. We capture from an OFF-SCREEN compose canvas, not the live
 * #action canvas directly, because:
 *   - #action is resized to the window (a moving source resolution);
 *   - the watermark / letterbox must live in the captured pixels (DOM overlays
 *     are NOT captured by captureStream).
 *
 * Each frame the gameloop calls composeFrame(): it fits #action into a fixed
 * 1280x720 (16:9) canvas with letterbox bars and draws the watermark. The
 * MediaRecorder runs with a 1s timeslice; we keep a ~30s ring (for the instant
 * quick clip) plus a budget-capped full-match buffer (for the on-demand montage).
 *
 * The webm ring trick: the FIRST chunk carries the container header, so a tail
 * slice is only playable when that init chunk is prepended.
 *
 *  License: Apache 2.0
 */
///<reference path="../Game.ts"/>
///<reference path="RecordingAudioBus.ts"/>
///<reference path="MatchTimeline.ts"/>

module MatchRecorder
{
    // The user picks a TARGET PLATFORM and the clip format adapts to it (aspect +
    // resolution + a universally-shareable MP4 container). The clip is composed
    // straight into that shape so it is ready to post with no extra crop/convert.
    // Named target platforms; the clip aspect/resolution adapts to each. Vertical
    // 9:16 for TikTok / Instagram Reels / Shorts; landscape 16:9 for YouTube /
    // Reddit / Facebook. All export as shareable MP4.
    var PLATFORMS: any = {
        "tiktok": { label: "TikTok", short: "TikTok", w: 720, h: 1280, aspect: "9:16" },
        "instagram": { label: "Instagram Reels", short: "Reels", w: 720, h: 1280, aspect: "9:16" },
        "shorts": { label: "YouTube Shorts", short: "Shorts", w: 720, h: 1280, aspect: "9:16" },
        "youtube": { label: "YouTube", short: "YouTube", w: 1280, h: 720, aspect: "16:9" },
        "reddit": { label: "Reddit", short: "Reddit", w: 1280, h: 720, aspect: "16:9" },
        "facebook": { label: "Facebook", short: "FB", w: 1280, h: 720, aspect: "16:9" }
    };
    var PLATFORM_ORDER = ["tiktok", "instagram", "shorts", "youtube", "reddit", "facebook"];
    var PLATFORM_KEY = "wormsClipPlatform";
    var currentPlatform = readPlatform();

    // The recorder always captures a 16:9 MASTER (maximum horizontal info). The
    // chosen platform aspect is applied at EXPORT by render(), re-letterboxing the
    // master (e.g. the 16:9 game centered in a 9:16 frame for TikTok/Reels/Shorts).
    export var W = 1280;   // master width (16:9)
    export var H = 720;    // master height

    var composeCanvas: any = null;
    var cctx: any = null;

    function readPlatform()
    {
        try { var p = window.localStorage.getItem(PLATFORM_KEY); if (p && PLATFORMS[p]) { return p; } } catch (e) { }
        return "tiktok"; // vertical short-form is the most viral default
    }
    function writePlatform(p) { try { window.localStorage.setItem(PLATFORM_KEY, p); } catch (e) { } }

    export function getPlatform() { return currentPlatform; }
    export function getPlatformInfo(p) { return PLATFORMS[p || currentPlatform]; }
    export function listPlatforms() { return PLATFORM_ORDER.slice(); }
    export function nextPlatform()
    {
        var i = PLATFORM_ORDER.indexOf(currentPlatform);
        setPlatform(PLATFORM_ORDER[(i + 1) % PLATFORM_ORDER.length]);
        return currentPlatform;
    }

    // Platform is an EXPORT target; it never disturbs the live 16:9 master capture.
    // render() re-letterboxes the master into the platform's aspect on demand.
    export function setPlatform(p)
    {
        if (!PLATFORMS[p]) { return; }
        currentPlatform = p;
        writePlatform(p);
    }

    var recorder: any = null;
    var recordVideoTrack: any = null; // live canvas capture track; shared audio track is owned by RecordingAudioBus
    var recording = false;
    var mimeType = "";

    var initChunk: any = null;     // first dataavailable (container header)
    var ring: any[] = [];          // {blob, t, size} rolling ~30s window
    var fullChunks: any[] = [];    // whole match (budget-capped)
    var fullBytes = 0;

    var RING_MS = 32000;
    var FULL_BUDGET_BYTES = 240 * 1024 * 1024;   // ~240 MB cap for a long match
    var fullCapped = false;

    var WATERMARK = "LLM WORMS ARENA";

    function clock()
    {
        return (typeof performance != "undefined" && performance.now) ? performance.now() : Date.now();
    }

    function ensureCanvas()
    {
        if (composeCanvas) { return; }
        composeCanvas = document.createElement("canvas");
        composeCanvas.width = W;
        composeCanvas.height = H;
        composeCanvas.id = "waComposeCanvas";
        cctx = composeCanvas.getContext("2d");
    }

    export function getComposeCanvas() { ensureCanvas(); return composeCanvas; }

    // Fit the live game canvas into the compose canvas (letterboxed) + watermark.
    // Safe to call when not recording (no-op without a context).
    export function composeFrame()
    {
        if (!cctx) { return; }
        cctx.fillStyle = "#05070d";
        cctx.fillRect(0, 0, W, H);

        var dy = 0;
        var src = (typeof GameInstance != "undefined") ? GameInstance.actionCanvas : null;
        if (src && src.width > 0 && src.height > 0)
        {
            var s = Math.min(W / src.width, H / src.height);
            var dw = Math.max(1, Math.round(src.width * s));
            var dh = Math.max(1, Math.round(src.height * s));
            var dx = Math.round((W - dw) / 2);
            dy = Math.round((H - dh) / 2);
            try { cctx.drawImage(src, 0, 0, src.width, src.height, dx, dy, dw, dh); } catch (e) { }
        }
        // The master is otherwise CLEAN (overlays are added at render time so they sit
        // correctly in the target aspect); only a subtle watermark is baked here so even
        // a raw quick-share clip carries it.
        drawWatermark(cctx, W, H);
    }

    // The letterbox bars of vertical/square formats become branding space: an
    // "OpenAI vs Claude" matchup banner up top makes the clip read as intentional.
    function drawSocialChrome(ctx, w, h, topBar)
    {
        if (topBar >= 52)
        {
            var mt = matchupText();
            if (mt)
            {
                try
                {
                    ctx.save();
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    var fs = Math.max(18, Math.round(w * 0.042));
                    ctx.font = "bold " + fs + "px 'Arial Black', Arial, sans-serif";
                    ctx.lineWidth = Math.max(3, Math.round(fs / 5));
                    ctx.strokeStyle = "rgba(0,0,0,0.82)";
                    ctx.fillStyle = "rgba(255,200,67,0.96)";
                    var ty = Math.min(Math.round(topBar / 2), 46);
                    ctx.strokeText(mt, w / 2, ty);
                    ctx.fillText(mt, w / 2, ty);
                    ctx.restore();
                }
                catch (e) { }
            }
        }
        drawWatermark(ctx, w, h);
    }

    function matchupText()
    {
        try
        {
            if (typeof GameInstance == "undefined" || !GameInstance.players) { return ""; }
            var names = [];
            for (var i = 0; i < GameInstance.players.length; i++)
            {
                var nm = GameInstance.players[i].getTeam().name || ("Team " + i);
                nm = String(nm).replace(/\s*\[.*?\]\s*/g, "").trim(); // drop "[model]" suffix
                if (nm) { names.push(nm); }
            }
            return names.length >= 2 ? names.join("  vs  ") : "";
        }
        catch (e) { return ""; }
    }

    // Subtle, unobtrusive watermark (small, low-opacity, bottom-centre so it survives
    // the vertical/square cover-crop at render time).
    export function drawWatermark(ctx, w, h)
    {
        try
        {
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.globalAlpha = 0.42;
            var size = Math.max(10, Math.round(h * 0.020));
            ctx.font = "600 " + size + "px 'Trebuchet MS', Arial, sans-serif";
            var x = Math.round(w / 2);
            var y = h - Math.round(h * 0.016);
            ctx.lineWidth = Math.max(2, Math.round(size / 8));
            ctx.strokeStyle = "rgba(0,0,0,0.45)";
            ctx.strokeText(WATERMARK, x, y);
            ctx.fillStyle = "rgba(255,242,214,0.92)";
            ctx.fillText(WATERMARK, x, y);
            ctx.restore();
        }
        catch (e) { }
    }

    // Fit a single-line caption to a max width by shrinking the font; hard-truncate.
    function fitFont(ctx, text, maxWidth, baseSize, family)
    {
        var size = baseSize;
        ctx.font = "bold " + size + "px " + family;
        while (size > 11 && ctx.measureText(text).width > maxWidth) { size -= 1; ctx.font = "bold " + size + "px " + family; }
        return size;
    }
    function roundRectPath(ctx, x, y, w, h, r)
    {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    // A fit-to-width caption on a translucent pill (top = matchup banner, bottom = the
    // worm's trash-talk line). Used by render() so text never overflows the frame.
    function drawCaption(ctx, w, h, text, atTop, accent)
    {
        if (!text) { return; }
        try
        {
            text = String(text);
            if (text.length > 92) { text = text.slice(0, 90) + "…"; }
            var family = "'Arial Black', Arial, sans-serif";
            var maxW = w * 0.9;
            var size = fitFont(ctx, text, maxW, Math.round(w * 0.05), family);
            ctx.save();
            ctx.font = "bold " + size + "px " + family;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            var pad = Math.round(size * 0.5);
            var tw = Math.min(maxW, ctx.measureText(text).width) + pad * 2;
            var th = size + Math.round(pad * 1.3);
            var cx = Math.round(w / 2);
            var cy = atTop ? Math.round(h * 0.065 + th / 2) : Math.round(h * 0.93 - th / 2);
            ctx.fillStyle = "rgba(8,6,4,0.55)";
            roundRectPath(ctx, cx - tw / 2, cy - th / 2, tw, th, Math.round(th * 0.32));
            ctx.fill();
            ctx.lineWidth = Math.max(2, Math.round(size / 6));
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.strokeText(text, cx, cy);
            ctx.fillStyle = accent ? "rgba(255,200,67,0.98)" : "#fff7e6";
            ctx.fillText(text, cx, cy);
            ctx.restore();
        }
        catch (e) { }
    }

    function wrapLines(ctx, text, maxWidth)
    {
        var words = String(text).replace(/\s+/g, " ").trim().split(/\s+/);
        var lines = [], cur = "";
        var splitLongWord = function (word)
        {
            var piece = "";
            for (var c = 0; c < word.length; c++)
            {
                var test = piece + word.charAt(c);
                if (piece && ctx.measureText(test).width > maxWidth)
                {
                    lines.push(piece);
                    piece = word.charAt(c);
                }
                else { piece = test; }
            }
            return piece;
        };
        for (var i = 0; i < words.length; i++)
        {
            if (!words[i]) { continue; }
            if (ctx.measureText(words[i]).width > maxWidth)
            {
                if (cur) { lines.push(cur); cur = ""; }
                cur = splitLongWord(words[i]);
                continue;
            }
            var test = cur ? (cur + " " + words[i]) : words[i];
            if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = words[i]; }
            else { cur = test; }
        }
        if (cur) { lines.push(cur); }
        return lines;
    }

    function finiteNum(v)
    {
        return typeof v == "number" && isFinite(v);
    }

    function tauntAnchor(taunt, frameMap)
    {
        if (!taunt || !frameMap || !finiteNum(taunt.screenX) || !finiteNum(taunt.screenY)) { return null; }
        var mx = taunt.screenX;
        var my = taunt.screenY;
        if (finiteNum(taunt.canvasW) && finiteNum(taunt.canvasH) && taunt.canvasW > 0 && taunt.canvasH > 0)
        {
            var cs = Math.min(W / taunt.canvasW, H / taunt.canvasH);
            var cdx = Math.round((W - taunt.canvasW * cs) / 2);
            var cdy = Math.round((H - taunt.canvasH * cs) / 2);
            mx = cdx + taunt.screenX * cs;
            my = cdy + taunt.screenY * cs;
        }
        return { x: frameMap.dx + mx * frameMap.s, y: frameMap.dy + my * frameMap.s };
    }

    function bubbleStroke(taunt)
    {
        var color = taunt && taunt.teamColor ? String(taunt.teamColor) : "";
        return color || "#ffffff";
    }

    // Canvas equivalent of css/custom.css .wa-bubble: same dark panel, team border,
    // Trebuchet text, and two-dot thought tail. The caller passes the progressively
    // revealed substring to preserve the in-game streamed/typewriter feel.
    function drawWormBubble(ctx, w, h, taunt, text, frameMap)
    {
        if (!text) { return; }
        try
        {
            var anchor = tauntAnchor(taunt, frameMap);
            var fallback = !anchor;
            var scale = frameMap && frameMap.s ? frameMap.s : 1;
            var family = "'Trebuchet MS', 'Segoe UI', Sans-Serif";
            var size = Math.max(12, Math.round(14 * scale));
            var lineH = Math.round(size * 1.34);
            var padX = Math.round(12 * scale);
            var padTop = Math.round(7 * scale);
            var padBottom = Math.round(9 * scale);
            var radius = Math.round(14 * scale);
            var border = Math.max(2, Math.round(2 * scale));
            var maxBoxW = Math.min(w - 16, Math.round(360 * scale));
            var minBoxW = Math.min(maxBoxW, Math.round(88 * scale));
            var maxTextW = Math.max(24, maxBoxW - padX * 2);

            ctx.save();
            ctx.font = size + "px " + family;
            var lines = wrapLines(ctx, text, maxTextW);
            if (lines.length > 7) { lines = lines.slice(0, 7); lines[6] = lines[6] + "..."; }
            var textW = 0;
            for (var i = 0; i < lines.length; i++) { var lw = ctx.measureText(lines[i]).width; if (lw > textW) { textW = lw; } }
            var bw = Math.min(maxBoxW, Math.max(minBoxW, textW + padX * 2));
            var bh = padTop + padBottom + Math.max(1, lines.length) * lineH;
            if (!anchor) { anchor = { x: w / 2, y: h * 0.16 }; }

            var bx = Math.round(anchor.x - (bw / 2));
            var by = Math.round(anchor.y - bh - 80 * scale);
            var below = false;
            if (fallback)
            {
                by = Math.round(h * 0.035);
            }
            else if (by < 8)
            {
                by = Math.round(anchor.y + 58 * scale);
                below = true;
            }
            bx = Math.max(8, Math.min(w - bw - 8, bx));
            by = Math.max(8, Math.min(h - bh - 8, by));

            var fill = "rgba(14, 15, 22, 0.92)";
            var stroke = bubbleStroke(taunt);
            var tailX = Math.max(bx + 18 * scale, Math.min(bx + bw - 18 * scale, anchor.x));

            ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
            ctx.shadowBlur = 24 * scale;
            ctx.shadowOffsetY = 7 * scale;
            roundRectPath(ctx, bx, by, bw, bh, radius);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
            ctx.lineWidth = border;
            ctx.strokeStyle = stroke;
            ctx.stroke();

            var r1 = Math.max(4, 6 * scale);
            var r2 = Math.max(3, 3.5 * scale);
            var t1y = below ? (by - 9 * scale) : (by + bh + 9 * scale);
            var t2y = below ? (by - 21 * scale) : (by + bh + 21 * scale);
            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = border;
            ctx.beginPath();
            ctx.arc(tailX, t1y, r1, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(tailX, t2y, r2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.font = size + "px " + family;
            ctx.fillStyle = "#f6f7fb";
            ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
            ctx.shadowBlur = 2 * scale;
            ctx.shadowOffsetY = 1 * scale;
            var yy = by + padTop;
            for (var j = 0; j < lines.length; j++) { ctx.fillText(lines[j], bx + padX, yy); yy += lineH; }
            ctx.restore();
        }
        catch (e) { }
    }

    function pickMime()
    {
        // Prefer MP4/H.264+AAC so the clip is directly shareable to YouTube, Reddit,
        // X, TikTok, Instagram, etc. (modern Chrome supports MP4 recording). Fall
        // back to webm only where MP4 recording is unavailable.
        var candidates = [
            "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
            "video/mp4;codecs=h264,aac",
            "video/mp4",
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm"
        ];
        if (typeof MediaRecorder == "undefined" || !MediaRecorder.isTypeSupported) { return ""; }
        for (var i = 0; i < candidates.length; i++)
        {
            if (MediaRecorder.isTypeSupported(candidates[i])) { return candidates[i]; }
        }
        return "";
    }

    export function fileExt()
    {
        return (mimeType && mimeType.indexOf("mp4") >= 0) ? "mp4" : "webm";
    }

    export function isSupported()
    {
        return typeof MediaRecorder != "undefined"
            && typeof document != "undefined"
            && !!document.createElement("canvas").captureStream;
    }

    export function isRecording() { return recording; }

    function stopLiveTracks()
    {
        try { if (recordVideoTrack && recordVideoTrack.stop) { recordVideoTrack.stop(); } } catch (e) { }
        recordVideoTrack = null;
    }

    // Pause/resume the live capture while the studio menu is open, so the paused
    // game + menu frames never land in the master footage.
    export function pauseCapture()
    {
        try { if (recorder && recording && recorder.state == "recording") { recorder.pause(); } } catch (e) { }
    }
    export function resumeCapture()
    {
        try { if (recorder && recording && recorder.state == "paused") { recorder.resume(); } } catch (e) { }
    }
    export function isCapturePaused()
    {
        try { return !!(recorder && recorder.state == "paused"); } catch (e) { return false; }
    }

    // Start capturing. Call from a user-gesture-derived context (match start, which
    // follows the menu click) so the audio context can resume.
    export function start()
    {
        try
        {
            if (recording) { return true; }
            if (!isSupported()) { return false; }
            ensureCanvas();
            composeFrame();

            var stream = composeCanvas.captureStream(30);

            // Attach the shared game-audio track (music + SFX).
            if (typeof RecordingAudioBus != "undefined")
            {
                RecordingAudioBus.ensure();
                var track = RecordingAudioBus.getAudioTrack();
                if (track) { try { stream.addTrack(track); } catch (e) { } }
            }

            mimeType = pickMime();
            var opts: any = mimeType
                ? { mimeType: mimeType, videoBitsPerSecond: 5000000, audioBitsPerSecond: 128000 }
                : undefined;
            var videoTracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
            recordVideoTrack = videoTracks.length ? videoTracks[0] : null;
            recorder = new MediaRecorder(stream, opts);

            initChunk = null;
            ring = [];
            fullChunks = [];
            fullBytes = 0;
            fullCapped = false;

            recorder.ondataavailable = function (ev)
            {
                if (!ev || !ev.data || ev.data.size == 0) { return; }
                var t = clock();
                if (!initChunk) { initChunk = ev.data; }
                ring.push({ blob: ev.data, t: t, size: ev.data.size });
                while (ring.length > 1 && (t - ring[0].t) > RING_MS) { ring.shift(); }
                if (fullBytes < FULL_BUDGET_BYTES)
                {
                    fullChunks.push(ev.data);
                    fullBytes += ev.data.size;
                }
                else if (!fullCapped)
                {
                    fullCapped = true;
                    try { if (typeof console != "undefined") { console.log("[MatchRecorder] full-match buffer hit " + Math.round(FULL_BUDGET_BYTES / 1048576) + "MB cap; keeping ring + earlier footage."); } } catch (e) { }
                }
            };
            recorder.onerror = function ()
            {
                recording = false;
                stopLiveTracks();
                if (typeof MatchTimeline != "undefined") { MatchTimeline.stop(); }
            };

            recorder.start(1000);
            recording = true;

            if (typeof MatchTimeline != "undefined") { MatchTimeline.reset(); }
            return true;
        }
        catch (e)
        {
            recording = false;
            stopLiveTracks();
            return false;
        }
    }

    export function stop(postRollMs, cb)
    {
        if (!recording || !recorder)
        {
            if (cb) { cb(); }
            return;
        }
        var doStop = function ()
        {
            try
            {
                // onstop fires AFTER the final dataavailable, so the last chunk is in
                // the buffers before we report completion / enable export.
                recorder.onstop = function ()
                {
                    recording = false;
                    stopLiveTracks();
                    if (typeof MatchTimeline != "undefined") { MatchTimeline.stop(); }
                    if (cb) { try { cb(); } catch (e) { } }
                };
                recorder.stop();
            }
            catch (e)
            {
                recording = false;
                stopLiveTracks();
                if (typeof MatchTimeline != "undefined") { MatchTimeline.stop(); }
                if (cb) { try { cb(); } catch (e2) { } }
            }
        };
        if (postRollMs && postRollMs > 0) { setTimeout(doStop, postRollMs); }
        else { doStop(); }
    }

    function mimeOf()
    {
        return (recorder && recorder.mimeType) ? recorder.mimeType : (mimeType || "video/webm");
    }

    // Assemble the last ~30s: the init (header) chunk is prepended so the tail plays.
    function assembleRing()
    {
        if (!ring.length && !fullChunks.length) { return null; }
        var chunks = [];
        if (initChunk) { chunks.push(initChunk); }
        for (var i = 0; i < ring.length; i++)
        {
            if (ring[i].blob !== initChunk) { chunks.push(ring[i].blob); }
        }
        if (!chunks.length) { return null; }
        return new Blob(chunks, { type: mimeOf() });
    }

    function assembleFull()
    {
        if (!fullChunks.length) { return null; }
        return new Blob(fullChunks, { type: mimeOf() });
    }

    // Flush the in-progress chunk, then build — so a clip includes footage right up
    // to "now" instead of missing the last (up to) 1s. Falls back to a safety timer.
    function flushThen(builder, cb)
    {
        if (!(recorder && recording)) { cb(builder()); return; }
        var done = false;
        var finish = function ()
        {
            if (done) { return; }
            done = true;
            try { recorder.removeEventListener("dataavailable", onData); } catch (e) { }
            cb(builder());
        };
        var onData = function () { finish(); };
        try
        {
            recorder.addEventListener("dataavailable", onData);
            recorder.requestData();
            setTimeout(finish, 450);
        }
        catch (e) { finish(); }
    }

    // Instant clip of the last ~30s. Pass a callback to include the latest second;
    // the sync return (no callback) is a best-effort legacy fallback.
    export function quickClip(cb)
    {
        if (typeof cb != "function") { try { return assembleRing(); } catch (e) { return null; } }
        try { flushThen(assembleRing, cb); } catch (e) { cb(null); }
    }

    // The full match so far, as one playable webm.
    export function fullClip(cb)
    {
        if (typeof cb != "function") { try { return assembleFull(); } catch (e) { return null; } }
        try { flushThen(assembleFull, cb); } catch (e) { cb(null); }
    }

    // Trigger a browser download of a recorded blob (and offer native share).
    export function download(blob, filename)
    {
        if (!blob) { return; }
        try
        {
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = filename || ("llm-worms-arena-" + Math.round(clock()) + ".webm");
            document.body.appendChild(a);
            a.click();
            setTimeout(function ()
            {
                try { document.body.removeChild(a); } catch (e) { }
                try { URL.revokeObjectURL(url); } catch (e) { }
            }, 1500);
        }
        catch (e) { }
    }

    // Best-effort native share of a clip file; falls back to download.
    export function share(blob, filename, title)
    {
        if (!blob) { return; }
        var name = filename || "llm-worms-arena-clip.webm";
        try
        {
            var navAny: any = (typeof navigator != "undefined") ? navigator : null;
            if (navAny && navAny.canShare && typeof File != "undefined")
            {
                var file = new File([blob], name, { type: blob.type || "video/webm" });
                if (navAny.canShare({ files: [file] }))
                {
                    navAny.share({ files: [file], title: title || "LLM Worms Arena", text: title || "LLM Worms Arena clip" })
                        ["catch"](function () { download(blob, name); });
                    return;
                }
            }
        }
        catch (e) { }
        download(blob, name);
    }

    function drawMatchupBanner(ctx, w, topBar)
    {
        var mt = matchupText();
        if (!mt) { return; }
        try
        {
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            var fs = Math.max(18, Math.round(w * 0.042));
            ctx.font = "bold " + fs + "px 'Arial Black', Arial, sans-serif";
            ctx.lineWidth = Math.max(3, Math.round(fs / 5));
            ctx.strokeStyle = "rgba(0,0,0,0.82)";
            ctx.fillStyle = "rgba(255,200,67,0.96)";
            var ty = Math.min(Math.round(topBar / 2), 46);
            ctx.strokeText(mt, w / 2, ty);
            ctx.fillText(mt, w / 2, ty);
            ctx.restore();
        }
        catch (e) { }
    }

    // Re-render the 16:9 master into the chosen platform aspect, optionally cutting
    // to EDL segments (each {t0,t1 in seconds, rate}). Used by the VideoStudio for
    // platform-formatted highlight reels / sped-up full matches. All local.
    // cb(blob|null); progress(0..1) optional.
    export function render(opts, cb, progress)
    {
        try
        {
            opts = opts || {};
            if (!isSupported()) { cb(null); return; }
            if (segmentsStartAfterTimeline(opts.segments)) { cb(null); return; }
            flushThen(assembleFull, function (master)
            {
                renderMaster(opts, master, cb, progress);
            });
        }
        catch (e) { cb(null); }
    }

    function normalizeSegments(rawSegs, durationSec, defaultRate)
    {
        var out: any[] = [];
        var hasDuration = typeof durationSec == "number" && isFinite(durationSec) && durationSec > 0;
        var source = (rawSegs && rawSegs.length) ? rawSegs : [{ t0: 0, t1: hasDuration ? durationSec : 1e7, rate: defaultRate || 1 }];
        for (var i = 0; i < source.length; i++)
        {
            var seg = source[i] || {};
            var t0 = (typeof seg.t0 == "number" && isFinite(seg.t0)) ? seg.t0 : 0;
            var t1 = (typeof seg.t1 == "number" && isFinite(seg.t1)) ? seg.t1 : (hasDuration ? durationSec : 1e7);
            t0 = Math.max(0, t0);
            t1 = Math.max(0, t1);
            if (hasDuration)
            {
                if (t0 >= durationSec) { continue; }
                t1 = Math.min(t1, durationSec);
            }
            if (t1 <= t0 + 0.03) { continue; }
            out.push({ t0: t0, t1: t1, rate: seg.rate || defaultRate || 1, taunt: seg.taunt || null });
        }
        return out;
    }

    function segmentsStartAfterTimeline(rawSegs)
    {
        if (!rawSegs || !rawSegs.length) { return false; }
        try
        {
            if (typeof MatchTimeline == "undefined" || !MatchTimeline.now) { return false; }
            var endSec = Math.max(0, MatchTimeline.now() / 1000) + 0.5;
            var earliest = Infinity;
            for (var i = 0; i < rawSegs.length; i++)
            {
                var seg = rawSegs[i] || {};
                var t0 = (typeof seg.t0 == "number" && isFinite(seg.t0)) ? seg.t0 : 0;
                if (t0 < earliest) { earliest = t0; }
            }
            return earliest !== Infinity && earliest > endSec;
        }
        catch (e) { return false; }
    }

    function renderMaster(opts, master, cb, progress)
    {
        try
        {
            var plat = opts.platform || currentPlatform;
            var dim = PLATFORMS[plat] || PLATFORMS["youtube"];
            var ow = dim.w, oh = dim.h;
            var segs = (opts.segments && opts.segments.length) ? opts.segments.slice() : null;

            if (!master) { cb(null); return; }

            var outCanvas = document.createElement("canvas");
            outCanvas.width = ow; outCanvas.height = oh;
            var octx = outCanvas.getContext("2d");

            var video = document.createElement("video");
            video.muted = false; video.playsInline = true; video.preload = "auto";
            var url = URL.createObjectURL(master);
            video.src = url;

            var actx: any = null, renderDest: any = null;
            try
            {
                var AC = window["AudioContext"] || window["webkitAudioContext"];
                if (AC)
                {
                    actx = new AC();
                    var srcNode = actx.createMediaElementSource(video);
                    renderDest = actx.createMediaStreamDestination();
                    srcNode.connect(renderDest); // capture only - not connected to speakers
                }
            }
            catch (e) { }

            var rec2: any = null;
            var chunks2: any[] = [];
            var finished = false;
            var stopping = false;
            var rafId2: any = null;
            var safetyTimer: any = null;
            var renderTracks: any[] = [];

            function cleanup()
            {
                try { if (safetyTimer) { window.clearTimeout(safetyTimer); } } catch (e) { }
                try { if (rafId2) { window.cancelAnimationFrame(rafId2); } } catch (e) { }
                try { video.pause(); } catch (e) { }
                try { URL.revokeObjectURL(url); } catch (e) { }
                for (var i = 0; i < renderTracks.length; i++)
                {
                    try { if (renderTracks[i] && renderTracks[i].stop) { renderTracks[i].stop(); } } catch (e) { }
                }
                renderTracks = [];
                try { if (actx) { actx.close(); } } catch (e) { }
            }
            function renderBlob()
            {
                var type = (rec2 && rec2.mimeType) ? rec2.mimeType : mimeOf();
                return chunks2.length ? new Blob(chunks2, { type: type }) : null;
            }
            function finishRender(blob)
            {
                if (finished) { return; }
                finished = true;
                cleanup();
                cb(blob || null);
            }
            function failRender()
            {
                finishRender(null);
            }
            function finalize()
            {
                if (finished || stopping) { return; }
                stopping = true;
                try
                {
                    if (!rec2 || rec2.state == "inactive")
                    {
                        finishRender(renderBlob());
                        return;
                    }
                    rec2.onstop = function ()
                    {
                        finishRender(renderBlob());
                    };
                    rec2.stop();
                }
                catch (e) { finishRender(renderBlob()); }
            }

            function drawSegmentTaunt(seg, frameMap)
            {
                if (!seg || !seg.taunt || !seg.taunt.text) { return false; }
                try
                {
                    var tauntLocalStartMs = (typeof seg.taunt.localStartMs == "number") ? seg.taunt.localStartMs : 0;
                    var elapsed = Math.round((video.currentTime - (seg.t0 || 0)) * 1000) - tauntLocalStartMs;
                    if (elapsed < 0) { return true; }
                    var windowMs = (typeof MatchTimeline != "undefined" && MatchTimeline.tauntWindowMs)
                        ? MatchTimeline.tauntWindowMs(seg.taunt.text)
                        : Math.min(5400, Math.max(2600, Math.round(String(seg.taunt.text).length / 24 * 1000) + 1700));
                    if (elapsed > windowMs) { return false; }
                    var reveal = Math.max(0, Math.floor(elapsed / 1000 * 24));
                    var shown = String(seg.taunt.text).slice(0, reveal);
                    if (shown.length > 0) { drawWormBubble(octx, ow, oh, seg.taunt, shown, frameMap); }
                    return true;
                }
                catch (e) { return false; }
            }

            function drawFrame(seg)
            {
                octx.fillStyle = "#05070d";
                octx.fillRect(0, 0, ow, oh);
                // COVER: fill the target, cropping the overflow (no black bars). Vertical
                // and square become true fullscreen instead of letterboxed.
                var s = Math.max(ow / W, oh / H);
                var dw = Math.round(W * s), dh = Math.round(H * s);
                var dx = Math.round((ow - dw) / 2), dy = Math.round((oh - dh) / 2);
                try { octx.drawImage(video, dx, dy, dw, dh); } catch (e) { }
                var frameMap = { s: s, dx: dx, dy: dy };
                // The worm's trash-talk: a Worms-style thought bubble matching the
                // in-game .wa-bubble style and screen-space placement. It streams in,
                // holds to read, then disappears so the action plays cleanly.
                try
                {
                    if (!drawSegmentTaunt(seg, frameMap) && typeof MatchTimeline != "undefined" && MatchTimeline.getTauntAt)
                    {
                        var tMs = Math.round(video.currentTime * 1000);
                        var taunt = MatchTimeline.getTauntAt(tMs);
                        if (taunt && taunt.text)
                        {
                            var elapsed = tMs - taunt.t;
                            var reveal = Math.max(0, Math.floor(elapsed / 1000 * 24));
                            var shown = String(taunt.text).slice(0, reveal);
                            if (shown.length > 0) { drawWormBubble(octx, ow, oh, taunt, shown, frameMap); }
                        }
                    }
                }
                catch (e) { }
            }

            function startRecorder()
            {
                var vstream = outCanvas.captureStream(30);
                var videoTracks = vstream.getVideoTracks();
                for (var vt = 0; vt < videoTracks.length; vt++) { renderTracks.push(videoTracks[vt]); }
                var streamOut = new MediaStream(videoTracks);
                if (renderDest)
                {
                    var atr = renderDest.stream.getAudioTracks()[0];
                    if (atr)
                    {
                        renderTracks.push(atr);
                        try { streamOut.addTrack(atr); } catch (e) { }
                    }
                }
                var mt = pickMime();
                rec2 = new MediaRecorder(streamOut, mt ? { mimeType: mt, videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000 } : undefined);
                rec2.ondataavailable = function (e) { if (e && e.data && e.data.size) { chunks2.push(e.data); } };
                rec2.onerror = function () { failRender(); };
                rec2.start();
                if (actx && actx.state == "suspended") { try { actx.resume(); } catch (e) { } }
            }

            function runSegment(i)
            {
                if (finished) { return; }
                if (i >= segs.length) { finalize(); return; }
                var seg = segs[i];
                video.playbackRate = Math.max(0.25, Math.min(16, seg.rate || 1));
                if (progress) { try { progress(i / segs.length); } catch (e) { } }

                var segmentStarted = false;
                var startSegment = function ()
                {
                    if (segmentStarted || finished) { return; }
                    segmentStarted = true;
                    video.removeEventListener("seeked", startSegment);
                    var pr = video.play();
                    if (pr && pr["catch"]) { pr["catch"](function () { failRender(); }); }
                    tick();
                };
                function tick()
                {
                    if (finished) { return; }
                    drawFrame(seg);
                    var end = (typeof seg.t1 == "number") ? seg.t1 : 1e7;
                    if (video.currentTime >= end || video.ended)
                    {
                        try { video.pause(); } catch (e) { }
                        runSegment(i + 1);
                        return;
                    }
                    rafId2 = window.requestAnimationFrame(tick);
                }
                try { video.currentTime = Math.max(0, seg.t0 || 0); } catch (e) { }
                video.addEventListener("seeked", startSegment);
                // Some blobs fire no "seeked" when already at 0 - start anyway.
                if ((seg.t0 || 0) <= 0.01 && video.currentTime <= 0.01) { setTimeout(startSegment, 60); }
            }

            video.onloadedmetadata = function ()
            {
                var durationSec = (isFinite(video.duration) && video.duration > 0) ? video.duration : null;
                var fallbackDurationSec = durationSec;
                try
                {
                    if (!fallbackDurationSec && typeof MatchTimeline != "undefined" && MatchTimeline.now)
                    {
                        fallbackDurationSec = Math.max(0.1, MatchTimeline.now() / 1000);
                    }
                }
                catch (e) { }
                segs = normalizeSegments(segs, fallbackDurationSec, opts.rate || 1);
                if (!segs.length) { failRender(); return; }
                startRecorder();
                runSegment(0);
            };
            video.onerror = function () { failRender(); };

            // Hard safety cap so a stuck decode can never hang the UI.
            safetyTimer = setTimeout(function () { if (!finished) { finalize(); } }, opts.maxMs || 120000);
        }
        catch (e) { cb(null); }
    }
}
