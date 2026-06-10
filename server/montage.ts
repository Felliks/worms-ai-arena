/**
 * montage.ts
 *
 * Optional BYOK "AI editor". Given the deterministic moments detected in a match,
 * it asks the user's own OpenAI-compatible connection to pick + ORDER the most
 * viral ones and write a punchy title. It NEVER touches match fairness — the
 * agents already played; this only curates the spectator highlight reel. Heavy
 * video processing stays local in the browser; this is a single cheap text call.
 *
 * No connection configured -> { refined: false } and the client uses its own
 * deterministic edit. The api key is read from the request (UI connection
 * cascade) or env, and is never logged.
 */
import { z } from "zod";

const MONTAGE_FETCH_TIMEOUT_MS = 15_000;

// Structured output via a forced tool call (regex-free; portable to the Anthropic-
// backed proxy). The model returns these fields as the tool_call arguments.
const MONTAGE_TOOL = {
  type: "function",
  function: {
    name: "submit_montage_edit",
    description: "Submit the highlight-reel edit decision.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "one punchy title, <= 60 chars" },
        order: { type: "array", items: { type: "string" }, description: "momentIds in play order, most viral first or building to a climax" },
        slowmo: { type: "array", items: { type: "string" }, description: "momentIds that deserve slow motion (big hits)" }
      },
      required: ["title", "order"],
      additionalProperties: false
    }
  }
};

const MomentInputSchema = z.object({
  id: z.string(),
  type: z.string(),
  t0: z.number(),
  t1: z.number(),
  score: z.number().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional()
});

export const MontageEditRequestSchema = z.object({
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  platform: z.string().optional(),
  scenarioId: z.string().optional(),
  maxClips: z.number().int().min(1).max(20).optional(),
  moments: z.array(MomentInputSchema).max(200)
});
export type MontageEditRequest = z.infer<typeof MontageEditRequestSchema>;

export interface MontageEditResult {
  refined: boolean;
  title?: string;
  order?: string[];
  slowmo?: string[];
  reason?: string;
}

function requestOwnsConnection(req: MontageEditRequest): boolean {
  return typeof req.baseURL === "string" && req.baseURL.trim().length > 0;
}

function resolveBaseURL(req: MontageEditRequest): string | undefined {
  const raw = (req.baseURL && req.baseURL.trim())
    || process.env.OPENAI_BASE_URL || process.env.BASE_URL || process.env.API_URL;
  if (!raw) {
    return undefined;
  }
  const u = raw.trim().replace(/\/+$/, "");
  return /\/v1$/.test(u) ? u : u + "/v1";
}

function resolveApiKey(req: MontageEditRequest): string | undefined {
  // A user-supplied connection is authoritative even when its key is blank (never
  // silently mixed with an env key), mirroring the agent connection cascade.
  if (requestOwnsConnection(req)) {
    return req.apiKey && req.apiKey.trim() ? req.apiKey.trim() : undefined;
  }
  const k = (req.apiKey && req.apiKey.trim()) || process.env.OPENAI_API_KEY;
  return k || undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MONTAGE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function editMontage(input: unknown): Promise<MontageEditResult> {
  const req = MontageEditRequestSchema.parse(input);
  const baseURL = resolveBaseURL(req);
  const apiKey = resolveApiKey(req);
  if (!baseURL || !apiKey) {
    return { refined: false, reason: "no-connection" };
  }
  const model = req.model || process.env.AGENT_MONTAGE_MODEL || "gpt-4o-mini";
  const maxClips = req.maxClips ?? 6;

  const system = [
    "You are a short-form video editor for an AI-vs-AI Worms highlight reel.",
    "Given the detected moments, pick and ORDER the most viral ones (most dramatic first or building to a climax), write ONE punchy title, and call submit_montage_edit.",
    "Use only momentIds present in the input. Keep order length <= maxClips. slowmo = ids that deserve slow motion (big hits)."
  ].join(" ");
  const user = JSON.stringify({ platform: req.platform, scenario: req.scenarioId, maxClips, moments: req.moments });

  let resp: Response;
  try {
    resp = await fetchWithTimeout(baseURL.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.7,
        tools: [MONTAGE_TOOL],
        tool_choice: { type: "function", function: { name: "submit_montage_edit" } }
      })
    });
  } catch (error) {
    return { refined: false, reason: (error as Error).name === "AbortError" ? "timeout" : "fetch-error" };
  }
  if (!resp.ok) {
    return { refined: false, reason: "http-" + resp.status };
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    return { refined: false, reason: "no-tool-call" };
  }
  let parsed: { title?: unknown; order?: unknown; slowmo?: unknown };
  try {
    parsed = JSON.parse(args);
  } catch {
    return { refined: false, reason: "bad-args" };
  }

  const ids = new Set(req.moments.map((m) => m.id));
  const order = Array.isArray(parsed.order) ? parsed.order.filter((x): x is string => typeof x === "string" && ids.has(x)).slice(0, maxClips) : [];
  const orderedIds = new Set(order);
  const slowmo = Array.isArray(parsed.slowmo) ? parsed.slowmo.filter((x): x is string => typeof x === "string" && orderedIds.has(x)) : [];
  const title = typeof parsed.title === "string" ? parsed.title.slice(0, 60) : undefined;
  if (!order.length) {
    return { refined: false, reason: "no-order" };
  }
  return { refined: true, title, order, slowmo };
}
