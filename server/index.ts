import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { decideTurnStream, listModelsForConnection } from "./agent";
import { getAgentLogFile, logAgentEvent } from "./agent-log";

const serverParent = path.resolve(__dirname, "..");
const defaultPublicRoot = path.basename(serverParent) === "dist" ? path.resolve(serverParent, "..") : serverParent;
const root = path.resolve(process.env.PUBLIC_ROOT ?? defaultPublicRoot);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const app = express();
// Don't advertise the framework/version in responses.
app.disable("x-powered-by");

app.use(express.json({ limit: "25mb" }));

function logPayloadForConsole(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function saveVisionScreenshot(requestId: string, body: Record<string, unknown>): string | null {
  const dataUrl = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl : "";
  if (!dataUrl || String(process.env.AGENT_SAVE_VISION_SCREENSHOTS ?? "true").toLowerCase() === "false") {
    return null;
  }

  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    logAgentEvent(requestId, "vision/screenshot-save-skipped", {
      reason: "Unsupported or malformed data URL",
      prefix: dataUrl.slice(0, 64)
    });
    return null;
  }

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const logRoot = path.resolve(process.env.AGENT_LOG_DIR || "logs");
  const visionDir = path.join(logRoot, "vision");
  const safeRequestId = requestId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const filePath = path.join(visionDir, `${Date.now()}-${safeRequestId}.${ext}`);

  fs.mkdirSync(visionDir, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  body.visionScreenshotPath = filePath;
  logAgentEvent(requestId, "vision/screenshot-saved", {
    path: filePath,
    bytes: fs.statSync(filePath).size,
    mediaType: `image/${match[1]}`
  });
  return filePath;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, logFile: getAgentLogFile() });
});

app.post("/api/agent/turn", async (req, res, next) => {
  const requestId = String(req.body?.requestId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const startedAt = Date.now();
  // Stream the turn as newline-delimited JSON: zero or more {type:"say"} events the moment the
  // worm's chat line is parsed from the model stream, then a single {type:"final", decision}.
  // This lets the browser render the worm's taunt within ~2s instead of waiting the full decision.
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const write = (obj: unknown) => {
    res.write(JSON.stringify(obj) + "\n");
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };
  try {
    req.body.requestId = requestId;
    console.log(`[agent:${requestId}] HTTP request received`);
    saveVisionScreenshot(requestId, req.body);
    let sayCount = 0;
    let firstSayMs = -1;
    const decision = await decideTurnStream(req.body, (text) => {
      sayCount++;
      if (firstSayMs < 0) {
        firstSayMs = Date.now() - startedAt;
      }
      write({ type: "say", text });
    });
    write({ type: "final", decision });
    res.end();
    console.log(`[agent:${requestId}] HTTP response ${Date.now() - startedAt}ms (first-say=${firstSayMs}ms, early-say=${sayCount})`);
    console.log(logPayloadForConsole({ requestId, decision }));
  } catch (error) {
    console.error(`[agent:${requestId}] HTTP error ${Date.now() - startedAt}ms`);
    if (res.headersSent) {
      try {
        write({ type: "error", error: (error as Error).message });
      } catch {
        // socket already gone
      }
      res.end();
    } else {
      next(error);
    }
  }
});

// Connection picker / "test connection" for the UI. Returns the model list for
// a user-supplied OpenAI-compatible connection (or env, when none supplied).
// Always 200 with { ok } so the browser can show a clear message instead of a
// thrown fetch. POST keeps the API key out of URLs/query logs.
app.post("/api/models", async (req, res) => {
  try {
    const baseURL = typeof req.body?.baseURL === "string" ? req.body.baseURL : undefined;
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey : undefined;
    const models = await listModelsForConnection(baseURL, apiKey);
    res.json({ ok: true, models });
  } catch (error) {
    res.json({ ok: false, error: (error as Error).message, models: [] });
  }
});

app.post("/api/agent/event", (req, res) => {
  const requestId = String(req.body?.requestId || `agent-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  logAgentEvent(requestId, `browser/${String(req.body?.label || "event")}`, req.body?.payload ?? req.body);
  res.json({ ok: true });
});

app.use("/api", (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(400).json({ error: error.message });
});

app.use(
  express.static(root, {
    extensions: ["htm", "html"],
    // Dev server: always revalidate so a freshly rebuilt bundle/CSS is never served stale from
    // the browser cache (etag still yields cheap 304s for unchanged assets).
    etag: true,
    setHeaders(res) {
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-cache");
    }
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(root, "index.htm"));
});

app.listen(port, host, () => {
  console.log(`LLM Worms Arena running at http://${host}:${port}/`);
  console.log(`Agent log file: ${getAgentLogFile()}`);
});
