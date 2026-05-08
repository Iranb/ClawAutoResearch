/**
 * 写作合约（Writing Contract）状态定义。
 *
 * 写作合约定义论文的写作约束——论文模式（conference/journal/survey）、
 * 模板配置、页数/字数预算、章节顺序、段落逻辑检查清单、故事线检查清单、
 * 证明风格（lemma_result_only）、理论附录要求等。
 *
 * 为什么需要写作合约？因为学术写作有严格约束——
 * - 会议论文有严格页数限制（如 9 页正文 + 2 页参考文献）
 * - 段落必须有清晰的逻辑结构（一段一意、首句点题、尾句衔接）
 * - 每个论点必须映射到证据链
 * - 理论推导必须放在附录，正文只保留定理陈述
 *
 * DEFAULT_WRITING_SECTION_ORDER: 实验论文标准章节（abstract → introduction → related_work → method → experiments → conclusion）
 * DEFAULT_SURVEY_WRITING_SECTION_ORDER: 综述论文标准章节（abstract → introduction → scope_and_protocol → taxonomy → evidence_synthesis → benchmark_landscape → open_problems → conclusion）
 *
 * evaluateWritingContractState 评估合约的当前状态——
 * 模板是否存在、是否已应用、是否有待解决的问题。
 */
import * as path from "node:path";
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { pathExists } from "../workflow-guard-core/fs";
import type { WritingContractState, WritingMode } from "../workflow-guard.js";

export const DEFAULT_WRITING_SECTION_ORDER = [
  "abstract",
  "introduction",
  "related_work",
  "method",
  "experiments",
  "conclusion",
];

export const DEFAULT_SURVEY_WRITING_SECTION_ORDER = [
  "abstract",
  "introduction",
  "scope_and_protocol",
  "taxonomy",
  "evidence_synthesis",
  "benchmark_landscape",
  "open_problems",
  "conclusion",
];

export const DEFAULT_PARAGRAPH_LOGIC_CHECKLIST = [
  "one_message_per_paragraph",
  "first_sentence_states_paragraph_role",
  "sentences_connect_by_cause_contrast_consequence_or_refinement",
  "closing_sentence_bridges_to_next_paragraph_or_section",
  "reverse_outline_each_section_before_finalize",
];

export const DEFAULT_STORYLINE_CHECKLIST = [
  "one_clean_problem_gap_method_arc",
  "thesis_is_grounded_in_papernexus_kg",
  "every_headline_claim_maps_to_evidence_spine",
  "related_work_supports_gap_not_catalog_only",
  "limitations_boundary_is_explicit",
];

export const DEFAULT_PROOF_CHECKLIST = [
  "derive_a_small_set_of_named_lemmas_from_supported_results",
  "keep_main_text_to_lemma_statements_and_consequences_only",
  "move_full_derivations_and_case_splits_to_appendix",
  "tie_every_formulaic_step_to_evidence_or_explicit_assumption",
  "mark_speculative_theory_as_conservative_mechanistic_interpretation",
];

export const DEFAULT_SCIENTIFIC_EDITING_PASSES = [
  "clutter_reduction",
  "agency_active_voice",
  "logical_flow",
  "terminology_consistency",
  "numerical_consistency",
];

export const DEFAULT_KG_STORYLINE_PACKET_PATH =
  "academic_writer/KG_STORYLINE_PACKET.md";
export const DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH =
  "academic_writer/SCIENTIFIC_EDIT_LEDGER.json";
export const DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH =
  "academic_writer/SCIENTIFIC_EDIT_REPORT.md";

/**
 * 解析写作模式。
 *
 * 兼容多种输入格式（"conf"/"conference_9p_2refs" → "conference"）。
 * 论文模式决定了章节顺序、页数预算、理论附录要求等。
 */
export function normalizeWritingMode(value: unknown): WritingMode | null {
  const normalized = normalizeStage(value);
  if (!normalized) {
    return null;
  }
  if (
    ["conference", "conf", "conference_9p_2refs", "conference_9_body_2_refs"].includes(
      normalized
    )
  ) {
    return "conference";
  }
  if (
    ["journal", "journal_12p_2refs", "journal_12_body_2_refs"].includes(normalized)
  ) {
    return "journal";
  }
  if (
    ["survey", "survey_review", "survey_paper", "review_paper", "literature_review"].includes(
      normalized
    )
  ) {
    return "survey";
  }
  return null;
}

/**
 * 解析写作模板路径。
 *
 * 支持绝对路径和相对路径（相对于项目根目录）。
 */
export function resolveWritingTemplatePath(
  projectRoot: string | null,
  templatePath: string | null
): string | null {
  if (!templatePath) {
    return null;
  }
  if (path.isAbsolute(templatePath)) {
    return path.normalize(templatePath);
  }
  if (!projectRoot) {
    return templatePath;
  }
  return path.normalize(path.join(projectRoot, templatePath));
}

/**
 * 解析写作合约完整状态。
 *
 * 从 unknown JSON 安全转换。所有检查清单（proofChecklist、storylineChecklist、
 * paragraphLogicChecklist）和章节顺序（requiredSections、sectionOrder）
 * 如果为空则使用默认值。proofAppendixRequired 根据论文模式自动决定
 * （survey 不需要，其他需要）。
 */
export function normalizeWritingContractState(value: unknown): WritingContractState {
  const record = asRecord(value) ?? {};
  const paperMode = normalizeWritingMode(record.paperMode ?? record.paper_mode);
  const defaultSections =
    paperMode === "survey"
      ? DEFAULT_SURVEY_WRITING_SECTION_ORDER
      : DEFAULT_WRITING_SECTION_ORDER;
  return {
    paperMode,
    templateRequired:
      pickBoolean(record, ["templateRequired", "template_required"]) ?? false,
    templatePath: pickString(record, ["templatePath", "template_path"]),
    projectTemplatePath: pickString(record, [
      "projectTemplatePath",
      "project_template_path",
    ]),
    templateName: pickString(record, ["templateName", "template_name"]),
    templateStatus: normalizeStage(record.templateStatus ?? record.template_status) ?? "optional",
    templateCopyStatus:
      normalizeStage(record.templateCopyStatus ?? record.template_copy_status) ?? "pending",
    bodyPageBudget: pickNumber(record, ["bodyPageBudget", "body_page_budget"]),
    referencePageBudget: pickNumber(record, [
      "referencePageBudget",
      "reference_page_budget",
    ]),
    bodyWordTargetMin: pickNumber(record, [
      "bodyWordTargetMin",
      "body_word_target_min",
    ]),
    bodyWordTargetMax: pickNumber(record, [
      "bodyWordTargetMax",
      "body_word_target_max",
    ]),
    maxCoreIdeas:
      Math.max(1, Math.floor(pickNumber(record, ["maxCoreIdeas", "max_core_ideas"]) ?? 2)),
    maxHeadlineClaims:
      Math.max(
        1,
        Math.floor(pickNumber(record, ["maxHeadlineClaims", "max_headline_claims"]) ?? 3)
      ),
    mainTextProofStyle:
      pickString(record, ["mainTextProofStyle", "main_text_proof_style"]) ??
      "lemma_result_only",
    proofAppendixRequired:
      pickBoolean(record, ["proofAppendixRequired", "proof_appendix_required"]) ??
      (paperMode === "survey" ? false : true),
    proofAppendixPath:
      pickString(record, ["proofAppendixPath", "proof_appendix_path"]) ??
      "academic_writer/paper/sections/appendix_theory.tex",
    proofAppendixStatus:
      normalizeStage(record.proofAppendixStatus ?? record.proof_appendix_status) ?? "pending",
    theoryNotePath:
      pickString(record, ["theoryNotePath", "theory_note_path"]) ??
      "analyzer/THEORY_SUPPORT_NOTE.md",
    proofChecklist:
      asStringArray(record.proofChecklist ?? record.proof_checklist).length > 0
        ? asStringArray(record.proofChecklist ?? record.proof_checklist)
        : [...DEFAULT_PROOF_CHECKLIST],
    scientificEditingRequired:
      pickBoolean(record, [
        "scientificEditingRequired",
        "scientific_editing_required",
      ]) ?? false,
    scientificEditingStatus:
      normalizeStage(
        record.scientificEditingStatus ?? record.scientific_editing_status
      ) ??
      (pickBoolean(record, [
        "scientificEditingRequired",
        "scientific_editing_required",
      ])
        ? "pending"
        : "optional"),
    scientificEditingPasses:
      asStringArray(
        record.scientificEditingPasses ?? record.scientific_editing_passes
      ).length > 0
        ? asStringArray(
            record.scientificEditingPasses ?? record.scientific_editing_passes
          )
        : [...DEFAULT_SCIENTIFIC_EDITING_PASSES],
    scientificEditingLedgerPath:
      pickString(record, [
        "scientificEditingLedgerPath",
        "scientific_editing_ledger_path",
      ]) ?? DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH,
    scientificEditingReportPath:
      pickString(record, [
        "scientificEditingReportPath",
        "scientific_editing_report_path",
      ]) ?? DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH,
    lastScientificEditingAt: pickString(record, [
      "lastScientificEditingAt",
      "last_scientific_editing_at",
    ]),
    storylineSource: pickString(record, ["storylineSource", "storyline_source"]),
    kgStorylineRequired:
      pickBoolean(record, ["kgStorylineRequired", "kg_storyline_required"]) ?? false,
    kgStorylineStatus:
      normalizeStage(record.kgStorylineStatus ?? record.kg_storyline_status) ?? "missing",
    kgStorylinePacketPath: pickString(record, [
      "kgStorylinePacketPath",
      "kg_storyline_packet_path",
    ]),
    storylineChecklist:
      asStringArray(record.storylineChecklist ?? record.storyline_checklist).length > 0
        ? asStringArray(record.storylineChecklist ?? record.storyline_checklist)
        : [...DEFAULT_STORYLINE_CHECKLIST],
    requiredSections:
      asStringArray(record.requiredSections ?? record.required_sections).length > 0
        ? asStringArray(record.requiredSections ?? record.required_sections)
        : [...defaultSections],
    sectionOrder:
      asStringArray(record.sectionOrder ?? record.section_order).length > 0
        ? asStringArray(record.sectionOrder ?? record.section_order)
        : [...defaultSections],
    paragraphLogicChecklist:
      asStringArray(
        record.paragraphLogicChecklist ?? record.paragraph_logic_checklist
      ).length > 0
        ? asStringArray(
            record.paragraphLogicChecklist ?? record.paragraph_logic_checklist
          )
        : [...DEFAULT_PARAGRAPH_LOGIC_CHECKLIST],
    paragraphLogicStatus:
      normalizeStage(
        record.paragraphLogicStatus ?? record.paragraph_logic_status
      ) ?? "pending",
    lastTemplateAppliedAt: pickString(record, [
      "lastTemplateAppliedAt",
      "last_template_applied_at",
    ]),
    lastParagraphLogicAuditAt: pickString(record, [
      "lastParagraphLogicAuditAt",
      "last_paragraph_logic_audit_at",
    ]),
    templateMappingPath: pickString(record, [
      "templateMappingPath",
      "template_mapping_path",
    ]),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
  };
}

/**
 * 序列化写作合约状态。
 */
export function serializeWritingContractState(
  state: WritingContractState
): Record<string, unknown> {
  return {
    paper_mode: state.paperMode,
    template_required: state.templateRequired,
    template_path: state.templatePath,
    project_template_path: state.projectTemplatePath,
    template_name: state.templateName,
    template_status: state.templateStatus,
    template_copy_status: state.templateCopyStatus,
    body_page_budget: state.bodyPageBudget,
    reference_page_budget: state.referencePageBudget,
    body_word_target_min: state.bodyWordTargetMin,
    body_word_target_max: state.bodyWordTargetMax,
    max_core_ideas: state.maxCoreIdeas,
    max_headline_claims: state.maxHeadlineClaims,
    main_text_proof_style: state.mainTextProofStyle,
    proof_appendix_required: state.proofAppendixRequired,
    proof_appendix_path: state.proofAppendixPath,
    proof_appendix_status: state.proofAppendixStatus,
    theory_note_path: state.theoryNotePath,
    proof_checklist: state.proofChecklist,
    scientific_editing_required: state.scientificEditingRequired,
    scientific_editing_status: state.scientificEditingStatus,
    scientific_editing_passes: state.scientificEditingPasses,
    scientific_editing_ledger_path: state.scientificEditingLedgerPath,
    scientific_editing_report_path: state.scientificEditingReportPath,
    last_scientific_editing_at: state.lastScientificEditingAt,
    storyline_source: state.storylineSource,
    kg_storyline_required: state.kgStorylineRequired,
    kg_storyline_status: state.kgStorylineStatus,
    kg_storyline_packet_path: state.kgStorylinePacketPath,
    storyline_checklist: state.storylineChecklist,
    required_sections: state.requiredSections,
    section_order: state.sectionOrder,
    paragraph_logic_checklist: state.paragraphLogicChecklist,
    paragraph_logic_status: state.paragraphLogicStatus,
    last_template_applied_at: state.lastTemplateAppliedAt,
    last_paragraph_logic_audit_at: state.lastParagraphLogicAuditAt,
    template_mapping_path: state.templateMappingPath,
    pending_reason: state.pendingReason,
  };
}

/**
 * 评估写作合约状态。
 *
 * 检查模板是否存在、是否已应用、是否有待解决的问题。
 * 决策逻辑：
 * 1. 不需要模板 → optional
 * 2. 需要但未配置 → missing（阻塞）
 * 3. 已配置但文件不存在 → missing（阻塞）
 * 4. 已应用 → applied
 * 5. 已配置但未应用 → configured
 *
 * 优先使用项目级模板（projectTemplatePath），其次使用全局模板（templatePath）。
 */
export async function evaluateWritingContractState(params: {
  projectRoot: string | null;
  state: WritingContractState;
}): Promise<{
  templateResolvedPath: string | null;
  projectTemplateResolvedPath: string | null;
  sourceTemplateResolvedPath: string | null;
  templateExists: boolean;
  templateStatus: string;
  templateCopyStatus: string;
  pendingReason: string | null;
}> {
  const sourceTemplateResolvedPath = resolveWritingTemplatePath(
    params.projectRoot,
    params.state.templatePath
  );
  const projectTemplateResolvedPath = resolveWritingTemplatePath(
    params.projectRoot,
    params.state.projectTemplatePath
  );
  const projectTemplateExists = projectTemplateResolvedPath
    ? await pathExists(projectTemplateResolvedPath)
    : false;
  const sourceTemplateExists = sourceTemplateResolvedPath
    ? await pathExists(sourceTemplateResolvedPath)
    : false;
  const templateResolvedPath = projectTemplateExists
    ? projectTemplateResolvedPath
    : sourceTemplateResolvedPath;
  const templateExists = projectTemplateExists || sourceTemplateExists;

  let templateStatus = params.state.templateStatus;
  let templateCopyStatus = params.state.templateCopyStatus;
  let pendingReason = params.state.pendingReason;

  if (!params.state.templateRequired && !params.state.templatePath) {
    templateStatus = "optional";
    templateCopyStatus = params.state.projectTemplatePath ? "ready" : "pending";
    pendingReason = null;
  } else if (params.state.templateRequired && !params.state.templatePath) {
    templateStatus = "missing";
    templateCopyStatus = "missing";
    pendingReason =
      pendingReason ??
      "Writer is required to follow a user-provided template, but writing_contract.template_path is not configured.";
  } else if (params.state.templatePath && !templateExists) {
    templateStatus = "missing";
    templateCopyStatus = "missing";
    pendingReason =
      pendingReason ??
      "The configured writing template path cannot be read. Restore the template file or update writing_contract.template_path.";
  } else if (params.state.lastTemplateAppliedAt) {
    templateStatus =
      params.state.templateStatus === "configured" ? "applied" : params.state.templateStatus;
    templateCopyStatus = projectTemplateExists ? "ready" : "source_only";
    pendingReason = null;
  } else if (params.state.templatePath) {
    templateStatus =
      params.state.templateStatus === "optional" ? "configured" : params.state.templateStatus;
    templateCopyStatus = projectTemplateExists ? "ready" : "source_only";
    pendingReason = null;
  }

  return {
    templateResolvedPath,
    projectTemplateResolvedPath,
    sourceTemplateResolvedPath,
    templateExists,
    templateStatus,
    templateCopyStatus,
    pendingReason,
  };
}
