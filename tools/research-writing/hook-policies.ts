import path from "node:path";
import { readJsonIfExists } from "../workflow-guard-core/fs";
import type { WritingMode } from "../workflow-guard.js";
import { normalizePaperStoryState } from "../workflow-guard-state/paper-story";
import { normalizeReviewPressurePacketState } from "../workflow-guard-state/review-pressure";
import {
  normalizeWritingContractState,
  normalizeWritingMode,
} from "../workflow-guard-state/writing-contract";
import type {
  WorkflowFileAuditHookPolicy,
  WorkflowHookAppliesWhen,
  WorkflowHookFilters,
  WorkflowHooksPolicy,
} from "../workflow-hooks/contracts.js";
import {
  readWorkflowHooksPolicyForProject,
  serializeWorkflowHooksPolicy,
  setFileAuditPolicyForProject,
  sortHookPolicies,
} from "../workflow-hooks/state.js";

const WRITING_HOOK_IDS = new Set([
  "paper-plan-thesis-audit",
  "paper-plan-figure-anchor-audit",
  "figure-table-alignment-audit",
  "innovation-synthesis-audit",
  "results-storyline-audit",
  "title-abstract-intro-alignment-audit",
  "paragraph-logic-flow-audit",
  "citation-topicality-audit",
  "method-comparison-coverage-audit",
  "reviewer-issues-appendix-audit",
  "abstract-claim-audit",
  "introduction-gap-story-audit",
  "results-claim-evidence-audit",
  "related-work-positioning-audit",
  "conclusion-boundary-audit",
  "main-tex-consistency-audit",
  "figure-caption-audit",
  "final-figure-table-budget-audit",
  "survey-abstract-synthesis-audit",
  "survey-introduction-positioning-audit",
  "survey-scope-protocol-audit",
  "survey-taxonomy-audit",
  "survey-evidence-synthesis-audit",
  "survey-benchmark-landscape-audit",
  "survey-methodology-consistency-audit",
  "survey-open-problems-audit",
  "survey-conclusion-boundary-audit",
]);

const WRITING_POLICY_STAGES = new Set(["plan", "write", "review", "submit"]);
const DEFERRED_SECTION_HOOK_IDS = new Set<string>();
const DEFAULT_REVIEWER_RESPONSE_APPENDIX_PATH =
  "academic_writer/paper/sections/appendix_reviewer_responses.tex";

function normalizeStage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

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

function readNestedString(
  value: Record<string, unknown> | null | undefined,
  pathKeys: string[]
): string | null {
  let current: unknown = value;
  for (const key of pathKeys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
}

function resolveTopTierVerdict(
  manifest: Record<string, unknown>,
  explicitTopTierVerdict: unknown
): string | null {
  if (typeof explicitTopTierVerdict === "string" && explicitTopTierVerdict.trim()) {
    return explicitTopTierVerdict.trim();
  }
  return (
    readNestedString(manifest, ["evidence_closeout", "top_tier_verdict"]) ??
    readNestedString(manifest, ["evidenceCloseout", "topTierVerdict"]) ??
    readNestedString(manifest, ["opportunity_scorecard", "verdict"]) ??
    readNestedString(manifest, ["opportunityScorecard", "verdict"]) ??
    readNestedString(manifest, ["top_tier_verdict"]) ??
    readNestedString(manifest, ["topTierVerdict"])
  );
}

function buildPrompt(params: {
  title: string;
  paperMode: WritingMode | null;
  topTierVerdict: string | null;
  requirements: string[];
  supportingArtifacts: string[];
  activationNote?: string | null;
}): string {
  const modeLine =
    params.paperMode === "survey"
      ? "Treat this as a survey manuscript: prefer scope discipline, comparative synthesis, and evidence-backed field positioning over novelty theater."
      : "Treat this as a research manuscript: prefer one clean thesis, concrete contribution delta, and claim-evidence alignment over stylistic polish.";
  const strictnessLine =
    params.topTierVerdict === "worth_top_tier_bet"
      ? "Apply top-tier strictness: vague novelty, soft evidence linkage, or overstated headline claims should trigger revise or block."
      : "Apply stable reviewer strictness: pass only when the prose is evidentially grounded and structurally coherent.";
  return [
    `Audit target: ${params.title}`,
    modeLine,
    strictnessLine,
    params.activationNote,
    "Special requirements:",
    ...params.requirements.map((entry) => `- ${entry}`),
    params.supportingArtifacts.length > 0 ? "Supporting artifacts to consult:" : null,
    ...params.supportingArtifacts.map((entry) => `- ${entry}`),
    "Return `pass` only if every requirement is satisfied.",
    "Return `revise` for fixable problems such as overclaiming, weak positioning, missing boundary language, or unsupported headline structure.",
    "Return `block` only for severe integrity failures such as repeated unsupported claims, contradiction with the evidence ledger, or missing core structure.",
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join("\n");
}

function buildHook(params: {
  hookId: string;
  stage: string | null;
  hookPoint: WorkflowFileAuditHookPolicy["hookPoint"];
  order: number;
  filePath: string;
  requirementPrompt: string;
  supportingArtifacts: string[];
  blockingMode: WorkflowFileAuditHookPolicy["blockingMode"];
  enabled?: boolean;
  parallelGroup?: string | null;
  maxRounds?: number;
  maxUnchangedRounds?: number;
  filters?: WorkflowHookFilters | null;
  appliesWhen?: WorkflowHookAppliesWhen | null;
  stateScope?: WorkflowFileAuditHookPolicy["stateScope"];
  targetRole?: string | null;
  auditorRole?: string;
  reviseOwnerRole?: string | null;
}): WorkflowFileAuditHookPolicy {
  return {
    hookId: params.hookId,
    hookType: "file_audit",
    enabled: params.enabled ?? true,
    stage: params.stage,
    hookPoint: params.hookPoint,
    order: params.order,
    parallelGroup: params.parallelGroup ?? null,
    targetRole: params.targetRole ?? "academic_writer",
    auditorRole: params.auditorRole ?? "reviewer",
    filePath: params.filePath,
    requirementPrompt: params.requirementPrompt,
    supportingArtifacts: uniqueStrings(params.supportingArtifacts),
    blockingMode: params.blockingMode,
    maxRounds: params.maxRounds ?? (params.blockingMode === "warn_only" ? 1 : 3),
    maxUnchangedRounds: params.maxUnchangedRounds ?? 2,
    reviseOwnerRole: params.reviseOwnerRole ?? "academic_writer",
    reviseCommand: null,
    reportDir: `reviewer/file-audits/${params.hookId}`,
    filters: params.filters ?? null,
    appliesWhen: params.appliesWhen ?? null,
    stateScope:
      params.stateScope ??
      (params.hookPoint === "before_task_complete"
        ? "shared_by_transition"
        : "shared_by_stage"),
  };
}

function buildWritingHookPolicies(params: {
  paperMode: WritingMode | null;
  topTierVerdict: string | null;
  requiredSections: string[];
  paperStory: ReturnType<typeof normalizePaperStoryState>;
  reviewPressure: ReturnType<typeof normalizeReviewPressurePacketState>;
}): WorkflowFileAuditHookPolicy[] {
  const experimentMode = params.paperMode !== "survey";
  const surveyMode = params.paperMode === "survey";
  const sectionSet = new Set(params.requiredSections);
  const experimentAppliesWhen: WorkflowHookAppliesWhen = {
    workflowLines: ["experiment"],
    paperModes:
      params.paperMode && params.paperMode !== "survey"
        ? [params.paperMode]
        : ["conference", "journal"],
  };
  const baseAppliesWhen: WorkflowHookAppliesWhen = surveyMode
    ? {
        workflowLines: ["survey"],
        paperModes: ["survey"],
      }
    : experimentAppliesWhen;
  const surveyArtifacts = [
    "academic_writer/SURVEY_STORYLINE_PACKET.md",
    "academic_writer/SURVEY_STORYLINE_PACKET.json",
    "academic_writer/SURVEY_SECTION_BRIEFS.md",
    "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
    "academic_writer/SURVEY_SELF_REVIEW.md",
  ];
  const paperPlanArtifacts = uniqueStrings([
    params.paperStory.storySpinePath,
    params.paperStory.contributionMapPath,
    params.paperStory.claimToExperimentMapPath,
    params.paperStory.claimEvidenceMatrixPath,
    params.paperStory.unsupportedClaimsPath,
    params.paperStory.contributionToStoryBridgePath,
    params.paperStory.writingReferenceBundlePath,
    ...(surveyMode ? surveyArtifacts : []),
  ]);
  const figureArtifacts = uniqueStrings([
    params.paperStory.figureAnchorPlanPath,
    params.paperStory.pipelineFigureSketchPath,
    params.paperStory.storySpinePath,
    params.paperStory.claimToExperimentMapPath,
    params.reviewPressure.figureTableQcPath,
    "academic_writer/FIGURE_REGISTRY.json",
    "academic_writer/TABLE_REGISTRY.json",
    "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
    ...(surveyMode ? surveyArtifacts : []),
  ]);
  const manuscriptArtifacts = uniqueStrings([
    params.paperStory.storySpinePath,
    params.paperStory.claimToExperimentMapPath,
    params.paperStory.claimEvidenceMatrixPath,
    params.paperStory.contributionToStoryBridgePath,
    params.paperStory.figureAnchorPlanPath,
    params.paperStory.fallbackNarrativePath,
    params.paperStory.rejectionRiskTablePath,
    params.paperStory.unsupportedClaimsPath,
    params.reviewPressure.reverseOutlinePath,
    params.reviewPressure.unsupportedClaimAuditPath,
    params.reviewPressure.limitationAuditPath,
    params.reviewPressure.figureTableQcPath,
    ...(surveyMode ? surveyArtifacts : []),
  ]);
  const innovationSynthesisArtifacts = uniqueStrings([
    ...manuscriptArtifacts,
    "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
    "academic_writer/INNOVATION_SYNTHESIS_GRAPH.json",
    "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
    "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
    "academic_writer/RESULTS_QUESTION_ORDER.md",
  ]);
  const resultsStorylineArtifacts = uniqueStrings([
    ...manuscriptArtifacts,
    "academic_writer/RESULTS_QUESTION_ORDER.md",
    "academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json",
    "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
  ]);
  const titleAbstractIntroArtifacts = uniqueStrings([
    ...innovationSynthesisArtifacts,
    "academic_writer/TITLE_CANDIDATES.md",
    "academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md",
    "academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md",
    "academic_writer/paper/main.tex",
  ]);
  const paragraphLogicArtifacts = uniqueStrings([
    ...titleAbstractIntroArtifacts,
    "academic_writer/PARAGRAPH_LOGIC_AUDIT.json",
    "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
    "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md",
    "academic_writer/WRITING_SIGNALS.md",
  ]);
  const citationAuditArtifacts = uniqueStrings([
    "academic_writer/paper/refs.bib",
    "reviewer/CITATION_VERIFICATION.md",
    "researcher/CITATION_AUDIT_REPORT.json",
    "academic_writer/paper/main.tex",
    params.paperStory.storySpinePath,
    params.paperStory.claimEvidenceMatrixPath,
    ...(surveyMode ? surveyArtifacts : []),
  ]);
  const comparisonCoverageArtifacts = uniqueStrings([
    ...resultsStorylineArtifacts,
    "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
    "academic_writer/FIGURE_REGISTRY.json",
    "academic_writer/TABLE_REGISTRY.json",
    "academic_writer/SURVEY_VISUALIZATION_PLAN.md",
    "academic_writer/paper/main.tex",
    "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
    "researcher/SOTA_MATRIX.md",
  ]);
  const reviewerResponseAppendixArtifacts = uniqueStrings([
    ...manuscriptArtifacts,
    "reviewer/REVIEW_REPORT.md",
    "reviewer/REVIEW_ISSUES.json",
    "reviewer/SUBMISSION_SIMULATION_REVIEW.json",
    "reviewer/CITATION_VERIFICATION.md",
    DEFAULT_REVIEWER_RESPONSE_APPENDIX_PATH,
    "academic_writer/paper/main.tex",
  ]);

  const hooks: WorkflowFileAuditHookPolicy[] = [
    buildHook({
      hookId: "paper-plan-thesis-audit",
      stage: "review",
      hookPoint: "before_stage_handoff",
      order: 100,
      parallelGroup: "writing-plan-closeout",
      filePath: "academic_writer/PAPER_PLAN.md",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title: "academic_writer/PAPER_PLAN.md before the workflow hands review outputs into writing",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "The survey question or organizing thesis must be singular and explicit.",
              "The planned section arc must teach a field structure, not list papers section-by-section.",
              "Comparative claims and taxonomy language must be traceable to the evidence ledger or survey briefs.",
              "Scope boundaries, exclusions, and known thin areas must be explicit before the draft is considered writing-ready.",
            ]
          : [
              "The paper plan must commit to one thesis and one clean problem-gap-method-evidence arc.",
              "Contribution bullets must be concrete, non-generic, and phrased as falsifiable deltas.",
              "Every headline claim in the plan must map cleanly to CLAIM_EVIDENCE_MATRIX.md or CLAIM_TO_EXPERIMENT_MAP.md.",
              "If unsupported or weakly supported claims remain, the plan must downgrade them instead of carrying them into drafting.",
            ],
        supportingArtifacts: paperPlanArtifacts,
      }),
      supportingArtifacts: paperPlanArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        changedPathsAny: ["academic_writer/PAPER_PLAN.md"],
      },
    }),
    buildHook({
      hookId: "paper-plan-figure-anchor-audit",
      stage: "write",
      hookPoint: "artifact_materialized",
      order: 140,
      parallelGroup: "writing-artifact-guard",
      filePath: "academic_writer/FIGURE_ANCHOR_PLAN.md",
      blockingMode: "warn_only",
      maxRounds: 1,
      maxUnchangedRounds: 1,
      requirementPrompt: buildPrompt({
        title: "academic_writer/FIGURE_ANCHOR_PLAN.md after writing scaffolds are materialized",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "Figure and table anchors must teach the survey structure, comparison axes, or benchmark landscape rather than act as decorative add-ons.",
              "The lead visual should clarify the field map or comparison logic that the prose depends on.",
              "Caption plans should already imply what evidence or comparative claim each visual is meant to carry.",
            ]
          : [
              "Figure 1 or the lead visual must carry the main narrative entry point rather than a secondary implementation detail.",
              "Each major figure must support a specific supported claim, not a vague promise.",
              "If a figure cannot be connected back to the story spine or evidence map, flag it as drift.",
            ],
        supportingArtifacts: figureArtifacts,
      }),
      supportingArtifacts: figureArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        materializedContracts: ["writing_support_artifacts"],
        changedPathsAny: [
          "academic_writer/FIGURE_ANCHOR_PLAN.md",
          "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
          "academic_writer/FIGURE_REGISTRY.json",
          "academic_writer/TABLE_REGISTRY.json",
        ],
        fileGlobs: [
          "academic_writer/FIGURE_ANCHOR_PLAN.md",
          "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
        ],
      },
    }),
    buildHook({
      hookId: "figure-table-alignment-audit",
      stage: "write",
      hookPoint: "artifact_materialized",
      order: 150,
      parallelGroup: "writing-artifact-guard",
      filePath: "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
      blockingMode: "warn_only",
      maxRounds: 1,
      maxUnchangedRounds: 1,
      requirementPrompt: buildPrompt({
        title: "Writer/Coder/Reviewer figure-table alignment contract after writing scaffolds are materialized",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: [
          "The contract must explicitly assign Writer ownership for placement/captions, Coder ownership for experiment table provenance/regenerability, and Reviewer ownership for claim/caption consistency.",
          "Before write handoff, the manuscript must plan or contain at least one framework figure and at least two experiment/result tables.",
          "The planned final manuscript must have a path to at least five figures and four tables; if not yet present, the missing visuals/tables must be listed as concrete debt.",
          "Tables must be backed by durable experiment, benchmark, ablation, or comparison artifacts rather than hand-wavy prose.",
        ],
        supportingArtifacts: figureArtifacts,
      }),
      supportingArtifacts: figureArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        materializedContracts: ["writing_support_artifacts"],
        changedPathsAny: ["academic_writer/FIGURE_TABLE_ALIGNMENT.md"],
        fileGlobs: ["academic_writer/FIGURE_TABLE_ALIGNMENT.md"],
      },
    }),
    buildHook({
      hookId: "innovation-synthesis-audit",
      stage: "review",
      hookPoint: "before_handoff_activation",
      order: 280,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title:
          "post-draft innovation synthesis bundle before the review stage hands the manuscript forward",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "The synthesis memo must unify the survey's organizing thesis, comparative structure, and open-problem arc into one coherent story rather than disconnected themes.",
              "Any claimed field-wide narrative must stay aligned with the evidence synthesis, benchmark landscape, and scope boundaries.",
              "If the memo still says more search is required, or if the integrated contribution statement disagrees with the manuscript, request revision or block.",
            ]
          : [
              "The synthesis memo must explain one central thesis and show how the validated innovation points function as one integrated mechanism rather than a stacked contribution list.",
              "Each innovation point must have a concrete role in the story, evidence mapping, and an explicit explanation of what breaks if that point is removed.",
              "Figure 1 story, results order rationale, and the integrated contribution statement must agree with the current manuscript wording in main.tex.",
              "If the memo still indicates unresolved search gaps, stale bridge evidence, or contradictory contribution wording, request revision or block.",
            ],
        supportingArtifacts: innovationSynthesisArtifacts,
      }),
      supportingArtifacts: innovationSynthesisArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: [
          "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
          "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
          "academic_writer/paper/main.tex",
        ],
      },
    }),
    buildHook({
      hookId: "results-storyline-audit",
      stage: "review",
      hookPoint: "before_handoff_activation",
      order: 285,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/RESULTS_QUESTION_ORDER.md",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title:
          "results storyline bundle before the review stage hands the manuscript forward",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "The survey storyline packet must expose one explicit thesis, a chosen macro-story strategy, and an intellectual-center section; the manuscript must follow that choice rather than defaulting back to a paper list.",
              "The storyline must organize the survey synthesis in an order that teaches scope, taxonomy, evidence synthesis, benchmark landscape, and open problems rather than listing papers.",
              "Each major synthesis question must map to evidence modules or comparison artifacts, and must keep non-comparable results explicit.",
            ]
          : [
              "The results storyline must answer reviewer questions in argument order instead of mirroring execution order or experiment chronology.",
              "Each major question must bind to concrete evidence identifiers and figure/table anchors.",
              "Boundary and robustness questions must be visible in the sequence; they must not disappear into limitations footnotes.",
            ],
        supportingArtifacts: resultsStorylineArtifacts,
      }),
      supportingArtifacts: resultsStorylineArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: [
          "academic_writer/RESULTS_QUESTION_ORDER.md",
          "academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json",
          "academic_writer/paper/main.tex",
        ],
      },
    }),
    buildHook({
      hookId: "title-abstract-intro-alignment-audit",
      stage: "review",
      hookPoint: "before_handoff_activation",
      order: 290,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title:
          "title / abstract / introduction workbench before the review stage hands the manuscript forward",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "The preferred title, abstract skeleton, and introduction workbench must all tell the same survey thesis and organizing lens.",
              "The title / abstract / introduction layer must agree with the selected macro-story and intellectual-center section from the survey storyline packet.",
              "The abstract and introduction workbench must keep scope boundaries, evidence base, and contribution lens aligned with the manuscript and survey evidence packet.",
            ]
          : [
              "The preferred title, abstract workbench, and introduction workbench must all express the same central thesis and contribution wording.",
              "The abstract workbench must preserve a five-sentence problem-gap-mechanism-result-implication arc without drifting beyond the evidence ledger.",
              "The introduction workbench must preview the same argument order that the results storyline and integrated contribution statement require.",
            ],
        supportingArtifacts: titleAbstractIntroArtifacts,
      }),
      supportingArtifacts: titleAbstractIntroArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: [
          "academic_writer/TITLE_CANDIDATES.md",
          "academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md",
          "academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md",
          "academic_writer/paper/main.tex",
        ],
      },
    }),
    buildHook({
      hookId: "paragraph-logic-flow-audit",
      stage: "review",
      hookPoint: "before_stage_handoff",
      order: 292,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/paper/main.tex",
      auditorRole: "cross-reviewer",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title:
          "cross-paragraph logic and section-to-section handoffs before the review stage hands the manuscript forward",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "The manuscript must read as one teaching sequence: scope -> taxonomy -> evidence synthesis -> benchmark landscape -> open problems, not as a stack of locally correct paragraphs.",
              "Adjacent paragraphs must hand off naturally: if the topic shifts, the prose or reverse outline should make the shift feel necessary rather than abrupt.",
              "academic_writer/PARAGRAPH_LOGIC_AUDIT.md and PARAGRAPH_LOGIC_REVERSE_OUTLINE.md must show no unresolved blocking paragraph-pair breaks before pass.",
            ]
          : [
              "The manuscript must read as one argument rather than a sequence of locally correct but disconnected paragraphs.",
              "Adjacent paragraphs and section boundaries must hand off naturally: problem -> gap -> method -> evidence -> limitation should feel causally linked, not merely adjacent.",
              "academic_writer/PARAGRAPH_LOGIC_AUDIT.md and PARAGRAPH_LOGIC_REVERSE_OUTLINE.md must show no unresolved blocking paragraph-pair breaks before pass.",
            ],
        supportingArtifacts: paragraphLogicArtifacts,
      }),
      supportingArtifacts: paragraphLogicArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: [
          "academic_writer/paper/main.tex",
          "academic_writer/PARAGRAPH_LOGIC_AUDIT.json",
          "academic_writer/PARAGRAPH_LOGIC_AUDIT.md",
          "academic_writer/PARAGRAPH_LOGIC_REVERSE_OUTLINE.md",
          "academic_writer/WRITING_SIGNALS.md",
        ],
      },
    }),
    buildHook({
      hookId: "citation-topicality-audit",
      stage: "review",
      hookPoint: "before_stage_handoff",
      order: 295,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/paper/refs.bib",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title:
          "bibliography integrity and topicality before the review stage hands the manuscript forward",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements:
          params.paperMode === "survey"
            ? [
                "The bibliography must contain at least 50 cited works before the survey exits review.",
                "Every kept citation should support the survey topic, taxonomy, comparison axes, benchmark landscape, or open-problem synthesis; decorative or generic off-topic references should be revised out.",
                "If reviewer/CITATION_VERIFICATION.md or researcher/CITATION_AUDIT_REPORT.json says topic relevance is weak, count is below threshold, or suspicious references remain, require revision instead of passing.",
              ]
            : params.paperMode === "journal"
              ? [
                  "The bibliography must contain at least 40 cited works before the journal manuscript exits review.",
                  "Citations should stay tied to the paper's problem, method, baselines, benchmarks, mechanisms, or limitations; broad motivational references with no real topical connection should be revised out or explicitly justified.",
                  "If reviewer/CITATION_VERIFICATION.md or researcher/CITATION_AUDIT_REPORT.json says topic relevance is weak, count is below threshold, or suspicious references remain, require revision instead of passing.",
                ]
              : [
                  "Check that bibliography entries remain relevant to the manuscript's actual topic and evidence story.",
                  "If reviewer/CITATION_VERIFICATION.md or researcher/CITATION_AUDIT_REPORT.json says topic relevance is weak or suspicious references remain, require revision instead of passing.",
                ],
        supportingArtifacts: citationAuditArtifacts,
      }),
      supportingArtifacts: citationAuditArtifacts,
      appliesWhen: {
        paperModes: ["survey", "journal"],
      },
      filters: {
        fileGlobs: [
          "academic_writer/paper/refs.bib",
          "reviewer/CITATION_VERIFICATION.md",
          "researcher/CITATION_AUDIT_REPORT.json",
        ],
      },
    }),
    buildHook({
      hookId: "method-comparison-coverage-audit",
      stage: "review",
      hookPoint: "before_stage_handoff",
      order: 297,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/paper/main.tex",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title:
          "method comparison coverage before the review stage hands the manuscript forward",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "The manuscript must contain or explicitly plan method-performance comparison tables that compare families or representative methods across multiple metrics, datasets, or evaluation angles.",
              "The manuscript must contain or explicitly plan at least one comparison-oriented figure that helps readers see strengths, weaknesses, trade-offs, or taxonomy-level contrasts at a glance.",
              "The prose must analyze comparative advantages and disadvantages from more than one angle instead of only reporting a single best score.",
              "Using multiple tables for different metrics or evaluation slices is encouraged when one table cannot honestly carry the comparison.",
            ]
          : [
              "The manuscript must contain or explicitly plan at least one method-performance comparison table and at least one comparison-oriented figure.",
              "The results discussion must compare strengths and weaknesses from more than one angle, such as accuracy, robustness, efficiency, ablation sensitivity, calibration, or transfer behavior.",
              "If one table cannot honestly cover the comparison, multiple tables for different metrics or evaluation slices should be used instead of collapsing everything into a single leaderboard.",
              "A draft that only celebrates the best number without discussing trade-offs or failure regimes should be revised.",
            ],
        supportingArtifacts: comparisonCoverageArtifacts,
      }),
      supportingArtifacts: comparisonCoverageArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: [
          "academic_writer/paper/main.tex",
          "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
          "academic_writer/FIGURE_REGISTRY.json",
          "academic_writer/TABLE_REGISTRY.json",
        ],
      },
    }),
    buildHook({
      hookId: "main-tex-consistency-audit",
      stage: "write",
      hookPoint: "before_handoff_activation",
      order: 300,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/paper/main.tex",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title: "academic_writer/paper/main.tex before the write-stage handoff is activated",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: surveyMode
          ? [
              "Abstract, introduction, evidence-synthesis sections, and conclusion must tell one consistent survey story.",
              "Comparative positioning and scope boundaries must stay consistent across the manuscript; do not let the conclusion overstate field consensus.",
              "Any synthesis claim that is not supported by the evidence bundle or survey briefs must be downgraded or removed.",
            ]
          : [
              "Abstract, introduction, results, and conclusion must agree on the same contribution wording and evidence-backed claims.",
              "No headline contribution may outrun CLAIM_EVIDENCE_MATRIX.md or reintroduce a claim already flagged as unsupported.",
              "Limitations and boundary statements must remain aligned with the story spine and review pressure artifacts.",
            ],
        supportingArtifacts: manuscriptArtifacts,
      }),
      supportingArtifacts: manuscriptArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: ["academic_writer/paper/main.tex"],
      },
    }),
    buildHook({
      hookId: "figure-caption-audit",
      stage: "write",
      hookPoint: "before_handoff_activation",
      order: 320,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/paper/main.tex",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title: "figure/table narrative inside academic_writer/paper/main.tex before write-stage handoff",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: [
          "Captions must be self-explanatory enough that a skeptical reviewer can understand the figure claim without guessing missing setup.",
          "Figure and table references in the prose must reinforce the main claim path rather than trail as detached implementation notes.",
          "If a caption or narrative implies evidence stronger than the ledger supports, request revision.",
        ],
        supportingArtifacts: figureArtifacts,
      }),
      supportingArtifacts: figureArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: ["academic_writer/paper/main.tex"],
      },
    }),
    buildHook({
      hookId: "reviewer-issues-appendix-audit",
      stage: "submit",
      hookPoint: "before_stage_handoff",
      order: 345,
      parallelGroup: "writing-closeout",
      filePath: DEFAULT_REVIEWER_RESPONSE_APPENDIX_PATH,
      blockingMode: "block_stage",
      auditorRole: "cross-reviewer",
      requirementPrompt: buildPrompt({
        title:
          "reviewer-response appendix before the submit-stage handoff is activated",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: [
          `Create a dedicated appendix section at ${DEFAULT_REVIEWER_RESPONSE_APPENDIX_PATH} and ensure main.tex clearly includes or references it as part of the appendix.`,
          "The appendix must answer reviewer-raised points in detailed paragraph form rather than terse bullet acknowledgements.",
          "Each major point from REVIEW_REPORT.md, REVIEW_ISSUES.json, and submission simulation feedback should be reflected with concrete response text, evidence, or manuscript changes.",
          "The appendix may and should use tables or figures when they clarify rebuttal evidence, comparative metrics, ablations, or implementation details better than prose alone.",
          "If a reviewer concern is only partially addressed, the appendix must say so explicitly instead of pretending it is fully resolved.",
        ],
        supportingArtifacts: reviewerResponseAppendixArtifacts,
      }),
      supportingArtifacts: reviewerResponseAppendixArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: [
          DEFAULT_REVIEWER_RESPONSE_APPENDIX_PATH,
          "academic_writer/paper/main.tex",
          "reviewer/REVIEW_REPORT.md",
          "reviewer/REVIEW_ISSUES.json",
          "reviewer/SUBMISSION_SIMULATION_REVIEW.json",
        ],
      },
    }),
    buildHook({
      hookId: "final-figure-table-budget-audit",
      stage: "submit",
      hookPoint: "before_handoff_activation",
      order: 340,
      parallelGroup: "writing-closeout",
      filePath: "academic_writer/paper/main.tex",
      blockingMode: "block_stage",
      requirementPrompt: buildPrompt({
        title: "final figure/table budget in academic_writer/paper/main.tex before submit handoff",
        paperMode: params.paperMode,
        topTierVerdict: params.topTierVerdict,
        requirements: [
          "The final manuscript must contain at least five figures and four tables, unless a reviewer-approved waiver is explicitly recorded in FIGURE_TABLE_ALIGNMENT.md.",
          "At least one figure must be a framework, architecture, pipeline, method, or system overview figure.",
          "At least two tables must report experiment, benchmark, ablation, or comparison results.",
          "Every figure/table caption must be present and must not overclaim beyond the evidence ledger.",
          "If fewer than five figures or four tables are present, return block rather than revise because the final visual evidence budget is incomplete.",
        ],
        supportingArtifacts: figureArtifacts,
      }),
      supportingArtifacts: figureArtifacts,
      appliesWhen: baseAppliesWhen,
      filters: {
        fileGlobs: ["academic_writer/paper/main.tex"],
      },
    }),
  ];

  if (experimentMode && sectionSet.has("abstract")) {
    hooks.push(
      buildHook({
        hookId: "abstract-claim-audit",
        stage: "write",
        hookPoint: "before_task_complete",
        order: 200,
        parallelGroup: "writing-section-draft",
        filePath: "academic_writer/paper/sections/abstract.tex",
        blockingMode: "block_stage",
        requirementPrompt: buildPrompt({
          title: "academic_writer/paper/sections/abstract.tex",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "The abstract must cover problem, gap, action, result, and implication without adding unsupported claims.",
            "Headline wins must stay within the evidence ledger and avoid vague superiority language.",
          ],
          supportingArtifacts: manuscriptArtifacts,
        }),
        supportingArtifacts: manuscriptArtifacts,
        appliesWhen: experimentAppliesWhen,
        filters: {
          taskIds: ["write.section.abstract"],
          fileGlobs: ["academic_writer/paper/sections/abstract.tex"],
        },
      })
    );
  }
  if (experimentMode && sectionSet.has("introduction")) {
    hooks.push(
      buildHook({
        hookId: "introduction-gap-story-audit",
        stage: "write",
        hookPoint: "before_task_complete",
        order: 210,
        parallelGroup: "writing-section-draft",
        filePath: "academic_writer/paper/sections/introduction.tex",
        blockingMode: "block_stage",
        requirementPrompt: buildPrompt({
          title: "academic_writer/paper/sections/introduction.tex",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "The introduction must state the problem, gap, method, and evidence-backed contribution path clearly.",
            "Contribution bullets in the introduction must align with results rather than promise extra claims.",
          ],
          supportingArtifacts: manuscriptArtifacts,
        }),
        supportingArtifacts: manuscriptArtifacts,
        appliesWhen: experimentAppliesWhen,
        filters: {
          taskIds: ["write.section.introduction"],
          fileGlobs: ["academic_writer/paper/sections/introduction.tex"],
        },
      })
    );
  }
  if (experimentMode && (sectionSet.has("results") || sectionSet.has("experiments"))) {
    hooks.push(
      buildHook({
        hookId: "results-claim-evidence-audit",
        stage: "write",
        hookPoint: "before_task_complete",
        order: 220,
        parallelGroup: "writing-section-draft",
        filePath: "academic_writer/paper/sections/results.tex",
        blockingMode: "block_stage",
        requirementPrompt: buildPrompt({
          title: "academic_writer/paper/sections/results.tex",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "Each headline result must point back to concrete evidence rather than generalized hype.",
            "Unsupported claims previously removed from the ledger must not re-enter the prose here.",
          ],
          supportingArtifacts: manuscriptArtifacts,
        }),
        supportingArtifacts: manuscriptArtifacts,
        appliesWhen: experimentAppliesWhen,
        filters: {
          taskIds: ["write.section.results", "write.section.experiments"],
          fileGlobs: [
            "academic_writer/paper/sections/results.tex",
            "academic_writer/paper/sections/experiments.tex",
          ],
        },
      })
    );
  }
  if (experimentMode && sectionSet.has("related_work")) {
    hooks.push(
      buildHook({
        hookId: "related-work-positioning-audit",
        stage: "write",
        hookPoint: "before_task_complete",
        order: 230,
        parallelGroup: "writing-section-draft",
        filePath: "academic_writer/paper/sections/related_work.tex",
        blockingMode: "block_stage",
        requirementPrompt: buildPrompt({
          title: "academic_writer/paper/sections/related_work.tex",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "Related work must position the paper against the field; it must not degrade into paper-by-paper catalog prose.",
            "Differences from neighbors must stay tied to the supported contribution delta.",
          ],
          supportingArtifacts: manuscriptArtifacts,
        }),
        supportingArtifacts: manuscriptArtifacts,
        appliesWhen: experimentAppliesWhen,
        filters: {
          taskIds: ["write.section.related_work"],
          fileGlobs: ["academic_writer/paper/sections/related_work.tex"],
        },
      })
    );
  }
  if (sectionSet.has("conclusion")) {
    hooks.push(
      buildHook({
        hookId: "conclusion-boundary-audit",
        stage: "write",
        hookPoint: "before_task_complete",
        order: 240,
        parallelGroup: "writing-section-draft",
        filePath: "academic_writer/paper/sections/conclusion.tex",
        blockingMode: "block_stage",
        requirementPrompt: buildPrompt({
          title: "academic_writer/paper/sections/conclusion.tex",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "The conclusion must preserve scope boundaries and keep limitations explicit.",
            "No new claim or broader implication may appear unless it is already supported elsewhere in the manuscript and ledger.",
          ],
          supportingArtifacts: manuscriptArtifacts,
        }),
        supportingArtifacts: manuscriptArtifacts,
        appliesWhen: experimentAppliesWhen,
        filters: {
          taskIds: ["write.section.conclusion"],
          fileGlobs: ["academic_writer/paper/sections/conclusion.tex"],
        },
      })
    );
  }

  if (surveyMode) {
    const surveySectionArtifacts = uniqueStrings([
      ...manuscriptArtifacts,
      "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
      "academic_writer/SURVEY_SECTION_BRIEFS.md",
      "academic_writer/SURVEY_SELF_REVIEW.md",
      "researcher/SURVEY_BRIEF.md",
      "researcher/LITERATURE_REVIEW.md",
      "researcher/SOTA_MATRIX.md",
      "researcher/GAP_SYNTHESIS.md",
      "researcher/COVERAGE_SUMMARY.md",
      "researcher/REVIEW_PROTOCOL.md",
      "researcher/INCLUDED_PAPERS.json",
      "researcher/EXCLUDED_PAPERS.json",
      "researcher/SOURCE_TO_CLAIM_INDEX.json",
      "researcher/SURVEY_TOP_TIER_BRIDGE.json",
      "researcher/SURVEY_TRACEABILITY_AUDIT.json",
      "researcher/SURVEY_METHODOLOGY_CONSISTENCY.json",
      "researcher/SURVEY_REFERENCE_ALIGNMENT.json",
      "academic_writer/SURVEY_COMPARABILITY_REPORT.md",
      "analyzer/FAIR_COMPARE_MATRIX.json",
    ]);

    if (sectionSet.has("abstract")) {
      hooks.push(
        buildHook({
          hookId: "survey-abstract-synthesis-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 200,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/abstract.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey abstract",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "The abstract must summarize the survey scope, organizing thesis, evidence base, and main takeaways without pretending stronger consensus than the packet supports.",
              "Any comparative or field-wide claim must be traceable to the survey evidence bundle.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.abstract"],
            fileGlobs: ["academic_writer/paper/sections/abstract.tex"],
          },
        })
      );
    }
    if (sectionSet.has("introduction")) {
      hooks.push(
        buildHook({
          hookId: "survey-introduction-positioning-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 205,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/introduction.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey introduction",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "The introduction must justify why this survey is needed now and what organizing lens it contributes beyond a paper list.",
              "The survey framing must stay aligned with scope boundaries and known blind spots.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.introduction"],
            fileGlobs: ["academic_writer/paper/sections/introduction.tex"],
          },
        })
      );
    }
    if (sectionSet.has("scope_and_protocol")) {
      hooks.push(
        buildHook({
          hookId: "survey-scope-protocol-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 210,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/scope_and_protocol.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey scope and protocol",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "This section must explain the selection protocol, retrieval boundary, and known blind spots clearly.",
              "Do not let protocol language drift away from REVIEW_PROTOCOL.md or COVERAGE_SUMMARY.md.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.scope_and_protocol"],
            fileGlobs: ["academic_writer/paper/sections/scope_and_protocol.tex"],
          },
        })
      );
    }
    if (sectionSet.has("taxonomy")) {
      hooks.push(
        buildHook({
          hookId: "survey-taxonomy-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 220,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/taxonomy.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey taxonomy",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "The taxonomy must define stable method families or themes rather than list papers flatly.",
              "When category boundaries are tentative or overlapping, the prose must say so instead of pretending a rigid taxonomy.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.taxonomy"],
            fileGlobs: ["academic_writer/paper/sections/taxonomy.tex"],
          },
        })
      );
    }
    if (sectionSet.has("evidence_synthesis")) {
      hooks.push(
        buildHook({
          hookId: "survey-evidence-synthesis-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 230,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/evidence_synthesis.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey evidence synthesis",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "This section must synthesize across papers, families, or benchmarks rather than summarize one paper at a time.",
              "Comparative claims must stay evidence-backed, and non-comparable results must be called out explicitly.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.evidence_synthesis"],
            fileGlobs: ["academic_writer/paper/sections/evidence_synthesis.tex"],
          },
        })
      );
    }
    if (sectionSet.has("benchmark_landscape")) {
      hooks.push(
        buildHook({
          hookId: "survey-benchmark-landscape-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 240,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/benchmark_landscape.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey benchmark landscape",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "Benchmark comparisons must stay honest about dataset/metric incompatibility and missing fairness assumptions.",
              "Do not collapse non-comparable setups into one scoreboard-like ranking.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.benchmark_landscape"],
            fileGlobs: ["academic_writer/paper/sections/benchmark_landscape.tex"],
          },
        })
      );
    }
    hooks.push(
      buildHook({
        hookId: "survey-methodology-consistency-audit",
        stage: "review",
        hookPoint: "before_stage_handoff",
        order: 310,
        parallelGroup: "writing-closeout",
        filePath: "academic_writer/paper/main.tex",
        blockingMode: "block_stage",
        auditorRole: "cross-reviewer",
        requirementPrompt: buildPrompt({
          title: "survey methodology consistency before review handoff",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "Counts, date ranges, and protocol wording must stay internally consistent across abstract, introduction, scope/protocol, and the survey methodology support files.",
            "If the manuscript or protocol still disagrees with INCLUDED_PAPERS.json, EXCLUDED_PAPERS.json, SURVEY_METHODOLOGY_CONSISTENCY.json, or SURVEY_REFERENCE_ALIGNMENT.json, request revision instead of waving it through.",
            'Use "reviewed works" / "papers and preprints" language when the evidence set includes preprints; do not let the manuscript overstate that all entries are formally published papers.',
          ],
          supportingArtifacts: surveySectionArtifacts,
        }),
        supportingArtifacts: surveySectionArtifacts,
        appliesWhen: baseAppliesWhen,
        filters: {
          fileGlobs: ["academic_writer/paper/main.tex"],
        },
      })
    );
    hooks.push(
      buildHook({
        hookId: "survey-source-traceability-audit",
        stage: "review",
        hookPoint: "before_stage_handoff",
        order: 320,
        parallelGroup: "writing-closeout",
        filePath: "academic_writer/paper/main.tex",
        blockingMode: "block_stage",
        auditorRole: "cross-reviewer",
        requirementPrompt: buildPrompt({
          title: "survey source traceability before review handoff",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "Core synthesis claims should remain traceable to SOURCE_TO_CLAIM_INDEX.json rather than floating as unsupported survey prose.",
            "If SURVEY_TRACEABILITY_AUDIT.json still reports unsupported synthesis claims or missing source links, require revision instead of passing the draft forward.",
            "Background-only references may explain scope boundaries, but they must not silently replace true included-paper support for core synthesis claims.",
          ],
          supportingArtifacts: surveySectionArtifacts,
        }),
        supportingArtifacts: surveySectionArtifacts,
        appliesWhen: baseAppliesWhen,
        filters: {
          fileGlobs: [
            "academic_writer/paper/main.tex",
            "researcher/SOURCE_TO_CLAIM_INDEX.json",
            "researcher/SURVEY_TRACEABILITY_AUDIT.json",
          ],
        },
      })
    );
    hooks.push(
      buildHook({
        hookId: "survey-comparability-audit",
        stage: "review",
        hookPoint: "before_stage_handoff",
        order: 325,
        parallelGroup: "writing-closeout",
        filePath: "academic_writer/paper/main.tex",
        blockingMode: "block_stage",
        auditorRole: "cross-reviewer",
        requirementPrompt: buildPrompt({
          title: "survey comparability before review handoff",
          paperMode: params.paperMode,
          topTierVerdict: params.topTierVerdict,
          requirements: [
            "Benchmark and method comparisons should remain grounded in SURVEY_COMPARABILITY_REPORT.md and FAIR_COMPARE_MATRIX.json rather than free-form leaderboard prose.",
            "If the fair-compare packet still lacks usable rows or flags unresolved fairness assumptions, request revision instead of passing review closeout.",
            "Do not let the manuscript imply fair cross-family comparison when the comparability artifacts still mark settings as unclear or confounded.",
          ],
          supportingArtifacts: surveySectionArtifacts,
        }),
        supportingArtifacts: surveySectionArtifacts,
        appliesWhen: baseAppliesWhen,
        filters: {
          fileGlobs: [
            "academic_writer/paper/main.tex",
            "academic_writer/SURVEY_COMPARABILITY_REPORT.md",
            "analyzer/FAIR_COMPARE_MATRIX.json",
          ],
        },
      })
    );
    if (sectionSet.has("open_problems")) {
      hooks.push(
        buildHook({
          hookId: "survey-open-problems-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 250,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/open_problems.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey open problems",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "Open problems must tie back to concrete evidence gaps, contradictions, or thin coverage zones rather than generic future work prose.",
              "The section should rank unresolved problems by evidential importance, not by rhetorical flourish.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.open_problems"],
            fileGlobs: ["academic_writer/paper/sections/open_problems.tex"],
          },
        })
      );
    }
    if (sectionSet.has("conclusion")) {
      hooks.push(
        buildHook({
          hookId: "survey-conclusion-boundary-audit",
          stage: "write",
          hookPoint: "before_task_complete",
          order: 260,
          parallelGroup: "writing-section-draft",
          filePath: "academic_writer/paper/sections/conclusion.tex",
          blockingMode: "block_stage",
          requirementPrompt: buildPrompt({
            title: "survey conclusion",
            paperMode: params.paperMode,
            topTierVerdict: params.topTierVerdict,
            requirements: [
              "The conclusion must summarize what the field knows with confidence while keeping open boundaries and unresolved contradictions explicit.",
              "Do not let the final section imply survey consensus stronger than the evidence bundle supports.",
            ],
            supportingArtifacts: surveySectionArtifacts,
          }),
          supportingArtifacts: surveySectionArtifacts,
          appliesWhen: baseAppliesWhen,
          filters: {
            taskIds: ["write.section.conclusion"],
            fileGlobs: ["academic_writer/paper/sections/conclusion.tex"],
          },
        })
      );
    }
  }

  return sortHookPolicies(hooks);
}

function policiesEqual(left: WorkflowHooksPolicy, right: WorkflowHooksPolicy): boolean {
  return JSON.stringify(serializeWorkflowHooksPolicy(left)) ===
    JSON.stringify(serializeWorkflowHooksPolicy(right));
}

export async function materializeWritingHookPolicies(params: {
  projectRoot: string;
  stage?: string | null;
  paperMode?: WritingMode | string | null;
  topTierVerdict?: string | null;
}): Promise<{
  updated: boolean;
  stage: string | null;
  paperMode: WritingMode | null;
  topTierVerdict: string | null;
  generatedHookIds: string[];
  enabledHookIds: string[];
  deferredHookIds: string[];
  policy: WorkflowHooksPolicy;
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const stage = normalizeStage(params.stage ?? manifest.current_stage ?? manifest.currentStage);
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const paperMode =
    normalizeWritingMode(params.paperMode) ?? writingContract.paperMode ?? null;
  const topTierVerdict = resolveTopTierVerdict(manifest, params.topTierVerdict);
  const paperStory = normalizePaperStoryState(manifest.paper_story_state);
  const reviewPressure = normalizeReviewPressurePacketState(manifest.review_pressure_packet);

  const existingPolicy = await readWorkflowHooksPolicyForProject(params.projectRoot);
  const retainedHooks = existingPolicy.auditHooks.filter(
    (entry) => !WRITING_HOOK_IDS.has(entry.hookId)
  );
  const generatedHooks = WRITING_POLICY_STAGES.has(stage ?? "")
    ? buildWritingHookPolicies({
        paperMode,
        topTierVerdict,
        requiredSections: writingContract.requiredSections,
        paperStory,
        reviewPressure,
      })
    : [];
  const nextPolicy: WorkflowHooksPolicy = {
    enabled: retainedHooks.length + generatedHooks.length > 0,
    auditHooks: sortHookPolicies([...retainedHooks, ...generatedHooks]),
  };

  const alreadyCanonical = Object.prototype.hasOwnProperty.call(manifest, "workflow_hooks");
  const updated = !alreadyCanonical || !policiesEqual(existingPolicy, nextPolicy);
  const policy = updated
    ? await setFileAuditPolicyForProject({
        projectRoot: params.projectRoot,
        hookPolicies: nextPolicy.auditHooks,
        mode: "replace",
      })
    : nextPolicy;

  const generatedHookIds = generatedHooks.map((entry) => entry.hookId);
  const deferredHookIds = generatedHooks
    .filter((entry) => !entry.enabled && DEFERRED_SECTION_HOOK_IDS.has(entry.hookId))
    .map((entry) => entry.hookId);
  const enabledHookIds = generatedHooks
    .filter((entry) => entry.enabled)
    .map((entry) => entry.hookId);

  return {
    updated,
    stage,
    paperMode,
    topTierVerdict,
    generatedHookIds,
    enabledHookIds,
    deferredHookIds,
    policy,
  };
}
