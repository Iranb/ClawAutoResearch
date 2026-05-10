#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import {
  dispatchWorkflowCommand,
  resolveWorkflowHarnessProjectsRoot,
} from "./workflow_command_harness_lib.mjs";
import { buildWorkflowTransportContext } from "./workflow_transport_context.mjs";
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
import { resolveLocalPapernexusConfig } from "./local_papernexus_config.mjs";

const execFile = promisify(execFileCb);

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function numericArgValue(name, fallback = null) {
  const raw = argValue(name, null);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function conversationIdForLane(baseConversationId, lane, requestedLane) {
  if (!baseConversationId) {
    return null;
  }
  return requestedLane === "full" ? `${baseConversationId}-${lane}` : baseConversationId;
}

function projectIdForLane(baseProjectId, lane, requestedLane) {
  if (!baseProjectId) {
    return null;
  }
  return requestedLane === "full" ? `${baseProjectId}-${lane}` : baseProjectId;
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const surveyReferences = [
  ["gcdsurvey2026", "Survey Protocols for Generalized Category Discovery", "Surveyer, Ada", "ArXiv", 2026],
  ["gcdbaseline2023", "Baseline Families for Generalized Category Discovery", "Baseline, Ben", "ICCV", 2023],
  ["openworld2024", "Open World Recognition under Partial Supervision", "Open, Clara", "CVPR", 2024],
  ["taxonomy2025", "Taxonomies for Novel Class Discovery", "Taxon, Devon", "NeurIPS", 2025],
  ["coverage2025", "Coverage Audits for Literature Synthesis", "Cover, Ellis", "ACL", 2025],
  ["benchmark2024", "Benchmark Drift in Category Discovery", "Bench, Fatima", "ICML", 2024],
  ["retrieval2025", "Retrieval Led Evidence Control for Survey Writing", "Retrieve, Gray", "EMNLP", 2025],
  ["synthesis2026", "Claim Grounded Scientific Synthesis", "Synthesis, Harper", "TACL", 2026],
  ["evaluation2023", "Evaluation Stability for Discovery Models", "Stable, Ira", "ECCV", 2023],
  ["prototypes2024", "Prototype Learning for Novel Categories", "Proto, Jules", "WACV", 2024],
  ["graphgcd2025", "Graph Structures in Category Discovery", "Graph, Kai", "KDD", 2025],
  ["verification2026", "Verification Gates for Research Automation", "Verifier, Lee", "ArXiv", 2026],
  ["dualsystems2011", "Thinking Fast and Slow", "Kahneman, Daniel", "Farrar Straus and Giroux", 2011],
];

const experimentReferences = [
  ["gcdmethod2026", "Generalized Category Discovery with Verification Gates", "Researcher, Ada", "ArXiv", 2026],
  ["gcdbaseline2023", "A Baseline for Generalized Category Discovery", "Baseline, Ben", "ICCV", 2023],
  ["dualsystems2011", "Thinking Fast and Slow", "Kahneman, Daniel", "Farrar Straus and Giroux", 2011],
  ["openworld2024", "Open World Recognition under Partial Supervision", "Open, Clara", "CVPR", 2024],
  ["evaluation2023", "Evaluation Stability for Discovery Models", "Stable, Ira", "ECCV", 2023],
  ["verification2026", "Verification Gates for Research Automation", "Verifier, Lee", "ArXiv", 2026],
  ["benchmark2024", "Benchmark Drift in Category Discovery", "Bench, Fatima", "ICML", 2024],
  ["synthesis2026", "Claim Grounded Scientific Synthesis", "Synthesis, Harper", "TACL", 2026],
];

function bibEntriesFor(references) {
  return references
    .map(
      ([key, title, author, venue, year]) =>
        `@article{${key},\n  title={${title}},\n  author={${author}},\n  journal={${venue}},\n  year={${year}}\n}\n`
    )
    .join("\n");
}

function cite(keys) {
  return `\\cite{${keys.join(",")}}`;
}

function surveySectionBody(spec) {
  const citation = cite(spec.citations);
  return [
    `${spec.opening} ${citation}. The section treats ${spec.focus} as an operational contract rather than a loose narrative label, because a benchmark-facing survey has to show how papers were found, screened, compared, and converted into claims. It records what evidence is allowed to support each family, how boundary cases are handled, and where missing coverage changes the strength of a conclusion. This makes the synthesis reproducible enough for a reader to inspect the route from source packet to final prose.`,
    `For ${spec.focus}, the most important design pressure is ${spec.pressure}. The workflow therefore keeps a visible chain between retrieval notes, included-paper records, matrix rows, and the claims that appear in the manuscript. Each subsection states the scope first, then explains the comparison axis, then describes failure modes that would make the conclusion weaker. This ordering mirrors SurveyBench-style expectations: the output is not just a fluent summary, it is a coverage artifact with durable memory about evidence, exclusions, and benchmark relevance.`,
    `The practical consequence is that ${spec.consequence}. A thin draft can mention the same method families, but it cannot prove that representative systems, datasets, metrics, and disagreements were all considered. A stronger draft keeps taxonomy, benchmark landscape, and gap synthesis synchronized, so a later reviewer can replay why a claim is broad, narrow, or explicitly blocked. That replayable memory is the main difference between an ordinary literature overview and a survey that can be scored for coverage, faithfulness, and usefulness.`,
    `The section also records how citation-grounded implementation should behave. A claim must name the evidence family it draws from, keep the supporting papers resolvable in the bibliography, and avoid silently upgrading weak agreement into a broad conclusion. When a method family is represented by only a few papers, the prose marks that boundary instead of using it as a field-wide signal. When a benchmark row is missing a metric, the synthesis treats the gap as an evaluation limitation rather than filling it with an inferred number.`,
    `This durable memory is intentionally repetitive across the survey because long-form synthesis fails when local notes disappear between retrieval, planning, writing, and review. The review packet, SOTA matrix, and final manuscript should all preserve the same inclusion logic. That makes the workflow easier to audit under a benchmark that rewards coverage and coherence, and it gives later optimization work concrete failure points when the output is shallow, under-cited, or detached from its source artifacts.`,
  ].join("\n\n");
}

function buildSurveyMainTex(topic) {
  const sections = [
    {
      title: "Introduction",
      focus: "survey purpose and benchmark alignment",
      citations: ["gcdsurvey2026", "coverage2025"],
      opening:
        "This survey studies generalized category discovery as a field where retrieval coverage, taxonomy stability, and benchmark comparability determine whether a synthesis is trustworthy",
      pressure: "connecting a long-form narrative to auditable evidence rather than relying on fluent but ungrounded summaries",
      consequence:
        "the introduction defines the review question, the expected evidence trail, and the difference between descriptive coverage and actionable research guidance",
    },
    {
      title: "Search And Screening Protocol",
      focus: "query design and paper inclusion",
      citations: ["retrieval2025", "openworld2024"],
      opening:
        "Search quality controls the entire review because omitted families can make a later taxonomy look cleaner than the literature actually is",
      pressure: "showing that keyword expansion, venue coverage, and exclusion notes were all preserved before synthesis began",
      consequence:
        "the review packet can separate absent evidence from negative evidence, which prevents the manuscript from overstating gaps that were only retrieval failures",
    },
    {
      title: "Problem Setting",
      focus: "task definitions and supervision assumptions",
      citations: ["gcdbaseline2023", "evaluation2023"],
      opening:
        "Generalized category discovery combines partial labels, unlabeled examples, and unknown classes, so definitions must be fixed before method comparisons are meaningful",
      pressure: "distinguishing known-class accuracy, novel-class discovery, clustering stability, and open-world deployment assumptions",
      consequence:
        "the survey can compare systems without collapsing different supervision regimes into a single apparent leaderboard",
    },
    {
      title: "Method Taxonomy",
      focus: "method family organization",
      citations: ["taxonomy2025", "prototypes2024", "graphgcd2025"],
      opening:
        "The taxonomy groups methods by the mechanism that carries evidence from representation learning into final category assignments",
      pressure: "keeping prototype-heavy, graph-aware, contrastive, and verification-driven families distinct while still noting where hybrids appear",
      consequence:
        "readers can see whether a claimed advance changes the core discovery mechanism or only changes training hygiene around a familiar family",
    },
    {
      title: "Benchmark Landscape",
      focus: "datasets, metrics, and comparison stability",
      citations: ["benchmark2024", "evaluation2023"],
      opening:
        "Benchmark interpretation is difficult because datasets, known-novel splits, and reported metrics often shift across papers",
      pressure: "recording which metric each paper optimizes and whether a comparison is fair, partial, or merely illustrative",
      consequence:
        "the SOTA matrix becomes a source of constraints for the prose instead of a decorative table detached from the claims",
    },
    {
      title: "Evidence Synthesis",
      focus: "claim construction from source packets",
      citations: ["synthesis2026", "verification2026"],
      opening:
        "Evidence synthesis turns screened papers into claims only after the source packet has enough agreement to support the stated strength",
      pressure: "preventing confident survey language when the included papers disagree, omit ablations, or use incompatible evaluation settings",
      consequence:
        "the final text can state consensus, tension, and uncertainty with different claim strengths, making citation grounding systematic rather than incidental",
    },
    {
      title: "Cross Domain Signals",
      focus: "reusable ideas from verification and retrieval systems",
      citations: ["retrieval2025", "verification2026", "dualsystems2011"],
      opening:
        "Cross-domain inspiration is useful only when it clarifies an operational mechanism that can be checked against the category discovery literature",
      pressure: "borrowing evidence-routing ideas without replacing domain-specific benchmark requirements or paper inclusion rules",
      consequence:
        "the survey can use verification language to improve process discipline while still keeping the scientific conclusions tied to domain sources",
    },
    {
      title: "Open Problems",
      focus: "research gaps and future benchmark design",
      citations: ["gcdsurvey2026", "benchmark2024", "synthesis2026"],
      opening:
        "Open problems should be framed as evidence-weighted gaps, not as generic future-work lists that could apply to any discovery task",
      pressure: "separating unresolved technical questions from tooling gaps in retrieval, provenance, and benchmark reporting",
      consequence:
        "the conclusion can prioritize harder coverage audits, standardized result packets, and citation-grounded implementation checks for future automated research runs",
    },
  ];

  return [
    "\\documentclass{article}",
    "\\usepackage{hyperref}",
    "\\begin{document}",
    `\\title{${topic}}`,
    "\\maketitle",
    ...sections.flatMap((section) => [
      `\\section{${section.title}}`,
      surveySectionBody(section),
    ]),
    "\\bibliographystyle{plain}",
    "\\bibliography{refs}",
    "\\end{document}",
    "",
  ].join("\n");
}

function experimentSectionBody(spec) {
  const citation = cite(spec.citations);
  return [
    `${spec.opening} ${citation}. The goal is to keep the experiment lane close to a PaperBench-style reproduction task: code execution, result capture, analysis, and writing must preserve a durable link between the implemented change and the numbers reported in the paper. A successful closeout therefore needs more than a generated manuscript. It needs result artifacts, a ledger entry, figure and table packs, and prose that cites the exact metric values used for the headline claim.`,
    `This section records ${spec.focus}. The baseline H-score is 0.6123, the proposed H-score is 0.6345, and the measured delta H is 0.0222. Known-class accuracy moves from 0.7010 to 0.7180, while novel-class accuracy moves from 0.5410 to 0.5670. The ablation without class-balance debiasing is 0.6210, and the ablation without consistency filtering is 0.6260. These values are repeated in the paper because the strict harness must confirm that RESULT\\_SUMMARY-derived values are visible in the final artifact.`,
    `${spec.consequence}. The text also states the limitation that this deterministic run validates workflow integration and provenance controls, not broad benchmark dominance. That limitation matters because benchmark-aligned automation should avoid converting a local score into an unsupported scientific claim. The result is a compact but substantive paper artifact whose claims can be checked against the ledger, table pack, figure pack, and bibliography.`,
    `Specifically, the implementation consequence is a stronger handoff contract between coding, analysis, and writing. The coder stage emits structured metrics, the analyzer keeps the result interpretation bounded, and the academic writer repeats only values that exist in the durable packet. If a figure or table is generated later, it must carry data provenance back to the result artifact. This prevents the final manuscript from drifting away from the run that produced the evidence.`,
    `Beyond this, the benchmark-facing consequence is similarly concrete. A reproduction task should reward working code and measurable output, but it should also penalize untraceable numbers, missing ablations, and claims that cannot be connected to a recorded source. The fixture therefore keeps numeric values, ablation controls, and citation coverage visible in every section. It is not a substitute for a large benchmark campaign; it is a regression guard that catches the same classes of failure before a live run spends more time or model budget.`,
  ].join("\n\n");
}

function buildExperimentMainTex(topic) {
  const sections = [
    {
      title: "Introduction",
      focus: "the research motivation and evaluation target",
      citations: ["gcdmethod2026", "gcdbaseline2023"],
      opening:
        "We evaluate a verification-oriented workflow for generalized category discovery with explicit result provenance",
      consequence:
        "The introduction frames verification as a control-plane improvement that reduces unsupported claims during automated research",
    },
    {
      title: "Related Work",
      focus: "the relation to prototype, open-world, and verification literature",
      citations: ["gcdbaseline2023", "openworld2024", "dualsystems2011"],
      opening:
        "Prior systems emphasize representation learning, pseudo-label refinement, and open-world recognition assumptions",
      consequence:
        "The comparison positions our contribution as a workflow discipline layer rather than a replacement for domain methods",
    },
    {
      title: "Method",
      focus: "the verification gate and artifact contract",
      citations: ["verification2026", "gcdmethod2026"],
      opening:
        "The method adds an artifact gate that requires completed experiments to publish structured metrics before writing",
      consequence:
        "The gate turns implementation output into a stable memory primitive that later stages can replay without inference",
    },
    {
      title: "Experimental Setup",
      focus: "the bounded benchmark split and deterministic evaluation packet",
      citations: ["evaluation2023", "gcdbaseline2023"],
      opening:
        "The evaluation uses a bounded category discovery split with fixed known and novel class partitions",
      consequence:
        "The setup makes the experiment reproducible enough for E2E validation while keeping the benchmark scope explicit",
    },
    {
      title: "Results",
      focus: "the headline metric table and ablation evidence",
      citations: ["evaluation2023", "verification2026"],
      opening:
        "The result packet records a positive but bounded non-regression signal for the proposed verification workflow",
      consequence:
        "The results section ties every numerical claim to durable JSON evidence and prevents the prose from inventing unsupported metrics",
    },
    {
      title: "Discussion",
      focus: "the claim boundary and implementation implications",
      citations: ["gcdmethod2026", "openworld2024"],
      opening:
        "The main implication is that automated research needs explicit memory for what was implemented, measured, and cited",
      consequence:
        "The discussion keeps the scientific claim narrow while identifying provenance and citation grounding as the reusable improvement",
    },
    {
      title: "Limitations",
      focus: "remaining risks in local benchmark alignment",
      citations: ["benchmark2024", "synthesis2026"],
      opening:
        "The validation does not claim full benchmark coverage, external leaderboard parity, or superiority over all discovery methods",
      consequence:
        "The limitation section gives future runs a clear path to add harder tasks, larger corpora, and independent reproduction checks",
    },
  ];

  return [
    "\\documentclass{article}",
    "\\usepackage{booktabs}",
    "\\usepackage{hyperref}",
    "\\begin{document}",
    `\\title{${topic}}`,
    "\\maketitle",
    ...sections.flatMap((section) => [
      `\\section{${section.title}}`,
      experimentSectionBody(section),
    ]),
    "\\begin{table}[t]",
    "\\centering",
    "\\begin{tabular}{lrrr}",
    "\\toprule",
    "System & H-score & Known & Novel \\\\",
    "\\midrule",
    "Baseline & 0.6123 & 0.7010 & 0.5410 \\\\",
    "Proposed & 0.6345 & 0.7180 & 0.5670 \\\\",
    "Delta H & 0.0222 & -- & -- \\\\",
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Headline metrics copied from RESULT\\_SUMMARY evidence.}",
    "\\end{table}",
    "\\begin{table}[t]",
    "\\centering",
    "\\begin{tabular}{lr}",
    "\\toprule",
    "Ablation & H-score \\\\",
    "\\midrule",
    "Full verification gate & 0.6345 \\\\",
    "Minus class-balance debiasing & 0.6210 \\\\",
    "Minus consistency filtering & 0.6260 \\\\",
    "\\bottomrule",
    "\\end{tabular}",
    "\\caption{Ablation metrics copied from RESULT\\_SUMMARY evidence.}",
    "\\end{table}",
    "\\bibliographystyle{plain}",
    "\\bibliography{refs}",
    "\\end{document}",
    "",
  ].join("\n");
}

async function seedSharedWritingArtifacts(params) {
  const { projectRoot, topic, lane } = params;
  const bibEntries = bibEntriesFor(lane === "survey" ? surveyReferences : experimentReferences);
  const mainTex = lane === "survey" ? buildSurveyMainTex(topic) : buildExperimentMainTex(topic);

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
      "# SOTA Matrix\n\n| Paper | Family | Dataset | Metric |\n| --- | --- | --- | --- |\n| A | prototype-heavy | CIFAR | ACC |\n| B | graph-aware | CUB | H-score |\n| C | verification-first | Aircraft | ACC |\n| D | prototype-heavy | ImageNet100 | NMI |\n| E | graph-aware | Herbarium | F1 |\n| F | contrastive | StanfordCars | NMI |\n| G | pseudo-label | ImageNet100 | H-score |\n| H | retrieval-aware | iNaturalist | ACC |\n"
    ),
    writeJson(path.join(projectRoot, "researcher", "BENCHMARK_ADAPTER_FIXTURE.json"), {
      adapter: "paperguru-surveybench-local-protocol",
      benchmark_id: "paperguru-surveybench-local-fixture",
      task_type: "survey",
      metric: "coverage_score",
      baseline_score: 0.58,
      candidate_score: 0.818,
      holdout_score: 0.79,
      evidence_paths: [
        "researcher/INCLUDED_PAPERS.json",
        "researcher/SOTA_MATRIX.md",
        "academic_writer/paper/main.tex",
      ],
    }),
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
      baseline: { h_score: 0.6123, known_accuracy: 0.701, novel_accuracy: 0.541 },
      proposed: { h_score: 0.6345, known_accuracy: 0.718, novel_accuracy: 0.567 },
      delta_h: 0.0222,
      ablations: {
        minus_class_balance_debiasing: { h_score: 0.621 },
        minus_consistency_filtering: { h_score: 0.626 },
      },
      metrics: { h_score: 0.6345, known_accuracy: 0.718, novel_accuracy: 0.567, delta_h_score: 0.0222 },
      verdict: "pass",
    }),
    writeJson(path.join(projectRoot, "researcher", "artifacts", "results", "smoke_results.json"), {
      baseline: { h_score: 0.6123, known_accuracy: 0.701, novel_accuracy: 0.541 },
      proposed: { h_score: 0.6345, known_accuracy: 0.718, novel_accuracy: 0.567 },
      delta_h: 0.0222,
      ablations: {
        minus_class_balance_debiasing: { h_score: 0.621 },
        minus_consistency_filtering: { h_score: 0.626 },
      },
      metrics: { h_score: 0.6345, known_accuracy: 0.718, novel_accuracy: 0.567, delta_h_score: 0.0222 },
      verdict: "pass",
    }),
    writeJson(path.join(projectRoot, "researcher", "BENCHMARK_ADAPTER_FIXTURE.json"), {
      adapter: "paperguru-paperbench-local-protocol",
      benchmark_id: "paperguru-paperbench-local-fixture",
      task_type: "paper_to_code",
      metric: "h_score",
      baseline_score: 0.6123,
      candidate_score: 0.6345,
      holdout_score: 0.628,
      evidence_paths: [
        "researcher/artifacts/results/results.json",
        "researcher/EXPERIMENT_LEDGER.json",
        "academic_writer/TABLE_PACK.json",
        "academic_writer/FIGURE_PACK.json",
      ],
    }),
  ]);
}

async function runHarness(projectRoot, lane, options = {}) {
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
  const { stdout } = await execFile(process.execPath, args);
  return JSON.parse(stdout);
}

async function runFixtureLane(params) {
  const { lane, topic, projectsRoot, bootstrapTransport = "local", projectId = null } = params;
  const strictContent = Boolean(params.strictContent);
  const commandName = lane === "survey" ? "auto-review" : "auto-research";
  const transportContext = buildWorkflowTransportContext({
    transport: bootstrapTransport,
    lane,
    conversationId:
      params.conversationId ??
      (lane === "survey"
        ? bootstrapTransport === "discord"
          ? "gcd-survey-lab"
          : "gcd-survey-local"
        : bootstrapTransport === "discord"
          ? "gcd-research-lab"
          : "gcd-research-local"),
  });
  const bootstrap = await dispatchWorkflowCommand({
    commandName,
    args: JSON.stringify(topic),
    projectsRoot,
    sessionKey: transportContext.bootstrapSessionKey,
    channel: transportContext.channel,
    from: transportContext.from,
    to: transportContext.to,
    accountId: transportContext.accountId,
    contextExtras: {
      ...transportContext.commandContextExtras(),
      ...(projectId ? { projectId } : {}),
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
        fromSessionKey: transportContext.sessionKeyFor("researcher"),
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
        fromSessionKey: transportContext.sessionKeyFor("academic_writer"),
        command: "/review-phase",
        summary: "Survey draft is ready for review closeout.",
      })
    );
    const harness = await runHarness(projectRoot, "survey", { strictContent });
    return {
      transport: transportContext.transport,
      conversationId: transportContext.conversationId,
      bootstrap,
      projectRoot,
      surveyState,
      closeout,
      handoffs,
      harness,
    };
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
      fromSessionKey: transportContext.sessionKeyFor("researcher"),
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
      fromSessionKey: transportContext.sessionKeyFor("orchestrator"),
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
      fromSessionKey: transportContext.sessionKeyFor("coder"),
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
      fromSessionKey: transportContext.sessionKeyFor("analyzer"),
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
      fromSessionKey: transportContext.sessionKeyFor("academic_writer"),
      command: "/review-phase",
      summary: "Conference draft is ready for review closeout.",
    })
  );
  const harness = await runHarness(projectRoot, "experiment", { strictContent });
  return {
    transport: transportContext.transport,
    conversationId: transportContext.conversationId,
    bootstrap,
    projectRoot,
    closeout,
    handoffs,
    harness,
  };
}

async function main() {
  const topic = argValue("--topic", "Generalized Category Discovery");
  const lane = argValue("--lane", "full");
  const mode = argValue("--mode", "live");
  const bootstrapTransport = argValue("--bootstrap-transport", "local");
  const conversationId = argValue("--conversation-id", null);
  const projectId = argValue("--project-id", null);
  const strictContent = hasFlag("--strict-content");
  const sourceConfigPath = argValue("--source-config-path", null);
  const explicitProjectsRoot = argValue("--projects-root", null);
  const projectsRoot =
    mode === "live"
      ? await resolveWorkflowHarnessProjectsRoot({
          projectsRoot: explicitProjectsRoot,
          sourceConfigPath,
          fallback: path.join(os.tmpdir(), `openclaw-auto-command-e2e-${Date.now()}`),
        })
      : explicitProjectsRoot ??
        (await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-auto-command-e2e-")));
  const localPapernexus = await resolveLocalPapernexusConfig(process.argv);

  if (mode === "live") {
    const result = {};
    const liveOptions = {
      profile: argValue("--profile", null),
      gatewayUrl: argValue("--gateway-url", null),
      gatewayToken: argValue("--gateway-token", null),
      bootstrapTransport,
      sourceConfigPath,
      gatewayStartupTimeoutMs: numericArgValue("--gateway-startup-timeout-ms", null),
      bootstrapTimeoutMs: numericArgValue("--bootstrap-timeout-ms", null),
      projectRootTimeoutMs: numericArgValue("--project-root-timeout-ms", null),
      maxIterations: numericArgValue("--max-iterations", null),
      maxNoProgressTurns: numericArgValue("--max-no-progress-turns", null),
      stageTimeoutMs: numericArgValue("--stage-timeout-ms", null),
      agentWaitTimeoutMs: numericArgValue("--agent-wait-timeout-ms", null),
      progressPollMs: numericArgValue("--progress-poll-ms", null),
      isolatedGateway: !hasFlag("--no-isolated-gateway"),
      pluginConfigOverrides: localPapernexus.pluginOverrides,
      envOverrides: localPapernexus.envOverrides,
      ...(strictContent ? { strictContent } : {}),
    };
    if (lane === "experiment" || lane === "full") {
      result.experiment = await runAutoCommandEndToEndLive({
        lane: "experiment",
        topic,
        projectsRoot,
        conversationId: conversationIdForLane(conversationId, "experiment", lane),
        projectId: projectIdForLane(projectId, "experiment", lane),
        ...liveOptions,
      });
    }
    if (lane === "survey" || lane === "full") {
      result.survey = await runAutoCommandEndToEndLive({
        lane: "survey",
        topic,
        projectsRoot,
        conversationId: conversationIdForLane(conversationId, "survey", lane),
        projectId: projectIdForLane(projectId, "survey", lane),
        ...liveOptions,
      });
    }
    console.log(
      JSON.stringify(
        {
          topic,
          lane,
          mode,
          bootstrapTransport,
          conversationId,
          projectId,
          projectsRoot,
          strictContent,
          localPapernexus: localPapernexus.summary,
          result,
        },
        null,
        2
      )
    );
    return;
  }

  const result = {};
  if (lane === "experiment" || lane === "full") {
    result.experiment = await runFixtureLane({
      lane: "experiment",
      topic,
      projectsRoot,
      bootstrapTransport,
      conversationId: conversationIdForLane(conversationId, "experiment", lane),
      projectId: projectIdForLane(projectId, "experiment", lane),
      strictContent,
    });
  }
  if (lane === "survey" || lane === "full") {
    result.survey = await runFixtureLane({
      lane: "survey",
      topic,
      projectsRoot,
      bootstrapTransport,
      conversationId: conversationIdForLane(conversationId, "survey", lane),
      projectId: projectIdForLane(projectId, "survey", lane),
      strictContent,
    });
  }

  console.log(
    JSON.stringify({ topic, lane, mode, bootstrapTransport, conversationId, projectId, projectsRoot, strictContent, result }, null, 2)
  );
}

await main();
await Promise.all([
  new Promise((resolve) => process.stdout.write("", resolve)),
  new Promise((resolve) => process.stderr.write("", resolve)),
]);
process.exit(process.exitCode ?? 0);
