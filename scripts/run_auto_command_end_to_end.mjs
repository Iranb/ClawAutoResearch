#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { dispatchWorkflowCommand } from "./workflow_command_harness_lib.mjs";
import { materializeSurveyReviewState, runWorkflowAutoIterator } from "../tools/workflow-guard.ts";
import { reconcileAuthoringCloseout } from "../tools/authoring-closeout-reconcile.ts";
import { createStageOwnerHandoffIntent } from "../tools/workflow-handoff/handoff-router.ts";
import { deliverWorkflowHandoffIntent } from "../tools/workflow-handoff/handoff-delivery.ts";
import {
  appendWorkflowHandoffDeliveryAttempt,
  transitionWorkflowHandoffIntent,
} from "../tools/workflow-handoff/handoff-store.ts";
import {
  acknowledgeWorkflowMailboxMessage,
  queueWorkflowMailboxMessage,
} from "../tools/workflow-collaboration/mailbox.ts";
import { runAutoCommandEndToEndLive } from "./auto_command_live_orchestrator.mjs";

const execFile = promisify(execFileCb);

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function seedSharedWritingArtifacts(params) {
  const { projectRoot, topic, lane } = params;
  const bibEntries =
    lane === "survey"
      ? [
          "@article{gcdsurvey2026,\n  title={Generalized Category Discovery Survey},\n  author={Test, Surveyer},\n  journal={ArXiv},\n  year={2026}\n}\n",
          "@article{gcdbaseline2023,\n  title={A Baseline for Generalized Category Discovery},\n  author={Test, Baseline},\n  journal={ICCV},\n  year={2023}\n}\n",
        ].join("\n")
      : [
          "@article{gcdmethod2026,\n  title={Generalized Category Discovery with Verification Gates},\n  author={Test, Researcher},\n  journal={ArXiv},\n  year={2026}\n}\n",
          "@article{gcdbaseline2023,\n  title={A Baseline for Generalized Category Discovery},\n  author={Test, Baseline},\n  journal={ICCV},\n  year={2023}\n}\n",
          "@article{dualsystems2011,\n  title={Thinking, Fast and Slow},\n  author={Kahneman, Daniel},\n  journal={Farrar Straus and Giroux},\n  year={2011}\n}\n",
        ].join("\n");
  const mainTex =
    lane === "survey"
      ? [
          "\\documentclass{article}",
          "\\usepackage{hyperref}",
          "\\begin{document}",
          `\\title{${topic}}`,
          "\\maketitle",
          "\\section{Introduction}",
          "We survey generalized category discovery literature and organizing principles \\cite{gcdsurvey2026,gcdbaseline2023}.",
          "\\section{Problem Setting}",
          "The field studies category discovery under partial supervision and open-world label spaces \\cite{gcdbaseline2023}.",
          "\\section{Taxonomy}",
          "We separate prototype-heavy, graph-aware, and verification-driven families.",
          "\\section{Representative Methods}",
          "Representative methods expose different clustering and novelty signals \\cite{gcdbaseline2023}.",
          "\\section{Benchmarks}",
          "Benchmarks remain fragmented across datasets and evaluation metrics.",
          "\\section{Cross-Domain Inspirations}",
          "Evidence-first verification offers a useful framing for how survey synthesis should gate claims.",
          "\\section{Open Problems}",
          "Coverage gaps and evaluation inconsistency remain major open problems.",
          "\\section{Conclusion}",
          "Generalized category discovery needs stronger evaluation and evidence-grounded writing.",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n")
      : [
          "\\documentclass{article}",
          "\\usepackage{hyperref}",
          "\\begin{document}",
          `\\title{${topic}}`,
          "\\maketitle",
          "\\section{Introduction}",
          "We evaluate a verification-oriented workflow for generalized category discovery \\cite{gcdmethod2026,gcdbaseline2023}.",
          "\\section{Related Work}",
          "Prior generalized category discovery systems emphasize prototype and pseudo-label pipelines \\cite{gcdbaseline2023}.",
          "\\section{Method}",
          "Our method adds a verification gate inspired by dual-process reasoning \\cite{dualsystems2011}.",
          "\\section{Experimental Setup}",
          "We run a deterministic smoke experiment on a controlled benchmark split.",
          "\\section{Results}",
          "The smoke evaluation demonstrates a stable non-regression signal for the proposed workflow gate.",
          "\\section{Discussion}",
          "The main value lies in reducing confirmation-bias-heavy failure modes.",
          "\\section{Limitations}",
          "This validation covers workflow integration more than full benchmark breadth.",
          "\\section{Conclusion}",
          "Verification-first orchestration is promising for more reliable GCD iteration.",
          "\\bibliographystyle{plain}",
          "\\bibliography{refs}",
          "\\end{document}",
          "",
        ].join("\n");

  await Promise.all([
    writeText(
      path.join(projectRoot, "academic_writer", "PAPER_PLAN.md"),
      ["# Paper Plan", "", `Topic: ${topic}`, "", "## Narrative", "- Evidence first", "- Close with limitations", ""].join("\n")
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
      ["# Story Spine", "", "- Problem pressure", "- Main evidence", "- Implication", ""].join("\n")
    ),
    writeText(
      path.join(projectRoot, "academic_writer", "story", "CROSS_DOMAIN_STORY_BRIDGE.md"),
      ["# Cross-Domain Story Bridge", "", "- Verification echoes dual-process reasoning.", ""].join("\n")
    ),
    writeText(path.join(projectRoot, "academic_writer", "paper", "main.tex"), mainTex),
    writeText(path.join(projectRoot, "academic_writer", "paper", "refs.bib"), bibEntries),
    writeText(
      path.join(projectRoot, "researcher", "ideation", "CROSS_DOMAIN_BRIDGE_EVIDENCE.json"),
      JSON.stringify({ topic, evidence: ["dual-process reasoning", "verification loops"] }, null, 2) + "\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "ideation", "NEURO_COGNITIVE_CONCEPT_MAP.md"),
      "# Neuro-Cognitive Concept Map\n\n- fast vs slow evaluation\n- verification before commitment\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "ideation", "CROSS_DOMAIN_RECONTEXTUALIZATION.md"),
      "# Cross-Domain Recontextualization\n\n- Translate cognitive verification into ML workflow gating.\n"
    ),
  ]);
}

async function runMailboxDeliveredHandoff(params) {
  const {
    projectRoot,
    projectId,
    workflowLine,
    stageAfter,
    ownerBefore,
    ownerAfter,
    fromSessionKey,
    command,
    summary,
  } = params;
  let mailboxMessageId = null;
  const created = await createStageOwnerHandoffIntent({
    projectRoot,
    projectId,
    workflowLine,
    stageBefore: null,
    stageAfter,
    ownerBefore,
    ownerAfter,
    fromSessionKey,
    nextAction: command,
    deliveryPlan: {
      channels: ["mailbox_compat"],
      requireAck: true,
      maxAttemptsTotal: 1,
      maxAttemptsByChannel: { mailbox_compat: 1 },
      fallbackAfterMs: 0,
      staleClaimAfterMs: 60_000,
      ackDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  const delivered = await deliverWorkflowHandoffIntent({
    intent: created.intent,
    runtime: {
      mailboxCompat: async (intent) => {
        const message = await queueWorkflowMailboxMessage({
          projectRoot,
          fromAgent: ownerBefore ?? "system",
          toAgent: ownerAfter,
          subject: `[handoff:${stageAfter}] ${summary}`,
          body: command ?? summary,
          kind: "handoff",
          priority: "normal",
        });
        mailboxMessageId = message.id;
        return { ok: true, messageId: message.id };
      },
    },
  });

  if (mailboxMessageId) {
    await acknowledgeWorkflowMailboxMessage({
      projectRoot,
      messageId: mailboxMessageId,
      agentId: ownerAfter,
    });
  }
  const acknowledged = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: delivered.intent.intentId,
    toStatus: "acknowledged",
    summary: `${ownerAfter} acknowledged ${stageAfter} handoff.`,
  });
  const claimed = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: acknowledged?.intentId ?? delivered.intent.intentId,
    toStatus: "claimed",
    summary: `${ownerAfter} claimed ${stageAfter} work.`,
    patch: {
      claimedAt: new Date().toISOString(),
      claimLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  const completed = await transitionWorkflowHandoffIntent({
    projectRoot,
    intentId: claimed?.intentId ?? delivered.intent.intentId,
    toStatus: "completed",
    summary: `${ownerAfter} completed ${stageAfter} handoff.`,
  });
  return {
    intentId: completed?.intentId ?? delivered.intent.intentId,
    mailboxMessageId,
    toRole: ownerAfter,
    stageAfter,
  };
}

async function runReviewDeliveredHandoff(params) {
  const handoff = await runMailboxDeliveredHandoff(params);
  return handoff;
}

async function seedSurveyArtifacts(projectRoot, topic) {
  await Promise.all([
    writeJson(path.join(projectRoot, "researcher", "SURVEY_QUERY_REGISTRY.json"), {
      rounds: [{ query: topic }, { query: `${topic} survey` }, { query: `${topic} benchmarks` }],
      candidate_paper_count: 24,
    }),
    writeJson(path.join(projectRoot, "researcher", "INCLUDED_PAPERS.json"), {
      papers: Array.from({ length: 12 }, (_, index) => ({
        canonical_id: `paper:${index + 1}`,
        title: `${topic} paper ${index + 1}`,
      })),
    }),
    writeJson(path.join(projectRoot, "researcher", "EXCLUDED_PAPERS.json"), {
      papers: [{ canonical_id: "paper:x1", reason: "out-of-scope" }],
    }),
    writeText(
      path.join(projectRoot, "researcher", "REVIEW_PROTOCOL.md"),
      "# Review Protocol\n\n- Search broadly\n- Screen for scope\n- Synthesize by taxonomy\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "LITERATURE_REVIEW.md"),
      "# Literature Review\n\n## Taxonomy\n- prototype-heavy\n- graph-aware\n- verification-first\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
      "# SOTA Matrix\n\n| Paper | Family | Dataset | Metric |\n| --- | --- | --- | --- |\n| A | prototype-heavy | CIFAR | ACC |\n| B | graph-aware | CUB | H-score |\n| C | verification-first | Aircraft | ACC |\n| D | prototype-heavy | ImageNet100 | NMI |\n| E | graph-aware | Herbarium | F1 |\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "GAP_SYNTHESIS.md"),
      "# Gap Synthesis\n\n- Benchmark comparisons remain inconsistent.\n- Verification methods are underexplored.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "COVERAGE_SUMMARY.md"),
      "# Coverage Summary\n\n- Search coverage spans major venues and benchmark settings.\n- Scope boundaries and blind spots are explicit in the current packet.\n- Representative families are covered and ready for synthesis.\n"
    ),
    writeText(
      path.join(projectRoot, "researcher", "SURVEY_BRIEF.md"),
      `# Survey Brief\n\n## Topic\n${topic}\n\n## Themes\n- taxonomy\n- benchmarks\n- verification\n\n## Open Problems\n- evaluation fragmentation\n`
    ),
  ]);

  const materialized = await materializeSurveyReviewState({
    projectRoot,
    surveyReviewMaterialization: { topic },
  });
  const iteratorResult = await runWorkflowAutoIterator({
    projectRoot,
    mode: "test",
    queueMailbox: false,
  });
  return { materialized, iteratorResult };
}

async function seedExperimentArtifacts(projectRoot, topic) {
  await Promise.all([
    writeText(path.join(projectRoot, "researcher", "IDEA_REPORT.md"), `# Idea Report\n\n- Topic: ${topic}\n- Core idea: verification-first GCD.\n`),
    writeText(path.join(projectRoot, "researcher", "IDEA_AUDIT.md"), "# Idea Audit\n\n- novelty: bounded\n- feasibility: acceptable\n"),
    writeText(path.join(projectRoot, "orchestrator", "PLAN.md"), "# Plan\n\n- implement gate\n- run smoke experiment\n- analyze and write\n"),
    writeText(path.join(projectRoot, "orchestrator", "TODOS.md"), "- [x] Implement\n- [x] Evaluate\n- [x] Write\n"),
    writeText(path.join(projectRoot, "orchestrator", "PLAN_AUDIT.md"), "# Plan Audit\n\n- scope is bounded\n"),
    writeText(path.join(projectRoot, "coder", "EXPERIMENT_INDEX.md"), "# Experiment Index\n\n- exp-001 verification gate smoke\n"),
    writeJson(path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json"), {
      experiments: [
        {
          experiment_id: "exp-001",
          status: "completed",
          summary: "verification gate smoke run",
        },
      ],
    }),
    writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "results.json"), {
      baseline: { h_score: 0.6123 },
      proposed: { h_score: 0.6345 },
      delta_h: 0.0222,
      verdict: "pass",
    }),
    writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "smoke_results.json"), {
      baseline: { h_score: 0.6123 },
      proposed: { h_score: 0.6345 },
      delta_h: 0.0222,
      verdict: "pass",
    }),
  ]);
}

async function runHarness(projectRoot, lane) {
  const { stdout } = await execFile(process.execPath, [
    path.join(process.cwd(), "scripts", "run-e2e-paper-generation.mjs"),
    "--project-root",
    projectRoot,
    "--lane",
    lane,
  ]);
  return JSON.parse(stdout);
}

async function runFixtureLane(params) {
  const { lane, topic, projectsRoot } = params;
  const commandName = lane === "survey" ? "auto-review" : "auto-research";
  const channelId = lane === "survey" ? "gcd-survey-lab" : "gcd-research-lab";
  const bootstrap = await dispatchWorkflowCommand({
    commandName,
    args: JSON.stringify(topic),
    projectsRoot,
    sessionKey: "agent:researcher:discord:slash:owner",
    channel: "discord",
    from: `discord:channel:${channelId}`,
    to: "slash:owner",
    accountId: "default",
    contextExtras: {
      sessionKey: "agent:researcher:discord:slash:owner",
      commandSource: "native",
      commandAuthorized: true,
      commandTargetSessionKey: `agent:researcher:discord:channel:${channelId}`,
      originatingChannel: "discord",
      originatingTo: `channel:${channelId}`,
    },
    emitFallbackNote: true,
  });

  const projectRoot =
    bootstrap.backgroundRuns[0]?.backgroundRun?.projectRoot ??
    null;
  if (!projectRoot) {
    throw new Error(`Failed to resolve project root for ${commandName}`);
  }

  if (lane === "survey") {
    const handoffs = [];
    handoffs.push(
      await runMailboxDeliveredHandoff({
        projectRoot,
        projectId: path.basename(projectRoot),
        workflowLine: "survey",
        stageAfter: "write",
        ownerBefore: "researcher",
        ownerAfter: "academic_writer",
        fromSessionKey: "agent:researcher:discord:channel:gcd-survey-lab",
        command: "/paper-phase",
        summary: "Survey review packet is complete; start survey writing.",
      })
    );
    const surveyState = await seedSurveyArtifacts(projectRoot, topic);
    await seedSharedWritingArtifacts({ projectRoot, topic, lane });
    const closeout = await reconcileAuthoringCloseout({
      projectRoot,
      compilePdf: true,
      currentStageOverride: "write",
    });
    handoffs.push(
      await runReviewDeliveredHandoff({
        projectRoot,
        projectId: path.basename(projectRoot),
        workflowLine: "survey",
        stageAfter: "review",
        ownerBefore: "academic_writer",
        ownerAfter: "reviewer",
        fromSessionKey: "agent:academic_writer:discord:channel:gcd-survey-lab",
        command: "/review-phase",
        summary: "Survey draft is ready for review closeout.",
      })
    );
    const harness = await runHarness(projectRoot, "survey");
    return { bootstrap, projectRoot, surveyState, closeout, handoffs, harness };
  }

  const handoffs = [];
  handoffs.push(
    await runMailboxDeliveredHandoff({
      projectRoot,
      projectId: path.basename(projectRoot),
      workflowLine: "experiment",
      stageAfter: "plan",
      ownerBefore: "researcher",
      ownerAfter: "orchestrator",
      fromSessionKey: "agent:researcher:discord:channel:gcd-research-lab",
      command: "/plan-research",
      summary: "Research evidence packet is ready for planning.",
    })
  );
  handoffs.push(
    await runMailboxDeliveredHandoff({
      projectRoot,
      projectId: path.basename(projectRoot),
      workflowLine: "experiment",
      stageAfter: "code",
      ownerBefore: "orchestrator",
      ownerAfter: "coder",
      fromSessionKey: "agent:orchestrator:discord:channel:gcd-research-lab",
      command: "/run-experiment",
      summary: "Approved experiment plan is ready for implementation.",
    })
  );
  await seedExperimentArtifacts(projectRoot, topic);
  handoffs.push(
    await runMailboxDeliveredHandoff({
      projectRoot,
      projectId: path.basename(projectRoot),
      workflowLine: "experiment",
      stageAfter: "analyze",
      ownerBefore: "coder",
      ownerAfter: "analyzer",
      fromSessionKey: "agent:coder:discord:channel:gcd-research-lab",
      command: "/analyze-results",
      summary: "Experiment artifacts are ready for analysis.",
    })
  );
  await seedSharedWritingArtifacts({ projectRoot, topic, lane });
  handoffs.push(
    await runMailboxDeliveredHandoff({
      projectRoot,
      projectId: path.basename(projectRoot),
      workflowLine: "experiment",
      stageAfter: "write",
      ownerBefore: "analyzer",
      ownerAfter: "academic_writer",
      fromSessionKey: "agent:analyzer:discord:channel:gcd-research-lab",
      command: "/paper-phase",
      summary: "Analysis packet is ready for paper writing.",
    })
  );
  const closeout = await reconcileAuthoringCloseout({
    projectRoot,
    compilePdf: true,
  });
  handoffs.push(
    await runReviewDeliveredHandoff({
      projectRoot,
      projectId: path.basename(projectRoot),
      workflowLine: "experiment",
      stageAfter: "review",
      ownerBefore: "academic_writer",
      ownerAfter: "reviewer",
      fromSessionKey: "agent:academic_writer:discord:channel:gcd-research-lab",
      command: "/review-phase",
      summary: "Conference draft is ready for review closeout.",
    })
  );
  const harness = await runHarness(projectRoot, "experiment");
  return { bootstrap, projectRoot, closeout, handoffs, harness };
}

async function main() {
  const topic = argValue("--topic", "Generalized Category Discovery");
  const lane = argValue("--lane", "full");
  const mode = argValue("--mode", "live");
  const projectsRoot =
    argValue("--projects-root") ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auto-command-e2e-")));

  if (mode === "live") {
    const result = {};
    if (lane === "experiment" || lane === "full") {
      result.experiment = await runAutoCommandEndToEndLive({
        lane: "experiment",
        topic,
        projectsRoot,
        profile: argValue("--profile", null),
        gatewayUrl: argValue("--gateway-url", null),
        gatewayToken: argValue("--gateway-token", null),
      });
    }
    if (lane === "survey" || lane === "full") {
      result.survey = await runAutoCommandEndToEndLive({
        lane: "survey",
        topic,
        projectsRoot,
        profile: argValue("--profile", null),
        gatewayUrl: argValue("--gateway-url", null),
        gatewayToken: argValue("--gateway-token", null),
      });
    }
    console.log(JSON.stringify({ topic, lane, mode, projectsRoot, result }, null, 2));
    return;
  }

  const result = {};
  if (lane === "experiment" || lane === "full") {
    result.experiment = await runFixtureLane({
      lane: "experiment",
      topic,
      projectsRoot,
    });
  }
  if (lane === "survey" || lane === "full") {
    result.survey = await runFixtureLane({
      lane: "survey",
      topic,
      projectsRoot,
    });
  }

  console.log(JSON.stringify({ topic, lane, mode, projectsRoot, result }, null, 2));
}

await main();
