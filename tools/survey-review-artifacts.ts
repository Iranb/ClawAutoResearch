import { normalizeTitle } from "./paper-source-contract";
import {
  asRecord,
  pickString,
} from "./workflow-guard-core/coercion";

export const DEFAULT_SURVEY_CANDIDATE_PAPERS_PATH = "researcher/CANDIDATE_PAPERS.json";
export const DEFAULT_SURVEY_SCREENING_DECISIONS_PATH =
  "researcher/CANDIDATE_SCREENING_DECISIONS.json";

type SurveyDecision = "include" | "exclude" | "background" | "pending" | "unknown";

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function collectEntriesFromRecord(
  record: Record<string, unknown>,
  keys: string[]
): Record<string, unknown>[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return asObjectArray(record[key]);
    }
  }
  return [];
}

export function collectSurveyEntries(
  value: unknown,
  keys: string[]
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return asObjectArray(value);
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  return collectEntriesFromRecord(record, keys);
}

function normalizeDecision(value: unknown): SurveyDecision {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (
    normalized === "include" ||
    normalized === "included" ||
    normalized === "keep" ||
    normalized === "accepted" ||
    normalized === "core"
  ) {
    return "include";
  }
  if (
    normalized === "exclude" ||
    normalized === "excluded" ||
    normalized === "reject" ||
    normalized === "rejected"
  ) {
    return "exclude";
  }
  if (
    normalized === "background" ||
    normalized === "background_only" ||
    normalized === "background-only" ||
    normalized === "reference" ||
    normalized === "reference_only" ||
    normalized === "reference-only" ||
    normalized === "related"
  ) {
    return "background";
  }
  if (
    normalized === "pending" ||
    normalized === "pending_screen" ||
    normalized === "pending-screen" ||
    normalized === "queued" ||
    normalized === "review"
  ) {
    return "pending";
  }
  return "unknown";
}

function buildEntryIdentityKeys(entry: Record<string, unknown>): string[] {
  const values = [
    pickString(entry, ["canonical_id", "canonicalId"]),
    pickString(entry, ["doi"]),
    pickString(entry, ["arxiv", "arxiv_id", "arxivId"]),
    pickString(entry, ["paper_id", "paperId"]),
    pickString(entry, ["title", "paper_title", "paperTitle", "name"]),
  ];
  const normalized = values
    .map((value) => {
      const text = String(value ?? "").trim();
      if (!text) {
        return null;
      }
      const title = normalizeTitle(text);
      return title ?? text.toLowerCase();
    })
    .filter((value): value is string => Boolean(value));
  return [...new Set(normalized)];
}

export function countSurveyPaperEntries(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  if (typeof record.totalCount === "number" && Number.isFinite(record.totalCount)) {
    return Math.max(0, Math.floor(record.totalCount));
  }
  if (typeof record.total_count === "number" && Number.isFinite(record.total_count)) {
    return Math.max(0, Math.floor(record.total_count));
  }
  for (const key of [
    "papers",
    "items",
    "candidates",
    "included",
    "includedPapers",
    "excluded",
    "excludedPapers",
  ]) {
    if (Array.isArray(record[key])) {
      return record[key].length;
    }
  }
  if (Array.isArray(record.backgroundPapers)) {
    return record.backgroundPapers.length;
  }
  return 0;
}

export function summarizeSurveyQueryRegistry(value: unknown): {
  queryRoundCount: number;
  candidatePaperCount: number;
  pendingRoundCount: number;
  hasExplicitSaturation: boolean;
  saturationVerdict: string | null;
} {
  const record = asRecord(value) ?? {};
  const rounds =
    (Array.isArray(record.rounds) ? record.rounds : null) ??
    (Array.isArray(record.retrieval_rounds) ? record.retrieval_rounds : null) ??
    (Array.isArray(record.retrievalRounds) ? record.retrievalRounds : null) ??
    (Array.isArray(record.queryRounds) ? record.queryRounds : null) ??
    [];
  const pendingRounds = [
    ...asObjectArray(record.pending_rounds),
    ...asObjectArray(record.pendingRounds),
    ...asObjectArray(record.planned_rounds),
    ...asObjectArray(record.plannedRounds),
  ];
  const pendingRoundStrings = [
    ...(Array.isArray(record.pending_rounds)
      ? record.pending_rounds.filter((entry) => typeof entry === "string")
      : []),
    ...(Array.isArray(record.pendingRounds)
      ? record.pendingRounds.filter((entry) => typeof entry === "string")
      : []),
  ];
  const pendingRoundCount =
    pendingRoundStrings.length +
    pendingRounds.filter((entry) => {
      const status = String(entry.status ?? "").trim().toLowerCase();
      return !status || status === "pending" || status === "planned" || status === "queued";
    }).length;
  const candidatePaperCount =
    typeof record.candidate_paper_count === "number" && Number.isFinite(record.candidate_paper_count)
      ? Math.max(0, Math.floor(record.candidate_paper_count))
      : typeof record.candidatePaperCount === "number" && Number.isFinite(record.candidatePaperCount)
        ? Math.max(0, Math.floor(record.candidatePaperCount))
        : typeof record.total_count === "number" && Number.isFinite(record.total_count)
          ? Math.max(0, Math.floor(record.total_count))
          : typeof record.totalCount === "number" && Number.isFinite(record.totalCount)
            ? Math.max(0, Math.floor(record.totalCount))
            : 0;
  const saturation = asRecord(record.saturation);
  const saturationVerdict = saturation ? pickString(saturation, ["verdict"]) : null;
  const hasExplicitSaturation =
    Boolean(saturation && saturation.assessed === true) ||
    saturationVerdict === "saturated";
  return {
    queryRoundCount: rounds.length,
    candidatePaperCount,
    pendingRoundCount,
    hasExplicitSaturation,
    saturationVerdict,
  };
}

export function summarizeSurveyScreening(params: {
  candidatePapers?: unknown;
  screeningDecisions?: unknown;
  includedPapers?: unknown;
  excludedPapers?: unknown;
}): {
  includedCount: number;
  excludedCount: number;
  backgroundCount: number;
  pendingCount: number;
} {
  const decisionEntries = collectSurveyEntries(params.screeningDecisions, [
    "decisions",
    "papers",
    "items",
  ]);
  const candidateEntries = collectSurveyEntries(params.candidatePapers, [
    "papers",
    "items",
    "candidates",
  ]);
  const includedCount = countSurveyPaperEntries(params.includedPapers);
  const excludedEntries = collectSurveyEntries(params.excludedPapers, [
    "excludedPapers",
    "excluded",
    "papers",
    "items",
  ]);
  const backgroundEntries = collectSurveyEntries(params.excludedPapers, [
    "backgroundPapers",
  ]);

  const decidedIdentities = new Set<string>();
  let decidedIncludedCount = 0;
  let decidedExcludedCount = 0;
  let decidedBackgroundCount = 0;
  let decidedPendingCount = 0;

  for (const entry of decisionEntries) {
    const decision = normalizeDecision(
      entry.decision ??
        entry.status ??
        entry.screening_status ??
        entry.screeningStatus
    );
    for (const key of buildEntryIdentityKeys(entry)) {
      decidedIdentities.add(key);
    }
    if (decision === "include") {
      decidedIncludedCount += 1;
    } else if (decision === "exclude") {
      decidedExcludedCount += 1;
    } else if (decision === "background") {
      decidedBackgroundCount += 1;
    } else if (decision === "pending") {
      decidedPendingCount += 1;
    }
  }

  let pendingCount = decidedPendingCount;
  for (const entry of candidateEntries) {
    const keys = buildEntryIdentityKeys(entry);
    const alreadyDecided = keys.some((key) => decidedIdentities.has(key));
    if (alreadyDecided) {
      continue;
    }
    const decision = normalizeDecision(
      entry.decision ??
        entry.status ??
        entry.screening_status ??
        entry.screeningStatus
    );
    if (decision === "pending" || decision === "unknown") {
      pendingCount += 1;
    }
  }

  return {
    includedCount:
      includedCount > 0
        ? includedCount
        : decidedIncludedCount,
    excludedCount:
      excludedEntries.length > 0
        ? excludedEntries.length
        : decidedExcludedCount,
    backgroundCount:
      backgroundEntries.length > 0
        ? backgroundEntries.length
        : decidedBackgroundCount,
    pendingCount,
  };
}

export function collectSurveyBackgroundReferenceLines(params: {
  excludedPapers?: unknown;
  screeningDecisions?: unknown;
  limit?: number;
}): string[] {
  const lines: Array<{ key: string; line: string }> = [];
  const pushLine = (entry: Record<string, unknown>) => {
    const title = pickString(entry, ["title", "paper_title", "paperTitle", "name"]);
    const reason = pickString(entry, ["reason", "decision_reason", "decisionReason"]);
    if (!title) {
      return;
    }
    const key = normalizeTitle(title) ?? title.toLowerCase();
    lines.push({ key, line: reason ? `${title} - ${reason}` : title });
  };

  for (const entry of collectSurveyEntries(params.excludedPapers, ["backgroundPapers"])) {
    pushLine(entry);
  }
  for (const entry of collectSurveyEntries(params.screeningDecisions, [
    "decisions",
    "papers",
    "items",
  ])) {
    const decision = normalizeDecision(
      entry.decision ??
        entry.status ??
        entry.screening_status ??
        entry.screeningStatus
    );
    if (decision === "background") {
      pushLine(entry);
    }
  }

  const bestByKey = new Map<string, string>();
  for (const entry of lines) {
    const current = bestByKey.get(entry.key);
    if (!current || current.length < entry.line.length) {
      bestByKey.set(entry.key, entry.line);
    }
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const { key, line } of lines) {
    const best = bestByKey.get(key) ?? line;
    if (!best || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(best);
  }
  return ordered.slice(0, Math.max(1, params.limit ?? 8));
}

function collectNormalizedFieldValues(
  entry: Record<string, unknown>,
  keys: string[]
): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const raw = entry[key];
    if (typeof raw === "string" && raw.trim()) {
      values.push(raw.trim());
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string" && item.trim()) {
          values.push(item.trim());
        }
      }
    }
  }
  return [...new Set(values)];
}

function countStringValues(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function summarizeSurveyRoleCoverage(params: {
  screeningDecisions?: unknown;
  includedPapers?: unknown;
  excludedPapers?: unknown;
}): {
  paperRoleCounts: Record<string, number>;
  evidenceRoleCounts: Record<string, number>;
  benchmarkFamilyCounts: Record<string, number>;
  taskFamilyCounts: Record<string, number>;
  settingFamilyCounts: Record<string, number>;
} {
  const merged = new Map<
    string,
    {
      paperRoles: Set<string>;
      evidenceRoles: Set<string>;
      benchmarkFamilies: Set<string>;
      taskFamilies: Set<string>;
      settingFamilies: Set<string>;
    }
  >();
  const allEntries = [
    ...collectSurveyEntries(params.screeningDecisions, ["decisions", "papers", "items"]),
    ...collectSurveyEntries(params.includedPapers, ["papers", "included", "includedPapers", "items"]),
    ...collectSurveyEntries(params.excludedPapers, [
      "excludedPapers",
      "excluded",
      "backgroundPapers",
      "papers",
      "items",
    ]),
  ];

  for (const [index, entry] of allEntries.entries()) {
    const keys = buildEntryIdentityKeys(entry);
    const identity = keys[0] ?? `entry-${index + 1}`;
    if (!merged.has(identity)) {
      merged.set(identity, {
        paperRoles: new Set<string>(),
        evidenceRoles: new Set<string>(),
        benchmarkFamilies: new Set<string>(),
        taskFamilies: new Set<string>(),
        settingFamilies: new Set<string>(),
      });
    }
    const target = merged.get(identity)!;
    for (const value of collectNormalizedFieldValues(entry, ["paper_role", "paperRole"])) {
      target.paperRoles.add(value);
    }
    for (const value of collectNormalizedFieldValues(entry, ["evidence_role", "evidenceRole"])) {
      target.evidenceRoles.add(value);
    }
    for (const value of collectNormalizedFieldValues(entry, ["benchmark_family", "benchmarkFamily"])) {
      target.benchmarkFamilies.add(value);
    }
    for (const value of collectNormalizedFieldValues(entry, ["task_family", "taskFamily"])) {
      target.taskFamilies.add(value);
    }
    for (const value of collectNormalizedFieldValues(entry, ["setting_family", "settingFamily"])) {
      target.settingFamilies.add(value);
    }
  }

  const flattened = {
    paperRoles: [] as string[],
    evidenceRoles: [] as string[],
    benchmarkFamilies: [] as string[],
    taskFamilies: [] as string[],
    settingFamilies: [] as string[],
  };
  for (const entry of merged.values()) {
    flattened.paperRoles.push(...entry.paperRoles);
    flattened.evidenceRoles.push(...entry.evidenceRoles);
    flattened.benchmarkFamilies.push(...entry.benchmarkFamilies);
    flattened.taskFamilies.push(...entry.taskFamilies);
    flattened.settingFamilies.push(...entry.settingFamilies);
  }

  return {
    paperRoleCounts: countStringValues(flattened.paperRoles),
    evidenceRoleCounts: countStringValues(flattened.evidenceRoles),
    benchmarkFamilyCounts: countStringValues(flattened.benchmarkFamilies),
    taskFamilyCounts: countStringValues(flattened.taskFamilies),
    settingFamilyCounts: countStringValues(flattened.settingFamilies),
  };
}
