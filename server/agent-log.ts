import fs from "node:fs";
import path from "node:path";

const logDir = path.resolve(process.env.AGENT_LOG_DIR || "logs");
const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = path.join(logDir, `agent-${startedAt}-${process.pid}.log`);

function shouldWriteFileLog(): boolean {
  return String(process.env.AGENT_FILE_LOGS ?? "true").toLowerCase() !== "false";
}

function ensureLogDir() {
  if (!shouldWriteFileLog()) {
    return;
  }

  fs.mkdirSync(logDir, { recursive: true });
}

function serialize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function getAgentLogFile(): string {
  ensureLogDir();
  return logFile;
}

export function logAgentEvent(requestId: string, label: string, value: unknown) {
  const rendered = serialize(value);
  const entry = [
    `\n===== ${new Date().toISOString()} [agent:${requestId}] ${label} =====`,
    rendered,
    `===== end ${label} =====\n`
  ].join("\n");

  if (shouldWriteFileLog()) {
    ensureLogDir();
    fs.appendFileSync(logFile, entry, "utf8");
  }

  if (String(process.env.AGENT_CONSOLE_LOGS ?? "true").toLowerCase() !== "false") {
    console.log(`[agent:${requestId}] ${label}`);
    console.log(rendered);
  }
}
