import * as path from "node:path";
import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickBoolean,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH,
  DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH,
  normalizeWritingContractState,
  serializeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import {
  AUTORESEARCH_LOOP_STATE_PATH,
  evaluatePaperGuruGate,
  hydrateAutoResearchLoopState,
  hydratePaperGuruWritingQuality,
  saveAutoResearchLoopState,
} from "../autoresearch-loop-state";

type ScientificEditingPass = {
  pass_id: string;
  order: number;
  title: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  scope: string[];
  allowed_edits: string[];
  forbidden_edits: string[];
  prompt: string;
};

export type ScientificEditingPassPlanResult = {
  status: string;
  ledgerPath: string;
  reportPath: string;
  generatedFiles: string[];
  passes: ScientificEditingPass[];
};

export type ScientificEditingPassRecordResult = {
  status: string;
  ledgerPath: string;
  reportPath: string;
  passId: string;
  generatedFiles: string[];
  missingSignals: string[];
  paperGuruStatus: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
}

function pickStringList(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const values = asStringArray(record[key]);
    if (values.length > 0) {
      return uniqueStrings(values);
    }
    const singleValue = pickString(record, [key]);
    if (singleValue) {
      return [singleValue];
    }
  }
  return [];
}

function mergeStringList(current: unknown, additions: Array<string | null | undefined>): string[] {
  const currentValues = Array.isArray(current)
    ? asStringArray(current)
    : typeof current === "string" && current.trim()
      ? [current.trim()]
      : [];
  return uniqueStrings([...currentValues, ...additions]);
}

function stringListOrFallback(value: unknown, fallback: string[]): string[] {
  const values = asStringArray(value);
  return values.length > 0 ? values : fallback;
}

function buildInitialPassLedgerEntry(pass: ScientificEditingPass): Record<string, unknown> {
  return {
    ...pass,
    files_inspected: [],
    edits_made: [],
    deferred_issues: [],
    blockers: [],
    forbidden_edit_violations: [],
    compile_receipt_path: null,
    reference_verification_receipt_path: null,
    number_consistency_receipt_path: null,
    claim_evidence_consistency_receipt_path: null,
    review_required: false,
    evidence_links: {
      claim_ids: [],
      paper_ids: [],
      paper_paragraph_ids: [],
      trial_ids: [],
      citation_keys: [],
    },
  };
}

function normalizePassResultStatus(value: unknown): string {
  const normalized = normalizeStage(value);
  if (normalized === "completed" || normalized === "ready" || normalized === "pass") {
    return "completed";
  }
  if (normalized === "pending" || normalized === "planned" || normalized === "todo") {
    return "pending";
  }
  if (normalized === "skipped" || normalized === "waived") {
    return "skipped";
  }
  if (normalized === "blocked" || normalized === "failed" || normalized === "fail") {
    return "blocked";
  }
  if (normalized === "in_progress" || normalized === "running") {
    return "in_progress";
  }
  return "pending";
}

function upsertRecordById(
  entries: Record<string, unknown>[],
  candidate: Record<string, unknown>,
  idKeys: string[]
): Record<string, unknown>[] {
  const candidateId = pickString(candidate, idKeys);
  if (!candidateId) {
    return [...entries, candidate];
  }
  let replaced = false;
  const next = entries.map((entry) => {
    if (pickString(entry, idKeys) !== candidateId) {
      return entry;
    }
    replaced = true;
    return {
      ...entry,
      ...candidate,
    };
  });
  return replaced ? next : [...next, candidate];
}

function buildPassEvidenceLinks(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(payload.evidence_links ?? payload.evidenceLinks) ?? {};
  return {
    claim_ids: uniqueStrings([
      ...pickStringList(payload, ["claim_ids", "claimIds"]),
      ...pickStringList(nested, ["claim_ids", "claimIds"]),
    ]),
    paper_ids: uniqueStrings([
      ...pickStringList(payload, ["paper_ids", "paperIds"]),
      ...pickStringList(nested, ["paper_ids", "paperIds"]),
    ]),
    paper_paragraph_ids: uniqueStrings([
      ...pickStringList(payload, [
        "paper_paragraph_ids",
        "paperParagraphIds",
        "paragraph_ids",
        "paragraphIds",
      ]),
      ...pickStringList(nested, [
        "paper_paragraph_ids",
        "paperParagraphIds",
        "paragraph_ids",
        "paragraphIds",
      ]),
    ]),
    trial_ids: uniqueStrings([
      ...pickStringList(payload, [
        "trial_ids",
        "trialIds",
        "experiment_trial_ids",
        "experimentTrialIds",
      ]),
      ...pickStringList(nested, [
        "trial_ids",
        "trialIds",
        "experiment_trial_ids",
        "experimentTrialIds",
      ]),
    ]),
    citation_keys: uniqueStrings([
      ...pickStringList(payload, ["citation_keys", "citationKeys"]),
      ...pickStringList(nested, ["citation_keys", "citationKeys"]),
    ]),
  };
}

function hasEvidenceLinks(links: Record<string, unknown>): boolean {
  return Object.values(links).some((value) => asStringArray(value).length > 0);
}

function collectPassResultStrings(entries: Record<string, unknown>[], keys: string[]): string[] {
  return uniqueStrings(entries.flatMap((entry) => pickStringList(entry, keys)));
}

function safeUsageIdSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
  return normalized || "record";
}

function buildUsageRecord(params: {
  payload: Record<string, unknown>;
  passId: string;
  status: string;
  now: string;
  operationId: string | null;
}): Record<string, unknown> | null {
  const evidenceLinks = buildPassEvidenceLinks(params.payload);
  if (!hasEvidenceLinks(evidenceLinks)) {
    return null;
  }
  const usageId =
    pickString(params.payload, ["usage_id", "usageId"]) ??
    `usage_paperguru_${safeUsageIdSegment(params.passId)}_${safeUsageIdSegment(
      params.operationId ?? params.now
    )}`;
  return {
    usage_id: usageId,
    stage: pickString(params.payload, ["stage"]) ?? "writing",
    section_id: pickString(params.payload, ["section_id", "sectionId"]) ?? null,
    manuscript_paragraph_id:
      pickString(params.payload, [
        "manuscript_paragraph_id",
        "manuscriptParagraphId",
      ]) ?? null,
    claim_ids: evidenceLinks.claim_ids,
    citation_keys: evidenceLinks.citation_keys,
    paper_ids: evidenceLinks.paper_ids,
    paper_paragraph_ids: evidenceLinks.paper_paragraph_ids,
    experiment_trial_ids: evidenceLinks.trial_ids,
    source_pass_id: params.passId,
    coverage_status: params.status === "completed" ? "covered" : "needs_repair",
    updated_at: params.now,
  };
}

function buildPasses(params: {
  field: string | null;
  paperMode: string | null;
  evidencePacketPath: string | null;
}): ScientificEditingPass[] {
  const field = params.field ?? "the target research field";
  const mode = params.paperMode ?? "research paper";
  const evidencePacket =
    params.evidencePacketPath ?? "PaperNexus evidence packet and local evidence artifacts";
  return [
    {
      pass_id: "pass_1_structure",
      order: 1,
      title: "Structure and Story Arc",
      status: "pending",
      scope: ["section order", "paragraph roles", "claim progression"],
      allowed_edits: [
        "Reorder paragraphs when the local argument is incoherent.",
        "Add TODO markers for missing transitions or missing evidence.",
        "Compress duplicate motivation or background paragraphs.",
      ],
      forbidden_edits: [
        "Do not invent new claims, results, datasets, citations, or baselines.",
        "Do not change numerical results.",
      ],
      prompt:
        `Review the ${mode} as a structure editor for ${field}. Check whether the problem, gap, method, evidence, and limitation arc is visible section by section. Use ${evidencePacket} as the ceiling for factual claims. Produce only bounded edits, TODOs, and a ledger entry for unresolved evidence gaps.`,
    },
    {
      pass_id: "pass_2_argumentation",
      order: 2,
      title: "Argumentation and Evidence Boundary",
      status: "pending",
      scope: ["claim strength", "evidence mapping", "related-work positioning"],
      allowed_edits: [
        "Weaken unsupported claims.",
        "Replace vague novelty language with evidence-bounded contribution language.",
        "Move speculative implications into limitations or future work.",
      ],
      forbidden_edits: [
        "Do not upgrade metadata-supported evidence into graph-backed claims.",
        "Do not add citations from memory.",
      ],
      prompt:
        `Act as a skeptical scientific reviewer. For each strong claim, classify it as supported, partial, unsupported, or needs-search using ${evidencePacket}. Weaken or defer unsupported claims. Preserve metadata-only PaperNexus evidence as coverage context, not proof of fine-grained comparisons.`,
    },
    {
      pass_id: "pass_3_sentence_precision",
      order: 3,
      title: "Sentence Precision",
      status: "pending",
      scope: ["sentence clarity", "redundancy", "active voice", "local coherence"],
      allowed_edits: [
        "Rewrite unclear sentences for direct technical meaning.",
        "Remove filler phrases and redundant hedging.",
        "Improve transitions between adjacent sentences.",
      ],
      forbidden_edits: [
        "Do not change section structure.",
        "Do not alter equations, labels, citations, or numeric values except to flag obvious formatting mistakes.",
      ],
      prompt:
        "Rewrite only at sentence and paragraph-local level. Preserve all scientific meaning, labels, citation keys, equations, and numbers. Prefer precise verbs, concrete subjects, and short causal links over generic academic filler.",
    },
    {
      pass_id: "pass_4_grammar_terminology",
      order: 4,
      title: "Grammar and Terminology Consistency",
      status: "pending",
      scope: ["grammar", "field terminology", "notation naming", "capitalization"],
      allowed_edits: [
        "Fix grammar, agreement, article usage, and punctuation.",
        "Normalize terminology across title, abstract, method, experiments, and captions.",
        "Create TODOs for ambiguous terminology that needs author choice.",
      ],
      forbidden_edits: [
        "Do not introduce new technical terms without a definition.",
        "Do not change claim scope or experiment interpretation.",
      ],
      prompt:
        `Polish grammar and terminology for ${field}. Keep terminology stable across sections, figures, captions, and tables. When two terms appear to refer to the same concept, prefer one and record the normalization in the ledger.`,
    },
    {
      pass_id: "pass_5_typography_latex",
      order: 5,
      title: "Typography and LaTeX Consistency",
      status: "pending",
      scope: ["LaTeX commands", "math notation", "figure/table labels", "caption style"],
      allowed_edits: [
        "Fix obvious LaTeX syntax, label references, and caption formatting.",
        "Normalize notation presentation and symbol spacing.",
        "Flag unresolved figure placeholders and missing real-data figures.",
      ],
      forbidden_edits: [
        "Do not run or change repository citation, compile, or submit gates.",
        "Do not rewrite scientific claims while fixing typography.",
      ],
      prompt:
        "Audit LaTeX and typography only. Check labels, refs, equations, captions, tables, and placeholder figures. Produce manuscript edits or TODOs, but do not change citation/compile gate behavior.",
    },
    {
      pass_id: "pass_6_integrity_audit",
      order: 6,
      title: "Integrity Audit",
      status: "pending",
      scope: ["claim-evidence consistency", "citation identity", "numbers", "limitations"],
      allowed_edits: [
        "Flag claims that exceed available evidence.",
        "Flag citations, DOIs, author lists, or venues that need verification.",
        "Move overclaims into limitations or TODOs.",
      ],
      forbidden_edits: [
        "Do not invent missing citations or BibTeX entries.",
        "Do not change repository citation/compile/submit gate logic.",
      ],
      prompt:
        `Perform an integrity audit against ${evidencePacket}. Every factual claim, number, baseline, citation-backed comparison, and limitation must be supported or explicitly marked TODO. This pass produces manuscript edits, warnings, and ledger entries only; it does not run new citation/compile gate behavior.`,
    },
  ];
}

function renderReport(params: {
  passes: ScientificEditingPass[];
  ledgerPath: string;
  paperMode: string | null;
  evidencePacketPath: string | null;
  status?: string | null;
  passResults?: Record<string, unknown>[];
  receiptSummary?: {
    compileReceipts?: string[];
    referenceVerificationReceipts?: string[];
    numberConsistencyReceipts?: string[];
    claimEvidenceConsistencyReceipts?: string[];
  };
}): string {
  const resultByPassId = new Map<string, Record<string, unknown>>();
  for (const result of params.passResults ?? []) {
    const passId = pickString(result, ["pass_id", "passId", "id"]);
    if (passId) {
      resultByPassId.set(passId, result);
    }
  }
  const receiptSummary = params.receiptSummary ?? {};
  return [
    "# Scientific Editing Pass Plan",
    "",
    `Status: ${params.status ?? "planned"}`,
    `Paper mode: ${params.paperMode ?? "unset"}`,
    `Ledger: ${params.ledgerPath}`,
    `Evidence packet: ${params.evidencePacketPath ?? "PaperNexus/local evidence artifacts"}`,
    "",
    "## Operating Rule",
    "- Run passes in order and record each pass result in the ledger.",
    "- Later passes must not reopen earlier structural decisions unless they mark a blocker.",
    "- Pass 6 is an integrity audit only; citation, compile, number, and claim-evidence receipts remain external gate inputs.",
    "",
    "## Passes",
    ...params.passes.flatMap((pass) => {
      const result = resultByPassId.get(pass.pass_id) ?? {};
      return [
        `### ${pass.order}. ${pass.title}`,
        `- Status: ${pickString(result, ["status"]) ?? pass.status}`,
        `- Scope: ${pass.scope.join(", ")}`,
        `- Files inspected: ${
          pickStringList(result, ["files_inspected", "filesInspected"]).join(", ") ||
          "pending"
        }`,
        `- Edits made: ${
          pickStringList(result, ["edits_made", "editsMade"]).join(", ") || "none"
        }`,
        `- Deferred issues: ${
          pickStringList(result, ["deferred_issues", "deferredIssues"]).join(", ") ||
          "none"
        }`,
        `- Blockers: ${pickStringList(result, ["blockers"]).join(", ") || "none"}`,
        `- Forbidden edit violations: ${
          pickStringList(result, [
            "forbidden_edit_violations",
            "forbiddenEditViolations",
          ]).join(", ") || "none"
        }`,
        `- Compile receipt: ${
          pickString(result, ["compile_receipt_path", "compileReceiptPath"]) ?? "pending"
        }`,
        `- Reference verification receipt: ${
          pickString(result, [
            "reference_verification_receipt_path",
            "referenceVerificationReceiptPath",
          ]) ?? "pending"
        }`,
        `- Number consistency receipt: ${
          pickString(result, [
            "number_consistency_receipt_path",
            "numberConsistencyReceiptPath",
          ]) ?? "pending"
        }`,
        `- Claim-evidence consistency receipt: ${
          pickString(result, [
            "claim_evidence_consistency_receipt_path",
            "claimEvidenceConsistencyReceiptPath",
          ]) ?? "pending"
        }`,
        `- Evidence links: ${[
          `claims=${pickStringList(result, ["claim_ids", "claimIds"]).join(", ") || "none"}`,
          `papers=${pickStringList(result, ["paper_ids", "paperIds"]).join(", ") || "none"}`,
          `paragraphs=${
            pickStringList(result, [
              "paper_paragraph_ids",
              "paperParagraphIds",
              "paragraph_ids",
              "paragraphIds",
            ]).join(", ") || "none"
          }`,
          `trials=${
            pickStringList(result, [
              "trial_ids",
              "trialIds",
              "experiment_trial_ids",
              "experimentTrialIds",
            ]).join(", ") || "none"
          }`,
          `citations=${
            pickStringList(result, ["citation_keys", "citationKeys"]).join(", ") ||
            "none"
          }`,
        ].join(" | ")}`,
        `- Prompt: ${pass.prompt}`,
        "",
      ];
    }),
    "## Completion Receipts",
    `- Compile receipts: ${(receiptSummary.compileReceipts ?? []).join(", ") || "pending"}`,
    `- Reference verification receipts: ${
      (receiptSummary.referenceVerificationReceipts ?? []).join(", ") || "pending"
    }`,
    `- Number consistency receipts: ${
      (receiptSummary.numberConsistencyReceipts ?? []).join(", ") || "pending"
    }`,
    `- Claim-evidence consistency receipts: ${
      (receiptSummary.claimEvidenceConsistencyReceipts ?? []).join(", ") || "pending"
    }`,
    "",
  ].join("\n");
}

export async function materializeScientificEditingPassPlan(params: {
  projectRoot: string;
  scientificEditingMaterialization?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<ScientificEditingPassPlanResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const payload = params.scientificEditingMaterialization ?? {};
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const paperDesignIntake = asRecord(manifest.paper_design_intake) ?? {};
  const field =
    pickString(payload, ["field"]) ??
    pickString(paperDesignIntake, ["field", "subfield"]) ??
    null;
  const evidencePacketPath =
    pickString(payload, ["evidence_packet_path", "evidencePacketPath"]) ??
    "researcher/COVERAGE_SUMMARY.md";
  const ledgerPath =
    pickString(payload, ["ledger_path", "ledgerPath"]) ??
    writingContract.scientificEditingLedgerPath ??
    DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH;
  const reportPath =
    pickString(payload, ["report_path", "reportPath"]) ??
    writingContract.scientificEditingReportPath ??
    DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH;
  const passes = buildPasses({
    field,
    paperMode: writingContract.paperMode,
    evidencePacketPath,
  });
  const generatedAt = nowIso();
  const ledgerResolvedPath = resolveProjectArtifactPath(projectRoot, ledgerPath);
  const reportResolvedPath = resolveProjectArtifactPath(projectRoot, reportPath);
  if (!ledgerResolvedPath || !reportResolvedPath) {
    throw new Error("Unable to resolve scientific editing artifact paths.");
  }
  const required =
    pickBoolean(payload, ["required", "scientific_editing_required"]) ??
    writingContract.scientificEditingRequired ??
    true;
  await writeJsonEnsured(ledgerResolvedPath, {
    schema_version: 1,
    status: "planned",
    generated_at: generatedAt,
    trigger: params.trigger ?? null,
    agent_id: params.agentId ?? null,
    evidence_packet_path: evidencePacketPath,
    passes,
    pass_results: [],
    completion_policy: {
      mark_ready_only_after_all_passes_completed: true,
      citation_compile_gates_modified: false,
    },
  });
  await writeTextEnsured(
    reportResolvedPath,
    renderReport({
      passes,
      ledgerPath,
      paperMode: writingContract.paperMode,
      evidencePacketPath,
      status: required ? "planned" : "optional",
    })
  );
  manifest.writing_contract = serializeWritingContractState({
    ...writingContract,
    scientificEditingRequired: required,
    scientificEditingStatus: required ? "planned" : "optional",
    scientificEditingPasses: passes.map((pass) => pass.pass_id),
    scientificEditingLedgerPath: ledgerPath,
    scientificEditingReportPath: reportPath,
  });
  manifest.scientific_editing = {
    schema_version: 1,
    status: required ? "planned" : "optional",
    ledger_path: ledgerPath,
    report_path: reportPath,
    pass_count: passes.length,
    citation_compile_gates_modified: false,
    updated_at: generatedAt,
  };
  await writeJsonEnsured(manifestPath, manifest);
  await hydratePaperGuruWritingQuality({
    projectRoot,
    manifest,
    operationId: `scientific_editing_plan:${generatedAt}`,
    agentId: params.agentId ?? "academic_writer",
  });
  return {
    status: required ? "planned" : "optional",
    ledgerPath,
    reportPath,
    generatedFiles: uniqueStrings([ledgerPath, reportPath, AUTORESEARCH_LOOP_STATE_PATH]),
    passes,
  };
}

export async function recordScientificEditingPassResult(params: {
  projectRoot: string;
  scientificEditingPassResult?: Record<string, unknown>;
  trigger?: string | null;
  agentId?: string | null;
  operationId?: string | null;
}): Promise<ScientificEditingPassRecordResult> {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const payload = params.scientificEditingPassResult ?? {};
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const paperDesignIntake = asRecord(manifest.paper_design_intake) ?? {};
  const field =
    pickString(payload, ["field"]) ??
    pickString(paperDesignIntake, ["field", "subfield"]) ??
    null;
  const evidencePacketPath =
    pickString(payload, ["evidence_packet_path", "evidencePacketPath"]) ??
    "researcher/COVERAGE_SUMMARY.md";
  const ledgerPath =
    pickString(payload, ["ledger_path", "ledgerPath"]) ??
    writingContract.scientificEditingLedgerPath ??
    DEFAULT_SCIENTIFIC_EDITING_LEDGER_PATH;
  const reportPath =
    pickString(payload, ["report_path", "reportPath"]) ??
    writingContract.scientificEditingReportPath ??
    DEFAULT_SCIENTIFIC_EDITING_REPORT_PATH;
  const passes = buildPasses({
    field,
    paperMode: writingContract.paperMode,
    evidencePacketPath,
  });
  const passById = new Map(passes.map((pass) => [pass.pass_id, pass] as const));
  const passId = pickString(payload, ["pass_id", "passId", "id"]);
  if (!passId) {
    throw new Error("Scientific editing pass results require a pass_id.");
  }
  const passDefinition = passById.get(passId);
  if (!passDefinition) {
    throw new Error(
      `Unknown scientific editing pass_id "${passId}". Expected one of: ${passes
        .map((pass) => pass.pass_id)
        .join(", ")}.`
    );
  }
  const ledgerResolvedPath = resolveProjectArtifactPath(projectRoot, ledgerPath);
  const reportResolvedPath = resolveProjectArtifactPath(projectRoot, reportPath);
  if (!ledgerResolvedPath || !reportResolvedPath) {
    throw new Error("Unable to resolve scientific editing artifact paths.");
  }
  const recordedAt = nowIso();
  const existingLedger =
    (await readJsonIfExists<Record<string, unknown>>(ledgerResolvedPath)) ?? {
      schema_version: 1,
      status: "planned",
      generated_at: recordedAt,
      trigger: params.trigger ?? null,
      agent_id: params.agentId ?? null,
      evidence_packet_path: evidencePacketPath,
      passes,
      pass_results: passes.map((pass) => buildInitialPassLedgerEntry(pass)),
      completion_policy: {
        mark_ready_only_after_all_passes_completed: true,
        citation_compile_gates_modified: false,
      },
    };
  const existingPassResults = recordList(existingLedger.pass_results);
  const previousPassResult =
    existingPassResults.find((entry) => pickString(entry, ["pass_id", "passId", "id"]) === passId) ??
    buildInitialPassLedgerEntry(passDefinition);
  const filesInspected = mergeStringList(
    previousPassResult.files_inspected ?? previousPassResult.filesInspected,
    pickStringList(payload, ["files_inspected", "filesInspected"])
  );
  const editsMade = mergeStringList(
    previousPassResult.edits_made ?? previousPassResult.editsMade,
    pickStringList(payload, ["edits_made", "editsMade"])
  );
  const deferredIssues = mergeStringList(
    previousPassResult.deferred_issues ?? previousPassResult.deferredIssues,
    pickStringList(payload, ["deferred_issues", "deferredIssues"])
  );
  const blockers = mergeStringList(
    previousPassResult.blockers,
    pickStringList(payload, ["blockers"])
  );
  const forbiddenEditViolations = mergeStringList(
    previousPassResult.forbidden_edit_violations ?? previousPassResult.forbiddenEditViolations,
    pickStringList(payload, ["forbidden_edit_violations", "forbiddenEditViolations"])
  );
  const evidenceLinks = buildPassEvidenceLinks(payload);
  const compileReceiptPath =
    pickString(payload, ["compile_receipt_path", "compileReceiptPath"]) ??
    pickString(previousPassResult, ["compile_receipt_path", "compileReceiptPath"]) ??
    null;
  const referenceVerificationReceiptPath =
    pickString(payload, [
      "reference_verification_receipt_path",
      "referenceVerificationReceiptPath",
    ]) ??
    pickString(previousPassResult, [
      "reference_verification_receipt_path",
      "referenceVerificationReceiptPath",
    ]) ??
    null;
  const numberConsistencyReceiptPath =
    pickString(payload, ["number_consistency_receipt_path", "numberConsistencyReceiptPath"]) ??
    pickString(previousPassResult, [
      "number_consistency_receipt_path",
      "numberConsistencyReceiptPath",
    ]) ??
    null;
  const claimEvidenceConsistencyReceiptPath =
    pickString(payload, [
      "claim_evidence_consistency_receipt_path",
      "claimEvidenceConsistencyReceiptPath",
    ]) ??
    pickString(previousPassResult, [
      "claim_evidence_consistency_receipt_path",
      "claimEvidenceConsistencyReceiptPath",
    ]) ??
    null;
  const reviewRequired =
    pickBoolean(payload, ["review_required", "reviewRequired"]) ??
    pickBoolean(previousPassResult, ["review_required", "reviewRequired"]) ??
    false;
  const rawStatus =
    pickString(payload, ["status", "result"]) ??
    pickString(previousPassResult, ["status", "result"]) ??
    "completed";
  const normalizedStatus = normalizePassResultStatus(rawStatus);
  const hasBlockingSignals =
    blockers.length > 0 ||
    forbiddenEditViolations.length > 0 ||
    (normalizedStatus === "completed" && filesInspected.length === 0);
  const passResult = {
    ...previousPassResult,
    pass_id: passId,
    order: pickNumber(previousPassResult, ["order"]) ?? passDefinition.order,
    title: pickString(previousPassResult, ["title"]) ?? passDefinition.title,
    status: hasBlockingSignals ? "blocked" : normalizedStatus,
    scope: stringListOrFallback(previousPassResult.scope, passDefinition.scope),
    allowed_edits: stringListOrFallback(
      previousPassResult.allowed_edits,
      passDefinition.allowed_edits
    ),
    forbidden_edits: stringListOrFallback(
      previousPassResult.forbidden_edits,
      passDefinition.forbidden_edits
    ),
    prompt: pickString(previousPassResult, ["prompt"]) ?? passDefinition.prompt,
    files_inspected: filesInspected,
    edits_made: editsMade,
    deferred_issues: deferredIssues,
    blockers,
    forbidden_edit_violations: forbiddenEditViolations,
    compile_receipt_path: compileReceiptPath,
    reference_verification_receipt_path: referenceVerificationReceiptPath,
    number_consistency_receipt_path: numberConsistencyReceiptPath,
    claim_evidence_consistency_receipt_path: claimEvidenceConsistencyReceiptPath,
    review_required: reviewRequired,
    evidence_links: evidenceLinks,
  };
  const nextPassResults = upsertRecordById(existingPassResults, passResult, [
    "pass_id",
    "passId",
    "id",
  ]);
  const compileReceipts = mergeStringList(
    existingLedger.compile_receipts ?? existingLedger.compileReceipts,
    collectPassResultStrings(nextPassResults, [
      "compile_receipt_path",
      "compileReceiptPath",
      "compile_receipts",
      "compileReceipts",
    ])
  );
  const referenceVerificationReceipts = mergeStringList(
    existingLedger.reference_verification_receipts ??
      existingLedger.referenceVerificationReceipts,
    collectPassResultStrings(nextPassResults, [
      "reference_verification_receipt_path",
      "referenceVerificationReceiptPath",
      "reference_verification_receipts",
      "referenceVerificationReceipts",
    ])
  );
  const numberConsistencyReceipts = mergeStringList(
    existingLedger.number_consistency_receipts ?? existingLedger.numberConsistencyReceipts,
    collectPassResultStrings(nextPassResults, [
      "number_consistency_receipt_path",
      "numberConsistencyReceiptPath",
      "number_consistency_receipts",
      "numberConsistencyReceipts",
    ])
  );
  const claimEvidenceConsistencyReceipts = mergeStringList(
    existingLedger.claim_evidence_consistency_receipts ??
      existingLedger.claimEvidenceConsistencyReceipts,
    collectPassResultStrings(nextPassResults, [
      "claim_evidence_consistency_receipt_path",
      "claimEvidenceConsistencyReceiptPath",
      "claim_evidence_consistency_receipts",
      "claimEvidenceConsistencyReceipts",
    ])
  );
  const completedPassIds: string[] = [];
  for (const pass of passes) {
    const recordedPass = nextPassResults.find(
      (entry) => pickString(entry, ["pass_id", "passId", "id"]) === pass.pass_id
    );
    if (
      normalizePassResultStatus(pickString(recordedPass ?? {}, ["status", "result"])) ===
      "completed"
    ) {
      completedPassIds.push(pass.pass_id);
    }
  }
  const missingPassIds = passes
    .map((pass) => pass.pass_id)
    .filter((passIdValue) => !completedPassIds.includes(passIdValue));
  const startedPassCount = nextPassResults.filter((entry) => {
    const status = normalizePassResultStatus(pickString(entry, ["status", "result"]));
    return status !== "pending";
  }).length;
  const missingPassSignals =
    missingPassIds.length > 0
      ? [
          `PaperGuru six-pass ledger is missing completed passes: ${missingPassIds.join(", ")}.`,
        ]
      : [];
  const localMissingSignals: string[] = [];
  for (const entry of nextPassResults) {
    const currentPassId = pickString(entry, ["pass_id", "passId", "id"]) ?? "unknown";
    const entryStatus = normalizePassResultStatus(pickString(entry, ["status", "result"]));
    const entryFiles = pickStringList(entry, ["files_inspected", "filesInspected"]);
    const entryBlockers = pickStringList(entry, ["blockers"]);
    const entryViolations = pickStringList(entry, [
      "forbidden_edit_violations",
      "forbiddenEditViolations",
    ]);
    if (entryStatus === "completed" && entryFiles.length === 0) {
      localMissingSignals.push(
        `PaperGuru pass ${currentPassId} must record files_inspected before it can be marked completed.`
      );
    }
    if (entryBlockers.length > 0) {
      localMissingSignals.push(
        `PaperGuru pass ${currentPassId} recorded blockers: ${entryBlockers.join(", ")}.`
      );
    }
    if (entryViolations.length > 0) {
      localMissingSignals.push(
        `PaperGuru pass ${currentPassId} recorded forbidden edit violations: ${entryViolations.join(", ")}.`
      );
    }
  }
  const hasAllRequiredPasses = missingPassIds.length === 0;
  const hasAllCoreReceipts =
    compileReceipts.length > 0 &&
    referenceVerificationReceipts.length > 0 &&
    numberConsistencyReceipts.length > 0 &&
    claimEvidenceConsistencyReceipts.length > 0;
  const required =
    pickBoolean(payload, ["required", "scientific_editing_required"]) ??
    writingContract.scientificEditingRequired ??
    true;
  const ledgerStatus = required
    ? localMissingSignals.length > 0
      ? "blocked"
      : hasAllRequiredPasses
        ? hasAllCoreReceipts
          ? "ready"
          : "blocked"
        : startedPassCount > 0
          ? "in_progress"
          : "planned"
    : "optional";
  const nextLedger = {
    ...existingLedger,
    schema_version: 1,
    status: ledgerStatus,
    generated_at: existingLedger.generated_at ?? recordedAt,
    updated_at: recordedAt,
    trigger: existingLedger.trigger ?? params.trigger ?? null,
    agent_id: existingLedger.agent_id ?? params.agentId ?? null,
    evidence_packet_path: existingLedger.evidence_packet_path ?? evidencePacketPath,
    passes,
    pass_results: nextPassResults,
    compile_receipts: compileReceipts,
    reference_verification_receipts: referenceVerificationReceipts,
    number_consistency_receipts: numberConsistencyReceipts,
    claim_evidence_consistency_receipts: claimEvidenceConsistencyReceipts,
    completed_pass_ids: completedPassIds,
    missing_pass_ids: missingPassIds,
    receipt_summary: {
      compile_receipts: compileReceipts,
      reference_verification_receipts: referenceVerificationReceipts,
      number_consistency_receipts: numberConsistencyReceipts,
      claim_evidence_consistency_receipts: claimEvidenceConsistencyReceipts,
    },
    last_recorded_pass_id: passId,
    last_recorded_at: recordedAt,
    completion_policy: {
      mark_ready_only_after_all_passes_completed: true,
      citation_compile_gates_modified: false,
    },
  };
  await writeJsonEnsured(ledgerResolvedPath, nextLedger);
  const nextWritingContract = serializeWritingContractState({
    ...writingContract,
    scientificEditingRequired: required,
    scientificEditingStatus: ledgerStatus,
    scientificEditingPasses: passes.map((pass) => pass.pass_id),
    scientificEditingLedgerPath: ledgerPath,
    scientificEditingReportPath: reportPath,
    lastScientificEditingAt: recordedAt,
  });
  const nextManifest = {
    ...manifest,
    writing_contract: nextWritingContract,
    scientific_editing: {
      ...(asRecord(manifest.scientific_editing) ?? {}),
      schema_version: 1,
      status: ledgerStatus,
      ledger_path: ledgerPath,
      report_path: reportPath,
      pass_count: passes.length,
      completed_pass_count: completedPassIds.length,
      missing_pass_count: missingPassIds.length,
      last_recorded_pass_id: passId,
      updated_at: recordedAt,
    },
  };
  await writeJsonEnsured(manifestPath, nextManifest);
  await writeTextEnsured(
    reportResolvedPath,
    renderReport({
      passes,
      ledgerPath,
      paperMode: writingContract.paperMode,
      evidencePacketPath,
      status: ledgerStatus,
      passResults: nextPassResults,
      receiptSummary: {
        compileReceipts,
        referenceVerificationReceipts,
        numberConsistencyReceipts,
        claimEvidenceConsistencyReceipts,
      },
    })
  );
  const gate = await evaluatePaperGuruGate({
    projectRoot,
    manifest: nextManifest,
  });
  const state = await hydrateAutoResearchLoopState({
    projectRoot,
    manifest: nextManifest,
    operationId: params.operationId,
    agentId: params.agentId,
  });
  const usageRecord = buildUsageRecord({
    payload,
    passId,
    status: pickString(passResult, ["status"]) ?? ledgerStatus,
    now: recordedAt,
    operationId: params.operationId ?? null,
  });
  const nextUsages = usageRecord
    ? upsertRecordById(
        recordList(state.reference_context.article_evidence_contract.usages),
        usageRecord,
        ["usage_id", "usageId"]
      )
    : recordList(state.reference_context.article_evidence_contract.usages);
  const paperGuruState = {
    ...gate.paperGuruState,
    status: ledgerStatus,
    missing_signals: uniqueStrings([
      ...missingPassSignals,
      ...localMissingSignals,
      ...gate.missingSignals,
    ]),
    completed_pass_ids: completedPassIds,
    missing_pass_ids: missingPassIds,
    compile_receipts: compileReceipts,
    reference_verification_receipts: referenceVerificationReceipts,
    number_consistency_receipts: numberConsistencyReceipts,
    claim_evidence_consistency_receipts: claimEvidenceConsistencyReceipts,
    last_recorded_pass_id: passId,
    last_recorded_at: recordedAt,
  };
  const nextState = {
    ...state,
    reference_context: {
      article_evidence_contract: {
        ...state.reference_context.article_evidence_contract,
        usages: nextUsages,
        writing_quality: {
          ...state.reference_context.article_evidence_contract.writing_quality,
          paper_guru: paperGuruState,
        },
      },
    },
  };
  await saveAutoResearchLoopState(projectRoot, nextState, {
    operationId: params.operationId,
    agentId: params.agentId,
  });
  return {
    status: ledgerStatus,
    ledgerPath,
    reportPath,
    passId,
    generatedFiles: uniqueStrings([ledgerPath, reportPath, AUTORESEARCH_LOOP_STATE_PATH]),
    missingSignals: uniqueStrings([
      ...missingPassSignals,
      ...localMissingSignals,
      ...gate.missingSignals,
    ]),
    paperGuruStatus: gate.status,
  };
}
