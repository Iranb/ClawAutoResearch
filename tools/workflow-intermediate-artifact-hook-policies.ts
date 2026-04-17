import path from "node:path";

import { pathExists, readJsonIfExists } from "./workflow-guard-core/fs";
import type { WritingMode } from "./workflow-guard.js";
import { normalizePaperStoryState } from "./workflow-guard-state/paper-story";
import { normalizeWritingContractState } from "./workflow-guard-state/writing-contract";
import type {
  WorkflowFileAuditHookPolicy,
  WorkflowHooksPolicy,
} from "./workflow-hooks/contracts.js";
import {
  readWorkflowHooksPolicyForProject,
  serializeWorkflowHooksPolicy,
  setFileAuditPolicyForProject,
  sortHookPolicies,
} from "./workflow-hooks/state.js";

const INTERMEDIATE_ARTIFACT_HOOK_IDS = new Set([
  "frontier-report-quality-audit",
  "idea-report-quality-audit",
  "idea-audit-quality-audit",
  "theory-state-quality-audit",
  "revision-cycle-quality-audit",
]);

const INTERMEDIATE_POLICY_STAGES = new Set([
  "frontier_mapping",
  "idea",
  "analyze",
  "submit",
]);

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

function buildPrompt(params: {
  title: string;
  paperMode: WritingMode | null;
  requirements: string[];
  supportingArtifacts: string[];
}): string {
  const modeLine =
    params.paperMode === "survey"
      ? "Treat this as survey workflow support: demand comparative rigor, scope discipline, and evidence-backed synthesis."
      : "Treat this as experiment workflow support: demand explicit decisions, evidence-backed reasoning, and handoff-safe intermediate state.";
  return [
    `Audit target: ${params.title}`,
    modeLine,
    "Special requirements:",
    ...params.requirements.map((entry) => `- ${entry}`),
    params.supportingArtifacts.length > 0 ? "Supporting artifacts to consult:" : null,
    ...params.supportingArtifacts.map((entry) => `- ${entry}`),
    "Return `pass` only if the target file is substantively populated, structurally usable, and aligned with the workflow intent for this stage.",
    "Return `revise` when the file is present but still hollow, underspecified, drifting from the stage objective, or inconsistent with the supporting artifacts.",
    "Return `block` only for severe integrity failures such as placeholder masquerading as real work, contradiction with the source-of-truth artifacts, or a missing core contract.",
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join("\n");
}

function buildHook(params: {
  hookId: string;
  stage: string;
  order: number;
  filePath: string;
  requirementPrompt: string;
  supportingArtifacts: string[];
  targetRole: string;
  appliesWhen?: WorkflowFileAuditHookPolicy["appliesWhen"];
}): WorkflowFileAuditHookPolicy {
  return {
    hookId: params.hookId,
    hookType: "file_audit",
    enabled: true,
    stage: params.stage,
    hookPoint: "before_stage_handoff",
    order: params.order,
    parallelGroup: "intermediate-artifact-quality",
    targetRole: params.targetRole,
    auditorRole: "cross-reviewer",
    filePath: params.filePath,
    requirementPrompt: params.requirementPrompt,
    supportingArtifacts: uniqueStrings(params.supportingArtifacts),
    blockingMode: "block_stage",
    maxRounds: 3,
    maxUnchangedRounds: 2,
    reviseOwnerRole: params.targetRole,
    reviseCommand: null,
    reportDir: `reviewer/file-audits/${params.hookId}`,
    filters: {
      fileGlobs: [params.filePath],
    },
    appliesWhen: params.appliesWhen ?? null,
    stateScope: "shared_by_stage",
  };
}

async function buildIntermediateArtifactHookPolicies(params: {
  projectRoot: string;
  stage: string | null;
  paperMode: WritingMode | null;
  manifest: Record<string, unknown>;
}): Promise<WorkflowFileAuditHookPolicy[]> {
  const hooks: WorkflowFileAuditHookPolicy[] = [];
  const workflowLine =
    params.stage === "survey_review" || params.paperMode === "survey" ? "survey" : "experiment";

  if (params.stage === "frontier_mapping") {
    const supportingArtifacts = [
      "TRACK_REGISTRY.json",
      "CLAIM_POLICY.md",
      "graph/LIMITATION_FRONTIER.md",
      "graph/CONTRADICTION_FRONTIER.md",
      "graph/TRANSFER_FRONTIER.md",
      "graph/COMPOSITION_FRONTIER.md",
      "graph/ANCHOR_INDEX.md",
    ];
    hooks.push(
      buildHook({
        hookId: "frontier-report-quality-audit",
        stage: "frontier_mapping",
        order: 80,
        targetRole: "researcher",
        filePath: "researcher/FRONTIER_REPORT.md",
        supportingArtifacts,
        appliesWhen: {
          workflowLines: [workflowLine],
          stages: ["frontier_mapping"],
        },
        requirementPrompt: buildPrompt({
          title: "researcher/FRONTIER_REPORT.md before leaving frontier_mapping",
          paperMode: params.paperMode,
          requirements: [
            "The report must summarize real frontiers, tensions, and non-obvious constraints rather than placeholder headings or generic opportunity language.",
            "The report must be specific enough that the next ideation step can recover frontier shape, not just the fact that a frontier step happened.",
            "If supporting graph frontier artifacts expose important limitations, contradictions, transfer routes, or composition opportunities, the report must reflect them explicitly.",
            "Do not pass a report that is structurally present but still hollow, repetitive, or disconnected from the active graph frontier pack.",
          ],
          supportingArtifacts,
        }),
      })
    );
  }

  if (params.stage === "idea") {
    const sharedIdeaArtifacts = [
      "researcher/FRONTIER_REPORT.md",
      "TRACK_REGISTRY.json",
      "PROJECT_MANIFEST.json",
    ];
    hooks.push(
      buildHook({
        hookId: "idea-report-quality-audit",
        stage: "idea",
        order: 100,
        targetRole: "researcher",
        filePath: "researcher/IDEA_REPORT.md",
        supportingArtifacts: sharedIdeaArtifacts,
        appliesWhen: {
          workflowLines: [workflowLine],
          stages: ["idea"],
        },
        requirementPrompt: buildPrompt({
          title: "researcher/IDEA_REPORT.md before leaving idea",
          paperMode: params.paperMode,
          requirements: [
            "The idea report must contain concrete idea candidates, tradeoffs, and why they follow from the frontier rather than broad aspiration language.",
            "The file must be actionable enough that planning can choose or reject directions without redoing the ideation step from scratch.",
            "If the active tracks or project goal constrain the idea space, the report must acknowledge that constraint instead of ignoring it.",
            "Do not pass a report that is mostly headings, single-line bullets, or generic statements that could fit any project.",
          ],
          supportingArtifacts: sharedIdeaArtifacts,
        }),
      }),
      buildHook({
        hookId: "idea-audit-quality-audit",
        stage: "idea",
        order: 110,
        targetRole: "researcher",
        filePath: "researcher/IDEA_AUDIT.md",
        supportingArtifacts: [...sharedIdeaArtifacts, "researcher/IDEA_REPORT.md"],
        appliesWhen: {
          workflowLines: [workflowLine],
          stages: ["idea"],
        },
        requirementPrompt: buildPrompt({
          title: "researcher/IDEA_AUDIT.md before leaving idea",
          paperMode: params.paperMode,
          requirements: [
            "The audit must stress-test the selected idea space with concrete objections, risks, or elimination reasoning instead of only restating the preferred direction.",
            "The audit should make it clear which ideas survived, which were rejected, and why.",
            "If the audit disagrees with IDEA_REPORT.md, the disagreement must be explicit rather than silently drifted away.",
            "Do not pass a file that is only a nominal audit marker without real adversarial content.",
          ],
          supportingArtifacts: [...sharedIdeaArtifacts, "researcher/IDEA_REPORT.md"],
        }),
      })
    );
  }

  if (params.stage === "analyze") {
    const writingContract = normalizeWritingContractState(params.manifest.writing_contract);
    const proofAppendixRequired = writingContract.proofAppendixRequired === true;
    const theoryStatePath = path.join(params.projectRoot, "analyzer", "THEORY_STATE.json");
    if (proofAppendixRequired || (await pathExists(theoryStatePath))) {
      const supportingArtifacts = [
        "analyzer/THEORY_SUPPORT_NOTE.md",
        "analyzer/CLAIM_EVIDENCE_MATRIX.md",
        "academic_writer/THEORY_APPENDIX_PLAN.md",
      ];
      hooks.push(
        buildHook({
          hookId: "theory-state-quality-audit",
          stage: "analyze",
          order: 140,
          targetRole: "analyzer",
          filePath: "analyzer/THEORY_STATE.json",
          supportingArtifacts,
          appliesWhen: {
            workflowLines: ["experiment"],
            stages: ["analyze"],
          },
          requirementPrompt: buildPrompt({
            title: "analyzer/THEORY_STATE.json before leaving analyze",
            paperMode: params.paperMode,
            requirements: [
              "The theory state must capture a real proof/object contract: status, overall signal, and substantive theorem/lemma/body/appendix guidance.",
              "The state should be detailed enough that Writer can distinguish body-safe claims from appendix-only derivations without guessing.",
              "If THEORY_SUPPORT_NOTE.md or the claim-evidence matrix imposes caveats, the structured theory state must preserve them instead of over-cleaning the narrative.",
              "Do not pass a JSON object that satisfies shape checks but still leaves the next role unable to reconstruct the proof plan.",
            ],
            supportingArtifacts,
          }),
        })
      );
    }
  }

  if (params.stage === "submit") {
    const paperStory = normalizePaperStoryState(params.manifest.paper_story_state);
    const revisionCyclePath =
      paperStory.revisionCyclePath ?? "academic_writer/PAPER_REVISION_STATE.json";
    const resolvedRevisionCyclePath = path.join(params.projectRoot, revisionCyclePath);
    if (await pathExists(resolvedRevisionCyclePath)) {
      const supportingArtifacts = [
        "academic_writer/WRITING_SIGNALS.md",
        "reviewer/story-pressure/REVERSE_OUTLINE.md",
        "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
        "reviewer/story-pressure/LIMITATION_AUDIT.md",
      ];
      hooks.push(
        buildHook({
          hookId: "revision-cycle-quality-audit",
          stage: "submit",
          order: 180,
          targetRole: "academic_writer",
          filePath: revisionCyclePath,
          supportingArtifacts,
          appliesWhen: {
            paperModes:
              params.paperMode === "survey"
                ? ["survey"]
                : params.paperMode
                  ? [params.paperMode]
                  : ["conference", "journal", "survey"],
            stages: ["submit"],
          },
          requirementPrompt: buildPrompt({
            title: `${revisionCyclePath} before leaving submit`,
            paperMode: params.paperMode,
            requirements: [
              "The revision cycle must reflect a real multi-pass manuscript process instead of a nominal state file with empty pass objects.",
              "Section pass, intro-method consistency pass, and full-paper adversarial pass should each carry enough structure that downstream submit logic can trust what was reviewed.",
              "If reviewer pressure artifacts still show open weaknesses, the revision cycle must acknowledge them rather than pretending the passes are clean.",
              "Do not pass a revision scaffold that only exists to satisfy a checklist without telling the truth about revision coverage.",
            ],
            supportingArtifacts,
          }),
        })
      );
    }
  }

  return hooks;
}

function policiesEqual(left: WorkflowHooksPolicy, right: WorkflowHooksPolicy): boolean {
  return JSON.stringify(serializeWorkflowHooksPolicy(left)) ===
    JSON.stringify(serializeWorkflowHooksPolicy(right));
}

export async function materializeIntermediateArtifactHookPolicies(params: {
  projectRoot: string;
  stage?: string | null;
  paperMode?: WritingMode | string | null;
}): Promise<{
  updated: boolean;
  stage: string | null;
  paperMode: WritingMode | null;
  generatedHookIds: string[];
  enabledHookIds: string[];
  policy: WorkflowHooksPolicy;
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const stage = normalizeStage(params.stage ?? manifest.current_stage ?? manifest.currentStage);
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const paperMode =
    (typeof params.paperMode === "string"
      ? normalizeStage(params.paperMode)
      : params.paperMode) === "survey"
      ? "survey"
      : (typeof params.paperMode === "string"
          ? normalizeStage(params.paperMode)
          : params.paperMode) === "journal"
        ? "journal"
        : (typeof params.paperMode === "string"
            ? normalizeStage(params.paperMode)
            : params.paperMode) === "conference"
          ? "conference"
          : writingContract.paperMode ?? null;

  const existingPolicy = await readWorkflowHooksPolicyForProject(params.projectRoot);
  const retainedHooks = existingPolicy.auditHooks.filter(
    (entry) => !INTERMEDIATE_ARTIFACT_HOOK_IDS.has(entry.hookId)
  );
  const generatedHooks = INTERMEDIATE_POLICY_STAGES.has(stage ?? "")
    ? await buildIntermediateArtifactHookPolicies({
        projectRoot: params.projectRoot,
        stage,
        paperMode,
        manifest,
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

  return {
    updated,
    stage,
    paperMode,
    generatedHookIds: generatedHooks.map((entry) => entry.hookId),
    enabledHookIds: generatedHooks.filter((entry) => entry.enabled).map((entry) => entry.hookId),
    policy,
  };
}
