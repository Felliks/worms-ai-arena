# LLM Worms Arena MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local browser MVP where the existing Worms clone can be controlled by human, text LLM, and VLM participants and can play to a winner.

**Architecture:** Keep the existing Worms clone as the game. Modernize the 2013 build path enough to generate `src/Worms.js` and serve `index.htm`; do not replace gameplay or visuals. Browser owns the original simulation; Node/Express owns LangGraph agent decisions. Participants all use the same primitive action schema mapped onto existing `Player`, `Worm`, `Target`, `WeaponManager`, and `InstructionChain` methods.

**Tech Stack:** Legacy global TypeScript, Canvas 2D, Box2DWeb, Express, LangGraph.js, LangChain tool schemas, Zod, Vitest, Playwright.

---

### Task 1: Legacy Build Revival

- [ ] Add `package.json`, TypeScript configs, and a local dev server.
- [ ] Generate `src/Worms.js` for the original `index.htm`.
- [ ] Keep the original game as the rendered experience.

### Task 2: Compatibility Refactor

- [ ] Fix old TypeScript syntax and same-origin asset loading issues that block local execution.
- [ ] Preserve global namespace behavior; do not migrate to ES modules unless required.
- [ ] Add small APIs to expose current aim/power/weapon state without changing game behavior.

### Task 3: LLM/VLM Controller In The Original Game

- [ ] Add participant config for `human`, `llm_text`, `vlm`, and `mock_model`.
- [ ] Execute model actions through existing primitive methods.
- [ ] Add a compact overlay for model thoughts, trash talk, snapshots, and feedback without hiding the game.

### Task 4: LangGraph Agent Server

- [ ] Add `POST /api/turn` with LangGraph-based model decision flow.
- [ ] Bind action tools and support multiple tool calls per request plus batch action chains.
- [ ] Add provider detection for OpenAI API key and a mock fallback for local verification.

### Task 5: Feedback Loop

- [ ] For model teams, request action, execute returned chain, append feedback, and either request again or end the turn.
- [ ] Respect per-turn action budget without real-time projectile reaction.
- [ ] Show public plan text and trash talk in chat.

### Task 6: Tests and QA

- [ ] Add Vitest coverage for terrain/projectile/damage, turn rotation, snapshots, feedback, and agent action extraction.
- [ ] Run typecheck/build/tests.
- [ ] Use browser automation to verify the original game renders and a mock-model match reaches a winner.
