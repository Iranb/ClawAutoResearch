import fs from "node:fs/promises";
import path from "node:path";

import { dispatchWorkflowCommand } from "./workflow_command_harness_lib.mjs";
import { createGatewayRuntimeSubagent } from "./gateway_runtime_subagent.mjs";
import { startIsolatedGateway } from "./isolated_gateway_server.mjs";
import { buildWorkflowTransportContext } from "./workflow_transport_context.mjs";
import { runWorkflowAutoIterator } from "../tools/workflow-guard.ts";
import { handoffWorkflowTaskToAgent } from "../tools/workflow-execution/delivery-adapter.ts";
import { createStageOwnerHandoffIntent } from "../tools/workflow-handoff/handoff-router.ts";
import { deliverWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-delivery.ts";
import { transitionWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-store.ts";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAssistantTexts(messages) {
  return (messages ?? [])
    .filter((entry) => entry?.role === "assistant")
    .flatMap((entry) => Array.isArray(entry?.content) ? entry.content : [])
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(projectRoot) {
  return (
    (await readJsonIfExists(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {}
  );
}

function parseProjectRootFromCommandText(text) {
  const match = /project_root=(.+)$/m.exec(text ?? "");
  return match?.[1]?.trim() ?? null;
}

function deriveProjectRootFromBootstrap(bootstrap) {
  return (
    bootstrap.backgroundRuns?.at?.(-1)?.started?.projectRoot ??
    bootstrap.backgroundRuns?.at?.(-1)?.backgroundRun?.projectRoot ??
    parseProjectRootFromCommandText(bootstrap.result?.text) ??
    null
  );
}

function slugifyTopic(topic) {
  const normalized = String(topic ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "research-topic";
}

function ensureSlashCommandText(text, fallback) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.startsWith("/") ? normalized : fallback;
}

function deriveStageCommand(params) {
  const nextAction = String(
    params.manifest.next_action ??
      params.manifest.resume_action ??
      params.iterator?.nextAction ??
      params.iterator?.resumeAction ??
      ""
  ).trim();
  if (nextAction.startsWith("/")) {
    return nextAction;
  }

  const stage = String(params.manifest.current_stage ?? params.iterator?.stageAfter ?? "setup");
  const topicArg = JSON.stringify(params.topic);
  if (stage === "setup" || stage === "graph_build" || stage === "frontier_mapping") {
    return params.lane === "survey" ? `/survey-pipeline ${topicArg}` : `/research-pipeline ${topicArg}`;
  }
  if (stage === "survey_review") {
    return `/survey-pipeline ${topicArg}`;
  }
  if (stage === "idea") {
    return "/idea-phase";
  }
  if (stage === "plan") {
    return "/plan-research";
  }
  if (stage === "code") {
    return "/run-experiment";
  }
  if (stage === "experiment") {
    return "/monitor-experiment";
  }
  if (stage === "analyze") {
    return "/analyze-results";
  }
  if (stage === "write") {
    return "/paper-phase";
  }
  if (stage === "review") {
    return "/review-phase";
  }
  return params.lane === "survey" ? `/survey-pipeline ${topicArg}` : `/research-pipeline ${topicArg}`;
}

function buildStageExtraBody(params) {
  const lines = [
    `You are the current workflow owner for stage ${params.stage}.`,
    "Do the stage work for real. Do not stop at a plan or status update.",
    "Use the project-local workflow tools and artifacts as the source of truth.",
    `Topic: ${params.topic}.`,
  ];
  if (params.stage === "graph_build") {
    lines.push(
      "Complete topic-grounded literature retrieval and graph build.",
      "Find canonical papers for the topic, populate project-local source artifacts, and keep working until graph presence is ready or you can explain a concrete hard blocker.",
      "Do not stop at 'missing_sources' if retrieval has not been attempted yet.",
      "Use workflow tools and retrieval/graph tooling directly instead of asking for another slash command."
    );
  }
  if (params.stage === "frontier_mapping" || params.stage === "idea") {
    lines.push(
      "Use the current graph and literature packet to derive real ideation outputs, not a placeholder summary."
    );
  }
  if (params.stage === "plan") {
    lines.push(
      "Produce a real research plan with concrete experiment/design decisions, not a placeholder checklist."
    );
  }
  if (params.stage === "code" || params.stage === "experiment") {
    lines.push(
      "Execute real experiment work and keep durable experiment artifacts current.",
      "If the experiment workflow requires tuning or repair, follow through instead of returning a status-only note."
    );
  }
  if (params.stage === "analyze") {
    lines.push(
      "Produce real analysis outputs that can support the paper draft."
    );
  }
  if (params.stage === "write") {
    lines.push(
      "Generate real paper prose. Each section should contain multiple paragraphs with concrete claims, evidence, and transitions.",
      "Do not leave one-sentence placeholders or skeletal section stubs."
    );
  }
  if (params.stage === "review") {
    lines.push(
      "Review the actual draft, request revisions if needed, and only after the content is stable run citation calibration and final closeout.",
      "Citation calibration belongs after substantive content changes are done."
    );
  }
  if (params.lane === "survey") {
    lines.push(
      "This is a survey workflow. Focus on retrieval coverage, taxonomy stability, benchmark alignment, representative methods, and survey synthesis."
    );
  } else {
    lines.push(
      "This is an experiment workflow. Focus on research framing, experiment execution, analysis, and evidence-backed writing."
    );
  }
  return lines.join("\n");
}

async function waitForProjectRoot(projectRoot, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (projectRoot && (await pathExists(path.join(projectRoot, "PROJECT_MANIFEST.json")))) {
      return true;
    }
    await sleep(1_000);
  }
  return false;
}

async function waitForProgress(params) {
  const startedAt = Date.now();
  let latestManifest = params.baselineManifest;
  while (Date.now() - startedAt < params.timeoutMs) {
    latestManifest = await readManifest(params.projectRoot);
    const currentStage = String(latestManifest.current_stage ?? "");
    const currentOwner = String(latestManifest.owner_agent ?? "");
    const pdfExists = await pathExists(
      path.join(params.projectRoot, "academic_writer", "paper", "main.pdf")
    );
    if (pdfExists && (currentStage === "submit" || currentStage === "done")) {
      return { progressed: true, manifest: latestManifest, reason: "terminal" };
    }
    if (
      currentStage !== String(params.baselineManifest.current_stage ?? "") ||
      currentOwner !== String(params.baselineManifest.owner_agent ?? "")
    ) {
      return { progressed: true, manifest: latestManifest, reason: "stage_or_owner_changed" };
    }
    await sleep(params.pollMs);
  }
  return { progressed: false, manifest: latestManifest, reason: "timeout" };
}

async function runLiveStageTurn(params) {
  const {
    runtimeSubagent,
    projectRoot,
    projectId,
    lane,
    manifest,
    iterator,
    topic,
    transportContext,
    previousRole,
  } = params;
  const owner = String(iterator.ownerAfter ?? manifest.owner_agent ?? "researcher");
  const stage = String(iterator.stageAfter ?? manifest.current_stage ?? "setup");
  const command = ensureSlashCommandText(
    deriveStageCommand({ lane, manifest, iterator, topic }),
    lane === "survey" ? `/survey-pipeline ${JSON.stringify(topic)}` : `/research-pipeline ${JSON.stringify(topic)}`
  );
  const fromRole = previousRole ?? "researcher";
  const fromSessionKey = transportContext.sessionKeyFor(fromRole);
  const sameOwner = owner === fromRole;

  if (sameOwner) {
    const started = await runtimeSubagent.run({
      sessionKey: transportContext.sessionKeyFor(owner),
      message: [
        `Complete workflow stage ${stage} for project ${projectId}.`,
        `Suggested command context: ${command}`,
        buildStageExtraBody({ lane, stage, topic }),
      ].join("\n"),
      lane: "nested",
      deliver: false,
      idempotencyKey: `live-stage:${projectId}:${stage}:${Date.now()}`,
      originatingChannel: transportContext.originatingChannel,
      originatingTo: transportContext.originatingTo,
      originatingAccountId: transportContext.accountId,
    });
    const waited = await runtimeSubagent.waitForRun?.({
      runId: started.runId,
      timeoutMs: 120_000,
    });
    const progress = await waitForProgress({
      projectRoot,
      baselineManifest: manifest,
      timeoutMs: 180_000,
      pollMs: 5_000,
    });
    return {
      owner,
      stage,
      command,
      intentId: null,
      progressed: progress.progressed,
      progressReason:
        progress.progressed
          ? progress.reason
          : waited?.status === "timeout"
            ? "agent_timeout"
            : progress.reason,
      manifest: progress.manifest,
    };
  }

  const created = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId,
    workflowLine: lane === "survey" ? "survey" : "experiment",
    stageBefore: String(manifest.current_stage ?? null),
    stageAfter: stage,
    ownerBefore: fromRole,
    ownerAfter: owner,
    fromSessionKey,
    nextAction: command,
    deliveryPlan: {
      channels: ["native_runtime"],
      requireAck: true,
      maxAttemptsTotal: 1,
      maxAttemptsByChannel: { native_runtime: 1 },
      fallbackAfterMs: 0,
      staleClaimAfterMs: 120_000,
      ackDeadlineAt: new Date(Date.now() + 120_000).toISOString(),
    },
  });

  const delivered = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      nativeDispatch: async (intent) => {
        const dispatch = await handoffWorkflowTaskToAgent({
          runtimeSubagent,
          requesterSessionKey: fromSessionKey,
          requesterChannel: transportContext.requesterChannel,
          fromRole,
          toRole: owner,
          projectRoot,
          projectId,
          stage,
          summary:
            `Complete workflow stage ${stage} for project ${projectId}. Use the command and workflow state below.`,
          command,
          requireMailboxAcknowledgement: true,
          extraBody: buildStageExtraBody({ lane, stage, topic }),
          waitTimeoutMs: 90_000,
          retryOnTimeout: true,
          enableSpawnFallback: true,
          autoModeActive: true,
        });
        return {
          ok: dispatch.dispatched,
          runId: dispatch.runId,
          sessionKey: dispatch.sessionKey,
          error: dispatch.error,
        };
      },
    },
  });

  if (!delivered.delivered) {
    throw new Error(`Failed to dispatch live stage ${stage}: ${delivered.reason ?? "unknown"}`);
  }

  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: delivered.intent.intentId,
    toStatus: "acknowledged",
    summary: `${owner} acknowledged ${stage} handoff.`,
  });
  await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: delivered.intent.intentId,
    toStatus: "claimed",
    summary: `${owner} claimed ${stage} handoff.`,
    patch: {
      claimedAt: new Date().toISOString(),
      claimLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    },
  });

  const progress = await waitForProgress({
    projectRoot,
    baselineManifest: manifest,
    timeoutMs: 180_000,
    pollMs: 5_000,
  });

  if (progress.progressed) {
    await transitionWorkflowHandoffIntent({
      projectRoot,
      intentId: delivered.intent.intentId,
      toStatus: "completed",
      summary: `${owner} completed ${stage} handoff.`,
    });
  } else {
    await transitionWorkflowHandoffIntent({
      projectRoot,
      intentId: delivered.intent.intentId,
      toStatus: "failed",
      summary: `${owner} did not make observable progress on ${stage} within the timeout.`,
      terminalReason: "live_stage_timeout",
    });
  }

  return {
    owner,
    stage,
    command,
    intentId: delivered.intent.intentId,
    progressed: progress.progressed,
    progressReason: progress.reason,
    manifest: progress.manifest,
  };
}

async function runHarness(projectRoot, lane, options = {}) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const args = [
    path.join(process.cwd(), "scripts", "run-e2e-paper-generation.mjs"),
    "--project-root",
    projectRoot,
    "--lane",
    lane,
  ];
  if (options.strictContent) {
    args.push("--strict-content");
  }
  const { stdout } = await execFileAsync(process.execPath, args);
  return JSON.parse(stdout);
}

export async function runAutoCommandEndToEndLive(params) {
  const { lane, topic, projectsRoot } = params;
  const commandName = lane === "survey" ? "auto-review" : "auto-research";
  const bootstrapTransport = params.bootstrapTransport === "discord" ? "discord" : "local";
  const transportContext = buildWorkflowTransportContext({
    transport: bootstrapTransport,
    lane,
    conversationId:
      params.conversationId ??
      (lane === "survey" ? "gcd-survey-live" : "gcd-research-live"),
    accountId: "default",
    userId: "owner",
  });
  const isolatedGateway =
    params.isolatedGateway === false
      ? null
      : await startIsolatedGateway({
          projectsRoot,
          sourceConfigPath: params.sourceConfigPath,
          timeoutMs: params.gatewayStartupTimeoutMs ?? 90_000,
        });
  const gateway = await createGatewayRuntimeSubagent({
    profile: params.profile,
    url: isolatedGateway?.url ?? params.gatewayUrl,
    token: isolatedGateway?.token ?? params.gatewayToken,
    originatingChannel: transportContext.originatingChannel,
    originatingTo: transportContext.originatingTo,
    originatingAccountId: transportContext.accountId,
  });
  const runtimeSubagent = gateway.runtimeSubagent;
  try {
    const bootstrap =
      bootstrapTransport === "local"
        ? await dispatchWorkflowCommand({
            commandName,
            args: JSON.stringify(topic),
            projectsRoot: isolatedGateway?.projectsRoot ?? projectsRoot,
            workspaceDir: isolatedGateway?.projectsRoot ?? projectsRoot,
            sessionKey: transportContext.bootstrapSessionKey,
            channel: transportContext.channel,
            from: transportContext.from,
            to: transportContext.to,
            accountId: transportContext.accountId,
            contextExtras: transportContext.commandContextExtras(),
            emitFallbackNote: true,
            runtimeSubagent,
            backgroundExecutionMode: "live",
          })
        : await (async () => {
            const started = await gateway.client.chatSend({
              sessionKey: transportContext.bootstrapSessionKey,
              message: `/${commandName} ${JSON.stringify(topic)}`,
              idempotencyKey: `native-bootstrap:${commandName}:${Date.now()}`,
              originatingChannel: transportContext.originatingChannel,
              originatingTo: transportContext.originatingTo,
              originatingAccountId: transportContext.accountId,
              timeoutMs: 30_000,
            });
            if (started?.status !== "started" || typeof started?.runId !== "string") {
              throw new Error(`Native slash bootstrap did not start correctly: ${JSON.stringify(started)}`);
            }
            await gateway.client.agentWait({
              runId: started.runId,
              timeoutMs: 120_000,
            });
            const slashHistory = await gateway.client.chatHistory({
              sessionKey: transportContext.bootstrapSessionKey,
              limit: 20,
              timeoutMs: 30_000,
            });
            const assistantTexts = extractAssistantTexts(slashHistory.messages);
            return {
              command: `/${commandName}`,
              args: JSON.stringify(topic),
              projectRoot: null,
              projectsRoot: isolatedGateway?.projectsRoot ?? projectsRoot,
              sessionKey: transportContext.bootstrapSessionKey,
              result: {
                text: assistantTexts.at(-1) ?? "",
              },
              backgroundRuns: [],
              fallbackTransport: "Executed through isolated native slash bootstrap.",
              runId: started.runId,
            };
          })();

    const projectRoot =
      deriveProjectRootFromBootstrap(bootstrap) ??
      path.join(
        isolatedGateway?.projectsRoot ?? projectsRoot,
        lane === "survey" ? `survey-${slugifyTopic(topic)}` : slugifyTopic(topic)
      );
    if (!projectRoot) {
      throw new Error(`Failed to derive project root from ${commandName} bootstrap.`);
    }
    const ready = await waitForProjectRoot(projectRoot);
    if (!ready) {
      throw new Error(`Project root did not materialize in time: ${projectRoot}`);
    }

    const turns = [];
    let previousRole = "researcher";
    const maxIterations = params.maxIterations ?? 12;
    for (let index = 0; index < maxIterations; index += 1) {
      const manifest = await readManifest(projectRoot);
      const pdfExists = await pathExists(
        path.join(projectRoot, "academic_writer", "paper", "main.pdf")
      );
      if (pdfExists && ["submit", "done"].includes(String(manifest.current_stage ?? ""))) {
        break;
      }
      const iterator = await runWorkflowAutoIterator({
        projectRoot,
        mode: "test",
        queueMailbox: false,
      });
      const turn = await runLiveStageTurn({
        runtimeSubagent,
        projectRoot,
        projectId: path.basename(projectRoot),
        lane,
        topic,
        manifest,
        iterator,
        transportContext,
        previousRole,
      });
      turns.push(turn);
      previousRole = turn.owner;
      if (["submit", "done"].includes(String(turn.manifest.current_stage ?? ""))) {
        break;
      }
    }

    const harness = await runHarness(projectRoot, lane, { strictContent: true });
    return {
      transport: bootstrapTransport,
      bootstrap,
      projectRoot,
      turns,
      harness,
    };
  } finally {
    await gateway.stop();
    await isolatedGateway?.stop?.();
  }
}
