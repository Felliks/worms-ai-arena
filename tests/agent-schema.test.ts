import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentDecisionSchema,
  PINNED_AGENT_PROMPT,
  buildAnthropicInitialMessages,
  buildOpenAIInitialMessages,
  buildPromptText,
  createArenaTools,
  normalizeDecision
} from "../server/agent";

describe("agent decision schema", () => {
  it("accepts explicit inventory inspection and weapon selection primitives", () => {
    const parsed = AgentDecisionSchema.safeParse({
      thought: "Check weapons, then pick a shot.",
      trashTalk: "Inventory first, panic later.",
      actions: [
        {
          tool: "inspect_inventory",
          text: null,
          weapon: null,
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: 250,
          observeMs: null
        },
        {
          tool: "select_weapon",
          text: null,
          weapon: "Bazooka",
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: null,
          observeMs: null
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts low-level jetpack and ninja rope mobility primitives", () => {
    const parsed = AgentDecisionSchema.safeParse({
      thought: "Use mobility instead of wasting a shot.",
      trashTalk: "Лечу, а не стреляю в воду.",
      actions: [
        {
          tool: "jetpack_start",
          text: null,
          weapon: null,
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: null,
          observeMs: null
        },
        {
          tool: "jetpack_thrust",
          text: null,
          weapon: null,
          index: null,
          direction: "up_right",
          steps: null,
          degrees: null,
          percent: null,
          ms: 1200,
          observeMs: null
        },
        {
          tool: "jetpack_stop",
          text: null,
          weapon: null,
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: null,
          observeMs: null
        },
        {
          tool: "rope_fire",
          text: null,
          weapon: null,
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: null,
          observeMs: null
        },
        {
          tool: "rope_swing",
          text: null,
          weapon: null,
          index: null,
          direction: "right",
          steps: null,
          degrees: null,
          percent: null,
          ms: 900,
          observeMs: null
        },
        {
          tool: "rope_contract",
          text: null,
          weapon: null,
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: 500,
          observeMs: null
        },
        {
          tool: "rope_release",
          text: null,
          weapon: null,
          index: null,
          direction: null,
          steps: null,
          degrees: null,
          percent: null,
          ms: null,
          observeMs: null
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts explicit multi-turn campaign plans and longer purposeful walks", () => {
    const normalized = normalizeDecision({
      thought: "No sane shot; I need to keep closing distance.",
      trashTalk: "Иду ближе, потом пробью стену.",
      target: "Alan Kay",
      campaignPlan: "Travel right across the lower shelf toward Alan Kay; if the wall blocks me, open it with a safe bazooka demolition shot next turn.",
      nextTurnPlan: "Continue right unless water appears; use jump or jetpack if the ledge blocks walking.",
      actions: [
        { tool: "walk", direction: "right", steps: 140 }
      ]
    });

    expect(normalized.target).toBe("Alan Kay");
    expect(normalized.campaignPlan).toContain("Travel right");
    expect(normalized.nextTurnPlan).toContain("Continue right");
    expect(normalized.actions.find((action) => action.tool === "walk")?.steps).toBe(140);
  });
});

describe("agent decision normalization", () => {
  it("normalizes sparse model tool payloads into the engine action contract", () => {
    const normalized = normalizeDecision({
      thought: "Inspect and shoot.",
      trashTalk: "Sparse JSON still works.",
      actions: [
        { tool: "inspect_inventory" },
        { tool: "select_weapon", weapon: "Bazooka" },
        { tool: "aim", degrees: -35 },
        { tool: "set_power", percent: 70 },
        { tool: "fire", observeMs: 7000 }
      ]
    });

    expect(AgentDecisionSchema.safeParse(normalized).success).toBe(true);
    expect(normalized.actions[0]).toMatchObject({
      tool: "say",
      text: "Sparse JSON still works."
    });
    expect(normalized.actions[1]).toMatchObject({
      tool: "inspect_inventory",
      text: null,
      weapon: null,
      ms: null
    });
    expect(normalized.actions[5]).toMatchObject({
      tool: "fire",
      observeMs: 7000
    });
  });
});

describe("proxy prompt contract", () => {
  const request = {
    requestId: "test-turn",
    matchId: "test-match",
    turnId: 1,
    teamIndex: 0,
    teamName: "LLM Team 0",
    personality: "reckless aggressor",
    chatLanguage: "Russian",
    model: "claude-haiku-4-5-20251001",
    perception: "text" as const,
    snapshotMarkdown: "# Worms arena state\n\n## Current combat situation\n\n- Active worm: test.",
    feedbackMarkdown: ""
  };

  it("uses the pinned agent prompt as the first user message for OpenAI-compatible proxy calls", () => {
    const messages = buildOpenAIInitialMessages(request);

    expect(messages[0]).toEqual({ role: "user", content: PINNED_AGENT_PROMPT });
    expect(messages[1]?.role).toBe("user");
    expect(JSON.stringify(messages[1])).toContain("# Worms arena state");
    expect(JSON.stringify(messages[1])).toContain("Chat language for visible say/trashTalk: Russian");
    expect(JSON.stringify(messages)).not.toContain("\"role\":\"system\"");
  });

  it("uses the pinned agent prompt as the first user message for Anthropic calls", () => {
    const messages = buildAnthropicInitialMessages(request);

    expect(messages[0]).toEqual({ role: "user", content: PINNED_AGENT_PROMPT });
    expect(messages[1]?.role).toBe("user");
    expect(JSON.stringify(messages[1])).toContain("# Worms arena state");
    expect(JSON.stringify(messages[1])).toContain("Chat language for visible say/trashTalk: Russian");
    expect(JSON.stringify(messages)).not.toContain("\"role\":\"system\"");
  });

  it("passes VLM screenshots as an image before the turn text and describes the visual overlay", () => {
    const messages = buildOpenAIInitialMessages({
      ...request,
      perception: "text+vision" as const,
      screenshotDataUrl: "data:image/jpeg;base64,AAAA",
      visionScreenshotPath: "/tmp/vision/test.jpg"
    } as any);
    const content = messages[1]?.content as any[];

    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AAAA", detail: "high" }
    });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("current start-of-turn screenshot");
    expect(content[1].text).toContain("centered on the active worm");
    expect(content[1].text).toContain("world-coordinate grid");
    expect(content[1].text).toContain("cyan ACTIVE WORM arrow");
    expect(content[1].text).toContain("SELF/ALLY/ENEMY markers");
    expect(content[1].text).toContain("/tmp/vision/test.jpg");
  });
});

describe("createAgent turn context", () => {
  const request = {
    requestId: "test-turn-memory",
    matchId: "test-match",
    turnId: 7,
    teamIndex: 1,
    teamName: "LLM Team 1",
    personality: "defensive survivor",
    chatLanguage: "Russian",
    model: "claude-sonnet-4-6",
    perception: "text" as const,
    wormId: "team-1:Grace Hopper",
    wormName: "Grace Hopper",
    wormProfileMarkdown: "## Worm profile\n- Personality: terrain reader.",
    wormMemoryMarkdown: "### Recent personal turns\n- Turn 3: self-hit with Bazooka; avoid close wall shots.",
    chatHistoryMarkdown: "- Turn 4, Ada Lovelace: Я тебя вижу.",
    interactionInboxMarkdown: "- Turn 6: Alan Turing (enemy) caused an explosion 95 px from you.",
    memoryStrategy: "summary" as const,
    memoryWindow: 9,
    snapshotMarkdown: "# Worms arena state\n\n## Current combat situation\n\n- Active worm: Grace Hopper.",
    feedbackMarkdown: "## Engine feedback\n\n- Miss feedback: explosion was short."
  };

  it("injects worm identity, personal memory, interaction inbox, and shared chat into the first user turn", () => {
    const prompt = buildPromptText(request);

    expect(prompt).toContain("Active worm agent id: team-1:Grace Hopper");
    expect(prompt).toContain("Memory strategy: summary");
    expect(prompt).toContain("Memory window: 9");
    expect(prompt).toContain("self-hit with Bazooka");
    expect(prompt).toContain("caused an explosion 95 px from you");
    expect(prompt).toContain("Ada Lovelace");
    expect(prompt).toContain("Use only this language; no translations or bilingual duplicates");
  });

  it("turns ally damage history into an explicit grudge ledger and drama cues", () => {
    const prompt = buildPromptText({
      ...request,
      wormProfileMarkdown: "## Worm profile\n- Personality: patient survivor.",
      interactionInboxMarkdown: [
        "- Turn 6: Phil Katz (ally) damaged you for 21.2 with `fire`; estimated HP after queued damage 58.",
        "- Turn 6: Alan Kay (enemy) caused an explosion 301 px from you at (4330, 1440), radius 80."
      ].join("\n")
    });

    expect(prompt).toContain("## Grudge ledger");
    expect(prompt).toContain("FRIENDLY-FIRE GRUDGE");
    expect(prompt).toContain("Phil Katz");
    expect(prompt).toContain("21.2");
    expect(prompt).toContain("patient survivor");
    expect(prompt).toContain("Visible drama cues");
    expect(prompt).toContain("ally betrayal is strong material");
  });

  it("describes fire risk without turning mobility into the default answer", () => {
    const prompt = buildPromptText(request);

    expect(prompt).toContain("## Fire risk checklist");
    expect(prompt).toContain("A skipped shot is better than a meaningless self-hit");
    expect(prompt).toContain("under about 180 px");
    expect(prompt).toContain("Facts to consider before explosive fire");
    expect(prompt).toContain("point-blank explosive fire into nearby terrain");
    expect(prompt).not.toContain("Prefer walk, jump, backflip, wait, or end_turn");
    expect(prompt).not.toContain("prefer closing distance");
    expect(prompt).not.toContain("movement is the default tactical action");
  });

  it("exposes real jetpack and ninja rope primitives instead of treating them as MVP placeholders", () => {
    const prompt = buildPromptText(request);

    expect(prompt).toContain("jetpack_start");
    expect(prompt).toContain("jetpack_thrust");
    expect(prompt).toContain("rope_fire");
    expect(prompt).toContain("rope_swing");
    expect(prompt).toContain("rope_contract");
    expect(prompt).toContain("rope_release");
    expect(prompt).toContain("manual low-level mobility primitives");
    expect(prompt).toContain("screen-relative directions");
    expect(prompt).toContain("consumes one Jet Pack ammo");
    expect(prompt).toContain("There is no voluntary end-turn tool");
    expect(prompt).not.toContain("no dedicated agent piloting primitive yet");
    expect(prompt).not.toContain("fire may waste the turn");
    expect(prompt).not.toContain("Use them when no sane shot exists");
  });

  it("keeps campaign plans as memory fields without hardcoded travel strategy", () => {
    const prompt = buildPromptText(request);

    expect(prompt).toContain("## Planning memory fields");
    expect(prompt).toContain("campaignPlan");
    expect(prompt).toContain("nextTurnPlan");
    expect(prompt).toContain("They are memory, not orders");
    expect(prompt).not.toContain("40-120");
    expect(prompt).not.toContain("terrain-opening shot for the next turn");
    expect(prompt).not.toContain("prefer meaningful travel");
  });

  it("tells createAgent when it is continuing the same physical worm turn", () => {
    const prompt = buildPromptText({
      ...request,
      sameTurnBatch: 3,
      maxSameTurnBatches: 4,
      turnTimeRemainingMs: 93000
    });

    expect(prompt).toContain("Same physical worm-turn batch: 3.");
    expect(prompt).toContain("Physical worm-turn time remaining: 93 seconds");
    expect(prompt).toContain("no voluntary end-turn/pass tool");
    expect(prompt).toContain("Continuation warning");
    expect(prompt).toContain("Use the fresh feedback");
    expect(prompt).toContain("do not repeat a failed mobility primitive");
    expect(prompt).not.toContain("include `fire` if prepared or `end_turn`");
  });

  it("exposes submit_worms_turn as the return-direct final tool and maps removed end_turn to wait", async () => {
    let submitted: unknown = null;
    const tools = createArenaTools(request, (decision) => {
      submitted = decision;
    });
    const submitTool = tools.find((agentTool: any) => agentTool.name === "submit_worms_turn") as any;

    expect(submitTool).toBeTruthy();
    expect(submitTool.returnDirect).toBe(true);

    const result = await submitTool.invoke({
      thought: "Use memory, then wait briefly.",
      trashTalk: "Помню прошлый провал.",
      actions: [{ tool: "end_turn" }]
    });

    const parsedResult = JSON.parse(String(result));
    expect(parsedResult.accepted).toBe(true);
    expect(submitted).toMatchObject({
      trashTalk: "Помню прошлый провал.",
      actions: [
        { tool: "say", text: "Помню прошлый провал." },
        { tool: "wait", text: null, ms: null }
      ]
    });
  });

  it("does not force a first tool call by default so createAgent can choose its ReAct order", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "server", "agent.ts"), "utf8");

    expect(source).toContain('process.env.AGENT_FORCE_FIRST_WORLD_SURVEY ?? "false"');
    expect(source).not.toContain('process.env.AGENT_FORCE_FIRST_WORLD_SURVEY ?? "true"');
  });

  it("accepts verbose model plans without failing tool schema validation", async () => {
    let submitted: any = null;
    const tools = createArenaTools(request, (decision) => {
      submitted = decision;
    });
    const submitTool = tools.find((agentTool: any) => agentTool.name === "submit_worms_turn") as any;
    const longThought = "terrain ".repeat(260);

    const result = await submitTool.invoke({
      thought: longThought,
      trashTalk: "Слишком много думаю, всё равно прыгаю.",
      actions: [{ tool: "jump" }, { tool: "wait", ms: 500 }]
    });

    expect(JSON.parse(String(result)).accepted).toBe(true);
    expect(submitted.thought).toBe(longThought);
    expect(submitted.actions).toMatchObject([
      { tool: "say", text: "Слишком много думаю, всё равно прыгаю." },
      { tool: "jump" },
      { tool: "wait", ms: 500 }
    ]);
  });

  it("clamps dirty numeric tool arguments instead of failing schema validation", async () => {
    let submitted: any = null;
    const tools = createArenaTools(request, (decision) => {
      submitted = decision;
    });
    const submitTool = tools.find((agentTool: any) => agentTool.name === "submit_worms_turn") as any;

    await submitTool.invoke({
      thought: "Clamp this.",
      actions: [
        { tool: "walk", direction: "left", steps: 150 },
        { tool: "aim", degrees: "-240" },
        { tool: "set_power", percent: "140" },
        { tool: "fire", observeMs: 12000 },
        { tool: "dance", ms: 1 }
      ]
    });

    expect(submitted.actions).toMatchObject([
      { tool: "walk", direction: "left", steps: 150 },
      { tool: "aim", degrees: -179 },
      { tool: "set_power", percent: 100 },
      { tool: "fire", observeMs: 9000 },
      { tool: "wait", ms: 100 }
    ]);
  });

  it("cleans leaked tool wrapper suffixes from visible chat without rejecting the decision", async () => {
    let submitted: any = null;
    const tools = createArenaTools(request, (decision) => {
      submitted = decision;
    });
    const submitTool = tools.find((agentTool: any) => agentTool.name === "submit_worms_turn") as any;

    await submitTool.invoke({
      thought: "Raw model text can be messy; logs keep it raw, UI should stay readable.",
      trashTalk: "Слишком предсказуемо. Сейчас найду вас.\\\"}\\n",
      actions: [
        { tool: "say", text: "Вот и получите!\\\"} </invoke>" },
        { tool: "end_turn" }
      ]
    });

    expect(submitted.trashTalk).toBe("Слишком предсказуемо. Сейчас найду вас.");
    expect(submitted.actions).toMatchObject([
      { tool: "say", text: "Вот и получите!" },
      { tool: "wait" }
    ]);
  });

  it("strips English translation parentheticals from non-English visible chat", async () => {
    let submitted: any = null;
    const tools = createArenaTools(request, (decision) => {
      submitted = decision;
    });
    const submitTool = tools.find((agentTool: any) => agentTool.name === "submit_worms_turn") as any;

    await submitTool.invoke({
      thought: "Keep Russian chat clean.",
      trashTalk: "Позиция закрыта. (Position is blocked.)",
      actions: [
        { tool: "say", text: "Ухожу вправо. (Moving right.)" },
        { tool: "walk", direction: "right", steps: 60 }
      ]
    });

    expect(submitted.trashTalk).toBe("Позиция закрыта.");
    expect(submitted.actions).toMatchObject([
      { tool: "say", text: "Ухожу вправо." },
      { tool: "walk", direction: "right", steps: 60 }
    ]);
  });
});
