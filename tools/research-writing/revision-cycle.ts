import { writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type { PaperStoryState } from "../workflow-guard.js";

export const DEFAULT_PAPER_REVISION_STATE_PATH =
  "academic_writer/PAPER_REVISION_STATE.json";

function buildPassStatus(stage: string | null, passKey: string): string {
  if (passKey === "writing_quality_pass") {
    if (stage === "submit" || stage === "review") {
      return "required";
    }
    return "pending";
  }
  if (passKey === "claim_verification_pass") {
    if (stage === "submit" || stage === "review") {
      return "required";
    }
    return "pending";
  }
  if (stage === "submit") {
    if (passKey === "section_pass") {
      return "ready";
    }
    return "required";
  }
  if (stage === "review") {
    if (passKey === "section_pass" || passKey === "intro_method_consistency_pass") {
      return "required";
    }
    return "pending";
  }
  if (stage === "write") {
    return passKey === "section_pass" ? "required" : "pending";
  }
  return "pending";
}

export async function materializeRevisionCycle(params: {
  projectRoot: string;
  stage: string | null;
  paperStoryState: PaperStoryState;
  fallbackActivation: {
    activeNarrativeMode: string;
    blockingClaimIds: string[];
    triggerReason: string | null;
    recommendedStorySwitch: string | null;
  } | null;
  artifactPath?: string | null;
}) {
  const stage = params.stage ?? "write";
  const state = {
    status: "ready",
    stage,
    storyMode: params.fallbackActivation?.activeNarrativeMode ?? "main",
    revisionPriority:
      params.fallbackActivation?.activeNarrativeMode === "fallback"
        ? "protect-support-before-polish"
        : "strengthen-main-story",
    passes: {
      section_pass: {
        status: buildPassStatus(stage, "section_pass"),
        objective: "Rewrite local sections until each paragraph has one message and one evidence role.",
      },
      intro_method_consistency_pass: {
        status: buildPassStatus(stage, "intro_method_consistency_pass"),
        objective:
          "Check whether the introduction promise and method realization still match after evidence downgrades.",
      },
      full_paper_adversarial_pass: {
        status: buildPassStatus(stage, "full_paper_adversarial_pass"),
        objective:
          "Run full-paper skeptic review, especially for overclaim, novelty drift, and limitation coverage.",
      },
      writing_quality_pass: {
        status: buildPassStatus(stage, "writing_quality_pass"),
        objective:
          "Run the writing-quality sweep for AI-typical prose, paragraph rhythm, and throat-clearing patterns before final polish.",
      },
      claim_verification_pass: {
        status: buildPassStatus(stage, "claim_verification_pass"),
        objective:
          "Verify that abstract, introduction, and headline result claims still match evidence without major distortion or unverifiable jumps.",
      },
    },
    storySpinePath: params.paperStoryState.storySpinePath,
    claimMapPath: params.paperStoryState.claimToExperimentMapPath,
    blockingClaimIds: params.fallbackActivation?.blockingClaimIds ?? [],
    triggerReason: params.fallbackActivation?.triggerReason ?? null,
    recommendedStorySwitch:
      params.fallbackActivation?.recommendedStorySwitch ?? null,
    generatedAt: new Date().toISOString(),
  };

  const artifactPath = params.artifactPath ?? DEFAULT_PAPER_REVISION_STATE_PATH;
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error("Unable to resolve PAPER_REVISION_STATE.json path.");
  }
  await writeJsonEnsured(resolvedPath, {
    status: state.status,
    stage: state.stage,
    story_mode: state.storyMode,
    revision_priority: state.revisionPriority,
    passes: state.passes,
    story_spine_path: state.storySpinePath,
    claim_map_path: state.claimMapPath,
    blocking_claim_ids: state.blockingClaimIds,
    trigger_reason: state.triggerReason,
    recommended_story_switch: state.recommendedStorySwitch,
    generated_at: state.generatedAt,
  });
  return {
    path: artifactPath,
    state,
  };
}
