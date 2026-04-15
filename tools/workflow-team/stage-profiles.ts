import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";
import type { WorkflowWriteScopeMode } from "../workflow-handoff/write-scope";

export type WorkflowTaskVerificationRule =
  | "none"
  | "benchmark_protocol"
  | "statistical_evidence"
  | "ablation_evidence"
  | "mechanism_evidence"
  | "venue_competition"
  | "reproducibility_pack"
  | "camera_ready_evidence"
  | "write_closeout"
  | "submit_closeout";

export type WorkflowStageTaskPreview = {
  taskId: string;
  title: string;
  owner: string | null;
  status: "ready" | "blocked" | "optional";
  reason: string | null;
  dependsOn: string[];
  verificationRule: WorkflowTaskVerificationRule;
  writeScope?: {
    ownedDirs: string[];
    exclusiveFiles: string[];
    mode: WorkflowWriteScopeMode;
  };
};

const DEFAULT_WRITE_SECTION_ORDER = [
  "abstract",
  "introduction",
  "related_work",
  "method",
  "experiments",
  "results",
  "discussion",
  "limitations",
  "conclusion",
] as const;

function makeTask(
  taskId: string,
  title: string,
  owner: string | null,
  status: WorkflowStageTaskPreview["status"],
  reason: string | null = null,
  options: {
    dependsOn?: string[];
    verificationRule?: WorkflowTaskVerificationRule;
    writeScope?: WorkflowStageTaskPreview["writeScope"];
  } = {}
): WorkflowStageTaskPreview {
  return {
    taskId,
    title,
    owner,
    status,
    reason,
    dependsOn: options.dependsOn ?? [],
    verificationRule: options.verificationRule ?? "none",
    writeScope: options.writeScope,
  };
}

function buildSectionWriteScope(sectionId: string): WorkflowStageTaskPreview["writeScope"] {
  return {
    ownedDirs: [],
    exclusiveFiles: [
      `academic_writer/paper/sections/${sectionId}.tex`,
      `academic_writer/section-packets/${sectionId}.json`,
      `academic_writer/section_packets/${sectionId}.md`,
    ],
    mode: "exclusive_write",
  };
}

function normalizeWriteSectionOrder(value: string[] | null | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value ?? []) {
    if (typeof entry !== "string") {
      continue;
    }
    const sectionId = entry.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!sectionId || seen.has(sectionId)) {
      continue;
    }
    seen.add(sectionId);
    normalized.push(sectionId);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_WRITE_SECTION_ORDER];
}

function humanizeSectionId(sectionId: string): string {
  return sectionId
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildWriteSectionTaskPreview(params: {
  sectionOrder: string[] | null | undefined;
  initialDependsOnTaskId?: string | null;
  finalTaskId: string;
  finalTaskTitle: string;
  finalVerificationRule: WorkflowTaskVerificationRule;
}): WorkflowStageTaskPreview[] {
  const sectionOrder = normalizeWriteSectionOrder(params.sectionOrder);
  const tasks: WorkflowStageTaskPreview[] = [];
  let previousTaskId =
    typeof params.initialDependsOnTaskId === "string" &&
    params.initialDependsOnTaskId.trim()
      ? params.initialDependsOnTaskId.trim()
      : null;

  for (const sectionId of sectionOrder) {
    const taskId = `write.section.${sectionId}`;
    tasks.push(
      makeTask(
        taskId,
        `Draft and harden the ${humanizeSectionId(sectionId)} section`,
        "academic_writer",
        "blocked",
        null,
        {
          dependsOn: previousTaskId ? [previousTaskId] : [],
          verificationRule: "none",
          writeScope: buildSectionWriteScope(sectionId),
        }
      )
    );
    previousTaskId = taskId;
  }

  tasks.push(
    makeTask(
      params.finalTaskId,
      params.finalTaskTitle,
      "academic_writer",
      "blocked",
      null,
      {
        dependsOn: previousTaskId ? [previousTaskId] : [],
        verificationRule: params.finalVerificationRule,
        writeScope: {
          ownedDirs: [],
          exclusiveFiles: [
            "academic_writer/paper/main.tex",
            "academic_writer/WRITING_SIGNALS.md",
          ],
          mode: "exclusive_write",
        },
      }
    )
  );

  return tasks;
}

export function buildWorkflowStageTaskPreview(params: {
  currentStage: string | null;
  topTierVerdict: string | null;
  evidenceCloseout: EvidenceCloseoutSummary;
  writingSectionOrder?: string[] | null;
}): WorkflowStageTaskPreview[] {
  const stage = params.currentStage;
  const topTier = params.topTierVerdict === "worth_top_tier_bet";

  if (!stage) {
    return [];
  }

  if (!topTier) {
    switch (stage) {
      case "experiment":
        return [
          makeTask(
            "experiment.monitor_or_reconcile",
            "Monitor active runs or reconcile finished experiment outputs",
            "researcher",
            "ready",
            null,
            { verificationRule: "none" }
          ),
        ];
      case "write":
        return buildWriteSectionTaskPreview({
          sectionOrder: params.writingSectionOrder,
          finalTaskId: "write.polish_and_compile",
          finalTaskTitle:
            "Polish the draft, keep graph evidence aligned, and maintain compile-safe sections",
          finalVerificationRule: "none",
        });
      default:
        return [];
    }
  }

  switch (stage) {
    case "experiment":
      return [
        makeTask(
          "experiment.lock_benchmark_protocol",
          "Lock the benchmark protocol and drift status before top-tier analysis",
          "orchestrator",
          params.evidenceCloseout.experimentAnalyzeReady ? "ready" : "blocked",
          params.evidenceCloseout.experimentAnalyzeReady
            ? null
            : "Benchmark/statistical/ablation evidence is still incomplete.",
          { verificationRule: "benchmark_protocol" }
        ),
        makeTask(
          "experiment.aggregate_statistics",
          "Materialize statistical evidence and claim-strength summary",
          "analyzer",
          params.evidenceCloseout.experimentAnalyzeReady ? "ready" : "blocked",
          null,
          {
            dependsOn: ["experiment.lock_benchmark_protocol"],
            verificationRule: "statistical_evidence",
          }
        ),
        makeTask(
          "experiment.evaluate_ablation_sufficiency",
          "Summarize publication-critical ablations and sufficiency status",
          "researcher",
          params.evidenceCloseout.experimentAnalyzeReady ? "ready" : "blocked",
          null,
          {
            dependsOn: ["experiment.aggregate_statistics"],
            verificationRule: "ablation_evidence",
          }
        ),
      ];
    case "analyze":
      return [
        makeTask(
          "analyze.materialize_mechanism_packet",
          "Produce a mechanism evidence packet tied to the strongest results",
          "analyzer",
          params.evidenceCloseout.analyzeReviewReady ? "ready" : "blocked",
          params.evidenceCloseout.analyzeReviewReady
            ? null
            : "Mechanism evidence or venue competition context is not graph-grounded.",
          { verificationRule: "mechanism_evidence" }
        ),
        makeTask(
          "analyze.finalize_competitor_slate",
          "Finalize the graph-grounded competitor slate for review pressure",
          "researcher",
          params.evidenceCloseout.analyzeReviewReady ? "ready" : "blocked",
          null,
          { verificationRule: "venue_competition" }
        ),
      ];
    case "review":
      return [
        makeTask(
          "review.confirm_venue_pressure",
          "Confirm venue pressure and novelty positioning before write handoff",
          "reviewer",
          params.evidenceCloseout.writeReady ? "ready" : "blocked",
          params.evidenceCloseout.writeReady
            ? null
            : "Venue competition or reproducibility readiness still blocks write closeout.",
          { verificationRule: "venue_competition" }
        ),
        makeTask(
          "review.confirm_repro_readiness",
          "Confirm the reproducibility pack is strong enough for write handoff",
          "reviewer",
          params.evidenceCloseout.writeReady ? "ready" : "blocked",
          null,
          { verificationRule: "reproducibility_pack" }
        ),
        makeTask(
          "review.closeout_for_write",
          "Run the evidence closeout check for the write handoff",
          "reviewer",
          params.evidenceCloseout.writeReady ? "ready" : "blocked",
          null,
          {
            dependsOn: [
              "review.confirm_venue_pressure",
              "review.confirm_repro_readiness",
            ],
            verificationRule: "write_closeout",
          }
        ),
      ];
    case "write":
      return [
        makeTask(
          "write.complete_repro_pack",
          "Finish the reproducibility pack before top-tier write handoff",
          "academic_writer",
          params.evidenceCloseout.writeReady ? "ready" : "blocked",
          params.evidenceCloseout.writeReady
            ? null
            : "Reproducibility pack or graph-grounded opportunity context is incomplete.",
          { verificationRule: "reproducibility_pack" }
        ),
        ...buildWriteSectionTaskPreview({
          sectionOrder: params.writingSectionOrder,
          initialDependsOnTaskId: "write.complete_repro_pack",
          finalTaskId: "write.keep_story_and_evidence_aligned",
          finalTaskTitle:
            "Keep story, evidence, and venue positioning aligned while drafting",
          finalVerificationRule: "write_closeout",
        }),
      ];
    case "submit":
      return [
        makeTask(
          "submit.camera_ready_package",
          "Finish the camera-ready evidence package for figures, tables, and captions",
          "reviewer",
          params.evidenceCloseout.submitReady ? "ready" : "blocked",
          params.evidenceCloseout.submitReady
            ? null
            : "Camera-ready evidence is not fully ready for top-tier submit.",
          { verificationRule: "camera_ready_evidence" }
        ),
        makeTask(
          "submit.final_confidence_check",
          "Run the final top-tier evidence closeout check before submit",
          "reviewer",
          params.evidenceCloseout.status === "ready" ? "ready" : "blocked",
          null,
          {
            dependsOn: ["submit.camera_ready_package"],
            verificationRule: "submit_closeout",
          }
        ),
      ];
    default:
      return [];
  }
}
