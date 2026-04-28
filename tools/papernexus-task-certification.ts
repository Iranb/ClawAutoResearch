import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";

type UnknownRecord = Record<string, unknown>;

export type PapernexusTaskCertificationStatus =
  | "ready"
  | "partial"
  | "blocked"
  | "unknown";

export type PapernexusTaskClaimLevel =
  | "none"
  | "connectivity_only"
  | "remote_corpus_summary"
  | "paper_index_confirmed"
  | "source_backed_graph";

type GraphPresenceLike = {
  status?: unknown;
  verificationMode?: unknown;
  expectedPaperCount?: unknown;
  presentPaperCount?: unknown;
  missingPaperCount?: unknown;
  reportPath?: unknown;
  presentPapers?: unknown;
  missingPapers?: unknown;
  corpusName?: unknown;
  corpusRoot?: unknown;
};

type SourceIndexSummary = {
  path: string | null;
  declaredPaperCount: number | null;
  paperRecordCount: number;
  sourceBackedPaperCount: number;
  metadataOnlyPaperCount: number;
  preciseIdentifierCount: number;
  summaryOnly: boolean;
};

type PresentPaperEvidence = {
  canonicalId: string | null;
  title: string | null;
  matchedBy: string | null;
  corpusPaperId: string | null;
  corpusSourceKey: string | null;
  hasPaperIndexEvidence: boolean;
  hasSourceSpanEvidence: boolean;
};

export type PapernexusTaskCertification = {
  schema_version: 1;
  generated_at: string;
  status: PapernexusTaskCertificationStatus;
  claim_level: PapernexusTaskClaimLevel;
  source_backed_graph_claim: boolean;
  graph: {
    status: string | null;
    verification_mode: string | null;
    expected_paper_count: number | null;
    present_paper_count: number | null;
    missing_paper_count: number | null;
    source_backed_present_count: number;
    paper_index_present_count: number;
    corpus_name: string | null;
    corpus_root: string | null;
  };
  upload: {
    phase: string | null;
    manifest_path: string | null;
    total_items: number | null;
    synced_items: number;
    failed_items: number;
    queue_remaining: number | null;
    queue_completed: number | null;
    remote_task_completed: boolean | null;
    remote_task_status: string | null;
    remote_task_stage: string | null;
  };
  source_index: {
    path: string | null;
    declared_paper_count: number | null;
    paper_record_count: number;
    source_backed_paper_count: number;
    metadata_only_paper_count: number;
    precise_identifier_count: number;
    summary_only: boolean;
  };
  mcp_contract: {
    evidence_mode: string | null;
    remote_mcp_evidence: boolean;
    remote_api_fallback: boolean;
    local_corpus_evidence: boolean;
    skill_aligned_graph_claim: boolean;
  };
  limitations: string[];
  linked_artifacts: {
    graph_presence_report: string;
    papernexus_status: string;
    papernexus_progress: string;
    paper_source_index: string | null;
  };
  report_path: string;
};

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function pickString(source: UnknownRecord | null, keys: string[]): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function pickNumber(source: UnknownRecord | null, keys: string[]): number | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = asNumber(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function relativeArtifactPath(projectRoot: string, artifactPath: string): string {
  return path.relative(projectRoot, artifactPath);
}

export function getPapernexusTaskCertificationPath(projectRoot: string): string {
  return path.join(projectRoot, "graph", "PAPERNEXUS_TASK_CERTIFICATION.json");
}

function normalizePresentPaperEvidence(value: unknown): PresentPaperEvidence | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const corpusSourceKey = pickString(record, [
    "corpusSourceKey",
    "corpus_source_key",
    "canonicalSourceKey",
    "canonical_source_key",
    "sourceKey",
    "source_key",
    "sourcePath",
    "source_path",
    "inputPath",
    "input_path",
  ]);
  const corpusPaperId = pickString(record, [
    "corpusPaperId",
    "corpus_paper_id",
    "graphPaperId",
    "graph_paper_id",
    "paperId",
    "paper_id",
  ]);
  const matchedBy = pickString(record, ["matchedBy", "matched_by"]);
  return {
    canonicalId: pickString(record, ["canonicalId", "canonical_id"]),
    title: pickString(record, ["title", "paperTitle", "paper_title"]),
    matchedBy,
    corpusPaperId,
    corpusSourceKey,
    hasPaperIndexEvidence: Boolean(corpusPaperId || corpusSourceKey),
    hasSourceSpanEvidence: Boolean(corpusSourceKey),
  };
}

function sourceIndexPapers(raw: UnknownRecord | null): UnknownRecord[] {
  if (!raw) {
    return [];
  }
  const papers = raw.papers;
  if (Array.isArray(papers)) {
    return papers.map((entry) => asRecord(entry)).filter(Boolean) as UnknownRecord[];
  }
  const papersRecord = asRecord(papers);
  if (papersRecord) {
    return Object.values(papersRecord)
      .map((entry) => asRecord(entry))
      .filter(Boolean) as UnknownRecord[];
  }
  return [];
}

function hasPreciseIdentifier(record: UnknownRecord): boolean {
  const identifiers = asRecord(record.identifiers);
  return Boolean(
    pickString(record, [
      "doi",
      "DOI",
      "arxiv_id",
      "arxivId",
      "pmid",
      "pmcid",
      "PMID",
      "PMCID",
    ]) ||
      pickString(identifiers, [
        "doi",
        "DOI",
        "arxiv_id",
        "arxivId",
        "pmid",
        "pmcid",
        "PMID",
        "PMCID",
      ])
  );
}

function hasSourcePointer(record: UnknownRecord): boolean {
  return Boolean(
    pickString(record, [
      "source_path",
      "sourcePath",
      "local_md_path",
      "localMdPath",
      "md_path",
      "markdown_path",
      "pdf_path",
      "pdfPath",
      "server_file_path",
      "serverFilePath",
      "canonical_source_key",
      "canonicalSourceKey",
      "corpus_source_key",
      "corpusSourceKey",
    ])
  );
}

async function readSourceIndexSummary(
  projectRoot: string
): Promise<SourceIndexSummary> {
  const candidates = [
    path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"),
    path.join(projectRoot, "researcher", "paper-staging", "PAPER_SOURCE_INDEX.json"),
    path.join(projectRoot, "graph", "PAPER_SOURCE_INDEX.json"),
  ];
  for (const candidate of candidates) {
    const raw = asRecord(await readJsonIfExists<UnknownRecord>(candidate));
    if (!raw) {
      continue;
    }
    const papers = sourceIndexPapers(raw);
    const declaredPaperCount =
      pickNumber(raw, [
        "paper_count",
        "paperCount",
        "graph_presence_expected",
        "graphPresenceExpected",
      ]) ?? (papers.length > 0 ? papers.length : null);
    const sourceBackedPaperCount = papers.filter(hasSourcePointer).length;
    return {
      path: candidate,
      declaredPaperCount,
      paperRecordCount: papers.length,
      sourceBackedPaperCount,
      metadataOnlyPaperCount: Math.max(0, papers.length - sourceBackedPaperCount),
      preciseIdentifierCount: papers.filter(hasPreciseIdentifier).length,
      summaryOnly: papers.length === 0 && (declaredPaperCount ?? 0) > 0,
    };
  }
  return {
    path: null,
    declaredPaperCount: null,
    paperRecordCount: 0,
    sourceBackedPaperCount: 0,
    metadataOnlyPaperCount: 0,
    preciseIdentifierCount: 0,
    summaryOnly: false,
  };
}

function normalizeRemoteTaskCompleted(remoteTask: UnknownRecord | null): boolean | null {
  if (!remoteTask) {
    return null;
  }
  const status = pickString(remoteTask, ["status"]);
  const stage = pickString(remoteTask, ["stage"]);
  if (!status && !stage) {
    return null;
  }
  return status === "completed" && stage === "completed";
}

function buildLimitations(params: {
  graphStatus: string | null;
  verificationMode: string | null;
  expectedPaperCount: number | null;
  presentPaperCount: number | null;
  sourceBackedPresentCount: number;
  paperIndexPresentCount: number;
  sourceIndex: SourceIndexSummary;
  evidenceMode: string | null;
  uploadRemoteTaskCompleted: boolean | null;
  queueRemaining: number | null;
}): string[] {
  const limitations: string[] = [];
  const expected = params.expectedPaperCount ?? 0;
  const present = params.presentPaperCount ?? 0;
  if (params.graphStatus !== "ready") {
    limitations.push("graph_presence_not_ready");
  }
  if (params.verificationMode === "remote_corpus_summary") {
    limitations.push("remote_corpus_summary_without_per_paper_source_spans");
  }
  if (params.sourceIndex.summaryOnly) {
    limitations.push("paper_source_index_summary_only");
  }
  if (params.sourceIndex.metadataOnlyPaperCount > 0) {
    limitations.push("metadata_only_source_index_entries");
  }
  if (expected > 0 && present < expected) {
    limitations.push("incomplete_graph_presence");
  }
  if (expected > 0 && params.paperIndexPresentCount < expected) {
    limitations.push("missing_per_paper_graph_index_evidence");
  }
  if (expected > 0 && params.sourceBackedPresentCount < expected) {
    limitations.push("missing_per_paper_source_span_evidence");
  }
  if (params.evidenceMode === "remote_api") {
    limitations.push("remote_api_status_without_mcp_tool_evidence");
  }
  if (
    params.uploadRemoteTaskCompleted === false ||
    (params.queueRemaining !== null && params.queueRemaining > 0)
  ) {
    limitations.push("import_task_not_confirmed_completed");
  }
  return uniqueStrings(limitations);
}

function chooseClaimLevel(params: {
  graphStatus: string | null;
  verificationMode: string | null;
  expectedPaperCount: number | null;
  sourceBackedGraphClaim: boolean;
  paperIndexPresentCount: number;
  evidenceMode: string | null;
}): PapernexusTaskClaimLevel {
  if (params.graphStatus !== "ready") {
    return params.evidenceMode ? "connectivity_only" : "none";
  }
  if (params.sourceBackedGraphClaim) {
    return "source_backed_graph";
  }
  if (params.verificationMode === "remote_corpus_summary") {
    return "remote_corpus_summary";
  }
  if (params.paperIndexPresentCount > 0 || (params.expectedPaperCount ?? 0) > 0) {
    return "paper_index_confirmed";
  }
  return params.evidenceMode ? "connectivity_only" : "none";
}

function chooseCertificationStatus(params: {
  graphStatus: string | null;
  sourceBackedGraphClaim: boolean;
  claimLevel: PapernexusTaskClaimLevel;
}): PapernexusTaskCertificationStatus {
  if (!params.graphStatus) {
    return "unknown";
  }
  if (params.graphStatus !== "ready") {
    return "blocked";
  }
  if (params.sourceBackedGraphClaim) {
    return "ready";
  }
  if (params.claimLevel === "remote_corpus_summary" || params.claimLevel === "paper_index_confirmed") {
    return "partial";
  }
  return "unknown";
}

export async function certifyPapernexusTaskForProject(params: {
  projectRoot: string;
  checkedAt?: string | null;
  graphPresenceResult?: GraphPresenceLike | null;
}): Promise<PapernexusTaskCertification> {
  const projectRoot = path.resolve(params.projectRoot);
  const generatedAt = params.checkedAt ?? new Date().toISOString();
  const graphPresenceReportPath = path.join(projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json");
  const papernexusStatusPath = path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json");
  const papernexusProgressPath = path.join(projectRoot, "graph", "PAPERNEXUS_PROGRESS.json");
  const reportPath = getPapernexusTaskCertificationPath(projectRoot);

  const resultRecord = asRecord(params.graphPresenceResult);
  const graphReport = asRecord(
    await readJsonIfExists<UnknownRecord>(graphPresenceReportPath)
  );
  const statusRecord = asRecord(await readJsonIfExists<UnknownRecord>(papernexusStatusPath));
  const progressRecord = asRecord(
    await readJsonIfExists<UnknownRecord>(papernexusProgressPath)
  );
  const sourceIndex = await readSourceIndexSummary(projectRoot);

  const graphStatus =
    pickString(resultRecord, ["status"]) ??
    pickString(graphReport, ["status"]) ??
    pickString(statusRecord, ["status"]);
  const verificationMode =
    pickString(resultRecord, ["verificationMode", "verification_mode"]) ??
    pickString(graphReport, ["verification_mode", "verificationMode"]) ??
    pickString(statusRecord, ["verification_mode", "verificationMode"]);
  const expectedPaperCount =
    pickNumber(resultRecord, ["expectedPaperCount", "expected_paper_count"]) ??
    pickNumber(graphReport, ["expected_paper_count", "expectedPaperCount"]) ??
    pickNumber(statusRecord, ["expected_paper_count", "expectedPaperCount"]);
  const presentPaperCount =
    pickNumber(resultRecord, ["presentPaperCount", "present_paper_count"]) ??
    pickNumber(graphReport, ["present_paper_count", "presentPaperCount"]) ??
    pickNumber(statusRecord, ["present_paper_count", "presentPaperCount"]);
  const missingPaperCount =
    pickNumber(resultRecord, ["missingPaperCount", "missing_paper_count"]) ??
    pickNumber(graphReport, ["missing_paper_count", "missingPaperCount"]) ??
    pickNumber(statusRecord, ["missing_paper_count", "missingPaperCount"]);
  const presentPapers = firstArray(
    resultRecord?.presentPapers,
    resultRecord?.present_papers,
    graphReport?.present_papers,
    statusRecord?.present_papers
  )
    .map(normalizePresentPaperEvidence)
    .filter(Boolean) as PresentPaperEvidence[];
  const sourceBackedPresentCount = presentPapers.filter(
    (paper) => paper.hasSourceSpanEvidence
  ).length;
  const paperIndexPresentCount = presentPapers.filter(
    (paper) => paper.hasPaperIndexEvidence
  ).length;
  const expectedForClaim = expectedPaperCount ?? 0;
  const sourceBackedGraphClaim =
    graphStatus === "ready" &&
    verificationMode !== "remote_corpus_summary" &&
    expectedForClaim > 0 &&
    sourceBackedPresentCount >= expectedForClaim;

  const evidenceMode = pickString(statusRecord, ["mode"]);
  const batchRecord = asRecord(progressRecord?.batch);
  const queueProgressRecord = asRecord(
    progressRecord?.queue_progress ?? progressRecord?.queueProgress
  );
  const remoteTaskRecord = asRecord(
    progressRecord?.remote_task ?? progressRecord?.remoteTask
  );
  const uploadRemoteTaskCompleted = normalizeRemoteTaskCompleted(remoteTaskRecord);
  const queueRemaining = pickNumber(queueProgressRecord, ["remaining"]);
  const claimLevel = chooseClaimLevel({
    graphStatus,
    verificationMode,
    expectedPaperCount,
    sourceBackedGraphClaim,
    paperIndexPresentCount,
    evidenceMode,
  });
  const certificationStatus = chooseCertificationStatus({
    graphStatus,
    sourceBackedGraphClaim,
    claimLevel,
  });
  const limitations = buildLimitations({
    graphStatus,
    verificationMode,
    expectedPaperCount,
    presentPaperCount,
    sourceBackedPresentCount,
    paperIndexPresentCount,
    sourceIndex,
    evidenceMode,
    uploadRemoteTaskCompleted,
    queueRemaining,
  });

  const certification: PapernexusTaskCertification = {
    schema_version: 1,
    generated_at: generatedAt,
    status: certificationStatus,
    claim_level: claimLevel,
    source_backed_graph_claim: sourceBackedGraphClaim,
    graph: {
      status: graphStatus,
      verification_mode: verificationMode,
      expected_paper_count: expectedPaperCount,
      present_paper_count: presentPaperCount,
      missing_paper_count: missingPaperCount,
      source_backed_present_count: sourceBackedPresentCount,
      paper_index_present_count: paperIndexPresentCount,
      corpus_name:
        pickString(resultRecord, ["corpusName", "corpus_name"]) ??
        pickString(graphReport, ["corpus_name", "corpusName"]) ??
        pickString(statusRecord, ["corpus_name", "corpusName"]),
      corpus_root:
        pickString(resultRecord, ["corpusRoot", "corpus_root"]) ??
        pickString(graphReport, ["corpus_root", "corpusRoot"]) ??
        pickString(statusRecord, ["corpus_root", "corpusRoot"]),
    },
    upload: {
      phase: pickString(progressRecord, ["phase"]),
      manifest_path: pickString(batchRecord, ["manifest_path", "manifestPath"]),
      total_items: pickNumber(batchRecord, ["total_items", "totalItems"]),
      synced_items: pickNumber(batchRecord, ["synced_items", "syncedItems"]) ?? 0,
      failed_items: pickNumber(batchRecord, ["failed_items", "failedItems"]) ?? 0,
      queue_remaining: queueRemaining,
      queue_completed: pickNumber(queueProgressRecord, ["completed"]),
      remote_task_completed: uploadRemoteTaskCompleted,
      remote_task_status: pickString(remoteTaskRecord, ["status"]),
      remote_task_stage: pickString(remoteTaskRecord, ["stage"]),
    },
    source_index: {
      path: sourceIndex.path,
      declared_paper_count: sourceIndex.declaredPaperCount,
      paper_record_count: sourceIndex.paperRecordCount,
      source_backed_paper_count: sourceIndex.sourceBackedPaperCount,
      metadata_only_paper_count: sourceIndex.metadataOnlyPaperCount,
      precise_identifier_count: sourceIndex.preciseIdentifierCount,
      summary_only: sourceIndex.summaryOnly,
    },
    mcp_contract: {
      evidence_mode: evidenceMode,
      remote_mcp_evidence: evidenceMode === "remote_mcp",
      remote_api_fallback: evidenceMode === "remote_api",
      local_corpus_evidence: evidenceMode === "local_corpus",
      skill_aligned_graph_claim:
        evidenceMode === "remote_mcp" && sourceBackedGraphClaim,
    },
    limitations,
    linked_artifacts: {
      graph_presence_report: relativeArtifactPath(projectRoot, graphPresenceReportPath),
      papernexus_status: relativeArtifactPath(projectRoot, papernexusStatusPath),
      papernexus_progress: relativeArtifactPath(projectRoot, papernexusProgressPath),
      paper_source_index: sourceIndex.path
        ? relativeArtifactPath(projectRoot, sourceIndex.path)
        : null,
    },
    report_path: relativeArtifactPath(projectRoot, reportPath),
  };

  await writeJsonEnsured(reportPath, certification);
  return certification;
}
