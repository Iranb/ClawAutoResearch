import type { EvidenceCloseoutSummary } from "../workflow-evidence/closeout-summary";

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
};

function makeTask(
  taskId: string,
  title: string,
  owner: string | null,
  status: WorkflowStageTaskPreview["status"],
  reason: string | null = null,
  options: {
    dependsOn?: string[];
    verificationRule?: WorkflowTaskVerificationRule;
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
  };
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
            "ready",
            null,
            { verificationRule: "none" }
          ),
        ];
      case "write":
        return [
          makeTask(
            "write.polish_and_compile",
            "Polish the draft, keep graph evidence aligned, and maintain compile-safe sections",
            "academic_writer",
            "ready",
            null,
            { verificationRule: "none" }
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
        makeTask(
          "write.keep_story_and_evidence_aligned",
          "Keep story, evidence, and venue positioning aligned while drafting",
          "academic_writer",
          "ready",
          null,
          {
            dependsOn: ["write.complete_repro_pack"],
            verificationRule: "write_closeout",
          }
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
