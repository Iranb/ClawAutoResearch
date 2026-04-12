#!/usr/bin/env node
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const passthrough = [];
  let silenceTimeoutSeconds = 45;
  let startupGraceSeconds = 8;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--silence-timeout-seconds") {
      silenceTimeoutSeconds = Math.max(1, Number(argv[index + 1] ?? 45));
      index += 1;
      continue;
    }
    if (value === "--startup-grace-seconds") {
      startupGraceSeconds = Math.max(0, Number(argv[index + 1] ?? 8));
      index += 1;
      continue;
    }
    passthrough.push(value);
  }
  return { passthrough, silenceTimeoutSeconds, startupGraceSeconds };
}

const { passthrough, silenceTimeoutSeconds, startupGraceSeconds } = parseArgs(
  process.argv.slice(2)
);

const child = spawn("openclaw", ["agent", ...passthrough], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

const startedAt = Date.now();
let lastOutputAt = startedAt;
let stdout = "";
let stderr = "";
let finished = false;

function markOutput(chunk, sink) {
  const text = String(chunk ?? "");
  if (!text) {
    return;
  }
  lastOutputAt = Date.now();
  if (sink === "stdout") {
    stdout += text;
  } else {
    stderr += text;
  }
}

child.stdout.on("data", (chunk) => markOutput(chunk, "stdout"));
child.stderr.on("data", (chunk) => markOutput(chunk, "stderr"));

const silenceTimer = setInterval(() => {
  if (finished) {
    return;
  }
  const now = Date.now();
  if (now - startedAt < startupGraceSeconds * 1000) {
    return;
  }
  if (now - lastOutputAt < silenceTimeoutSeconds * 1000) {
    return;
  }
  finished = true;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 2000).unref();
  const payload = {
    status: "timed_out_silent",
    exitCode: null,
    signal: "SIGTERM",
    durationMs: now - startedAt,
    silenceTimeoutSeconds,
    startupGraceSeconds,
    stdout,
    stderr,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  clearInterval(silenceTimer);
}, 1000);

child.on("error", (error) => {
  if (finished) {
    return;
  }
  finished = true;
  clearInterval(silenceTimer);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "spawn_error",
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        silenceTimeoutSeconds,
        startupGraceSeconds,
        stdout,
        stderr,
        error: String(error?.message ?? error),
      },
      null,
      2
    )}\n`
  );
});

child.on("close", (code, signal) => {
  if (finished) {
    return;
  }
  finished = true;
  clearInterval(silenceTimer);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: code === 0 ? "ok" : "failed",
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt,
        silenceTimeoutSeconds,
        startupGraceSeconds,
        stdout,
        stderr,
      },
      null,
      2
    )}\n`
  );
});
