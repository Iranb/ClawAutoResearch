#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  return fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArgValue(argv, name, fallback = null) {
  const raw = argValue(argv, name, null);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstPositional(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current.startsWith("--")) {
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        index += 1;
      }
      continue;
    }
    return current;
  }
  return null;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "topic";
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replaceAll(":", "").replace(/\.\d+Z$/, "Z");
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

export function normalizeAutoWorkflowCommand(value) {
  const token = normalizeToken(value || "full");
  if (["full", "both", "all"].includes(token)) {
    return {
      requestedCommand: value || "full",
      canonicalCommand: "full",
      displayCommand: "full",
      lane: "full",
    };
  }
  if (["autoresearch", "auto-research", "research", "experiment"].includes(token)) {
    return {
      requestedCommand: value || "/auto-research",
      canonicalCommand: "auto-research",
      displayCommand: "/auto-research",
      lane: "experiment",
    };
  }
  if (["autoreview", "auto-review", "review", "survey"].includes(token)) {
    return {
      requestedCommand: value || "/auto-review",
      canonicalCommand: "auto-review",
      displayCommand: "/auto-review",
      lane: "survey",
    };
  }
  throw new Error(
    `Unknown auto workflow command "${value}". Use /autoresearch, /auto-research, /autoreview, /auto-review, or full.`
  );
}

export function normalizeAutoWorkflowMode(value) {
  const token = normalizeToken(value || "live");
  if (["live", "real", "runtime"].includes(token)) {
    return "live";
  }
  if (["fixture", "deterministic", "mock", "regression"].includes(token)) {
    return "fixture";
  }
  throw new Error(`Unknown E2E mode "${value}". Use live/real or fixture/deterministic.`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(name) {
  const pathEntries = String(process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const candidates =
    process.platform === "win32"
      ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
      : [name];
  for (const directory of pathEntries) {
    for (const candidate of candidates) {
      const filePath = path.join(directory, candidate);
      try {
        await fs.access(filePath, fs.constants.X_OK);
        return filePath;
      } catch {}
    }
  }
  return null;
}

async function runProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  const timeoutMs = options.timeoutMs ?? 0;
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    stdout.push(text);
    options.onStdout?.(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderr.push(text);
    options.onStderr?.(text);
  });

  const exit = await new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({ code: 127, signal: null, error });
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal, error: null });
    });
  });
  if (timer) {
    clearTimeout(timer);
  }
  return {
    code: timedOut ? 124 : exit.code,
    signal: exit.signal,
    error: exit.error,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    timedOut,
  };
}

function parseJsonPayload(rawText) {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function summarizeLane(name, value) {
  if (!value) {
    return null;
  }
  return {
    lane: name,
    transport: value.transport ?? null,
    projectRoot: value.projectRoot ?? null,
    finalVerdict: value.harness?.finalVerdict ?? null,
    strictContent: value.harness?.strictContent ?? null,
    reportPath: value.harness?.reportPath ?? null,
    checklistPath: value.harness?.checklistPath ?? null,
    timelinePath: value.harness?.timelinePath ?? null,
    turnCount: Array.isArray(value.turns) ? value.turns.length : null,
    turns: Array.isArray(value.turns)
      ? value.turns.map((turn) => ({
          stage: turn.stage ?? null,
          owner: turn.owner ?? null,
          progressed: turn.progressed ?? null,
          progressReason: turn.progressReason ?? null,
        }))
      : [],
    handoffCount: Array.isArray(value.handoffs) ? value.handoffs.length : null,
  };
}

function summarizePayload(payload) {
  const result = payload?.result ?? {};
  const lanes = [
    summarizeLane("experiment", result.experiment),
    summarizeLane("survey", result.survey),
  ].filter(Boolean);
  return {
    topic: payload?.topic ?? null,
    lane: payload?.lane ?? null,
    mode: payload?.mode ?? null,
    bootstrapTransport: payload?.bootstrapTransport ?? null,
    projectsRoot: payload?.projectsRoot ?? null,
    lanes,
  };
}

function verdictStatus(summary, allowPartial) {
  if (!summary?.lanes?.length) {
    return "fail";
  }
  const verdicts = summary.lanes.map((lane) => lane.finalVerdict ?? "missing");
  if (verdicts.every((verdict) => verdict === "pass")) {
    return "pass";
  }
  if (allowPartial && verdicts.every((verdict) => verdict === "pass" || verdict === "partial")) {
    return "partial";
  }
  return "fail";
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function preflight(params) {
  const checks = [];
  const packageJsonPath = path.join(repoRoot, "package.json");
  checks.push({
    name: "repo_package_json",
    ok: await pathExists(packageJsonPath),
    detail: packageJsonPath,
  });
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node_version",
    ok: Number.isFinite(nodeMajor) && nodeMajor >= 18,
    detail: process.versions.node,
  });

  if (params.mode === "live") {
    const openclawPath = await findExecutable("openclaw");
    checks.push({
      name: "openclaw_cli",
      ok: Boolean(openclawPath),
      detail: openclawPath ?? "not found in PATH",
    });
    if (params.isolatedGateway) {
      checks.push({
        name: "source_openclaw_config",
        ok: await pathExists(params.sourceConfigPath),
        detail: params.sourceConfigPath,
      });
    }
  }

  return checks;
}

function formatHumanSummary(summary) {
  const lines = [
    `Auto workflow E2E: ${summary.status}`,
    `command: ${summary.command.displayCommand}`,
    `topic: ${summary.topic}`,
    `mode: ${summary.mode}`,
    `run root: ${summary.runRoot}`,
    `projects root: ${summary.projectsRoot}`,
    `summary: ${summary.summaryPath}`,
  ];
  for (const lane of summary.result.lanes) {
    lines.push(
      "",
      `${lane.lane}: ${lane.finalVerdict ?? "missing"}`,
      `project: ${lane.projectRoot ?? "unknown"}`,
      `report: ${lane.reportPath ?? "unknown"}`
    );
    if (lane.turnCount !== null) {
      lines.push(`turns: ${lane.turnCount}`);
    }
    if (lane.handoffCount !== null) {
      lines.push(`handoffs: ${lane.handoffCount}`);
    }
  }
  if (summary.failureReason) {
    lines.push("", `failure: ${summary.failureReason}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv) {
  const command = normalizeAutoWorkflowCommand(
    argValue(argv, "--command", null) ?? firstPositional(argv) ?? "full"
  );
  const topic = argValue(argv, "--topic", "Generalized Category Discovery");
  const mode = normalizeAutoWorkflowMode(argValue(argv, "--mode", "live"));
  const bootstrapTransport = argValue(argv, "--bootstrap-transport", "local");
  const profile = argValue(argv, "--profile", null);
  const sourceConfigPath =
    argValue(argv, "--source-config-path", null) ??
    (profile === "dev"
      ? path.join(os.homedir(), ".openclaw-dev", "openclaw.json")
      : path.join(os.homedir(), ".openclaw", "openclaw.json"));
  const timestamp = timestampSlug();
  const runRoot = path.resolve(
    argValue(
      argv,
      "--run-root",
      path.join(repoRoot, ".openclaw-research", "e2e-runs", `${timestamp}-${command.lane}-${slugify(topic)}`)
    )
  );
  const projectsRoot = path.resolve(argValue(argv, "--projects-root", path.join(runRoot, "projects")));
  const jsonOutput = hasFlag(argv, "--json");
  const quiet = hasFlag(argv, "--quiet") || jsonOutput;
  const allowPartial = hasFlag(argv, "--allow-partial");
  const noPreflight = hasFlag(argv, "--no-preflight");
  const isolatedGateway = !hasFlag(argv, "--no-isolated-gateway");
  const timeoutMs = numberArgValue(argv, "--timeout-ms", mode === "live" ? 45 * 60_000 : 5 * 60_000);
  const maxIterations = numberArgValue(argv, "--max-iterations", null);
  const gatewayStartupTimeoutMs = numberArgValue(argv, "--gateway-startup-timeout-ms", null);

  await fs.mkdir(runRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });

  const preflightChecks = noPreflight
    ? [{ name: "preflight", ok: true, detail: "skipped" }]
    : await preflight({ mode, sourceConfigPath, isolatedGateway });
  const preflightOk = preflightChecks.every((entry) => entry.ok);

  const childArgs = [
    path.join(repoRoot, "scripts", "run_auto_command_end_to_end.mjs"),
    "--topic",
    topic,
    "--lane",
    command.lane,
    "--mode",
    mode,
    "--bootstrap-transport",
    bootstrapTransport,
    "--projects-root",
    projectsRoot,
  ];
  if (profile) {
    childArgs.push("--profile", profile);
  }
  if (sourceConfigPath) {
    childArgs.push("--source-config-path", sourceConfigPath);
  }
  const gatewayUrl = argValue(argv, "--gateway-url", null);
  const gatewayToken = argValue(argv, "--gateway-token", null);
  if (gatewayUrl) {
    childArgs.push("--gateway-url", gatewayUrl);
  }
  if (gatewayToken) {
    childArgs.push("--gateway-token", gatewayToken);
  }
  if (maxIterations !== null) {
    childArgs.push("--max-iterations", String(maxIterations));
  }
  if (gatewayStartupTimeoutMs !== null) {
    childArgs.push("--gateway-startup-timeout-ms", String(gatewayStartupTimeoutMs));
  }
  if (!isolatedGateway) {
    childArgs.push("--no-isolated-gateway");
  }

  const startedAt = new Date().toISOString();
  await writeText(
    path.join(runRoot, "command.txt"),
    [`node ${childArgs.map((part) => JSON.stringify(part)).join(" ")}`, ""].join("\n")
  );

  let child = {
    code: 1,
    stdout: "",
    stderr: "",
    timedOut: false,
    error: null,
  };
  let payload = null;
  let resultSummary = { topic, lane: command.lane, mode, bootstrapTransport, projectsRoot, lanes: [] };
  let failureReason = null;

  if (!preflightOk) {
    failureReason = "preflight_failed";
  } else {
    child = await runProcess(process.execPath, childArgs, {
      cwd: repoRoot,
      timeoutMs,
      onStdout: quiet ? null : (text) => process.stdout.write(text),
      onStderr: quiet ? null : (text) => process.stderr.write(text),
    });
    payload = parseJsonPayload(child.stdout);
    if (payload) {
      resultSummary = summarizePayload(payload);
    }
    if (child.timedOut) {
      failureReason = "timeout";
    } else if (child.error) {
      failureReason = child.error.message;
    } else if (child.code !== 0) {
      failureReason = `child_exit_${child.code}`;
    } else if (!payload) {
      failureReason = "missing_json_payload";
    }
  }

  const status =
    failureReason === null
      ? verdictStatus(resultSummary, allowPartial)
      : "fail";
  if (status === "fail" && failureReason === null) {
    failureReason = "final_verdict_not_pass";
  }

  const finishedAt = new Date().toISOString();
  const summaryPath = path.join(runRoot, "AUTO_WORKFLOW_E2E_SUMMARY.json");
  const markdownSummaryPath = path.join(runRoot, "AUTO_WORKFLOW_E2E_SUMMARY.md");
  const summary = {
    status,
    failureReason,
    startedAt,
    finishedAt,
    command,
    topic,
    mode,
    bootstrapTransport,
    runRoot,
    projectsRoot,
    preflight: preflightChecks,
    child: {
      code: child.code,
      signal: child.signal ?? null,
      timedOut: child.timedOut,
    },
    result: resultSummary,
    summaryPath,
    markdownSummaryPath,
    stdoutPath: path.join(runRoot, "stdout.log"),
    stderrPath: path.join(runRoot, "stderr.log"),
    payloadPath: path.join(runRoot, "payload.json"),
  };

  await Promise.all([
    writeText(summary.stdoutPath, child.stdout ?? ""),
    writeText(summary.stderrPath, child.stderr ?? ""),
    writeText(summaryPath, `${JSON.stringify(summary, null, 2)}\n`),
    writeText(summary.payloadPath, payload ? `${JSON.stringify(payload, null, 2)}\n` : "null\n"),
    writeText(markdownSummaryPath, formatHumanSummary(summary)),
  ]);

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(formatHumanSummary(summary));
  }

  if (status === "fail") {
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await main();
}
