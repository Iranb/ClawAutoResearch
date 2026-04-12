import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { refreshExperimentGpuMonitor } from "../tools/workflow-gpu-monitor.ts";

async function makeProjectRoot() {
  return await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-gpu-monitor-priority-")
  );
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeExecutable(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, { mode: 0o755 });
}

test("refreshExperimentGpuMonitor prioritizes stable result summaries over live shell heuristics", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '0, NVIDIA RTX 4090, 15000, 24576, 80\\n'",
      "printf '\\n---SCREENS---\\n'",
      "printf 'There is a screen on:\\n'",
      "printf '\\t2222.stale-run\\t(Detached)\\n'",
      "printf '1 Socket in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;

  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-3",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "stale-run",
    status: "running",
  });
  const resultSummaryPath = path.join(runDir, "RESULT_SUMMARY.json");
  await writeJson(resultSummaryPath, {
    status: "completed",
    metrics: { h_score: 0.58 },
  });
  const staleAt = new Date(Date.now() - 5 * 60 * 1000);
  await fs.utimes(resultSummaryPath, staleAt, staleAt);

  const refreshed = await refreshExperimentGpuMonitor({
    projectRoot,
  });

  assert.equal(refreshed.state.recommendation, "reconcile_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].conclusion, "likely_finished");
  assert.equal(
    refreshed.state.servers[0].assignments[0].watcherSignal,
    "result_summary"
  );
});

test("refreshExperimentGpuMonitor treats stale heartbeats as timeout-style completion", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      "printf '\\n---SCREENS---\\n'",
      "printf 'No Sockets found in /run/screen.\\n'",
      "",
    ].join("\n")
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;

  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-4",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "timed-run",
    status: "running",
  });
  await writeJson(path.join(runDir, "RUN_HEARTBEAT.json"), {
    status: "running",
    heartbeat_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });

  const refreshed = await refreshExperimentGpuMonitor({
    projectRoot,
  });

  assert.equal(refreshed.state.recommendation, "reconcile_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].conclusion, "likely_finished");
  assert.equal(refreshed.state.servers[0].assignments[0].watcherSignal, "timeout");
});

test("refreshExperimentGpuMonitor does not treat stale heartbeats as timeout when SSH sampling fails", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-research-fake-ssh-"));

  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeExecutable(
    path.join(binDir, "ssh"),
    "#!/bin/sh\nexit 255\n"
  );
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;

  const runDir = path.join(projectRoot, "coder", "demo-exp");
  await writeJson(path.join(runDir, "REMOTE_RUN.json"), {
    experiment_id: "exp-5",
    experiment_name: "candidate",
    track_id: "track-main",
    server: "gpu-server",
    gpu_id: "0",
    screen_name: "timed-run",
    status: "running",
  });
  await writeJson(path.join(runDir, "RUN_HEARTBEAT.json"), {
    status: "running",
    heartbeat_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  });

  const refreshed = await refreshExperimentGpuMonitor({
    projectRoot,
  });

  assert.equal(refreshed.state.servers[0].status, "error");
  assert.notEqual(refreshed.state.servers[0].assignments[0].watcherSignal, "timeout");
});
