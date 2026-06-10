import { spawn } from "node:child_process";
import { chromium, type Page } from "playwright";

const port = Number(process.env.QA_PORT ?? 8797);
const baseUrl = `http://127.0.0.1:${port}`;

// Deterministic by default: the "mock" model runs the zero-key scripted bot, so
// QA needs no API keys or proxy and is reproducible in CI and for contributors.
// Set QA_MODELS="model-a,model-b" to smoke-test a real OpenAI-compatible endpoint.
const models = process.env.QA_MODELS ?? "mock,mock";

function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(`${url}/api/health`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Keep polling until timeout.
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }

      setTimeout(poll, 500);
    };

    poll();
  });
}

// Report any element inside the menu overlay that spills past the viewport's
// right edge — the classic source of an ugly horizontal scrollbar on mobile.
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const wide: string[] = [];
    document.querySelectorAll("#wormsMenu *").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 1) {
        wide.push(`${(el as HTMLElement).className || el.tagName}@${Math.round(r.right)}`);
      }
    });
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, overflow: de.scrollWidth - de.clientWidth > 1, wide: wide.slice(0, 8) };
  });
}

async function externalScripts(page: Page): Promise<string[]> {
  return page.$$eval("script", (nodes) =>
    nodes.map((s) => (s as HTMLScriptElement).src).filter(Boolean).filter((src) => !src.startsWith(location.origin))
  );
}

async function main() {
  const server = spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverLogs: string[] = [];
  server.stdout.on("data", (chunk) => serverLogs.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverLogs.push(String(chunk)));

  const failures: string[] = [];
  const note = (bad: unknown, message: string) => {
    if (bad) {
      failures.push(message);
    }
  };

  try {
    await waitForServer(baseUrl);

    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"]
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (!text.includes("Image http://127.0.0.1") && !text.includes("Notice: argv")) {
        consoleLogs.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      const url = request.url();
      // The cinematic art (assets/ui/*.jpg) is optional; a missing pack is not a failure.
      if (/assets\/ui\/.*\.(jpg|png)/.test(url)) {
        return;
      }
      failedRequests.push(`${url} ${request.failure()?.errorText}`);
    });

    // ---- Phase A: desktop menu -------------------------------------------
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForSelector("#wormsMenu", { timeout: 20_000 });
    await page.waitForSelector("#startLocal", { timeout: 20_000 });

    note((await page.title()) !== "LLM Worms Arena", `document.title is not "LLM Worms Arena".`);
    note((await page.$$eval("html[manifest]", (n) => n.length)) !== 0, "html[manifest] count is not 0 (stale AppCache).");
    note(!(await page.locator("#wormsMenu").isVisible()), "#wormsMenu is not visible on the menu.");

    const menuText = await page.locator("body").innerText();
    note(/Tweet|Facebook|Google\+|Leaderboards|linkedin|g-plus|analytics/i.test(menuText), "Menu contains social/ad text.");
    note(
      /Worms Armageddon HTML5 Clone|original worms armageddon|copyrighted audio|Team17/i.test(menuText),
      "Menu shows legacy brand/notice text."
    );

    const menuExternalScripts = await externalScripts(page);
    note(menuExternalScripts.length > 0, `Menu has external scripts: ${menuExternalScripts.join(", ")}`);

    const desktopOverflow = await horizontalOverflow(page);
    note(desktopOverflow.overflow, `Desktop menu overflows horizontally (${desktopOverflow.wide.join(", ")}).`);

    // ---- Phase B: Battle Setup opens with usable controls ----------------
    // The gear-prefixed label is unique to the nav card (the help paragraph also
    // mentions "Battle Setup" in prose).
    await page.getByText("⚙ Battle Setup").first().click();
    const setupReady = await page
      .waitForFunction(() => {
        const stage = document.querySelector("#wormsMenu");
        if (!stage) return false;
        const hasInputs = stage.querySelectorAll("input, select, .wa-stepper").length > 3;
        return hasInputs && /Battle Setup|Worms per team|Turn time/i.test((stage as HTMLElement).innerText);
      }, undefined, { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    note(!setupReady, "Battle Setup did not open with usable controls.");

    // ---- Phase C: mobile menu --------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForSelector("#startLocal", { timeout: 20_000 });
    const mobileOverflow = await horizontalOverflow(page);
    note(mobileOverflow.overflow, `Mobile (390px) menu overflows horizontally (${mobileOverflow.wide.join(", ")}).`);
    await page.setViewportSize({ width: 1280, height: 800 });

    // ---- Phase D: local 2-player game starts -----------------------------
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForSelector("#startLocal", { timeout: 20_000 });
    await page.locator("#startLocal").click();
    await page.waitForFunction(
      () => {
        const game = (globalThis as any).GameInstance;
        return Boolean(game && game.state && game.state.isStarted);
      },
      undefined,
      { timeout: 30_000 }
    );
    const localGame = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      const menu = document.getElementById("wormsMenu");
      out.menuGone = !menu || getComputedStyle(menu).display === "none";
      const canvas = document.getElementById("action") as HTMLCanvasElement | null;
      out.hasCanvas = Boolean(canvas);
      if (canvas) {
        out.sized = canvas.width > 0 && canvas.height > 0;
        try {
          const ctx = canvas.getContext("2d")!;
          const points = [
            [canvas.width * 0.5, canvas.height * 0.3],
            [canvas.width * 0.2, canvas.height * 0.6],
            [canvas.width * 0.8, canvas.height * 0.8],
            [canvas.width * 0.5, canvas.height * 0.9]
          ];
          const colors = points.map(([x, y]) => Array.from(ctx.getImageData(x | 0, y | 0, 1, 1).data).join(","));
          out.nonblank = new Set(colors).size > 1;
        } catch (error) {
          out.canvasError = String(error);
        }
      }
      const timer = document.getElementById("turnTimeCounter");
      out.timerPresent = Boolean(timer);
      return out;
    });
    note(!localGame.menuGone, "Menu did not disappear after starting the local game.");
    note(!localGame.hasCanvas || !localGame.sized, "Game canvas #action is missing or unsized.");
    note(!localGame.nonblank, `Game canvas appears blank (${localGame.canvasError ?? "uniform pixels"}).`);
    note(!localGame.timerPresent, "Turn timer is missing in the local game.");

    // ---- Phase E: LLM arena (mock by default) ----------------------------
    const arenaUrl = `${baseUrl}/?arena=llm-vs-llm&models=${encodeURIComponent(models)}&turnTime=120&chatLang=Russian&memoryStrategy=summary&historySize=8&maxBatchesPerTurn=4`;
    await page.goto(arenaUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.mouse.click(200, 200);
    await page.waitForFunction(
      () => {
        const game = (globalThis as any).GameInstance;
        const controller = (globalThis as any).ArenaControllerInstance;
        const bubble = document.querySelector("#arenaThoughtBubble");
        const bubbleText = (bubble?.textContent || "").trim();
        const bubbleVisible = Boolean(bubble && getComputedStyle(bubble).display !== "none");
        return Boolean(game && game.state && game.state.isStarted && controller && controller.enabled && bubbleVisible && bubbleText.length > 3);
      },
      undefined,
      { timeout: 75_000 }
    );
    const bubbleText = await page.locator("#arenaThoughtBubble").innerText({ timeout: 5_000 });
    const timerText = await page.locator("#turnTimeCounter").innerText({ timeout: 5_000 });
    const arenaExternalScripts = await externalScripts(page);

    note(arenaExternalScripts.length > 0, `Arena has external scripts: ${arenaExternalScripts.join(", ")}`);
    note(bubbleText.trim().length <= 3, "Arena thought bubble is missing.");
    note(/\b(system|engine|model|plan)\s*:/i.test(bubbleText), `Arena thought bubble contains service/debug text: ${bubbleText}`);
    note(
      /thinking|Agent error|Engine feedback|tool-result|react\/iteration/i.test(bubbleText),
      `Arena thought bubble contains non-chat diagnostics: ${bubbleText}`
    );
    note(!(Number(timerText) > 90), `turnTime=120 was not applied; timer text is ${timerText}.`);

    // The single in-game clip button must appear once the arena match starts
    // recording (and MatchRecorder must auto-start). Deterministic on mock models.
    const clipButtonSeen = await page
      .waitForFunction(
        () => {
          const overlay = document.querySelector("#waVideoOverlay");
          const btn = document.querySelector("#waClipButton");
          return Boolean(btn && overlay && getComputedStyle(overlay as Element).display !== "none");
        },
        undefined,
        { timeout: 20_000 }
      )
      .then(() => true)
      .catch(() => false);
    note(!clipButtonSeen, "In-game clip button (#waClipButton) did not appear in the mock arena.");
    const recordingActive = await page.evaluate(() => {
      const rec = (globalThis as any).MatchRecorder;
      return Boolean(rec && typeof rec.isRecording === "function" && rec.isRecording());
    });
    note(!recordingActive, "MatchRecorder did not auto-start recording in the mock arena.");
    let footageReady = false;
    const footageDeadline = Date.now() + 12_000;
    while (!footageReady && Date.now() < footageDeadline) {
      footageReady = await page.evaluate(async () => {
        const rec = (globalThis as any).MatchRecorder;
        if (!rec || typeof rec.fullClip !== "function") {
          return false;
        }
        return await new Promise<boolean>((resolve) => {
          rec.fullClip((blob: Blob | null) => resolve(Boolean(blob && blob.size > 50_000)));
        });
      });
      if (!footageReady) {
        await page.waitForTimeout(750);
      }
    }
    note(!footageReady, "MatchRecorder did not produce a non-empty flushed master clip.");

    // Render a tiny platform clip from the live master. This catches MP4-timeslice
    // regressions where the synchronous full buffer only contains the init chunk,
    // so VideoStudio Generate returns null even though recording is active.
    const renderSmoke = await page.evaluate(async () => {
      const rec = (globalThis as any).MatchRecorder;
      const timeline = (globalThis as any).MatchTimeline;
      if (!rec || typeof rec.render !== "function" || !timeline || typeof timeline.getScenarios !== "function") {
        return { ok: false, reason: "missing-api" };
      }
      const scenario = timeline.getScenarios().find((item: any) => item && item.segments && item.segments.length);
      if (!scenario) {
        return { ok: false, reason: "no-scenario" };
      }
      const first = scenario.segments[0] || {};
      const t0 = Math.max(0, Number(first.t0) || 0);
      const naturalEnd = Number(first.t1) || (t0 + 2.5);
      const t1 = Math.max(t0 + 1, Math.min(naturalEnd, t0 + 2.5));
      return await new Promise<{ ok: boolean; reason?: string; size?: number; type?: string }>((resolve) => {
        rec.render(
          { platform: "instagram", segments: [{ t0, t1, rate: 1 }], maxMs: 30_000 },
          (blob: Blob | null) => {
            if (!blob) {
              resolve({ ok: false, reason: "null-blob" });
              return;
            }
            resolve({ ok: blob.size > 50_000, size: blob.size, type: blob.type || "" });
          }
        );
      });
    });
    note(!renderSmoke.ok, `MatchRecorder.render failed during browser QA: ${JSON.stringify(renderSmoke)}.`);

    note(pageErrors.length > 0, `Page errors: ${pageErrors.join(" | ")}`);
    note(failedRequests.length > 0, `Failed requests: ${failedRequests.join(" | ")}`);

    await browser.close();

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          models,
          menuExternalScripts,
          arenaExternalScripts,
          timerText,
          thoughtBubblePreview: bubbleText.slice(0, 300),
          clipButton: clipButtonSeen,
          recording: recordingActive,
          renderSmoke,
          pageErrors,
          failedRequests
        },
        null,
        2
      )
    );
  } finally {
    if (server.pid) {
      try {
        if (process.platform !== "win32") {
          process.kill(-server.pid, "SIGTERM");
        } else {
          server.kill("SIGTERM");
        }
      } catch {
        server.kill("SIGTERM");
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
