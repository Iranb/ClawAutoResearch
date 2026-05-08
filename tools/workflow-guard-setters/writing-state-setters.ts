import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  DEFAULT_KG_STORYLINE_PACKET_PATH,
  DEFAULT_PARAGRAPH_LOGIC_CHECKLIST,
  DEFAULT_PROOF_CHECKLIST,
  DEFAULT_SCIENTIFIC_EDITING_PASSES,
  DEFAULT_STORYLINE_CHECKLIST,
  DEFAULT_WRITING_SECTION_ORDER,
  evaluateWritingContractState,
  normalizeWritingContractState,
  normalizeWritingMode,
  resolveWritingTemplatePath,
  serializeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import {
  normalizeWritingSessionState,
  serializeWritingSessionState,
  normalizeWritingSectionPacketState,
  normalizeReviewSessionRubric,
  serializeReviewSessionRubric,
  normalizeReviewSessionState,
  serializeReviewSessionState,
  normalizeGraphGuidedWritingState,
  serializeGraphGuidedWritingState,
  normalizeExternalReviewState,
  serializeExternalReviewState,
} from "../workflow-guard-state/authoring-review-state";
import {
  areWritingSectionPacketsReady,
  evaluateWritingProcessReadiness,
  isExternalReviewConclusionReady,
  isGraphGuidedWritingReadyForSubmit,
  isWritingSessionReadyForSubmit,
} from "../workflow-guard-writing/write-package-eval";
import { syncAuthoringArtifactRecovery } from "../research-writing/authoring-artifact-recovery";
import { materializeRevisionControlState } from "../research-writing/revision-control";
import type { WorkflowGuardPolicy } from "../workflow-guard.js";

type WritingMode = "conference" | "journal" | "survey";

type WritingContractState = ReturnType<typeof normalizeWritingContractState>;
type WritingSessionState = ReturnType<typeof normalizeWritingSessionState>;
type ReviewSessionState = ReturnType<typeof normalizeReviewSessionState>;
type GraphGuidedWritingState = ReturnType<typeof normalizeGraphGuidedWritingState>;
type ExternalReviewState = ReturnType<typeof normalizeExternalReviewState>;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_RESEARCH_REVIEW_STATE_PATH = "researcher/REVIEW_STATE.json";
const DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH =
  "reviewer/SUBMISSION_SIMULATION_REVIEW.json";

type WritingModePreset = {
  templateFile: string;
  templateName: string;
  bodyPageBudget: number;
  referencePageBudget: number;
  bodyWordTargetMin: number;
  bodyWordTargetMax: number;
  maxCoreIdeas: number;
  maxHeadlineClaims: number;
  requiredSections: string[];
  sectionOrder: string[];
  kgStorylineRequired: boolean;
  proofAppendixRequired: boolean;
};

const WRITING_MODE_PRESETS: Record<WritingMode, WritingModePreset> = {
  conference: {
    templateFile: "conference-9p-body-2p-refs.md",
    templateName: "conference-9p-body-2p-refs",
    bodyPageBudget: 9,
    referencePageBudget: 2,
    bodyWordTargetMin: 5000,
    bodyWordTargetMax: 6500,
    maxCoreIdeas: 2,
    maxHeadlineClaims: 3,
    requiredSections: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
    sectionOrder: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
    kgStorylineRequired: true,
    proofAppendixRequired: true,
  },
  journal: {
    templateFile: "journal-12p-body-2p-refs.md",
    templateName: "journal-12p-body-2p-refs",
    bodyPageBudget: 12,
    referencePageBudget: 2,
    bodyWordTargetMin: 7000,
    bodyWordTargetMax: 9500,
    maxCoreIdeas: 2,
    maxHeadlineClaims: 4,
    requiredSections: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
    sectionOrder: [
      "abstract",
      "introduction",
      "related_work",
      "method",
      "experiments",
      "results",
      "discussion",
      "limitations",
      "conclusion",
    ],
    kgStorylineRequired: true,
    proofAppendixRequired: true,
  },
  survey: {
    templateFile: "survey-review.md",
    templateName: "survey-review",
    bodyPageBudget: 12,
    referencePageBudget: 4,
    bodyWordTargetMin: 7000,
    bodyWordTargetMax: 10000,
    maxCoreIdeas: 4,
    maxHeadlineClaims: 6,
    requiredSections: [
      "abstract",
      "introduction",
      "scope_and_protocol",
      "taxonomy",
      "evidence_synthesis",
      "benchmark_landscape",
      "open_problems",
      "conclusion",
    ],
    sectionOrder: [
      "abstract",
      "introduction",
      "scope_and_protocol",
      "taxonomy",
      "evidence_synthesis",
      "benchmark_landscape",
      "open_problems",
      "conclusion",
    ],
    kgStorylineRequired: false,
    proofAppendixRequired: false,
  },
};

function getManifestPath(projectRoot: string): string {
  return path.join(projectRoot, "PROJECT_MANIFEST.json");
}

async function readManifestEnsured(projectRoot: string): Promise<Record<string, unknown>> {
  return (await readJsonIfExists<Record<string, unknown>>(getManifestPath(projectRoot))) ?? {};
}

async function saveManifest(
  projectRoot: string,
  manifest: Record<string, unknown>
): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeJsonEnsured(getManifestPath(projectRoot), manifest);
}

async function upsertJsonArtifact(
  targetPath: string | null,
  patch: Record<string, unknown>
): Promise<void> {
  if (!targetPath) {
    return;
  }
  const current = (await readJsonIfExists<Record<string, unknown>>(targetPath)) ?? {};
  await writeJsonEnsured(targetPath, {
    ...current,
    ...patch,
  });
}

async function scaffoldMarkdownArtifactIfMissing(
  targetPath: string | null,
  content: string
): Promise<void> {
  if (!targetPath) {
    return;
  }
  if (await pathExists(targetPath)) {
    return;
  }
  await writeTextEnsured(targetPath, content);
}

function sanitizeTemplateCopyName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "template";
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isBundledWritingModeTemplatePath(templatePath: string | null): boolean {
  if (!templatePath) {
    return false;
  }
  const normalized = path.normalize(templatePath);
  return Object.values(WRITING_MODE_PRESETS).some((preset) =>
    normalized.endsWith(
      path.normalize(path.join("templates", "writing", preset.templateFile))
    )
  );
}

function getConfiguredWritingModeTemplatePath(
  policy: WorkflowGuardPolicy | undefined,
  mode: WritingMode
): string | null {
  const configured =
    mode === "conference"
      ? policy?.defaultConferenceTemplatePath
      : mode === "journal"
        ? policy?.defaultJournalTemplatePath
        : null;
  return configured || null;
}

async function resolveBundledWritingModeTemplatePath(
  mode: WritingMode
): Promise<string | null> {
  const preset = WRITING_MODE_PRESETS[mode];
  const relativePath = path.join("templates", "writing", preset.templateFile);
  const candidates = [
    path.join(MODULE_DIR, "..", relativePath),
    path.join(MODULE_DIR, "..", "..", relativePath),
  ];
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (await pathExists(normalized)) {
      return normalized;
    }
  }
  return path.normalize(candidates[0]);
}

async function copyWritingTemplateIntoProject(params: {
  projectRoot: string;
  sourcePath: string;
  paperMode: WritingMode | null;
}): Promise<{
  projectTemplatePath: string;
  projectTemplateResolvedPath: string;
}> {
  const resolvedSourcePath = path.normalize(params.sourcePath);
  const projectRoot = path.normalize(params.projectRoot);

  if (isInside(projectRoot, resolvedSourcePath)) {
    return {
      projectTemplatePath: path.relative(projectRoot, resolvedSourcePath),
      projectTemplateResolvedPath: resolvedSourcePath,
    };
  }

  const sourceStat = await fs.stat(resolvedSourcePath);
  const templateBundleRoot = path.join(projectRoot, "academic_writer", "template_bundle");
  await fs.mkdir(templateBundleRoot, { recursive: true });

  const modePrefix = params.paperMode ? `${params.paperMode}-` : "";
  if (sourceStat.isDirectory()) {
    const destinationDir = path.join(
      templateBundleRoot,
      `${modePrefix}${sanitizeTemplateCopyName(path.basename(resolvedSourcePath))}`
    );
    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.cp(resolvedSourcePath, destinationDir, { recursive: true, force: true });
    return {
      projectTemplatePath: path.relative(projectRoot, destinationDir),
      projectTemplateResolvedPath: destinationDir,
    };
  }

  const sourceDir = path.dirname(resolvedSourcePath);
  const destinationDir = path.join(
    templateBundleRoot,
    `${modePrefix}${sanitizeTemplateCopyName(path.basename(sourceDir))}`
  );
  await fs.rm(destinationDir, { recursive: true, force: true });
  await fs.cp(sourceDir, destinationDir, { recursive: true, force: true });
  const destinationFile = path.join(destinationDir, path.basename(resolvedSourcePath));
  return {
    projectTemplatePath: path.relative(projectRoot, destinationFile),
    projectTemplateResolvedPath: destinationFile,
  };
}

function deriveResearchMemoryReviewVerdict(
  value: string | null | undefined
): "ready" | "almost" | "not ready" {
  const normalized = normalizeStage(value);
  if (normalized && ["ready", "publication_ready", "accept", "accepted"].includes(normalized)) {
    return "ready";
  }
  if (
    normalized &&
    ["almost", "almost_ready", "minor_revision", "needs_revision", "revise"].includes(
      normalized
    )
  ) {
    return "almost";
  }
  return "not ready";
}

function deriveResearchMemoryReviewScore(reviewSession: ReviewSessionState): number {
  const rubricValues = Object.values(reviewSession.rubric).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (rubricValues.length > 0) {
    const average =
      rubricValues.reduce((sum, value) => sum + value, 0) / rubricValues.length;
    return Math.round(average * 100) / 100;
  }
  const verdict = deriveResearchMemoryReviewVerdict(reviewSession.verdict);
  switch (verdict) {
    case "ready":
      return 8;
    case "almost":
      return 6.5;
    default:
      return 4;
  }
}

function getWritingSessionStateValidationErrors(state: WritingSessionState): string[] {
  const errors: string[] = [];
  const finalLikeStatuses = new Set(["finalized", "frozen"]);
  for (const section of DEFAULT_WRITING_SECTION_ORDER) {
    const normalized = normalizeStage(section) ?? section;
    const packet = state.sectionPackets[normalized];
    if (!packet) {
      errors.push(`writing_session missing section packet for required section ${section}`);
      continue;
    }
    if (packet.status === "stale" || packet.stale) {
      errors.push(`section packet ${section} is stale`);
    }
    if (
      state.finalizedSections.includes(normalized) &&
      !finalLikeStatuses.has(packet.status)
    ) {
      errors.push(
        `finalized section ${section} must have packet status finalized/frozen (current: ${packet.status})`
      );
    }
    if (
      state.compileSafeSections.includes(normalized) &&
      !state.finalizedSections.includes(normalized)
    ) {
      errors.push(`compile_safe section ${section} must also be finalized`);
    }
  }
  const currentSection = state.currentSection;
  if (currentSection) {
    const packet = state.sectionPackets[currentSection];
    if (packet && packet.status === "frozen") {
      errors.push(`current_section ${currentSection} cannot be frozen`);
    }
  }
  return errors;
}

export async function setWritingContractState(params: {
  projectRoot: string;
  writingContract: Record<string, unknown>;
  policy?: WorkflowGuardPolicy;
}): Promise<{
  state: WritingContractState;
  templateResolvedPath: string | null;
  projectTemplateResolvedPath: string | null;
  sourceTemplateResolvedPath: string | null;
  templateExists: boolean;
  templateReady: boolean;
  templateStatus: string;
  templateCopyStatus: string;
  paragraphLogicStatus: string;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeWritingContractState(manifest.writing_contract);
  const patch = asRecord(params.writingContract) ?? {};
  const requestedMode =
    normalizeWritingMode(patch.paperMode ?? patch.paper_mode) ?? current.paperMode;
  const modeChanged = Boolean(requestedMode && requestedMode !== current.paperMode);
  const hasKgStorylineRequiredPatch =
    Object.prototype.hasOwnProperty.call(patch, "kgStorylineRequired") ||
    Object.prototype.hasOwnProperty.call(patch, "kg_storyline_required");
  const requestedTemplatePath =
    patch.templatePath || patch.template_path
      ? pickString(patch, ["templatePath", "template_path"])
      : null;
  let templatePath = requestedTemplatePath ?? current.templatePath;
  let templateName =
    pickString(patch, ["templateName", "template_name"]) ?? current.templateName;
  let requiredSections =
    patch.requiredSections || patch.required_sections
      ? asStringArray(patch.requiredSections ?? patch.required_sections)
      : current.requiredSections;
  let sectionOrder =
    patch.sectionOrder || patch.section_order
      ? asStringArray(patch.sectionOrder ?? patch.section_order)
      : current.sectionOrder;
  let bodyPageBudget =
    pickNumber(patch, ["bodyPageBudget", "body_page_budget"]) ?? current.bodyPageBudget;
  let referencePageBudget =
    pickNumber(patch, ["referencePageBudget", "reference_page_budget"]) ??
    current.referencePageBudget;
  let bodyWordTargetMin =
    pickNumber(patch, ["bodyWordTargetMin", "body_word_target_min"]) ??
    current.bodyWordTargetMin;
  let bodyWordTargetMax =
    pickNumber(patch, ["bodyWordTargetMax", "body_word_target_max"]) ??
    current.bodyWordTargetMax;
  let maxCoreIdeas =
    pickNumber(patch, ["maxCoreIdeas", "max_core_ideas"]) ?? current.maxCoreIdeas;
  let maxHeadlineClaims =
    pickNumber(patch, ["maxHeadlineClaims", "max_headline_claims"]) ??
    current.maxHeadlineClaims;
  let storylineSource =
    pickString(patch, ["storylineSource", "storyline_source"]) ??
    current.storylineSource;
  let mainTextProofStyle =
    pickString(patch, ["mainTextProofStyle", "main_text_proof_style"]) ??
    current.mainTextProofStyle;
  let proofAppendixRequired =
    pickBoolean(patch, ["proofAppendixRequired", "proof_appendix_required"]) ??
    current.proofAppendixRequired;
  let proofAppendixPath =
    pickString(patch, ["proofAppendixPath", "proof_appendix_path"]) ??
    current.proofAppendixPath;
  const proofAppendixStatus =
    normalizeStage(patch.proofAppendixStatus ?? patch.proof_appendix_status) ??
    current.proofAppendixStatus;
  let theoryNotePath =
    pickString(patch, ["theoryNotePath", "theory_note_path"]) ??
    current.theoryNotePath;
  let proofChecklist =
    patch.proofChecklist || patch.proof_checklist
      ? asStringArray(patch.proofChecklist ?? patch.proof_checklist)
      : current.proofChecklist;
  const scientificEditingPasses =
    patch.scientificEditingPasses || patch.scientific_editing_passes
      ? asStringArray(
          patch.scientificEditingPasses ?? patch.scientific_editing_passes
        )
      : current.scientificEditingPasses;
  let kgStorylineRequired =
    pickBoolean(patch, ["kgStorylineRequired", "kg_storyline_required"]) ??
    current.kgStorylineRequired;
  let kgStorylinePacketPath =
    pickString(patch, ["kgStorylinePacketPath", "kg_storyline_packet_path"]) ??
    current.kgStorylinePacketPath;
  let storylineChecklist =
    patch.storylineChecklist || patch.storyline_checklist
      ? asStringArray(patch.storylineChecklist ?? patch.storyline_checklist)
      : current.storylineChecklist;

  if (requestedMode) {
    const preset = WRITING_MODE_PRESETS[requestedMode];
    if (!requestedTemplatePath && (!templatePath || isBundledWritingModeTemplatePath(templatePath))) {
      templatePath =
        getConfiguredWritingModeTemplatePath(params.policy, requestedMode) ??
        (await resolveBundledWritingModeTemplatePath(requestedMode));
    }
    if (!templateName || templateName === current.templateName) {
      templateName = preset.templateName;
    }
    if (requiredSections.length === 0 || modeChanged) {
      requiredSections = [...preset.requiredSections];
    }
    if (sectionOrder.length === 0 || modeChanged) {
      sectionOrder = [...preset.sectionOrder];
    }
    bodyPageBudget = modeChanged ? preset.bodyPageBudget : bodyPageBudget ?? preset.bodyPageBudget;
    referencePageBudget = modeChanged
      ? preset.referencePageBudget
      : referencePageBudget ?? preset.referencePageBudget;
    bodyWordTargetMin = modeChanged
      ? preset.bodyWordTargetMin
      : bodyWordTargetMin ?? preset.bodyWordTargetMin;
    bodyWordTargetMax = modeChanged
      ? preset.bodyWordTargetMax
      : bodyWordTargetMax ?? preset.bodyWordTargetMax;
    maxCoreIdeas = modeChanged ? preset.maxCoreIdeas : maxCoreIdeas ?? preset.maxCoreIdeas;
    maxHeadlineClaims = modeChanged
      ? preset.maxHeadlineClaims
      : maxHeadlineClaims ?? preset.maxHeadlineClaims;
    storylineSource =
      storylineSource ?? (requestedMode === "survey" ? "survey_packet" : "papernexus_kg");
    if (!hasKgStorylineRequiredPatch && modeChanged) {
      kgStorylineRequired = preset.kgStorylineRequired;
    }
    kgStorylinePacketPath =
      kgStorylinePacketPath ?? DEFAULT_KG_STORYLINE_PACKET_PATH;
    if (storylineChecklist.length === 0) {
      storylineChecklist = [...DEFAULT_STORYLINE_CHECKLIST];
    }
    if (proofChecklist.length === 0) {
      proofChecklist = [...DEFAULT_PROOF_CHECKLIST];
    }
    mainTextProofStyle = mainTextProofStyle ?? "lemma_result_only";
    proofAppendixRequired = modeChanged
      ? preset.proofAppendixRequired
      : proofAppendixRequired ?? preset.proofAppendixRequired;
    proofAppendixPath =
      proofAppendixPath ?? "academic_writer/paper/sections/appendix_theory.tex";
    theoryNotePath = theoryNotePath ?? "analyzer/THEORY_SUPPORT_NOTE.md";
  }

  let projectTemplatePath =
    pickString(patch, ["projectTemplatePath", "project_template_path"]) ??
    current.projectTemplatePath;
  let templateCopyStatus =
    normalizeStage(patch.templateCopyStatus ?? patch.template_copy_status) ??
    current.templateCopyStatus;

  const sourceTemplateResolvedPath = resolveWritingTemplatePath(
    params.projectRoot,
    templatePath
  );
  if (sourceTemplateResolvedPath && (await pathExists(sourceTemplateResolvedPath))) {
    const copiedTemplate = await copyWritingTemplateIntoProject({
      projectRoot: params.projectRoot,
      sourcePath: sourceTemplateResolvedPath,
      paperMode: requestedMode,
    });
    projectTemplatePath = copiedTemplate.projectTemplatePath;
    templateCopyStatus = "ready";
  } else if (templatePath) {
    projectTemplatePath = current.projectTemplatePath;
    templateCopyStatus = "missing";
  }

  const next: WritingContractState = {
    ...current,
    paperMode: requestedMode,
    templateRequired:
      pickBoolean(patch, ["templateRequired", "template_required"]) ??
      current.templateRequired,
    templatePath,
    projectTemplatePath,
    templateName,
    templateStatus:
      normalizeStage(patch.templateStatus ?? patch.template_status) ??
      current.templateStatus,
    templateCopyStatus,
    bodyPageBudget:
      bodyPageBudget == null ? null : Math.max(1, Math.floor(bodyPageBudget)),
    referencePageBudget:
      referencePageBudget == null ? null : Math.max(1, Math.floor(referencePageBudget)),
    bodyWordTargetMin:
      bodyWordTargetMin == null ? null : Math.max(500, Math.floor(bodyWordTargetMin)),
    bodyWordTargetMax:
      bodyWordTargetMax == null ? null : Math.max(500, Math.floor(bodyWordTargetMax)),
    maxCoreIdeas: Math.max(1, Math.floor(maxCoreIdeas ?? current.maxCoreIdeas)),
    maxHeadlineClaims: Math.max(
      1,
      Math.floor(maxHeadlineClaims ?? current.maxHeadlineClaims)
    ),
    mainTextProofStyle,
    proofAppendixRequired,
    proofAppendixPath,
    proofAppendixStatus,
    theoryNotePath,
    proofChecklist,
    scientificEditingRequired:
      pickBoolean(patch, [
        "scientificEditingRequired",
        "scientific_editing_required",
      ]) ?? current.scientificEditingRequired,
    scientificEditingStatus:
      normalizeStage(
        patch.scientificEditingStatus ?? patch.scientific_editing_status
      ) ?? current.scientificEditingStatus,
    scientificEditingPasses,
    scientificEditingLedgerPath:
      pickString(patch, [
        "scientificEditingLedgerPath",
        "scientific_editing_ledger_path",
      ]) ?? current.scientificEditingLedgerPath,
    scientificEditingReportPath:
      pickString(patch, [
        "scientificEditingReportPath",
        "scientific_editing_report_path",
      ]) ?? current.scientificEditingReportPath,
    lastScientificEditingAt:
      pickString(patch, [
        "lastScientificEditingAt",
        "last_scientific_editing_at",
      ]) ?? current.lastScientificEditingAt,
    storylineSource,
    kgStorylineRequired,
    kgStorylineStatus:
      normalizeStage(patch.kgStorylineStatus ?? patch.kg_storyline_status) ??
      current.kgStorylineStatus,
    kgStorylinePacketPath,
    storylineChecklist,
    requiredSections,
    sectionOrder,
    paragraphLogicChecklist:
      patch.paragraphLogicChecklist || patch.paragraph_logic_checklist
        ? asStringArray(
            patch.paragraphLogicChecklist ?? patch.paragraph_logic_checklist
          )
        : current.paragraphLogicChecklist,
    paragraphLogicStatus:
      normalizeStage(
        patch.paragraphLogicStatus ?? patch.paragraph_logic_status
      ) ?? current.paragraphLogicStatus,
    lastTemplateAppliedAt:
      pickString(patch, ["lastTemplateAppliedAt", "last_template_applied_at"]) ??
      current.lastTemplateAppliedAt,
    lastParagraphLogicAuditAt:
      pickString(patch, [
        "lastParagraphLogicAuditAt",
        "last_paragraph_logic_audit_at",
      ]) ?? current.lastParagraphLogicAuditAt,
    templateMappingPath:
      pickString(patch, ["templateMappingPath", "template_mapping_path"]) ??
      current.templateMappingPath,
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (next.requiredSections.length === 0) {
    next.requiredSections = [...DEFAULT_WRITING_SECTION_ORDER];
  }
  if (next.sectionOrder.length === 0) {
    next.sectionOrder = [...DEFAULT_WRITING_SECTION_ORDER];
  }
  if (next.storylineChecklist.length === 0) {
    next.storylineChecklist = [...DEFAULT_STORYLINE_CHECKLIST];
  }
  if (next.proofChecklist.length === 0) {
    next.proofChecklist = [...DEFAULT_PROOF_CHECKLIST];
  }
  if (next.scientificEditingPasses.length === 0) {
    next.scientificEditingPasses = [...DEFAULT_SCIENTIFIC_EDITING_PASSES];
  }
  if (next.scientificEditingRequired && next.scientificEditingStatus === "optional") {
    next.scientificEditingStatus = "pending";
  }
  if (next.paragraphLogicChecklist.length === 0) {
    next.paragraphLogicChecklist = [...DEFAULT_PARAGRAPH_LOGIC_CHECKLIST];
  }

  const evaluation = await evaluateWritingContractState({
    projectRoot: params.projectRoot,
    state: next,
  });
  next.templateStatus = evaluation.templateStatus;
  next.templateCopyStatus = evaluation.templateCopyStatus;
  next.pendingReason = evaluation.pendingReason;

  manifest.writing_contract = serializeWritingContractState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    templateResolvedPath: evaluation.templateResolvedPath,
    projectTemplateResolvedPath: evaluation.projectTemplateResolvedPath,
    sourceTemplateResolvedPath: evaluation.sourceTemplateResolvedPath,
    templateExists: evaluation.templateExists,
    templateReady:
      !next.templateRequired ||
      Boolean(evaluation.templateResolvedPath && evaluation.templateExists),
    templateStatus: evaluation.templateStatus,
    templateCopyStatus: evaluation.templateCopyStatus,
    paragraphLogicStatus: next.paragraphLogicStatus,
  };
}

export async function setWritingSessionState(params: {
  projectRoot: string;
  writingSession: Record<string, unknown>;
}): Promise<{
  state: WritingSessionState;
  currentSectionPacketResolvedPath: string | null;
  readyForSubmit: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeWritingSessionState(manifest.writing_session);
  const patch = asRecord(params.writingSession) ?? {};
  const sectionPacketsPatch = asRecord(
    patch.sectionPackets ?? patch.section_packets
  );
  const explicitStatus = normalizeStage(patch.status);
  const explicitHeadlineClaimEvidenceStatus = normalizeStage(
    patch.headlineClaimEvidenceStatus ?? patch.headline_claim_evidence_status
  );
  const explicitGraphEvidenceCoverageStatus = normalizeStage(
    patch.graphEvidenceCoverageStatus ?? patch.graph_evidence_coverage_status
  );
  const next: WritingSessionState = {
    ...current,
    status: explicitStatus ?? current.status,
    processStatus: current.processStatus,
    outlineReady: current.outlineReady,
    currentSection:
      normalizeStage(patch.currentSection ?? patch.current_section) ??
      current.currentSection,
    draftOrder:
      patch.draftOrder || patch.draft_order
        ? asStringArray(patch.draftOrder ?? patch.draft_order)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.draftOrder,
    draftedSections:
      patch.draftedSections || patch.drafted_sections
        ? asStringArray(patch.draftedSections ?? patch.drafted_sections)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.draftedSections,
    reviewedSections:
      patch.reviewedSections || patch.reviewed_sections
        ? asStringArray(patch.reviewedSections ?? patch.reviewed_sections)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.reviewedSections,
    finalizedSections:
      patch.finalizedSections || patch.finalized_sections
        ? asStringArray(patch.finalizedSections ?? patch.finalized_sections)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.finalizedSections,
    manuscriptComplete:
      pickBoolean(patch, ["manuscriptComplete", "manuscript_complete"]) ??
      current.manuscriptComplete,
    compileSafeSections:
      patch.compileSafeSections || patch.compile_safe_sections
        ? asStringArray(patch.compileSafeSections ?? patch.compile_safe_sections)
            .map((entry) => normalizeStage(entry) ?? entry)
            .filter(Boolean)
        : current.compileSafeSections,
    compileReady:
      pickBoolean(patch, ["compileReady", "compile_ready"]) ?? current.compileReady,
    sectionPackets: sectionPacketsPatch
      ? Object.fromEntries(
          Object.entries(sectionPacketsPatch).map(([key, value]) => [
            normalizeStage(key) ?? key,
            normalizeWritingSectionPacketState(key, value),
          ])
        )
      : current.sectionPackets,
    nextSuggestedSection:
      normalizeStage(
        patch.nextSuggestedSection ?? patch.next_suggested_section
      ) ?? current.nextSuggestedSection,
    rebuildNeeded:
      pickBoolean(patch, ["rebuildNeeded", "rebuild_needed"]) ?? current.rebuildNeeded,
    rebuildReason:
      pickString(patch, ["rebuildReason", "rebuild_reason"]) ?? current.rebuildReason,
    headlineClaimEvidenceStatus:
      explicitHeadlineClaimEvidenceStatus ?? current.headlineClaimEvidenceStatus,
    graphEvidenceCoverageStatus:
      explicitGraphEvidenceCoverageStatus ?? current.graphEvidenceCoverageStatus,
    graphEvidenceCoverageSummary:
      pickString(patch, [
        "graphEvidenceCoverageSummary",
        "graph_evidence_coverage_summary",
      ]) ?? current.graphEvidenceCoverageSummary,
    citationPlanMode:
      normalizeStage(patch.citationPlanMode ?? patch.citation_plan_mode) ??
      current.citationPlanMode,
    externalScholarQueryMode:
      normalizeStage(
        patch.externalScholarQueryMode ?? patch.external_scholar_query_mode
      ) ?? current.externalScholarQueryMode,
    futureScholarVerificationSkill:
      pickString(patch, [
        "futureScholarVerificationSkill",
        "future_scholar_verification_skill",
      ]) ?? current.futureScholarVerificationSkill,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  const sectionPacketsReady = areWritingSectionPacketsReady(next);
  if (!explicitHeadlineClaimEvidenceStatus && sectionPacketsReady) {
    next.headlineClaimEvidenceStatus = "ready";
  }
  if (!explicitGraphEvidenceCoverageStatus && sectionPacketsReady) {
    next.graphEvidenceCoverageStatus = "covered";
  }

  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const writingProcess = evaluateWritingProcessReadiness({
    writingSession: next,
    writingContract,
  });
  next.processStatus = writingProcess.processStatus;
  if (!explicitStatus) {
    next.status = writingProcess.processStatus;
  }
  next.outlineReady = !["missing", "bootstrapping"].includes(
    writingProcess.processStatus
  );
  next.draftedSections = writingProcess.draftedSections;
  next.reviewedSections = writingProcess.reviewedSections;
  next.manuscriptComplete = ["manuscript_complete", "compile_ready", "ready_for_submit"].includes(
    writingProcess.processStatus
  );
  next.compileReady = ["compile_ready", "ready_for_submit"].includes(
    writingProcess.processStatus
  );
  next.nextSuggestedSection = writingProcess.nextSuggestedSection;
  next.rebuildNeeded = writingProcess.rebuildNeeded;
  next.rebuildReason = writingProcess.rebuildReason;
  if (
    !explicitStatus &&
    sectionPacketsReady &&
    ["covered", "ready", "complete", "completed"].includes(
      normalizeStage(next.graphEvidenceCoverageStatus) ?? ""
    )
  ) {
    next.status = "ready_for_submit";
    next.processStatus = "ready_for_submit";
    next.compileReady = true;
    next.manuscriptComplete = true;
  }

  manifest.writing_session = serializeWritingSessionState(next);
  await saveManifest(params.projectRoot, manifest);
  await syncAuthoringArtifactRecovery({
    projectRoot: params.projectRoot,
    writingSession: manifest.writing_session as Record<string, unknown>,
  }).catch(() => null);

  const currentSectionPacket = next.currentSection
    ? next.sectionPackets[next.currentSection] ?? null
    : null;
  return {
    state: next,
    currentSectionPacketResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      currentSectionPacket?.packetPath ?? null
    ),
    readyForSubmit: isWritingSessionReadyForSubmit(next),
  };
}

export async function setReviewSessionState(params: {
  projectRoot: string;
  reviewSession: Record<string, unknown>;
}): Promise<{
  state: ReviewSessionState;
  reviewPacketResolvedPath: string | null;
  latestReviewResolvedPath: string | null;
  revisionControl: Awaited<ReturnType<typeof materializeRevisionControlState>>["state"];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeReviewSessionState(manifest.review_session);
  const patch = asRecord(params.reviewSession) ?? {};
  const next: ReviewSessionState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    stageScope:
      normalizeStage(patch.stageScope ?? patch.stage_scope) ?? current.stageScope,
    round: Math.max(
      0,
      Math.floor(pickNumber(patch, ["round"]) ?? current.round)
    ),
    reviewPacketPath:
      pickString(patch, ["reviewPacketPath", "review_packet_path"]) ??
      current.reviewPacketPath,
    graphEvidenceSummaryPath:
      pickString(patch, [
        "graphEvidenceSummaryPath",
        "graph_evidence_summary_path",
      ]) ?? current.graphEvidenceSummaryPath,
    latestReviewPath:
      pickString(patch, ["latestReviewPath", "latest_review_path"]) ??
      current.latestReviewPath,
    verdict: pickString(patch, ["verdict"]) ?? current.verdict,
    rubric:
      patch.rubric != null
        ? normalizeReviewSessionRubric(patch.rubric)
        : current.rubric,
    reviewerSummary:
      pickString(patch, ["reviewerSummary", "reviewer_summary"]) ??
      current.reviewerSummary,
    actionItems:
      patch.actionItems || patch.action_items
        ? asStringArray(patch.actionItems ?? patch.action_items)
        : current.actionItems,
    blockingArtifacts:
      patch.blockingArtifacts || patch.blocking_artifacts
        ? asStringArray(patch.blockingArtifacts ?? patch.blocking_artifacts)
        : current.blockingArtifacts,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  manifest.review_session = serializeReviewSessionState(next);
  await saveManifest(params.projectRoot, manifest);
  await writeJsonEnsured(
    path.join(params.projectRoot, DEFAULT_RESEARCH_REVIEW_STATE_PATH),
    {
      round: next.round,
      status: next.status === "completed" ? "completed" : "in_progress",
      lastScore: deriveResearchMemoryReviewScore(next),
      lastVerdict: deriveResearchMemoryReviewVerdict(next.verdict),
      pendingActions: next.actionItems,
      timestamp: next.lastUpdatedAt ?? new Date().toISOString(),
    }
  );
  await upsertJsonArtifact(
    resolveProjectArtifactPath(params.projectRoot, next.reviewPacketPath),
    {
      status: next.status,
      stage_scope: next.stageScope,
      round: next.round,
      verdict: next.verdict,
      rubric: serializeReviewSessionRubric(next.rubric),
      reviewer_summary: next.reviewerSummary,
      action_items: next.actionItems,
      blocking_artifacts: next.blockingArtifacts,
      updated_at: next.lastUpdatedAt,
      source: "research_workflow.set_review_session",
    }
  );
  await scaffoldMarkdownArtifactIfMissing(
    resolveProjectArtifactPath(params.projectRoot, next.graphEvidenceSummaryPath),
    [
      "# Graph Evidence Summary",
      "",
      `Status: ${next.status}`,
      `Verdict: ${next.verdict ?? "unset"}`,
      `Reviewer Summary: ${next.reviewerSummary ?? "none"}`,
      `Updated At: ${next.lastUpdatedAt ?? "unset"}`,
    ].join("\n")
  );
  await upsertJsonArtifact(
    path.join(params.projectRoot, DEFAULT_SUBMISSION_SIMULATION_REVIEW_PATH),
    {
      status: next.status,
      stage_scope: next.stageScope,
      round: next.round,
      verdict: next.verdict,
      reviewer_summary: next.reviewerSummary,
      action_items: next.actionItems,
      blocking_artifacts: next.blockingArtifacts,
      updated_at: next.lastUpdatedAt,
      source: "research_workflow.set_review_session",
    }
  );

  const revisionControl = (
    await materializeRevisionControlState({
      projectRoot: params.projectRoot,
      stage: next.stageScope,
    })
  ).state;

  return {
    state: next,
    reviewPacketResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.reviewPacketPath
    ),
    latestReviewResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.latestReviewPath
    ),
    revisionControl,
  };
}

export async function setGraphGuidedWritingState(params: {
  projectRoot: string;
  graphGuidedWriting: Record<string, unknown>;
}): Promise<{
  state: GraphGuidedWritingState;
  anchorIndexResolvedPath: string | null;
  readyForSubmit: boolean;
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeGraphGuidedWritingState(manifest.graph_guided_writing);
  const patch = asRecord(params.graphGuidedWriting) ?? {};
  const next: GraphGuidedWritingState = {
    ...current,
    enabled: pickBoolean(patch, ["enabled"]) ?? current.enabled,
    status: normalizeStage(patch.status) ?? current.status,
    anchorIndexPath:
      pickString(patch, ["anchorIndexPath", "anchor_index_path"]) ??
      current.anchorIndexPath,
    frontierFiles:
      patch.frontierFiles || patch.frontier_files
        ? asStringArray(patch.frontierFiles ?? patch.frontier_files)
        : current.frontierFiles,
    literaturePath:
      pickString(patch, ["literaturePath", "literature_path"]) ??
      current.literaturePath,
    claimEvidencePacketPaths:
      patch.claimEvidencePacketPaths || patch.claim_evidence_packet_paths
        ? asStringArray(
            patch.claimEvidencePacketPaths ?? patch.claim_evidence_packet_paths
          )
        : current.claimEvidencePacketPaths,
    requiredEvidencePointerCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "requiredEvidencePointerCount",
          "required_evidence_pointer_count",
        ]) ?? current.requiredEvidencePointerCount
      )
    ),
    coveredHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "coveredHeadlineClaimCount",
          "covered_headline_claim_count",
        ]) ?? current.coveredHeadlineClaimCount
      )
    ),
    totalHeadlineClaimCount: Math.max(
      0,
      Math.floor(
        pickNumber(patch, [
          "totalHeadlineClaimCount",
          "total_headline_claim_count",
        ]) ?? current.totalHeadlineClaimCount
      )
    ),
    evidenceCoverageStatus:
      normalizeStage(
        patch.evidenceCoverageStatus ?? patch.evidence_coverage_status
      ) ?? current.evidenceCoverageStatus,
    missingEvidenceClaims:
      patch.missingEvidenceClaims || patch.missing_evidence_claims
        ? asStringArray(
            patch.missingEvidenceClaims ?? patch.missing_evidence_claims
          )
        : current.missingEvidenceClaims,
    citationSourceMode:
      normalizeStage(patch.citationSourceMode ?? patch.citation_source_mode) ??
      current.citationSourceMode,
    scholarQueryReserved:
      pickBoolean(patch, ["scholarQueryReserved", "scholar_query_reserved"]) ??
      current.scholarQueryReserved,
    scholarQuerySkillSlot:
      pickString(patch, ["scholarQuerySkillSlot", "scholar_query_skill_slot"]) ??
      current.scholarQuerySkillSlot,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  manifest.graph_guided_writing = serializeGraphGuidedWritingState(next);
  await saveManifest(params.projectRoot, manifest);

  return {
    state: next,
    anchorIndexResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.anchorIndexPath
    ),
    readyForSubmit: isGraphGuidedWritingReadyForSubmit(next),
  };
}

export async function setExternalReviewState(params: {
  projectRoot: string;
  externalReview: Record<string, unknown>;
}): Promise<{
  state: ExternalReviewState;
  submittedPdfResolvedPath: string | null;
  externalReviewResolvedPath: string | null;
  reviewResponseResolvedPath: string | null;
  conclusionReady: boolean;
  revisionControl: Awaited<ReturnType<typeof materializeRevisionControlState>>["state"];
}> {
  const manifest = await readManifestEnsured(params.projectRoot);
  const current = normalizeExternalReviewState(manifest.external_review_state);
  const patch = asRecord(params.externalReview) ?? {};
  const next: ExternalReviewState = {
    ...current,
    status: normalizeStage(patch.status) ?? current.status,
    provider: pickString(patch, ["provider"]) ?? current.provider,
    reviewSkill:
      pickString(patch, ["reviewSkill", "review_skill"]) ?? current.reviewSkill,
    sourceLabel:
      pickString(patch, ["sourceLabel", "source_label"]) ?? current.sourceLabel,
    submissionId:
      pickString(patch, ["submissionId", "submission_id"]) ?? current.submissionId,
    submittedPdfPath:
      pickString(patch, ["submittedPdfPath", "submitted_pdf_path"]) ??
      current.submittedPdfPath,
    externalReviewPath:
      pickString(patch, ["externalReviewPath", "external_review_path"]) ??
      current.externalReviewPath,
    reviewResponsePath:
      pickString(patch, ["reviewResponsePath", "review_response_path"]) ??
      current.reviewResponsePath,
    overallRecommendation:
      pickString(patch, [
        "overallRecommendation",
        "overall_recommendation",
      ]) ?? current.overallRecommendation,
    requiredAction:
      pickString(patch, ["requiredAction", "required_action"]) ??
      current.requiredAction,
    lastPolledAt:
      pickString(patch, ["lastPolledAt", "last_polled_at"]) ?? current.lastPolledAt,
    lastUpdatedAt:
      pickString(patch, ["lastUpdatedAt", "last_updated_at"]) ??
      new Date().toISOString(),
    pendingReason:
      pickString(patch, ["pendingReason", "pending_reason"]) ?? current.pendingReason,
  };

  if (isExternalReviewConclusionReady(next)) {
    next.pendingReason = null;
  } else if (!next.pendingReason) {
    next.pendingReason =
      "Mandatory external Stanford review is not yet concluded. Submit the compiled PDF and persist the review outcome before completion.";
  }

  manifest.external_review_state = serializeExternalReviewState(next);
  await saveManifest(params.projectRoot, manifest);

  const externalReviewResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.externalReviewPath
  );
  const reviewResponseResolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    next.reviewResponsePath
  );
  await scaffoldMarkdownArtifactIfMissing(
    externalReviewResolvedPath,
    [
      "# External Review",
      "",
      `Status: ${next.status}`,
      `Provider: ${next.provider ?? "unset"}`,
      `Source Label: ${next.sourceLabel ?? "unset"}`,
      `Overall Recommendation: ${next.overallRecommendation ?? "unset"}`,
      `Required Action: ${next.requiredAction ?? "unset"}`,
      `Last Updated At: ${next.lastUpdatedAt ?? "unset"}`,
      `Pending Reason: ${next.pendingReason ?? "none"}`,
    ].join("\n")
  );
  await scaffoldMarkdownArtifactIfMissing(
    reviewResponseResolvedPath,
    [
      "# Review Response",
      "",
      `Status: ${next.status}`,
      `Overall Recommendation: ${next.overallRecommendation ?? "unset"}`,
      `Required Action: ${next.requiredAction ?? "unset"}`,
      `Last Updated At: ${next.lastUpdatedAt ?? "unset"}`,
    ].join("\n")
  );

  const revisionControl = (
    await materializeRevisionControlState({
      projectRoot: params.projectRoot,
      stage: "submit",
    })
  ).state;

  return {
    state: next,
    submittedPdfResolvedPath: resolveProjectArtifactPath(
      params.projectRoot,
      next.submittedPdfPath
    ),
    externalReviewResolvedPath,
    reviewResponseResolvedPath,
    conclusionReady: isExternalReviewConclusionReady(next),
    revisionControl,
  };
}
