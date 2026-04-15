import * as path from "node:path";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "./workflow-guard-core/fs";
import {
  buildWorkflowSnapshot,
  getChannelProjectBindingForWorkflow,
  listChannelProjectBindingsForWorkflow,
  getPapernexusProgressSummary,
  auditLiteratureCoverageForWorkflow,
  type WorkflowGuardPolicy,
} from "./workflow-guard";
import {
  getProjectBindingAuditPath,
  getProjectsBindingAuditPath,
} from "./channel-project-bindings";
import { resolveWorkflowRuntimeHealth } from "./workflow-runtime-health";
import {
  getWorkflowRuntimeQueuePath,
  getWorkflowRuntimeSessionsPath,
  readWorkflowRuntimeEvents,
} from "./workflow-runtime-state.js";
import { readWorkflowMailbox } from "./workflow-collaboration/mailbox";
import { readWorkflowHandoffIntentStore } from "./workflow-handoff/handoff-store";
import { readWorkflowHandoffEvents } from "./workflow-handoff/handoff-events";
import { readWorkflowTaskGraphStore } from "./workflow-team/task-graph";
import { readWorkflowTeamRoundStore } from "./workflow-team/team-round";
import { getWorkflowTraceLogPath } from "./workflow-trace";

type DiagnosticAgentContext = {
  agentId?: string | null;
  workspaceDir?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  messageChannel?: string | null;
  channelKey?: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampSegment(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
}

function slugify(value: string | null | undefined, fallback = "bundle"): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function relativeToProject(projectRoot: string, targetPath: string | null): string | null {
  if (!targetPath) {
    return null;
  }
  const resolved = path.resolve(targetPath);
  const relative = path.relative(projectRoot, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : resolved;
}

async function readJsonlTail(targetPath: string | null, tailLines: number) {
  const raw = await readTextIfExists(targetPath);
  if (!raw) {
    return {
      exists: false,
      lineCount: 0,
      tail: [] as string[],
    };
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return {
    exists: true,
    lineCount: lines.length,
    tail: lines.slice(-Math.max(1, tailLines)),
  };
}

async function captureOptionalFile(params: {
  projectRoot: string;
  bundleDir: string;
  relativePath: string;
  mode?: "copy" | "tail";
  tailLines?: number;
}) {
  const sourcePath = path.join(params.projectRoot, params.relativePath);
  if (!(await pathExists(sourcePath))) {
    return {
      exists: false,
      sourcePath,
      outputPath: null,
    };
  }
  const outputPath = path.join(
    params.bundleDir,
    params.relativePath + (params.mode === "tail" ? ".tail" : "")
  );
  if (params.mode === "tail") {
    const tail = await readJsonlTail(sourcePath, params.tailLines ?? 200);
    await writeJsonEnsured(outputPath, tail);
  } else {
    const text = await readTextIfExists(sourcePath);
    await writeTextEnsured(outputPath, text ?? "");
  }
  return {
    exists: true,
    sourcePath,
    outputPath,
  };
}

export async function captureWorkflowDiagnosticBundle(params: {
  projectRoot: string;
  workflowPolicy: WorkflowGuardPolicy;
  agentCtx?: DiagnosticAgentContext | null;
  reason?: string | null;
  tailLines?: number;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const trackRegistryPath = path.join(projectRoot, "TRACK_REGISTRY.json");
  const mailboxPath = path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json");
  const experimentLedgerPath = path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json");
  const autoIteratorAuditPath = path.join(projectRoot, ".openclaw-research", "auto-iterator-state.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? null;
  const trackRegistry =
    (await readJsonIfExists<Record<string, unknown>>(trackRegistryPath)) ?? null;
  const mailbox =
    (await readJsonIfExists<Record<string, unknown>>(mailboxPath)) ?? null;
  const experimentLedger =
    (await readJsonIfExists<Record<string, unknown>>(experimentLedgerPath)) ?? null;
  const autoIteratorAudit =
    (await readJsonIfExists<Record<string, unknown>>(autoIteratorAuditPath)) ?? null;

  const projectId =
    readString(manifest?.project_id) ?? path.basename(projectRoot);
  const snapshot = await buildWorkflowSnapshot({
    policy: params.workflowPolicy,
    agentId: readString(params.agentCtx?.agentId) ?? undefined,
    workspaceDir: readString(params.agentCtx?.workspaceDir) ?? undefined,
    sessionKey: readString(params.agentCtx?.sessionKey) ?? undefined,
    sessionId: readString(params.agentCtx?.sessionId) ?? undefined,
    messageChannel: readString(params.agentCtx?.messageChannel) ?? undefined,
    channelKey: readString(params.agentCtx?.channelKey) ?? undefined,
  });
  const runtimeHealth = await resolveWorkflowRuntimeHealth({
    projectRoot,
    manifest,
    trackRegistry,
    mailbox,
    experimentLedger,
    autoIteratorAudit,
    snapshot,
  });

  const bundleDir = path.join(
    projectRoot,
    ".openclaw-research",
    "diagnostics",
    `${timestampSegment()}-${slugify(params.reason ?? snapshot.currentStage ?? projectId)}`
  );
  await writeJsonEnsured(path.join(bundleDir, "manifest.json"), manifest ?? {});
  await writeJsonEnsured(path.join(bundleDir, "track-registry.json"), trackRegistry ?? {});
  await writeJsonEnsured(path.join(bundleDir, "snapshot.json"), snapshot);
  await writeJsonEnsured(path.join(bundleDir, "runtime-health.json"), runtimeHealth);
  await writeJsonEnsured(path.join(bundleDir, "mailbox.json"), mailbox ?? {});
  await writeJsonEnsured(path.join(bundleDir, "experiment-ledger.json"), experimentLedger ?? {});
  await writeJsonEnsured(path.join(bundleDir, "auto-iterator-audit.json"), autoIteratorAudit ?? {});

  const queuePath = getWorkflowRuntimeQueuePath(projectRoot);
  const sessionsPath = getWorkflowRuntimeSessionsPath(projectRoot);
  const runtimeQueue =
    (await readJsonIfExists<Record<string, unknown>>(queuePath)) ?? null;
  const runtimeSessions =
    (await readJsonIfExists<Record<string, unknown>>(sessionsPath)) ?? null;
  const runtimeEvents = await readWorkflowRuntimeEvents(projectRoot);
  const traceTail = await readJsonlTail(getWorkflowTraceLogPath({ projectRoot, projectId }), params.tailLines ?? 200);
  const handoffIntents = await readWorkflowHandoffIntentStore(projectRoot).catch(() => null);
  const handoffEvents = await readWorkflowHandoffEvents(projectRoot).catch(() => []);
  const taskGraph = await readWorkflowTaskGraphStore(projectRoot).catch(() => null);
  const teamRound = await readWorkflowTeamRoundStore(projectRoot).catch(() => null);
  const runtimeInboundTurns = await readJsonlTail(
    path.join(projectRoot, ".openclaw-research", "workflow-inbound-turns.jsonl"),
    params.tailLines ?? 200
  );

  await writeJsonEnsured(path.join(bundleDir, "runtime-queue.json"), runtimeQueue ?? {});
  await writeJsonEnsured(path.join(bundleDir, "runtime-sessions.json"), runtimeSessions ?? {});
  await writeJsonEnsured(
    path.join(bundleDir, "runtime-events.tail.json"),
    {
      lineCount: Array.isArray(runtimeEvents) ? runtimeEvents.length : 0,
      tail: Array.isArray(runtimeEvents)
        ? runtimeEvents.slice(-Math.max(1, params.tailLines ?? 200))
        : [],
    }
  );
  await writeJsonEnsured(path.join(bundleDir, "workflow-trace.tail.json"), traceTail);
  await writeJsonEnsured(path.join(bundleDir, "workflow-inbound-turns.tail.json"), runtimeInboundTurns);
  await writeJsonEnsured(path.join(bundleDir, "handoff-intents.json"), handoffIntents ?? {});
  await writeJsonEnsured(
    path.join(bundleDir, "handoff-events.tail.json"),
    {
      lineCount: Array.isArray(handoffEvents) ? handoffEvents.length : 0,
      tail: Array.isArray(handoffEvents)
        ? handoffEvents.slice(-Math.max(1, params.tailLines ?? 200))
        : [],
    }
  );
  await writeJsonEnsured(path.join(bundleDir, "task-graph.json"), taskGraph ?? {});
  await writeJsonEnsured(path.join(bundleDir, "team-round.json"), teamRound ?? {});

  const graphPresenceReport =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json")
    )) ?? null;
  const papernexusStatus =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json")
    )) ?? null;
  const graphBuildReportText = await readTextIfExists(
    path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md")
  );
  const papernexusProgress = await getPapernexusProgressSummary({ projectRoot }).catch(() => ({
    progress: null,
    summary: null,
  }));
  const literatureCoverage = await auditLiteratureCoverageForWorkflow({ projectRoot }).catch(
    () => ({ audit: null })
  );

  await writeJsonEnsured(path.join(bundleDir, "graph-presence.json"), graphPresenceReport ?? {});
  await writeJsonEnsured(path.join(bundleDir, "papernexus-status.json"), papernexusStatus ?? {});
  await writeJsonEnsured(path.join(bundleDir, "papernexus-progress.json"), papernexusProgress ?? {});
  await writeJsonEnsured(path.join(bundleDir, "literature-coverage.json"), literatureCoverage ?? {});
  if (graphBuildReportText != null) {
    await writeTextEnsured(path.join(bundleDir, "GRAPH_BUILD_REPORT.md"), graphBuildReportText);
  }

  const binding = getChannelProjectBindingForWorkflow({
    policy: params.workflowPolicy,
    workspaceDir: readString(params.agentCtx?.workspaceDir) ?? undefined,
    sessionKey: readString(params.agentCtx?.sessionKey) ?? undefined,
    sessionId: readString(params.agentCtx?.sessionId) ?? undefined,
    messageChannel: readString(params.agentCtx?.messageChannel) ?? undefined,
    channelKey: readString(params.agentCtx?.channelKey) ?? undefined,
  });
  const bindings = listChannelProjectBindingsForWorkflow({
    policy: params.workflowPolicy,
    workspaceDir: readString(params.agentCtx?.workspaceDir) ?? undefined,
  });
  await writeJsonEnsured(path.join(bundleDir, "channel-binding.json"), binding);
  await writeJsonEnsured(path.join(bundleDir, "channel-bindings.json"), bindings);
  const projectBindingAudit = await readTextIfExists(getProjectBindingAuditPath(projectRoot));
  if (projectBindingAudit != null) {
    await writeTextEnsured(
      path.join(bundleDir, "channel-project-binding-audit.project.jsonl"),
      projectBindingAudit
    );
  }
  const projectsRoot = readString(params.workflowPolicy?.projectsRoot);
  if (projectsRoot) {
    const rootBindingAudit = await readTextIfExists(getProjectsBindingAuditPath(projectsRoot));
    if (rootBindingAudit != null) {
      await writeTextEnsured(
        path.join(bundleDir, "channel-project-binding-audit.projects-root.jsonl"),
        rootBindingAudit
      );
    }
  }

  const queueEntries = Array.isArray((runtimeQueue as { entries?: unknown[] } | null)?.entries)
    ? (runtimeQueue as { entries: unknown[] }).entries
    : [];
  const sessionEntries = Array.isArray((runtimeSessions as { entries?: unknown[] } | null)?.entries)
    ? (runtimeSessions as { entries: unknown[] }).entries
    : [];
  const mailboxMessages = Array.isArray((mailbox as { messages?: unknown[] } | null)?.messages)
    ? (mailbox as { messages: unknown[] }).messages
    : [];
  const handoffIntentsCount = Array.isArray(handoffIntents?.intents)
    ? handoffIntents.intents.length
    : 0;

  const extraArtifacts = await Promise.all([
    captureOptionalFile({
      projectRoot,
      bundleDir,
      relativePath: "academic_writer/WRITING_SIGNALS.md",
    }),
    captureOptionalFile({
      projectRoot,
      bundleDir,
      relativePath: "reviewer/CITATION_VERIFICATION.md",
    }),
    captureOptionalFile({
      projectRoot,
      bundleDir,
      relativePath: "reviewer/CITATION_CALIBRATION.md",
    }),
    captureOptionalFile({
      projectRoot,
      bundleDir,
      relativePath: "reviewer/REVIEW_ISSUES.json",
    }),
    captureOptionalFile({
      projectRoot,
      bundleDir,
      relativePath: "reviewer/REVIEW_PACKET.json",
    }),
    captureOptionalFile({
      projectRoot,
      bundleDir,
      relativePath: "academic_writer/paper/compile.log",
      mode: "tail",
      tailLines: 200,
    }),
  ]);

  const summary = [
    "# Workflow Diagnostic Bundle",
    "",
    `- generated_at: ${new Date().toISOString()}`,
    `- project_id: ${projectId}`,
    `- project_root: ${projectRoot}`,
    `- reason: ${params.reason ?? "manual_capture"}`,
    `- stage: ${snapshot.currentStage ?? "unknown"}`,
    `- owner: ${snapshot.ownerAgent ?? "unknown"}`,
    `- project_resolution: ${snapshot.projectResolutionSource ?? "unknown"}`,
    `- blocking_reason: ${snapshot.blockingReason ?? "none"}`,
    `- graph_presence: ${snapshot.graphPresenceStatus ?? "unknown"}`,
    `- paper_ingestion_runtime: ${snapshot.paperIngestionRuntimeStatus ?? "unknown"}`,
    `- auto_iterator_audit: ${runtimeHealth.autoIteratorAuditStatus} (${runtimeHealth.autoIteratorAuditFreshness})`,
    `- queue_entries: ${queueEntries.length}`,
    `- session_entries: ${sessionEntries.length}`,
    `- handoff_intents: ${handoffIntentsCount}`,
    `- mailbox_messages: ${mailboxMessages.length}`,
    "",
    "## Bundle Contents",
    "- snapshot.json",
    "- runtime-health.json",
    "- manifest.json",
    "- track-registry.json",
    "- mailbox.json",
    "- experiment-ledger.json",
    "- auto-iterator-audit.json",
    "- channel-binding.json",
    "- channel-bindings.json",
    "- runtime-queue.json",
    "- runtime-sessions.json",
    "- runtime-events.tail.json",
    "- workflow-trace.tail.json",
    "- workflow-inbound-turns.tail.json",
    "- handoff-intents.json",
    "- handoff-events.tail.json",
    "- task-graph.json",
    "- team-round.json",
    "- graph-presence.json",
    "- papernexus-status.json",
    "- papernexus-progress.json",
    "- literature-coverage.json",
    ...(graphBuildReportText != null ? ["- GRAPH_BUILD_REPORT.md"] : []),
    ...extraArtifacts
      .filter((entry) => entry.exists && entry.outputPath)
      .map((entry) => `- ${relativeToProject(bundleDir, entry.outputPath)}`),
  ].join("\n");

  const summaryPath = path.join(bundleDir, "SUMMARY.md");
  const indexPath = path.join(bundleDir, "INDEX.json");
  await writeTextEnsured(summaryPath, summary);
  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId,
    projectRoot,
    reason: params.reason ?? "manual_capture",
    bundleDir,
    bundleRelativeDir: relativeToProject(projectRoot, bundleDir),
    summaryPath: relativeToProject(projectRoot, summaryPath),
    indexPath: relativeToProject(projectRoot, indexPath),
    keyFiles: {
      snapshot: "snapshot.json",
      runtimeHealth: "runtime-health.json",
      manifest: "manifest.json",
      runtimeQueue: "runtime-queue.json",
      runtimeSessions: "runtime-sessions.json",
      handoffIntents: "handoff-intents.json",
      handoffEventsTail: "handoff-events.tail.json",
      traceTail: "workflow-trace.tail.json",
      graphPresence: "graph-presence.json",
      papernexusStatus: "papernexus-status.json",
      papernexusProgress: "papernexus-progress.json",
      literatureCoverage: "literature-coverage.json",
    },
  };
  await writeJsonEnsured(indexPath, index);

  return {
    generatedAt: index.generatedAt,
    projectId,
    projectRoot,
    bundleDir,
    bundleRelativeDir: index.bundleRelativeDir,
    summaryPath,
    summaryRelativePath: index.summaryPath,
    indexPath,
    indexRelativePath: index.indexPath,
  };
}
