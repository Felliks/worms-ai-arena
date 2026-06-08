import { ChatOpenAI } from "@langchain/openai";
import {
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
  tool,
  toolCallLimitMiddleware
} from "langchain";
import OpenAI from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { logAgentEvent } from "./agent-log";

const ACTION_TOOLS = [
  "say",
  "inspect_inventory",
  "select_weapon",
  "walk",
  "jump",
  "backflip",
  "aim",
  "aim_delta",
  "set_power",
  "fire",
  "wait",
  "jetpack_start",
  "jetpack_thrust",
  "jetpack_stop",
  "rope_fire",
  "rope_swing",
  "rope_contract",
  "rope_expand",
  "rope_release"
] as const;
const ActionToolSchema = z.enum(ACTION_TOOLS);
const DirectionSchema = z.enum(["left", "right", "up", "up_left", "up_right"]);

const RawActionSchema = z.object({
  tool: z.string(),
  text: z.any().optional(),
  weapon: z.any().optional(),
  index: z.any().optional(),
  direction: z.any().optional(),
  steps: z.any().optional(),
  degrees: z.any().optional(),
  percent: z.any().optional(),
  ms: z.any().optional(),
  observeMs: z.any().optional()
});

const ActionSchema = z.object({
  tool: ActionToolSchema,
  text: z.string().max(240).nullable(),
  weapon: z.string().nullable(),
  index: z.number().int().min(0).max(20).nullable(),
  direction: DirectionSchema.nullable(),
  steps: z.number().int().min(1).max(160).nullable(),
  degrees: z.number().min(-179).max(179).nullable(),
  percent: z.number().min(1).max(100).nullable(),
  ms: z.number().int().min(100).max(5000).nullable(),
  observeMs: z.number().int().min(500).max(9000).nullable()
});

const RawAgentDecisionSchema = z.object({
  thought: z.any().optional(),
  trashTalk: z.any().optional(),
  target: z.any().optional(),
  campaignPlan: z.any().optional(),
  nextTurnPlan: z.any().optional(),
  actions: z.array(RawActionSchema).min(1).max(20)
});

const AgentDecisionSchema = z.object({
  thought: z.string().describe("Public tactical plan. Do not include hidden chain-of-thought."),
  trashTalk: z.string().max(300),
  target: z.string().max(120).nullable().default(null),
  campaignPlan: z.string().max(800).default("No explicit multi-turn campaign plan supplied; infer from thought and current position."),
  nextTurnPlan: z.string().max(500).default("Next turn should reassess current state, inventory, feedback, and memory before choosing primitives."),
  modelUsed: z.string().optional(),
  actions: z.array(ActionSchema).min(1).max(10)
});

const AgentTurnRequestSchema = z.object({
  requestId: z.string().optional(),
  matchId: z.string(),
  turnId: z.number(),
  teamIndex: z.number(),
  teamName: z.string(),
  personality: z.string(),
  chatLanguage: z.string().optional(),
  model: z.string().optional(),
  // Optional per-request connection overrides (UI connection cascade). When a
  // baseURL is supplied the request owns the connection; otherwise env is used.
  // This is connection plumbing only - prompt/tools/decision logic are unchanged.
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  perception: z.enum(["text", "text+vision"]),
  snapshotMarkdown: z.string(),
  feedbackMarkdown: z.string().optional(),
  screenshotDataUrl: z.string().optional(),
  visionScreenshotPath: z.string().optional(),
  visionError: z.string().optional(),
  wormId: z.string().optional(),
  wormName: z.string().optional(),
  wormProfileMarkdown: z.string().optional(),
  wormMemoryMarkdown: z.string().optional(),
  chatHistoryMarkdown: z.string().optional(),
  interactionInboxMarkdown: z.string().optional(),
  memoryStrategy: z.enum(["none", "sliding", "summary", "full"]).optional(),
  memoryWindow: z.number().int().min(0).max(200).optional(),
  sameTurnBatch: z.number().int().min(1).optional(),
  maxSameTurnBatches: z.number().int().min(1).optional(),
  turnTimeRemainingMs: z.number().int().min(0).optional()
});

type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;
type AgentDecision = z.infer<typeof AgentDecisionSchema>;

const PINNED_AGENT_PROMPT = `<role>
You are a ReAct agent controlling exactly one worm in a browser Worms-style artillery match.
</role>

<identity_and_memory>
You are the active worm named in the turn prompt, not a generic team controller.
Use your own worm profile, tactics, previous turns, and interaction inbox as personal memory.
The shared chat history is visible to every worm. Personal memory belongs only to this worm.
</identity_and_memory>

<objective>
Win the match using only low-level player intent primitives. You may batch several actions in one turn. If an early action fails, later actions will still execute.
</objective>

<react_loop>
Before submitting a turn, use tools to inspect the world in a practical order:
1. read_personal_memory when past actions, grudges, or interaction inbox may matter.
2. read_state when you need the full Markdown snapshot again.
3. inspect_inventory before choosing a weapon or when unsure which weapon is selected.
4. assess_spatial_risk before firing, especially if any ally, self, enemy, wall, ceiling, or ledge is within short range.
5. read_feedback to learn from the last turn.
6. submit_worms_turn exactly once when ready.
</react_loop>

<anti_cheat_rules>
- No ballistic solver, trajectory helper, move_to, pathfinding, or autopilot.
- Tools may describe visible state, memory, inventory, terrain obstruction, and damage feedback only. They do not calculate the correct aim, power, route, or target.
- Choose aim angle, power, movement, and weapon yourself from the Markdown state and optional screenshot.
- Wind is 0 because this clone does not implement wind.
- Be willing to miss. Bad judgment is allowed; hidden auto-aim is not.
- Keep public spectator text concise. Do not reveal private chain-of-thought.
- Write visible chat and trash talk only in the requested chat language. Do not add translations, bilingual parentheticals, or English duplicates unless the requested language is English. Proper names may stay unchanged. Keep tool names and structured action fields in English.
</anti_cheat_rules>

<grudge_and_drama_cheatsheet>
The Grudge ledger in the turn prompt is active tactical context, not flavor text.
Ally damage is a high-drama betrayal cue: it can change trust, timing, target preference, or visible trash talk.
Enemy damage is pressure context: it can bias target preference, but it is not a forced target lock.
Self-damage is embarrassment context: it can affect caution and jokes without forbidding bold plays.
Personality controls the style of reaction: chaos comedian jokes, patient survivor stores debts coldly, reckless duelist escalates when survivable, terrain reader cites the mistake precisely, defensive survivor prioritizes safety while keeping score.
</grudge_and_drama_cheatsheet>

<coordinate_cheatsheet>
Canvas coordinates: x increases right, y increases downward.
Aim angles: -90 = straight up, 0 = right, 90 = down, 180/-180 = left.
If a target has dx > 0 it is to your right. If dx < 0 it is to your left.
If a target has dy < 0 it is above you. If dy > 0 it is below you.
</coordinate_cheatsheet>

<safety_guidelines>
Friendly fire and self-damage are allowed by the game but usually bad.
Facts to consider before explosive fire: active worm distance to muzzle terrain, ally positions near likely impact areas, current weapon blast radius, and whether terrain blocks the line near the worm.
If aim clearance says terrain/boundary is under about 180 px in the intended muzzle direction, treat explosive fire as a likely self-hit unless you deliberately accept that risk.
If the aim clearance fan says "DANGER FLAG: no sampled aim lane has 180+ px", direct explosive fire from the current position is high risk. This is a risk signal, not an order to choose a specific fallback.
If terrain profile says walls/ledges are very close on both sides, do not assume an arced grenade can safely leave the pocket; use the clearance fan and your own judgment.
Before firing explosive weapons, read the blast and friendly-fire map. If an ally is below you in the same side/corridor, or an enemy is close to an ally, account for that risk in your plan.
A skipped shot is better than a meaningless self-hit or ally splash. point-blank explosive fire into nearby terrain is a shame event, not a default move.
For grenade/bazooka shots, use observeMs around 6500-9000 if you want feedback after the explosion.
If you choose only non-turn-ending actions such as walk, jump, aim, jetpack, rope, wait, or select_weapon, the engine may call you again in the same worm turn with fresh feedback while time remains.
There is no voluntary pass/end-turn action. The game ends this worm's turn through shot resolution, death, water, mine/physics turn change, or timer expiration.
Use at most one say action in a single action batch. If you are called again in the same physical worm turn, use the fresh feedback and do not repeat a failed mobility primitive or failed setup without a new reason.
</safety_guidelines>

<action_primitives>
- say: visible chat line.
- inspect_inventory: engine-side inventory check during the game turn.
- select_weapon: weapon name or inventory index.
- walk: direction plus primitive step count from 1-160. Smaller counts are short key holds; larger counts are longer key holds. Terrain can block actual movement; feedback reports dx/dy.
- jump / backflip: movement primitives.
- aim / aim_delta: absolute or relative angle control.
- set_power: shot force percentage.
- fire: shoot and observe result.
- jetpack_start: select and activate Jet Pack; successful activation consumes one Jet Pack ammo and starts a finite fuel pool.
- jetpack_thrust: low-level Jet Pack thrust; screen-relative directions are up, left, right, up_left, or up_right; up decreases y, left decreases x, right increases x; ms is duration.
- jetpack_stop: deactivate Jet Pack to land or conserve fuel.
- rope_fire: select and fire Ninja Rope along your current aim; feedback says whether it attached and where the anchor was.
- rope_swing: while Ninja Rope is attached, hold left/right movement for ms duration to swing manually.
- rope_contract / rope_expand: shorten or lengthen an attached Ninja Rope for ms duration.
- rope_release: detach Ninja Rope.
- wait: spend a small amount of turn time.
</action_primitives>

<inventory_cheatsheet_rules>
No inventory item is a default move. Treat weapon and mobility descriptions as facts about cost, risk, and available primitives, not as orders.
inspect_inventory gives current weapon, ammo, and primitive notes. Pick a tool from the current map state, memory, inventory, and feedback.
Jet Pack and Ninja Rope are manual low-level mobility primitives. They are not pathfinding, route solving, or guaranteed escape.
Mobile primitives do not finish the turn by themselves. After movement, either continue the same action batch or receive fresh same-worm feedback while time remains.
Read movement feedback such as dx/dy, fuel, rope attached/no anchor, and new position before repeating a mobility primitive. Screen-relative direction facts are in the coordinate cheatsheet.
</inventory_cheatsheet_rules>

<final_output>
Call submit_worms_turn once with target, campaignPlan, nextTurnPlan, and 1-10 primitive actions. Action objects may omit irrelevant fields; the engine will normalize missing fields to null.
</final_output>`;

let modelListPromise: Promise<Array<{ id: string; created?: number }>> | null = null;

function getRequestId(request: AgentTurnRequest): string {
  return request.requestId || `${request.matchId}-turn-${request.turnId}-team-${request.teamIndex}`;
}

function action(toolName: string, fields: Partial<z.infer<typeof ActionSchema>> = {}): z.infer<typeof ActionSchema> {
  return {
    tool: toolName as z.infer<typeof ActionSchema>["tool"],
    text: null,
    weapon: null,
    index: null,
    direction: null,
    steps: null,
    degrees: null,
    percent: null,
    ms: null,
    observeMs: null,
    ...fields
  };
}

function clipText(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) {
    return null;
  }

  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function cleanVisibleText(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) {
    return null;
  }

  let text = String(value)
    .replace(/\\n|\\r/g, " ")
    .replace(/<\/?invoke\b[^>]*>/gi, " ")
    .replace(/<\/?tool_call\b[^>]*>/gi, " ")
    .replace(/<\/?tool_use\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text
      .replace(/\s*<\/invoke>\s*$/i, "")
      .replace(/\s*<\/tool_call>\s*$/i, "")
      .replace(/\s*<\/tool_use>\s*$/i, "")
      .replace(/\s*(?:\\?["']\s*)?[}\]]+\s*$/g, "")
      .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
      .trim();
  }

  return clipText(text, maxLength);
}

function isEnglishChatLanguage(language?: string): boolean {
  return !language || /^(en|eng|english)$/i.test(String(language).trim());
}

function cleanVisibleChatText(value: string | null | undefined, maxLength: number, language?: string): string | null {
  const cleaned = cleanVisibleText(value, maxLength);
  if (!cleaned || isEnglishChatLanguage(language)) {
    return cleaned;
  }

  const withoutLatinTranslations = cleaned
    .replace(/[\s\u00a0]*[\(\[（]\s*[A-Za-z][A-Za-z0-9 ,.'’"?!:;—-]{7,}\s*[\)\]）]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clipText(withoutLatinTranslations, maxLength);
}

function normalizeNumber(value: unknown, min: number, max: number, integer = false): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const bounded = Math.max(min, Math.min(max, parsed));
  return integer ? Math.round(bounded) : bounded;
}

function normalizeToolName(value: unknown): z.infer<typeof ActionToolSchema> {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = raw.replace(/[\s-]+/g, "_");
  return (ACTION_TOOLS as readonly string[]).includes(normalized)
    ? normalized as z.infer<typeof ActionToolSchema>
    : "wait";
}

function normalizeDirection(value: unknown): z.infer<typeof DirectionSchema> | null {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "left" || raw === "l") {
    return "left";
  }
  if (raw === "right" || raw === "r") {
    return "right";
  }
  if (raw === "up" || raw === "u") {
    return "up";
  }
  if (raw === "up_left" || raw === "upleft" || raw === "northwest" || raw === "nw") {
    return "up_left";
  }
  if (raw === "up_right" || raw === "upright" || raw === "northeast" || raw === "ne") {
    return "up_right";
  }
  return null;
}

function fallbackTrashTalk(language?: string): string {
  return "";
}

function normalizeAction(input: z.infer<typeof RawActionSchema>, request?: AgentTurnRequest): z.infer<typeof ActionSchema> {
  return action(normalizeToolName(input.tool), {
    text: cleanVisibleChatText(input.text == null ? null : String(input.text), 240, request?.chatLanguage),
    weapon: input.weapon == null ? null : String(input.weapon),
    index: normalizeNumber(input.index, 0, 20, true),
    direction: normalizeDirection(input.direction),
    steps: normalizeNumber(input.steps, 1, 160, true),
    degrees: normalizeNumber(input.degrees, -179, 179),
    percent: normalizeNumber(input.percent, 1, 100),
    ms: normalizeNumber(input.ms, 100, 5000, true),
    observeMs: normalizeNumber(input.observeMs, 500, 9000, true)
  });
}

function normalizeDecision(decision: unknown, request?: AgentTurnRequest): AgentDecision {
  const parsed = RawAgentDecisionSchema.parse(decision);
  const actions = parsed.actions.slice(0, 10).map((agentAction) => normalizeAction(agentAction, request));
  const rawTrashTalk = parsed.trashTalk == null ? fallbackTrashTalk(request?.chatLanguage) : String(parsed.trashTalk);
  const trashTalk = cleanVisibleChatText(rawTrashTalk, 300, request?.chatLanguage) || "";
  if (trashTalk && actions.length < 10) {
    const alreadyHasSay = actions.some((agentAction) => agentAction.tool === "say");
    const normalizedTrashTalk = trashTalk.trim().toLowerCase();
    const alreadySaid = actions.some((agentAction) => (
      agentAction.tool === "say"
      && (agentAction.text || "").trim().toLowerCase() === normalizedTrashTalk
    ));
    if (!alreadyHasSay && !alreadySaid) {
      actions.unshift(action("say", { text: trashTalk }));
    }
  }

  return AgentDecisionSchema.parse({
    thought: parsed.thought == null ? "I will use the visible state, memory, tool observations, and low-level primitives for this turn." : String(parsed.thought),
    trashTalk,
    target: parsed.target == null ? null : cleanVisibleText(String(parsed.target), 120),
    campaignPlan: parsed.campaignPlan == null ? "No explicit multi-turn campaign plan supplied; infer from thought and current position." : cleanVisibleText(String(parsed.campaignPlan), 800),
    nextTurnPlan: parsed.nextTurnPlan == null ? "Next turn should reassess current state, inventory, feedback, and memory before choosing primitives." : cleanVisibleText(String(parsed.nextTurnPlan), 500),
    actions
  });
}

function sanitizeDecision(decision: unknown, request?: AgentTurnRequest, label = "decision/invalid-schema"): AgentDecision {
  try {
    return normalizeDecision(decision, request);
  } catch (error) {
    const fallback: AgentDecision = {
      thought: "The model returned an invalid action schema; falling back to a safe wait.",
      trashTalk: fallbackTrashTalk(request?.chatLanguage),
      target: null,
      campaignPlan: "Recover from invalid action schema and reassess next turn.",
      nextTurnPlan: "Read state again and choose a valid low-level action.",
      actions: [action("wait", { ms: 500 })]
    };
    if (request) {
      logAgentEvent(getRequestId(request), label, {
        error: error instanceof Error ? error.message : String(error),
        decision,
        fallback
      });
    }
    return fallback;
  }
}

function mockDecision(request: AgentTurnRequest): AgentDecision {
  const even = request.teamIndex % 2 === 0;
  const baseAngle = even ? -135 : -45;
  const wiggle = ((request.turnId * 17) % 30) - 15;
  const weapon = request.turnId % 3 === 0 ? "Hand Grenade" : "Bazooka";
  const russian = /ru|russian|рус/i.test(request.chatLanguage || "");

  return {
    thought: `MOCK AGENT: ${request.wormName || request.teamName} uses personal memory and tries a ${weapon} shot without a ballistic helper.`,
    trashTalk: russian ? "Память включена, уверенность необоснованная." : "Memory online. Confidence unjustified.",
    target: "nearest visible enemy",
    campaignPlan: "Mock agent keeps a simple pressure plan: move or shoot toward the nearest visible enemy without using a solver.",
    nextTurnPlan: "Read the next snapshot and continue pressure from the resulting position.",
    modelUsed: "mock",
    actions: [
      action("say", { text: russian ? "Мой ход. Я всё помню." : "My turn. I remember everything." }),
      action("inspect_inventory", { ms: 250 }),
      action("select_weapon", { weapon }),
      action("aim", { degrees: baseAngle + wiggle }),
      action("set_power", { percent: 62 }),
      action("fire", { observeMs: 7000 })
    ]
  };
}

interface ConnectionOverride {
  baseURL?: string;
  apiKey?: string;
}

function requestHasConnection(request?: ConnectionOverride): boolean {
  return Boolean(request && typeof request.baseURL === "string" && request.baseURL.trim());
}

function getOpenAIBaseURL(request?: ConnectionOverride): string | undefined {
  const raw = requestHasConnection(request)
    ? (request as ConnectionOverride).baseURL!.trim()
    : (process.env.OPENAI_BASE_URL || process.env.BASE_URL || process.env.API_URL);
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function getOpenAIApiKey(request?: ConnectionOverride): string | undefined {
  // A per-request connection (UI cascade) takes precedence over env entirely:
  // when the request supplies a baseURL, its apiKey is authoritative (even if
  // blank -> undefined -> mock), so a user connection is never silently mixed
  // with an env key.
  if (requestHasConnection(request)) {
    const key = typeof (request as ConnectionOverride).apiKey === "string"
      ? (request as ConnectionOverride).apiKey!.trim()
      : "";
    return key || undefined;
  }

  if (request && typeof request.apiKey === "string" && request.apiKey.trim()) {
    return request.apiKey.trim();
  }

  return getOpenAIBaseURL()
    ? process.env.API_KEY || process.env.OPENAI_API_KEY
    : process.env.OPENAI_API_KEY || process.env.API_KEY;
}

function createOpenAIClient(request?: ConnectionOverride): OpenAI {
  const apiKey = getOpenAIApiKey(request);
  if (!apiKey) {
    throw new Error("Missing OpenAI-compatible API key. Set a connection (Base URL + key) in the UI, or API_KEY / OPENAI_API_KEY.");
  }

  return new OpenAI({
    apiKey,
    baseURL: getOpenAIBaseURL(request)
  });
}

function mapModelListPage(page: any): Array<{ id: string; created?: number }> {
  const data = Array.isArray(page.data) ? page.data : [];
  return data
    .map((model: any) => ({ id: String(model.id), created: typeof model.created === "number" ? model.created : undefined }))
    .filter((model: { id: string; created?: number }) => model.id && !/embed|rerank|moderation|tts|whisper|image|audio/i.test(model.id));
}

async function listOpenAICompatibleModels(request?: ConnectionOverride): Promise<Array<{ id: string; created?: number }>> {
  // Per-request connections must never use the process-wide env cache, so a UI
  // connection switch always lists fresh from the chosen provider. A request is
  // connection-bound if it carries EITHER a base URL or an api key (e.g. testing
  // "default OpenAI + my key" must honour the typed key, not the env).
  const requestBound = Boolean(request && (
    (typeof request.baseURL === "string" && request.baseURL.trim()) ||
    (typeof request.apiKey === "string" && request.apiKey.trim())
  ));
  if (requestBound) {
    const client = createOpenAIClient(request);
    return mapModelListPage(await client.models.list());
  }

  if (!modelListPromise) {
    const client = createOpenAIClient();
    modelListPromise = client.models.list().then(mapModelListPage);
  }

  return modelListPromise;
}

// Used by the UI connection picker / "test connection" (POST /api/models).
export async function listModelsForConnection(baseURL?: string, apiKey?: string): Promise<string[]> {
  const models = await listOpenAICompatibleModels({ baseURL, apiKey });
  return models.map((model) => model.id);
}

function rankModelCandidates(models: Array<{ id: string; created?: number }>, preferences: RegExp[]): string | undefined {
  const ranked = models
    .filter((model) => preferences.some((pattern) => pattern.test(model.id)))
    .sort((a, b) => {
      const aLatest = /latest/i.test(a.id) ? 1 : 0;
      const bLatest = /latest/i.test(b.id) ? 1 : 0;
      if (aLatest !== bLatest) {
        return bLatest - aLatest;
      }

      const aCreated = a.created ?? 0;
      const bCreated = b.created ?? 0;
      if (aCreated !== bCreated) {
        return bCreated - aCreated;
      }

      return b.id.localeCompare(a.id);
    });

  return ranked[0]?.id;
}

function getTeamModel(request: AgentTurnRequest): string | undefined {
  if (request.model) {
    return request.model;
  }

  const raw = process.env.AGENT_TEAM_MODELS || process.env.OPENAI_TEAM_MODELS || "";
  if (!raw.trim()) {
    return undefined;
  }

  return raw.split(",").map((model) => model.trim()).filter(Boolean)[request.teamIndex];
}

async function chooseOpenAIModel(request: AgentTurnRequest): Promise<string> {
  const teamModel = getTeamModel(request);
  if (teamModel) {
    return teamModel;
  }

  const explicit = request.perception === "text+vision"
    ? process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL
    : process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL;

  if (explicit) {
    return explicit;
  }

  if (getOpenAIBaseURL(request)) {
    try {
      const models = await listOpenAICompatibleModels(request);
      const preferred = request.perception === "text+vision"
        ? rankModelCandidates(models, [/sonnet/i, /haiku/i, /claude/i])
        : rankModelCandidates(models, [/haiku/i, /sonnet/i, /claude/i]);
      if (preferred) {
        return preferred;
      }
    } catch {
      // Fall through to stock OpenAI default.
    }
  }

  return "gpt-5-mini";
}

function section(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`(^|\\n)## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
  return match ? match[2].trim() : "";
}

function extractInventory(request: AgentTurnRequest): string {
  return [
    "# Inventory observation",
    section(request.snapshotMarkdown, "Current combat situation").split("\n").filter((line) => /Current weapon|Aim angle|Active worm/.test(line)).join("\n"),
    "## Weapons",
    section(request.snapshotMarkdown, "Weapons") || "No weapon section found in snapshot."
  ].filter(Boolean).join("\n\n");
}

function extractSpatialRisk(request: AgentTurnRequest): string {
  return [
    "# Spatial risk observation",
    section(request.snapshotMarkdown, "Current combat situation"),
    section(request.snapshotMarkdown, "Spatial orientation"),
    section(request.snapshotMarkdown, "Terrain around active worm"),
    section(request.snapshotMarkdown, "Aim clearance fan"),
    section(request.snapshotMarkdown, "Blast and friendly-fire map"),
    section(request.snapshotMarkdown, "Non-ballistic safety notes"),
    "Reminder: this tool does not compute trajectories, target aim, shot power, or movement routes."
  ].filter(Boolean).join("\n\n");
}

function extractFeedback(request: AgentTurnRequest): string {
  return request.feedbackMarkdown?.trim()
    || section(request.snapshotMarkdown, "Engine feedback")
    || "No previous engine feedback for this agent yet.";
}

function personalityLabel(request: AgentTurnRequest): string {
  const profile = request.wormProfileMarkdown || "";
  const match = profile.match(/Personality:\s*([^\n.]+)/i);
  return (match?.[1] || request.personality || "pragmatic fighter").trim();
}

function summarizeGrudgeLines(markdown?: string): Array<{ kind: string; actor: string; relation: string; detail: string; raw: string }> {
  const lines = String(markdown || "")
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  return lines.flatMap((line) => {
    const damage = line.match(/Turn\s+\d+:\s*(.+?)\s+\((ally|enemy|self)\)\s+damaged you for\s+([\d.]+)/i);
    if (damage) {
      const relation = damage[2].toLowerCase();
      return [{
        kind: relation === "ally" ? "FRIENDLY-FIRE GRUDGE" : relation === "self" ? "SELF-OWN SHAME" : "ENEMY GRUDGE",
        actor: damage[1].trim(),
        relation,
        detail: `${damage[3]} damage`,
        raw: line
      }];
    }

    const explosion = line.match(/Turn\s+\d+:\s*(.+?)\s+\((ally|enemy|self)\)\s+caused an explosion\s+([\d.]+)\s+px from you/i);
    if (explosion) {
      const relation = explosion[2].toLowerCase();
      return [{
        kind: relation === "ally" ? "ALLY NEAR-MISS GRUDGE" : relation === "self" ? "SELF-OWN SHAME" : "ENEMY PRESSURE",
        actor: explosion[1].trim(),
        relation,
        detail: `${explosion[3]} px near explosion`,
        raw: line
      }];
    }

    if (/SELF DAMAGE|self-hit|self damage|подорвал/i.test(line)) {
      return [{
        kind: "SELF-OWN SHAME",
        actor: "self",
        relation: "self",
        detail: "remember the embarrassment",
        raw: line
      }];
    }

    return [];
  });
}

function buildGrudgeLedgerText(request: AgentTurnRequest): string {
  const personality = personalityLabel(request);
  const grudges = [
    ...summarizeGrudgeLines(request.interactionInboxMarkdown),
    ...summarizeGrudgeLines(request.wormMemoryMarkdown)
  ];
  const unique = new Map<string, { kind: string; actor: string; relation: string; detail: string; raw: string }>();
  for (const grudge of grudges) {
    unique.set(`${grudge.kind}:${grudge.actor}:${grudge.raw}`, grudge);
  }

  const lines = [
    "## Grudge ledger",
    `- Active personality for grudge interpretation: ${personality}.`,
    "- Use grudges as story pressure, not as a forced target lock. Tactical survival still matters.",
    "- Friendly fire is high-drama betrayal. Remember it longer than ordinary enemy pressure.",
    "- If revenge is unsafe, say you are delaying it, distrusting the ally, or refusing to waste the shot."
  ];

  const entries = Array.from(unique.values()).slice(-8);
  if (entries.length === 0) {
    lines.push("- No active grudge entries. Create new drama only from current events.");
  } else {
    for (const entry of entries) {
      lines.push(`- ${entry.kind}: ${entry.actor} (${entry.relation}) -> ${entry.detail}. Evidence: ${entry.raw}`);
    }
  }

  lines.push(
    "### Visible drama cues",
    "- If this ledger contains FRIENDLY-FIRE GRUDGE, ally betrayal is strong material for the public plan or a concise `say` line.",
    "- If this ledger contains SELF-OWN SHAME, embarrassment or overconfidence can color the next decision and trash talk.",
    "- Personality mapping: chaos comedian jokes about the wound; patient survivor stores the name and acts cold; reckless duelist may escalate when survivable; terrain reader cites the mistake precisely; defensive survivor chooses safety while remembering the debt."
  );

  return lines.join("\n");
}

function buildFireDisciplineText(): string {
  return [
    "## Fire risk checklist",
    "- A skipped shot is better than a meaningless self-hit or ally splash.",
    "- point-blank explosive fire into nearby terrain is a shame event, not a default move.",
    "- Facts to consider before explosive fire: aim clearance, nearby terrain, blast radius, ally separation, and whether the line is actually open.",
    "- If explosive muzzle clearance is under about 180 px, or allies are clustered near likely impact areas, treat the shot as high risk and account for it explicitly.",
    "- `wait` can spend a small amount of time without firing; it does not pass the turn by itself.",
    "- Non-explosive weapons are safer only when the line is actually clear; do not use them as fake certainty.",
    "- This checklist intentionally does not choose the alternative action for you."
  ].join("\n");
}

function buildMobilityPlanText(): string {
  return [
    "## Inventory and primitive cheatsheet",
    "- No item is a default move. Inventory descriptions are factual capabilities, costs, risks, and primitive names.",
    "- `walk` takes 1-160 primitive steps. Small counts are short key holds; large counts are longer key holds. Feedback reports actual dx/dy.",
    "- Jet Pack manual low-level mobility primitives: `jetpack_start`, `jetpack_thrust`, `jetpack_stop`.",
    "- Jet Pack activation consumes one Jet Pack ammo and creates a finite fuel pool; thrust consumes fuel and feedback reports fuel before/after.",
    "- Jet Pack screen-relative directions: `up` decreases y, `left` decreases x, `right` increases x, `up_left` combines up+left, `up_right` combines up+right.",
    "- Ninja Rope manual low-level mobility primitives: aim, `rope_fire`, `rope_contract`, `rope_expand`, `rope_swing`, `rope_release`.",
    "- Ninja Rope feedback says attached/no anchor and any actual dx/dy movement. Rope swing uses screen-relative `left`/`right` while attached.",
    "- There is no voluntary end-turn tool. If the game still gives this worm control after setup or movement, the engine calls the same worm again with fresh feedback while time remains.",
    "- No `move_to`, route solver, autopilot, guaranteed escape, or guaranteed shot. You choose direction, duration, aim, weapon, and risk yourself."
  ].join("\n");
}

function buildLongTermCampaignPlanText(): string {
  return [
    "## Planning memory fields",
    "- Every submitted turn should include `target`, `campaignPlan`, and `nextTurnPlan` fields.",
    "- They are memory, not orders. Use them to record your current intent so this same worm can remember it later.",
    "- `campaignPlan` can describe an enemy, terrain objective, survival goal, grudge, or reason for waiting instead of firing.",
    "- `nextTurnPlan` can keep, revise, or abandon the prior plan based on new feedback.",
    "- Do not treat prior plans as autopilot; re-read current state and inventory before acting."
  ].join("\n");
}

function buildMemoryText(request: AgentTurnRequest): string {
  return [
    "# Worm identity and memory",
    request.wormProfileMarkdown || `- Worm: ${request.wormName || "unknown"}.`,
    `- Memory strategy: ${request.memoryStrategy || "sliding"}.`,
    `- Memory window: ${request.memoryWindow ?? "default"}.`,
    buildGrudgeLedgerText(request),
    "## Personal worm memory",
    request.wormMemoryMarkdown || "- No personal memory for this worm yet.",
    "## Interaction inbox since this worm last acted",
    request.interactionInboxMarkdown || "- No recorded direct interactions since your last turn.",
    "## Shared visible chat history",
    request.chatHistoryMarkdown || "- Chat is empty."
  ].filter(Boolean).join("\n\n");
}

function buildPromptText(request: AgentTurnRequest): string {
  return [
    `Team: ${request.teamName}`,
    `Active worm agent id: ${request.wormId || `${request.teamIndex}:${request.wormName || "unknown"}`}`,
    `Active worm name: ${request.wormName || "unknown"}`,
    `Team personality fallback: ${request.personality}`,
    `Chat language for visible say/trashTalk: ${request.chatLanguage || "English"}. Use only this language; no translations or bilingual duplicates.`,
    `Same physical worm-turn batch: ${request.sameTurnBatch || 1}.`,
    request.turnTimeRemainingMs != null ? `Physical worm-turn time remaining: ${Math.max(0, Math.round(request.turnTimeRemainingMs / 1000))} seconds.` : "",
    "The agent has no voluntary end-turn/pass tool. The game ends this worm turn through shot resolution, death, water, mine/physics turn change, or timer expiration.",
    request.sameTurnBatch && request.sameTurnBatch > 1
      ? "Continuation warning: your previous action batch did not end this worm turn. Use the fresh feedback; do not repeat a failed mobility primitive or setup loop without new evidence. You may continue acting, inspect, fire, or wait from the current state."
      : "",
    request.model ? `Requested model: ${request.model}` : "",
    `Perception: ${request.perception}`,
    request.perception === "text+vision" && request.screenshotDataUrl
      ? "Attached before this text is the current start-of-turn screenshot centered on the active worm, with a world-coordinate grid, cyan ACTIVE WORM arrow, SELF/ALLY/ENEMY markers, team colors, active worm label, and current aim ray. Use it as visual context together with the Markdown state."
      : "",
    request.perception === "text+vision" && request.screenshotDataUrl && request.sameTurnBatch && request.sameTurnBatch > 1
      ? "This is a fresh same-turn continuation screenshot captured after your previous action batch and engine feedback; use it as the current visual position, not the earlier screenshot."
      : "",
    request.visionScreenshotPath ? `Debug copy of attached screenshot saved at: ${request.visionScreenshotPath}` : "",
    request.visionError ? `Vision error: ${request.visionError}` : "",
    buildFireDisciplineText(),
    buildLongTermCampaignPlanText(),
    buildMobilityPlanText(),
    buildMemoryText(request),
    request.snapshotMarkdown
  ]
    .filter(Boolean)
    .join("\n\n");
}

function contentForAgent(request: AgentTurnRequest): string | ChatCompletionContentPart[] {
  const text = buildPromptText(request);
  if (request.perception !== "text+vision" || !request.screenshotDataUrl) {
    return text;
  }

  return [
    {
      type: "image_url",
      image_url: { url: request.screenshotDataUrl, detail: "high" }
    },
    { type: "text", text }
  ];
}

function buildAgentInitialMessages(request: AgentTurnRequest): ChatCompletionMessageParam[] {
  return [
    { role: "user", content: PINNED_AGENT_PROMPT },
    { role: "user", content: contentForAgent(request) as any }
  ];
}

function shouldForceFirstWorldSurvey(): boolean {
  return String(process.env.AGENT_FORCE_FIRST_WORLD_SURVEY ?? "false").toLowerCase() === "true";
}

function createArenaTools(request: AgentTurnRequest, onSubmit: (decision: AgentDecision) => void) {
  const emptySchema = z.object({});

  return [
    tool(
      async () => buildMemoryText(request),
      {
        name: "read_personal_memory",
        description: "Read this worm's personal memory, static personality/tactics, interaction inbox since its last turn, and shared visible chat history.",
        schema: emptySchema
      }
    ),
    tool(
      async () => request.snapshotMarkdown,
      {
        name: "read_state",
        description: "Read the full current Markdown world snapshot: active worm, teams, inventory, terrain obstruction notes, spatial risk notes, and available primitives.",
        schema: emptySchema
      }
    ),
    tool(
      async () => extractInventory(request),
      {
        name: "inspect_inventory",
        description: "Return the selected weapon and all available weapons/ammo from the current Markdown state.",
        schema: emptySchema
      }
    ),
    tool(
      async () => extractSpatialRisk(request),
      {
        name: "assess_spatial_risk",
        description: "Return a non-ballistic spatial summary: nearest enemies/allies, left/right/up/down relation, terrain profile, straight-line aim clearance fan, and obvious self/friendly blast-risk warnings from the state. Does not calculate aim, power, trajectory, or routes.",
        schema: emptySchema
      }
    ),
    tool(
      async () => extractFeedback(request),
      {
        name: "read_feedback",
        description: "Read engine feedback from previous actions, including hit/miss, self damage, friendly fire, enemy damage, explosion points, target-relative miss notes, and movement notes.",
        schema: emptySchema
      }
    ),
    tool(
      async () => request.chatHistoryMarkdown || "- Chat is empty.",
      {
        name: "read_chat_history",
        description: "Read the shared visible chat history that all worms can see.",
        schema: emptySchema
      }
    ),
    tool(
      async (input) => {
        const decision = sanitizeDecision(input, request, "decision/invalid-submit-tool");
        onSubmit(decision);
        return JSON.stringify({ accepted: true, decision }, null, 2);
      },
      {
        name: "submit_worms_turn",
        description: "Submit the final low-level Worms turn decision as a batch of primitive actions. Use exactly once after inspecting enough state and memory.",
        schema: RawAgentDecisionSchema,
        returnDirect: true
      }
    )
  ];
}

function createLoggingMiddleware(request: AgentTurnRequest) {
  const requestId = getRequestId(request);
  let modelCall = 0;

  return createMiddleware({
    name: "ArenaFullLogging",
    wrapModelCall: async (modelRequest, handler) => {
      modelCall++;
      const forcedRequest = modelCall === 1 && shouldForceFirstWorldSurvey()
        ? {
            ...modelRequest,
            toolChoice: { type: "function" as const, function: { name: "assess_spatial_risk" } }
          }
        : modelRequest;

      logAgentEvent(requestId, `createAgent/model-${modelCall}/request`, {
        systemPrompt: forcedRequest.systemPrompt,
        systemMessage: forcedRequest.systemMessage,
        toolChoice: forcedRequest.toolChoice,
        tools: forcedRequest.tools.map((agentTool: any) => ({
          name: agentTool.name,
          description: agentTool.description,
          returnDirect: Boolean(agentTool.returnDirect)
        })),
        messages: forcedRequest.messages,
        context: forcedRequest.runtime?.context
      });

      const response = await handler(forcedRequest);
      logAgentEvent(requestId, `createAgent/model-${modelCall}/raw-response`, response);
      return response;
    },
    wrapToolCall: async (toolRequest, handler) => {
      logAgentEvent(requestId, `createAgent/tool-call/${toolRequest.toolCall.name}`, {
        toolCall: toolRequest.toolCall
      });
      const result = await handler(toolRequest);
      logAgentEvent(requestId, `createAgent/tool-result/${toolRequest.toolCall.name}`, result);
      return result;
    }
  });
}

function createChatModel(model: string, request?: ConnectionOverride): ChatOpenAI {
  const apiKey = getOpenAIApiKey(request);
  if (!apiKey) {
    throw new Error("Missing OpenAI-compatible API key. Set a connection (Base URL + key) in the UI, or API_KEY / OPENAI_API_KEY.");
  }

  return new ChatOpenAI({
    model,
    apiKey,
    configuration: {
      baseURL: getOpenAIBaseURL(request)
    },
    maxTokens: Number(process.env.OPENAI_MAX_TOKENS ?? "16000"),
    temperature: process.env.OPENAI_TEMPERATURE ? Number(process.env.OPENAI_TEMPERATURE) : undefined,
    maxRetries: Number(process.env.OPENAI_MAX_RETRIES ?? "1"),
    timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? "120000"),
    useResponsesApi: false,
    streamUsage: false,
    supportsStrictToolCalling: false
  } as any);
}

async function callCreateAgent(request: AgentTurnRequest): Promise<AgentDecision> {
  // Explicit zero-key demo: a "mock" model runs the deterministic scripted
  // agent so the arena plays to a winner with no API key configured.
  if (request.model === "mock") {
    return mockDecision(request);
  }

  if (!getOpenAIApiKey(request)) {
    return mockDecision(request);
  }

  const requestId = getRequestId(request);
  const model = await chooseOpenAIModel(request);
  let submittedDecision: AgentDecision | null = null;
  const tools = createArenaTools(request, (decision) => {
    submittedDecision = decision;
  });
  const maxModelCalls = Number(process.env.AGENT_REACT_MAX_ITERATIONS ?? "6");

  const agent = createAgent({
    model: createChatModel(model, request),
    tools,
    middleware: [
      createLoggingMiddleware(request),
      modelCallLimitMiddleware({ runLimit: maxModelCalls, exitBehavior: "end" }),
      toolCallLimitMiddleware({ runLimit: Number(process.env.AGENT_TOOL_CALL_LIMIT ?? "18"), exitBehavior: "continue" })
    ]
  });

  logAgentEvent(requestId, "provider/createAgent/request-meta", {
    provider: "langchain-createAgent-openai-compatible",
    baseURL: getOpenAIBaseURL(request) || "https://api.openai.com/v1",
    model,
    perception: request.perception,
    wormId: request.wormId,
    wormName: request.wormName,
    memoryStrategy: request.memoryStrategy,
    memoryWindow: request.memoryWindow,
    sameTurnBatch: request.sameTurnBatch,
    maxSameTurnBatches: request.maxSameTurnBatches,
    hasScreenshot: Boolean(request.screenshotDataUrl),
    screenshotBytes: request.screenshotDataUrl ? Buffer.byteLength(request.screenshotDataUrl) : 0,
    visionScreenshotPath: request.visionScreenshotPath,
    maxModelCalls,
    tools: tools.map((agentTool: any) => agentTool.name)
  });
  logAgentEvent(requestId, "pinned-prompt", PINNED_AGENT_PROMPT);
  logAgentEvent(requestId, "turn-prompt", buildPromptText(request));

  const result = await agent.invoke(
    {
      messages: buildAgentInitialMessages(request) as any
    },
    {
      configurable: {
        thread_id: `${request.matchId}:${request.wormId || `${request.teamIndex}:${request.wormName || "unknown"}`}`
      },
      context: {
        requestId,
        wormId: request.wormId,
        wormName: request.wormName,
        memoryStrategy: request.memoryStrategy
      }
    } as any
  );

  logAgentEvent(requestId, "createAgent/final-state", result);

  if (submittedDecision) {
    const decision = Object.assign({}, submittedDecision, { modelUsed: model }) as AgentDecision;
    logAgentEvent(requestId, "decision/final", decision);
    return decision;
  }

  const fallback = {
    ...sanitizeDecision({
      thought: "The createAgent loop ended without submit_worms_turn; waiting instead of guessing an invalid command.",
      trashTalk: fallbackTrashTalk(request.chatLanguage),
      actions: [{ tool: "wait", ms: 500 }]
    }, request, "decision/fallback-create-agent-no-submit"),
    modelUsed: model
  };
  logAgentEvent(requestId, "decision/fallback-create-agent-no-submit", fallback);
  return fallback;
}

export async function decideTurn(input: unknown): Promise<AgentDecision> {
  const request = AgentTurnRequestSchema.parse(input);
  const requestId = getRequestId(request);
  // Never write the user's API key to log files.
  const redacted = request.apiKey ? { ...request, apiKey: "***redacted***" } : request;
  logAgentEvent(requestId, "request/input", redacted);
  return callCreateAgent(request);
}

export {
  AgentTurnRequestSchema,
  AgentDecisionSchema,
  ActionSchema,
  normalizeDecision,
  PINNED_AGENT_PROMPT,
  buildAgentInitialMessages,
  buildAgentInitialMessages as buildOpenAIInitialMessages,
  buildAgentInitialMessages as buildAnthropicInitialMessages,
  buildPromptText,
  createArenaTools
};
