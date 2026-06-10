# Security Policy

LLM Worms Arena is designed for local use. Do not expose it directly to the
public internet without adding authentication, rate limiting, and reverse-proxy
hardening.

## Supported Versions

Security fixes target the default branch.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting when it is enabled for the repository,
or contact a maintainer privately. Do not post API keys, private prompts, model
responses, screenshots, or reproduction logs in public issues.

## Secret Handling

- Put provider keys in `.env` or the in-game connection editor.
- Never commit `.env`, logs, or browser storage exports.
- The local model proxy redacts request connection keys from server logs.
- Agent logs can include prompts, model responses, screenshots, and game state.
  Keep `logs/` private.

## Local Server Defaults

The Node server binds to `127.0.0.1` by default. Docker sets `HOST=0.0.0.0`
inside the container so the published local port works.
