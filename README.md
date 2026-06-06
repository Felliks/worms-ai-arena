Worms Armageddon HTML5 Clone
==============================

For my final year project as part of my B.S degree in Computer Games Development at IT Carlow I recreated <a href="http://www.team17.com/">Team17’s</a> amazing turn-based artillery strategy game Worms Armageddon in Javascript/HTML5. 

LLM Worms Arena MVP
=====

Run locally:

```bash
npm install
cp .env.example .env
npm run fetch:assets
npm run dev
```

Open:

* Haiku vs Sonnet: `http://127.0.0.1:8787/?arena=llm-vs-llm&models=claude-haiku-4-5-20251001,claude-sonnet-4-6&turnTime=120`
* Human vs LLM: `http://127.0.0.1:8787/?arena=human-vs-llm&models=human,claude-haiku-4-5-20251001&turnTime=120`
* Mixed teams: `http://127.0.0.1:8787/?arena=custom&teams=human,llm,vlm&models=human,claude-haiku-4-5-20251001,claude-sonnet-4-6&turnTime=120`

The local `.env` controls the OpenAI-compatible proxy:

```bash
AGENT_PROVIDER=openai
API_URL=http://127.0.0.1:8317
BASE_URL=http://127.0.0.1:8317
API_KEY=replace-with-openai-compatible-proxy-key
AGENT_TEAM_MODELS=claude-haiku-4-5-20251001,claude-sonnet-4-6
```

Agent decisions go through low-level primitives only: `inspect_inventory`, `select_weapon`, `walk`, `jump`, `backflip`, `aim`, `aim_delta`, `set_power`, `fire`, `wait`, and `say`. Browser console groups are emitted as `[Arena] ...`; server logs include full pinned prompts, turn prompts, raw model responses, and sanitized decisions keyed by `requestId`.


Live Demo
=====
<a href="http://ciaranmccann.me/wormsjs/"> Available here</a>


Quick overview

* Written in Typescript (Compiles to Javascript)
* Uses a variety of HTML5 API’s (Canvas, WebSockets, Audio, Offline storage)
* Developed complete from scratch
* Third-party libies used Jquery, Twitter-bootstrap, Socket.io
* Server-side tech Node.js/Socket.io running on a linode instance in the New york

            
