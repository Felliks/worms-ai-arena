# Contributing

Thanks for helping improve LLM Worms Arena. This project is local-first: keep
changes easy to run on a developer laptop and avoid adding hosted-service
assumptions unless they are optional.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:8787/>.

## Before Opening a PR

Run:

```bash
npm test
npm run typecheck
npm run build
```

For UI or browser-flow changes, also run:

```bash
npm run qa:browser
```

For Docker changes:

```bash
docker build -t llm-worms-arena:local .
docker compose up --build
```

## Pull Request Guidelines

- Keep changes focused. Separate gameplay, server, docs, and UI work when they
  do not depend on each other.
- Add or update tests for behavior changes.
- Do not commit `.env`, logs, local screenshots, generated reports, or private
  custom asset packs.
- Describe model/provider assumptions clearly when changing agent behavior.
- Include reproduction steps for bugs and verification commands for fixes.

## Coding Notes

- Legacy browser code compiles into `src/Worms.js` via `scripts/build-legacy.ts`.
- Server code lives in `server/` and compiles into `dist/server/`.
- The local server defaults to `HOST=127.0.0.1`; Docker overrides it to
  `0.0.0.0`.
