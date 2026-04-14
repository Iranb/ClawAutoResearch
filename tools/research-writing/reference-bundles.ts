import { writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";

export const DEFAULT_WRITING_REFERENCE_BUNDLE_PATH =
  "academic_writer/WRITING_REFERENCE_BUNDLE.json";

const REFERENCE_ROOT = "skills/academic_writer/research-paper-writing/references";

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function refPath(fileName: string): string {
  return `${REFERENCE_ROOT}/${fileName}`;
}

export async function materializeWritingReferenceBundle(params: {
  projectRoot: string;
  paperStoryState: PaperStoryState;
  reviewPressureState: ReviewPressurePacketState | null;
  artifactPath?: string | null;
}) {
  const bundle = {
    status: "ready",
    generatedAt: new Date().toISOString(),
    referenceRoot: REFERENCE_ROOT,
    storyArtifacts: {
      storySpinePath: params.paperStoryState.storySpinePath,
      claimToExperimentMapPath: params.paperStoryState.claimToExperimentMapPath,
      fallbackNarrativePath: params.paperStoryState.fallbackNarrativePath,
      rejectionRiskTablePath: params.paperStoryState.rejectionRiskTablePath,
      ideaToClaimMapPath: params.paperStoryState.ideaToClaimMapPath,
      venueRoutingPlanPath: "academic_writer/VENUE_ROUTING_PLAN.md",
    },
    reviewArtifacts: {
      rejectFirstReviewPath: params.reviewPressureState?.rejectFirstReviewPath ?? null,
      noveltyAttackPath: params.reviewPressureState?.noveltyAttackPath ?? null,
      unsupportedClaimAuditPath:
        params.reviewPressureState?.unsupportedClaimAuditPath ?? null,
      reverseOutlinePath: params.reviewPressureState?.reverseOutlinePath ?? null,
      figureTableQcPath: params.reviewPressureState?.figureTableQcPath ?? null,
      limitationAuditPath: params.reviewPressureState?.limitationAuditPath ?? null,
      rebuttalResponsePath: "reviewer/rebuttal_{date}.md",
    },
    globalReferencePaths: uniqueStrings([
      refPath("counterintuitive-writing.md"),
      refPath("story-planning-rules.md"),
      refPath("thesis-crystallization.md"),
      refPath("self-attack-protocol.md"),
      refPath("figure-centric-writing.md"),
      refPath("writing-quality-check.md"),
      refPath("writing-judgment-framework.md"),
      refPath("review-quality-lenses.md"),
      refPath("claim-verification-protocol.md"),
      refPath("paper-review.md"),
      refPath("does-my-writing-flow-source.md"),
      refPath("survey-writing.md"),
    ]),
    stageBundles: {
      plan: {
        referencePaths: uniqueStrings([
          refPath("story-planning-rules.md"),
          refPath("thesis-crystallization.md"),
          refPath("writing-judgment-framework.md"),
          refPath("counterintuitive-writing.md"),
          refPath("figure-centric-writing.md"),
          refPath("paper-review.md"),
          refPath("introduction.md"),
          refPath("method.md"),
          refPath("experiments.md"),
          "academic_writer/VENUE_ROUTING_PLAN.md",
        ]),
      },
      write: {
        referencePaths: uniqueStrings([
          refPath("counterintuitive-writing.md"),
          refPath("story-planning-rules.md"),
          refPath("self-attack-protocol.md"),
          refPath("figure-centric-writing.md"),
          refPath("writing-quality-check.md"),
          refPath("writing-judgment-framework.md"),
          refPath("claim-verification-protocol.md"),
          refPath("abstract.md"),
          refPath("introduction.md"),
          refPath("related-work.md"),
          refPath("method.md"),
          refPath("experiments.md"),
          refPath("conclusion.md"),
          refPath("paper-review.md"),
          "academic_writer/VENUE_ROUTING_PLAN.md",
          refPath("survey-writing.md"),
        ]),
      },
      review: {
        referencePaths: uniqueStrings([
          refPath("paper-review.md"),
          refPath("self-attack-protocol.md"),
          refPath("counterintuitive-writing.md"),
          refPath("review-quality-lenses.md"),
          refPath("claim-verification-protocol.md"),
          refPath("does-my-writing-flow-source.md"),
          "reviewer/rebuttal_{date}.md",
        ]),
      },
      submit: {
        referencePaths: uniqueStrings([
          refPath("paper-review.md"),
          refPath("counterintuitive-writing.md"),
          refPath("figure-centric-writing.md"),
          refPath("review-quality-lenses.md"),
          refPath("claim-verification-protocol.md"),
          refPath("does-my-writing-flow-source.md"),
          "academic_writer/VENUE_ROUTING_PLAN.md",
          "reviewer/rebuttal_{date}.md",
        ]),
      },
    },
    sectionBundles: {
      abstract: {
        referencePaths: uniqueStrings([
          refPath("abstract.md"),
          refPath("counterintuitive-writing.md"),
          refPath("writing-quality-check.md"),
          refPath("self-attack-protocol.md"),
        ]),
      },
      introduction: {
        referencePaths: uniqueStrings([
          refPath("introduction.md"),
          refPath("thesis-crystallization.md"),
          refPath("story-planning-rules.md"),
          refPath("counterintuitive-writing.md"),
          refPath("writing-judgment-framework.md"),
          refPath("does-my-writing-flow-source.md"),
        ]),
      },
      related_work: {
        referencePaths: uniqueStrings([
          refPath("related-work.md"),
          refPath("counterintuitive-writing.md"),
        ]),
      },
      method: {
        referencePaths: uniqueStrings([
          refPath("method.md"),
          refPath("figure-centric-writing.md"),
          refPath("writing-judgment-framework.md"),
          refPath("does-my-writing-flow-source.md"),
        ]),
      },
      experiments: {
        referencePaths: uniqueStrings([
          refPath("experiments.md"),
          refPath("self-attack-protocol.md"),
          refPath("claim-verification-protocol.md"),
          refPath("paper-review.md"),
        ]),
      },
      discussion: {
        referencePaths: uniqueStrings([
          refPath("paper-review.md"),
          refPath("counterintuitive-writing.md"),
          refPath("self-attack-protocol.md"),
          refPath("writing-judgment-framework.md"),
        ]),
      },
      conclusion: {
        referencePaths: uniqueStrings([
          refPath("conclusion.md"),
          refPath("counterintuitive-writing.md"),
        ]),
      },
      scope_and_protocol: {
        referencePaths: uniqueStrings([
          refPath("survey-writing.md"),
          refPath("scope-and-protocol.md"),
          refPath("does-my-writing-flow-source.md"),
          refPath("claim-verification-protocol.md"),
        ]),
      },
      taxonomy: {
        referencePaths: uniqueStrings([
          refPath("survey-writing.md"),
          refPath("taxonomy.md"),
          refPath("does-my-writing-flow-source.md"),
          refPath("writing-quality-check.md"),
        ]),
      },
      evidence_synthesis: {
        referencePaths: uniqueStrings([
          refPath("survey-writing.md"),
          refPath("evidence-synthesis.md"),
          refPath("claim-verification-protocol.md"),
          refPath("paper-review.md"),
        ]),
      },
      benchmark_landscape: {
        referencePaths: uniqueStrings([
          refPath("survey-writing.md"),
          refPath("benchmark-landscape.md"),
          refPath("claim-verification-protocol.md"),
        ]),
      },
      open_problems: {
        referencePaths: uniqueStrings([
          refPath("survey-writing.md"),
          refPath("open-problems.md"),
          refPath("paper-review.md"),
        ]),
      },
    },
  };

  const artifactPath = params.artifactPath ?? DEFAULT_WRITING_REFERENCE_BUNDLE_PATH;
  const resolvedPath = resolveProjectArtifactPath(params.projectRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error("Unable to resolve WRITING_REFERENCE_BUNDLE.json path.");
  }
  await writeJsonEnsured(resolvedPath, bundle);
  return {
    path: artifactPath,
    bundle,
  };
}
