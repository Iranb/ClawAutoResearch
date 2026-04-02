import * as path from "node:path";
import { asRecord } from "../workflow-guard-core/coercion";
import { readTextIfExists, writeTextEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeResearchProgramState } from "../workflow-guard-state/research-program";
import {
  normalizeReviewPressurePacketState,
  serializeReviewPressurePacketState,
} from "../workflow-guard-state/review-pressure";
import type { ReviewPressurePacketState } from "../workflow-guard.js";

type PaperStorySummary = {
  state: {
    storySpinePath: string | null;
    claimToExperimentMapPath: string | null;
    fallbackNarrativePath: string | null;
    rejectionRiskTablePath: string | null;
  };
};

type IdeationSummary = {
  state: {
    researchProposalPath: string | null;
  };
};

type ReviewPressureSummary = {
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
};

type MaterializeReviewPressureDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
  getPaperStoryStateSummary: (params: {
    projectRoot: string;
  }) => Promise<PaperStorySummary>;
  getIdeationContractStateSummary: (params: {
    projectRoot: string;
  }) => Promise<IdeationSummary>;
  getReviewPressurePacketStateSummary: (params: {
    projectRoot: string;
  }) => Promise<ReviewPressureSummary>;
  quoteMarkdownText: (value: string | null | undefined) => string;
  renderMarkdownBulletList: (items: string[]) => string;
  collectMarkdownSignalLines: (
    rawText: string | null,
    options?: { includeSectionsContaining?: string[] }
  ) => string[];
  isPaperStoryStateReady: (state: unknown) => boolean;
};

export async function materializeReviewPressurePacketImpl(
  params: {
    projectRoot: string;
    reviewPressureMaterialization?: Record<string, unknown>;
    trigger?: string | null;
    agentId?: string | null;
  },
  deps: MaterializeReviewPressureDeps
): Promise<{
  state: ReviewPressurePacketState;
  validationErrors: string[];
  rejectFirstReviewResolvedPath: string | null;
  rejectFirstReviewExists: boolean;
  unsupportedClaimAuditResolvedPath: string | null;
  unsupportedClaimAuditExists: boolean;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest = await deps.readManifestEnsured(projectRoot);
  const current = normalizeReviewPressurePacketState(manifest.review_pressure_packet);
  const patch = asRecord(params.reviewPressureMaterialization) ?? {};
  const paperStorySummary = await deps.getPaperStoryStateSummary({ projectRoot });
  const paperStoryState = paperStorySummary.state;
  const ideationSummary = await deps.getIdeationContractStateSummary({ projectRoot });
  const ideationState = ideationSummary.state;
  const researchProgram = normalizeResearchProgramState(manifest.research_program);

  const [
    storySpineText,
    claimMapText,
    fallbackNarrativeText,
    rejectionRiskText,
    proposalText,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, paperStoryState.storySpinePath)),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStoryState.claimToExperimentMapPath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStoryState.fallbackNarrativePath)
    ),
    readTextIfExists(
      resolveProjectArtifactPath(projectRoot, paperStoryState.rejectionRiskTablePath)
    ),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, ideationState.researchProposalPath)),
  ]);

  const rejectFirstReview = `# Reject First Review

## Most likely rejection angles
${deps.renderMarkdownBulletList([
  `The gain over ${researchProgram.baselineReference ?? "the baseline"} may be too small or too narrow.`,
  "The story may sound cleaner than the empirical evidence can support.",
  "The claimed novelty may overlap with already occupied solution zones.",
])}

## Immediate defenses
${deps.renderMarkdownBulletList([
  `Keep the main success criterion tied to ${(researchProgram.primaryMetric ?? "the primary metric").replace(/_/g, " ")}.`,
  "Use the claim-to-experiment map as the boundary for every headline statement.",
  "Prefer the narrower fallback narrative over an inflated general story.",
])}
`;

  const noveltyAttack = `# Novelty Attack

- Attack: This looks like an implementation cleanup around ${deps.quoteMarkdownText(
    researchProgram.baselineReference
  )}.
- Defense: The proposal isolates a graph-grounded routing delta and binds it to explicit claim-evidence alignment.
- Attack: The contribution could be copied into an existing baseline with minor edits.
- Defense: The story contract only survives if the router and claim map remain necessary under ablation.
- Proposal pressure points:
${deps.renderMarkdownBulletList(deps.collectMarkdownSignalLines(proposalText).slice(0, 3))}
`;

  const unsupportedClaimAudit = `# Unsupported Claim Audit

| Claim ID | Claim | Required evidence | Current pressure |
| --- | --- | --- | --- |
| claim-1 | Graph-grounded routing improves ${researchProgram.primaryMetric ?? "the primary metric"} over ${researchProgram.baselineReference ?? "the baseline"}. | Baseline reproduction + routing delta | Do not state as solved until the delta is measured. |
| claim-2 | The router causes the gain. | Module ablation | Keep this conditional until ablation is complete. |
| claim-3 | The method preserves clarity while improving support precision. | Boundary / failure analysis | Do not generalize beyond measured scope. |
`;

  const reverseOutline = `# Reverse Outline

1. Problem pressure
   - ${deps.quoteMarkdownText(researchProgram.problemStatement ?? "Problem statement pending.")}
2. Why existing baselines are insufficient
   - ${deps.quoteMarkdownText(researchProgram.baselineReference ?? "Baseline pending.")}
3. Core insight
   - ${deps.quoteMarkdownText(
     deps.collectMarkdownSignalLines(storySpineText, {
       includeSectionsContaining: ["insight"],
     })[0] ?? "Graph-grounded routing aligns claims to evidence."
   )}
4. Method consequence
   - Claim-to-experiment alignment constrains the draft to what can be verified.
5. Reviewer risk
   - Overclaiming beyond the measured routing delta.
`;

  const figureTableQc = `# Figure Table QC

- Pipeline figure must expose the graph-grounded router and the claim-evidence alignment layer.
- Every headline table must include ${deps.quoteMarkdownText(
    researchProgram.baselineReference ?? "the named baseline"
  )} for comparison.
- Any figure that implies broader scope must carry an explicit limitation or boundary note.
`;

  const limitationAudit = `# Limitation Audit

${deps.renderMarkdownBulletList([
  "The current story only defends the routing delta, not a universal writing agent improvement.",
  "Empirical gains must stay tied to the unchanged baseline protocol.",
  "Fallback narrative should be preferred whenever novelty overlap becomes the main review risk.",
  ...deps.collectMarkdownSignalLines(claimMapText).slice(0, 2),
  ...deps.collectMarkdownSignalLines(fallbackNarrativeText).slice(0, 1),
  ...deps.collectMarkdownSignalLines(rejectionRiskText).slice(0, 3),
])}
`;

  const nextState = normalizeReviewPressurePacketState({
    ...serializeReviewPressurePacketState(current),
    ...patch,
    status: deps.isPaperStoryStateReady(paperStoryState) ? "ready" : "pending",
    status_reason: !deps.isPaperStoryStateReady(paperStoryState)
      ? "paper_story_state is not ready yet."
      : null,
    last_updated_at: new Date().toISOString(),
  });

  const generatedFiles: string[] = [];
  const fileSpecs: Array<[string | null, string]> = [
    [nextState.rejectFirstReviewPath, rejectFirstReview],
    [nextState.noveltyAttackPath, noveltyAttack],
    [nextState.unsupportedClaimAuditPath, unsupportedClaimAudit],
    [nextState.reverseOutlinePath, reverseOutline],
    [nextState.figureTableQcPath, figureTableQc],
    [nextState.limitationAuditPath, limitationAudit],
  ];
  for (const [targetPath, payload] of fileSpecs) {
    const resolved = resolveProjectArtifactPath(projectRoot, targetPath);
    if (!resolved) {
      continue;
    }
    await writeTextEnsured(resolved, payload);
    generatedFiles.push(path.relative(projectRoot, resolved));
  }

  manifest.review_pressure_packet = serializeReviewPressurePacketState(nextState);
  await deps.saveManifest(projectRoot, manifest);
  const summary = await deps.getReviewPressurePacketStateSummary({ projectRoot });
  return {
    state: nextState,
    validationErrors: summary.validationErrors,
    rejectFirstReviewResolvedPath: summary.rejectFirstReviewResolvedPath,
    rejectFirstReviewExists: summary.rejectFirstReviewExists,
    unsupportedClaimAuditResolvedPath: summary.unsupportedClaimAuditResolvedPath,
    unsupportedClaimAuditExists: summary.unsupportedClaimAuditExists,
    generatedFiles,
  };
}
