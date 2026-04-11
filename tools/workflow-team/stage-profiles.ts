import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";

export type WorkflowStageTaskPreview = {
  taskId: string;
  title: string;
  owner: string | null;
  status: "ready" | "blocked" | "optional";
  reason: string | null;
};

function makeTask(
  taskId: string,
  title: string,
  owner: string | null,
  status: WorkflowStageTaskPreview["status"],
  reason: string | null = null
): WorkflowStageTaskPreview {
  return { taskId, title, owner, status, reason };
}

export function buildWorkflowStageTaskPreview(params: {
  currentStage: string | null;
  topTierVerdict: string | null;
  evidenceCloseout: EvidenceCloseoutSummary;
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
            "ready"
          ),
        ];
      case "write":
        return [
          makeTask(
            "write.polish_and_compile",
            "Polish the draft, keep graph evidence aligned, and maintain compile-safe sections",
            "academic_writer",
            "ready"
          ),
        ];
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
            : "Benchmark/statistical/ablation evidence is still incomplete."
        ),
        makeTask(
          "experiment.aggregate_statistics",
          "Materialize statistical evidence and claim-strength summary",
          "analyzer",
          params.evidenceCloseout.experimentAnalyzeReady ? "ready" : "blocked"
        ),
        makeTask(
          "experiment.evaluate_ablation_sufficiency",
          "Summarize publication-critical ablations and sufficiency status",
          "researcher",
          params.evidenceCloseout.experimentAnalyzeReady ? "ready" : "blocked"
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
            : "Mechanism evidence or venue competition context is not graph-grounded."
        ),
        makeTask(
          "analyze.finalize_competitor_slate",
          "Finalize the graph-grounded competitor slate for review pressure",
          "researcher",
          params.evidenceCloseout.analyzeReviewReady ? "ready" : "blocked"
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
            : "Reproducibility pack or graph-grounded opportunity context is incomplete."
        ),
        makeTask(
          "write.keep_story_and_evidence_aligned",
          "Keep story, evidence, and venue positioning aligned while drafting",
          "academic_writer",
          "ready"
        ),
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
            : "Camera-ready evidence is not fully ready for top-tier submit."
        ),
        makeTask(
          "submit.final_confidence_check",
          "Run the final top-tier evidence closeout check before submit",
          "reviewer",
          params.evidenceCloseout.status === "ready" ? "ready" : "blocked"
        ),
      ];
    default:
      return [];
  }
}
