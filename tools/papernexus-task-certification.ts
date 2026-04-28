import * as path from "node:path";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import { normalizePaperIngestionState } from "./workflow-guard-state/paper-ingestion";

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

type ImportTaskEvidence = {
  task_id: string | null;
  canonical_id: string | null;
  paper_id: string | null;
  title: string | null;
  manifest_path: string | null;
  source_path: string | null;
  status: string | null;
  stage: string | null;
  submitted: boolean | null;
  synced: boolean | null;
  matched_by: string | null;
  error: string | null;
  updated_at: string | null;
  evidence_sources: string[];
  task_completed: boolean | null;
  stage_completed: boolean | null;
  graph_index_confirmed: boolean;
  source_span_confirmed: boolean;
};

type ImportTaskEvidenceSummary = {
  task_count: number;
  completed_task_count: number;
  stage_completed_task_count: number;
  synced_task_count: number;
  failed_task_count: number;
  missing_task_id_count: number;
  all_tasks_completed: boolean | null;
  all_task_stages_completed: boolean | null;
  items: ImportTaskEvidence[];
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
    import_tasks: ImportTaskEvidenceSummary;
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

function uniqueStringsInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function relativeArtifactPath(projectRoot: string, artifactPath: string): string {
  return path.relative(projectRoot, artifactPath);
}

function relativeOrOriginalPath(projectRoot: string, artifactPath: string | null): string | null {
  if (!artifactPath) {
    return null;
  }
  return path.isAbsolute(artifactPath)
    ? path.relative(projectRoot, artifactPath)
    : artifactPath;
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

function normalizedTextKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

function normalizedPathKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function importTaskMatchKeys(task: ImportTaskEvidence): string[] {
  return uniqueStringsInOrder(
    [
      task.task_id ? `task:${task.task_id}` : null,
      task.canonical_id ? `canonical:${task.canonical_id}` : null,
      task.paper_id ? `paper:${task.paper_id}` : null,
      normalizedTextKey(task.title) ? `title:${normalizedTextKey(task.title)}` : null,
      normalizedPathKey(task.source_path) ? `source:${normalizedPathKey(task.source_path)}` : null,
    ].filter((entry): entry is string => Boolean(entry))
  );
}

function emptyImportTaskEvidence(source: string): ImportTaskEvidence {
  return {
    task_id: null,
    canonical_id: null,
    paper_id: null,
    title: null,
    manifest_path: null,
    source_path: null,
    status: null,
    stage: null,
    submitted: null,
    synced: null,
    matched_by: null,
    error: null,
    updated_at: null,
    evidence_sources: [source],
    task_completed: null,
    stage_completed: null,
    graph_index_confirmed: false,
    source_span_confirmed: false,
  };
}

function taskCompletedFromStatus(status: string | null): boolean | null {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
    case "complete":
    case "ready":
    case "synced":
      return true;
    case "pending":
    case "queued":
    case "running":
    case "submitted":
    case "uploading":
    case "processing":
    case "failed":
    case "submit_failed":
    case "timed_out":
      return false;
    default:
      return null;
  }
}

function stageCompletedFromStage(stage: string | null): boolean | null {
  switch ((stage ?? "").toLowerCase()) {
    case "completed":
    case "complete":
    case "ready":
      return true;
    case "queued":
    case "pending":
    case "running":
    case "uploading":
    case "processing":
    case "failed":
    case "timed_out":
      return false;
    default:
      return null;
  }
}

function mergeTaskBoolean(
  current: boolean | null,
  patch: boolean | null
): boolean | null {
  if (patch === true) {
    return true;
  }
  if (current === true) {
    return true;
  }
  if (patch === false) {
    return current ?? false;
  }
  return current;
}

function mergeImportTaskEvidence(
  current: ImportTaskEvidence,
  patch: ImportTaskEvidence
): ImportTaskEvidence {
  const status = patch.status ?? current.status;
  const stage = patch.stage ?? current.stage;
  const synced = patch.synced ?? current.synced;
  return {
    task_id: patch.task_id ?? current.task_id,
    canonical_id: patch.canonical_id ?? current.canonical_id,
    paper_id: patch.paper_id ?? current.paper_id,
    title: patch.title ?? current.title,
    manifest_path: patch.manifest_path ?? current.manifest_path,
    source_path: patch.source_path ?? current.source_path,
    status,
    stage,
    submitted: patch.submitted ?? current.submitted,
    synced,
    matched_by: patch.matched_by ?? current.matched_by,
    error: patch.error ?? current.error,
    updated_at: patch.updated_at ?? current.updated_at,
    evidence_sources: uniqueStringsInOrder([
      ...current.evidence_sources,
      ...patch.evidence_sources,
    ]),
    task_completed: mergeTaskBoolean(
      current.task_completed,
      patch.task_completed ?? (synced === true ? true : taskCompletedFromStatus(status))
    ),
    stage_completed: mergeTaskBoolean(
      current.stage_completed,
      patch.stage_completed ?? stageCompletedFromStage(stage)
    ),
    graph_index_confirmed:
      current.graph_index_confirmed || patch.graph_index_confirmed,
    source_span_confirmed:
      current.source_span_confirmed || patch.source_span_confirmed,
  };
}

function addOrMergeImportTaskEvidence(
  tasks: ImportTaskEvidence[],
  patch: ImportTaskEvidence
): void {
  const patchKeys = importTaskMatchKeys(patch);
  const existingIndex = tasks.findIndex((entry) =>
    importTaskMatchKeys(entry).some((key) => patchKeys.includes(key))
  );
  if (existingIndex >= 0) {
    tasks[existingIndex] = mergeImportTaskEvidence(tasks[existingIndex], patch);
    return;
  }
  tasks.push(mergeImportTaskEvidence(emptyImportTaskEvidence(""), patch));
}

function readManifestPaperTask(
  record: UnknownRecord,
  manifestPath: string | null
): ImportTaskEvidence {
  return {
    ...emptyImportTaskEvidence("batch_manifest"),
    task_id: pickString(record, ["task_id", "taskId", "import_task_id", "importTaskId"]),
    canonical_id: pickString(record, ["canonical_id", "canonicalId", "id"]),
    paper_id: pickString(record, ["paper_id", "paperId"]),
    title: pickString(record, ["title", "paper_title", "paperTitle"]),
    manifest_path: manifestPath,
    source_path: pickString(record, ["source", "source_path", "sourcePath", "path"]),
  };
}

async function readBatchManifestTasks(
  projectRoot: string,
  manifestPath: string | null
): Promise<ImportTaskEvidence[]> {
  if (!manifestPath) {
    return [];
  }
  const resolvedPath = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(projectRoot, manifestPath);
  const raw = asRecord(await readJsonIfExists<UnknownRecord>(resolvedPath));
  const papers = firstArray(raw?.papers, raw?.items)
    .map((entry) => asRecord(entry))
    .filter(Boolean) as UnknownRecord[];
  return papers.map((paper) =>
    readManifestPaperTask(paper, relativeOrOriginalPath(projectRoot, manifestPath))
  );
}

function batchItemTaskEvidence(
  value: UnknownRecord,
  projectRoot: string
): ImportTaskEvidence {
  const status = pickString(value, ["status"]);
  const stage = pickString(value, ["stage"]);
  const synced = value.synced === true;
  return {
    ...emptyImportTaskEvidence("batch_item"),
    task_id: pickString(value, ["importTaskId", "import_task_id", "taskId", "task_id"]),
    canonical_id: pickString(value, ["canonicalId", "canonical_id"]),
    paper_id: pickString(value, ["paperId", "paper_id"]),
    title: pickString(value, ["title"]),
    manifest_path: relativeOrOriginalPath(
      projectRoot,
      pickString(value, ["manifestPath", "manifest_path"])
    ),
    status,
    stage,
    submitted: value.submitted === true,
    synced,
    matched_by: pickString(value, ["matchedBy", "matched_by"]),
    error: pickString(value, ["error"]),
    updated_at: pickString(value, ["updatedAt", "updated_at"]),
    task_completed: synced ? true : taskCompletedFromStatus(status),
    stage_completed: stageCompletedFromStage(stage),
  };
}

function paperOperationTaskEvidence(value: UnknownRecord): ImportTaskEvidence {
  const status = pickString(value, ["status"]);
  const phase = pickString(value, ["phase"]);
  return {
    ...emptyImportTaskEvidence("paper_operation"),
    task_id: pickString(value, ["importTaskId", "import_task_id"]),
    canonical_id: pickString(value, ["canonicalId", "canonical_id"]),
    title: pickString(value, ["title"]),
    status,
    stage: phase === "graph" ? status : null,
    error: pickString(value, ["detail"]),
    updated_at: pickString(value, ["finishedAt", "finished_at", "startedAt", "started_at"]),
    task_completed: taskCompletedFromStatus(status),
    stage_completed: phase === "graph" ? stageCompletedFromStage(status) : null,
  };
}

function completedPaperTaskEvidence(value: UnknownRecord): ImportTaskEvidence {
  return {
    ...emptyImportTaskEvidence("completed_paper"),
    task_id: pickString(value, ["importTaskId", "import_task_id"]),
    canonical_id: pickString(value, ["canonicalId", "canonical_id"]),
    title: pickString(value, ["title"]),
    status: "completed",
    synced: true,
    task_completed: true,
  };
}

function importTaskIdEvidence(taskId: string): ImportTaskEvidence {
  return {
    ...emptyImportTaskEvidence("import_task_id"),
    task_id: taskId,
  };
}

function findMatchingPresentPaper(
  task: ImportTaskEvidence,
  presentPapers: PresentPaperEvidence[]
): PresentPaperEvidence | null {
  const taskTitle = normalizedTextKey(task.title);
  return (
    presentPapers.find((paper) => {
      if (
        task.canonical_id &&
        paper.canonicalId &&
        task.canonical_id === paper.canonicalId
      ) {
        return true;
      }
      if (
        task.paper_id &&
        paper.corpusPaperId &&
        task.paper_id === paper.corpusPaperId
      ) {
        return true;
      }
      return Boolean(taskTitle && normalizedTextKey(paper.title) === taskTitle);
    }) ?? null
  );
}

function summarizeImportTasks(
  tasks: ImportTaskEvidence[]
): ImportTaskEvidenceSummary {
  const sortedTasks = [...tasks].sort((left, right) =>
    String(left.task_id ?? left.canonical_id ?? left.title ?? "").localeCompare(
      String(right.task_id ?? right.canonical_id ?? right.title ?? "")
    )
  );
  const taskCount = sortedTasks.length;
  const completedTaskCount = sortedTasks.filter(
    (entry) => entry.task_completed === true
  ).length;
  const stageCompletedTaskCount = sortedTasks.filter(
    (entry) => entry.stage_completed === true
  ).length;
  return {
    task_count: taskCount,
    completed_task_count: completedTaskCount,
    stage_completed_task_count: stageCompletedTaskCount,
    synced_task_count: sortedTasks.filter((entry) => entry.synced === true).length,
    failed_task_count: sortedTasks.filter(
      (entry) =>
        ["failed", "submit_failed", "timed_out"].includes(entry.status ?? "") ||
        Boolean(entry.error)
    ).length,
    missing_task_id_count: sortedTasks.filter((entry) => !entry.task_id).length,
    all_tasks_completed: taskCount > 0 ? completedTaskCount === taskCount : null,
    all_task_stages_completed:
      taskCount > 0 ? stageCompletedTaskCount === taskCount : null,
    items: sortedTasks,
  };
}

async function buildImportTaskEvidenceSummary(params: {
  projectRoot: string;
  progressRecord: UnknownRecord | null;
  manifestRecord: UnknownRecord | null;
  presentPapers: PresentPaperEvidence[];
}): Promise<ImportTaskEvidenceSummary> {
  const paperIngestionRecord = asRecord(
    params.manifestRecord?.paper_ingestion ?? params.manifestRecord?.paperIngestion
  );
  const paperIngestionState = normalizePaperIngestionState(paperIngestionRecord);
  const batchRecord = asRecord(params.progressRecord?.batch);
  const manifestPaths = uniqueStringsInOrder(
    [
      pickString(batchRecord, ["manifest_path", "manifestPath"]),
      paperIngestionState.lastBatchManifestPath,
      ...paperIngestionState.activeBatches
        .map((entry) => entry.manifestPath)
        .filter((entry): entry is string => Boolean(entry)),
      ...paperIngestionState.batchItems
        .map((entry) => entry.manifestPath)
        .filter((entry): entry is string => Boolean(entry)),
      ...paperIngestionState.queuedRequests
        .map((entry) => entry.manifestPath)
        .filter((entry): entry is string => Boolean(entry)),
    ].filter((entry): entry is string => Boolean(entry))
  );
  const tasks: ImportTaskEvidence[] = [];
  for (const manifestPath of manifestPaths) {
    for (const task of await readBatchManifestTasks(params.projectRoot, manifestPath)) {
      addOrMergeImportTaskEvidence(tasks, task);
    }
  }
  for (const item of paperIngestionState.batchItems) {
    addOrMergeImportTaskEvidence(
      tasks,
      batchItemTaskEvidence(item as unknown as UnknownRecord, params.projectRoot)
    );
  }
  for (const item of firstArray(
    params.progressRecord?.batch_items,
    params.progressRecord?.batchItems
  )) {
    const record = asRecord(item);
    if (record) {
      addOrMergeImportTaskEvidence(
        tasks,
        batchItemTaskEvidence(record, params.projectRoot)
      );
    }
  }
  for (const operation of paperIngestionState.paperOperations) {
    addOrMergeImportTaskEvidence(
      tasks,
      paperOperationTaskEvidence(operation as unknown as UnknownRecord)
    );
  }
  for (const completedPaper of paperIngestionState.completedPapers) {
    addOrMergeImportTaskEvidence(
      tasks,
      completedPaperTaskEvidence(completedPaper as unknown as UnknownRecord)
    );
  }
  for (const taskId of paperIngestionState.importTaskIds) {
    addOrMergeImportTaskEvidence(tasks, importTaskIdEvidence(taskId));
  }
  for (const task of tasks) {
    const presentPaper = findMatchingPresentPaper(task, params.presentPapers);
    if (presentPaper) {
      task.graph_index_confirmed = presentPaper.hasPaperIndexEvidence;
      task.source_span_confirmed = presentPaper.hasSourceSpanEvidence;
    }
  }
  return summarizeImportTasks(tasks);
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
  importTasks: ImportTaskEvidenceSummary;
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
  if (params.importTasks.task_count > 0) {
    if (params.importTasks.completed_task_count < params.importTasks.task_count) {
      limitations.push("incomplete_import_task_completion_evidence");
    }
    if (params.importTasks.stage_completed_task_count < params.importTasks.task_count) {
      limitations.push("incomplete_import_task_stage_completion_evidence");
    }
    if (params.importTasks.missing_task_id_count > 0) {
      limitations.push("missing_import_task_ids");
    }
    if (params.importTasks.failed_task_count > 0) {
      limitations.push("failed_import_tasks");
    }
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
  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
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
  const manifestRecord = asRecord(await readJsonIfExists<UnknownRecord>(manifestPath));
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
  const importTasks = await buildImportTaskEvidenceSummary({
    projectRoot,
    progressRecord,
    manifestRecord,
    presentPapers,
  });
  const uploadRemoteTaskCompleted =
    normalizeRemoteTaskCompleted(remoteTaskRecord) ??
    importTasks.all_task_stages_completed ??
    importTasks.all_tasks_completed;
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
    importTasks,
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
      import_tasks: importTasks,
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
