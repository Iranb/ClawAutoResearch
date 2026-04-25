#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const parsed = {
    projectRoot: null,
    latest: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-root") {
      parsed.projectRoot = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--latest") {
      parsed.latest = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
    }
  }
  return parsed;
}

function relayPath(projectRoot) {
  return path.join(projectRoot, ".openclaw-research", "workflow-local-operator-relay.jsonl");
}

async function readRelayEntries(projectRoot) {
  try {
    const raw = await fs.readFile(relayPath(projectRoot), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function formatEntry(entry) {
  const lines = [
    `# Local Operator Relay: ${entry.summary ?? entry.kind ?? "workflow task"}`,
    "",
    `- recorded_at: ${entry.recordedAt ?? "unknown"}`,
    `- project_root: ${entry.projectRoot ?? "unknown"}`,
    entry.projectId ? `- project_id: ${entry.projectId}` : null,
    entry.queueKey ? `- queue_key: ${entry.queueKey}` : null,
    entry.sessionKey ? `- session_key: ${entry.sessionKey}` : null,
    entry.ownerAgent ? `- owner_agent: ${entry.ownerAgent}` : null,
    entry.stage ? `- stage: ${entry.stage}` : null,
    entry.cooldownUntil ? `- cooldown_until: ${entry.cooldownUntil}` : null,
    "",
    "## Reason",
    "",
    entry.reason ?? "No reason recorded.",
    "",
    "## Operator Prompt",
    "",
    entry.operatorPrompt ?? "",
  ].filter((line) => line != null);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectRoot) {
    console.error("Usage: node scripts/workflow_local_operator_relay.mjs --project-root <projectRoot> [--latest] [--json]");
    process.exitCode = 2;
    return;
  }
  const projectRoot = path.resolve(args.projectRoot);
  const entries = await readRelayEntries(projectRoot);
  const selected = args.latest ? entries.slice(-1) : entries;
  if (args.json) {
    console.log(JSON.stringify(selected, null, 2));
    return;
  }
  if (selected.length === 0) {
    console.log("No local operator relay entries.");
    return;
  }
  console.log(selected.map(formatEntry).join("\n---\n"));
}

await main();
