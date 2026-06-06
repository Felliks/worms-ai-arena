import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = Number(process.env.QA_PORT ?? 8797);
const baseUrl = `http://127.0.0.1:${port}`;

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

  try {
    await waitForServer(baseUrl);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const logs: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (!text.includes("Image http://127.0.0.1") && !text.includes("Notice: argv")) {
        logs.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
    page.on("requestfailed", (request) => logs.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForSelector("#startLocal:not([disabled])", { timeout: 15_000 });
    const menuText = await page.locator("body").innerText();
    const menuExternalScripts = await page.$$eval("script", (nodes) =>
      nodes.map((script) => script.src).filter(Boolean).filter((src) => !src.startsWith(location.origin))
    );

    await page.goto(`${baseUrl}/?arena=llm-vs-llm&models=claude-haiku-4-5-20251001,claude-sonnet-4-6&turnTime=120&chatLang=Russian&memoryStrategy=summary&historySize=8&maxBatchesPerTurn=4`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(() => {
      const overlay = document.querySelector("#arenaAgentOverlay");
      const rows = overlay?.querySelectorAll("div div");
      return Boolean(overlay && rows && rows.length > 0 && (overlay.textContent || "").trim().length > "LLM Worms Arena".length);
    }, undefined, { timeout: 75_000 });
    const overlay = await page.locator("#arenaAgentOverlay").innerText({ timeout: 5_000 });
    const timerText = await page.locator("#turnTimeCounter").innerText({ timeout: 5_000 });
    const arenaStarted = await page.evaluate(() => {
      const game = (globalThis as any).GameInstance;
      return Boolean(game && game.state && game.state.isStarted);
    });
    const arenaExternalScripts = await page.$$eval("script", (nodes) =>
      nodes.map((script) => script.src).filter(Boolean).filter((src) => !src.startsWith(location.origin))
    );

    await browser.close();

    const junkPattern = /Tweet|Facebook|Google\+|Leaderboards|linkedin|g-plus|analytics/i;
    const failures = [
      arenaStarted ? null : "Arena did not start.",
      junkPattern.test(menuText) ? "Menu still contains social/ad text." : null,
      menuExternalScripts.length > 0 ? `Menu has external scripts: ${menuExternalScripts.join(", ")}` : null,
      arenaExternalScripts.length > 0 ? `Arena has external scripts: ${arenaExternalScripts.join(", ")}` : null,
      overlay.includes("LLM Worms Arena") ? null : "Arena overlay is missing.",
      /\b(system|engine|model|plan)\s*:/i.test(overlay) ? `Arena overlay contains service/debug text: ${overlay}` : null,
      /thinking|Agent error|Engine feedback|tool-result|react\/iteration/i.test(overlay) ? `Arena overlay contains non-chat diagnostics: ${overlay}` : null,
      Number(timerText) > 90 ? null : `turnTime=120 was not applied; timer text is ${timerText}.`
    ].filter(Boolean);

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }

    console.log(JSON.stringify({
      ok: true,
      menuExternalScripts,
      arenaExternalScripts,
      timerText,
      overlayPreview: overlay.slice(0, 500),
      relevantConsoleLogs: logs
    }, null, 2));
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
