import {
  asRecord,
  normalizeStage,
} from "./workflow-guard-core/coercion";
import {
  normalizeBrainstormCycleOptionState,
  normalizeBrainstormCycleRoundState,
} from "./workflow-guard-state/research-loop-state";
import {
  normalizeReviewIssueState,
} from "./workflow-guard-state/execution-state";

type BrainstormCycleOptionStateLike = {
  optionId: string;
  title: string | null;
  summary: string | null;
  score: number | null;
  status: string | null;
  verdict: string | null;
};

type BrainstormCycleRoundStateLike = {
  roundId: string;
  label: string | null;
  status: string | null;
  focus: string | null;
  options: BrainstormCycleOptionStateLike[];
};

type BrainstormCycleStateLike = {
  selectedRoundId: string | null;
  selectedOptionId: string | null;
  selectedOptionTitle: string | null;
  selectedOptionScore: number | null;
  selectionMode: string | null;
};

type ReviewIssueStateLike = {
  issueId: string;
  lane: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  targetStage: string | null;
  targetArtifact: string | null;
  openedBy: string | null;
  owner: string | null;
  status: string | null;
  fixArtifactPaths: string[];
  verifiedAt: string | null;
  waiverReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ReviewIssueCountsLike = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export function renderMarkdownishPayload(value: unknown): string {
  if (typeof value === "string") {
    return value.endsWith("\n") ? value : `${value}\n`;
  }
  if (value == null) {
    return "";
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderReasoningTracePayload(value: unknown): string {
  if (typeof value === "string") {
    return value.endsWith("\n") ? value : `${value}\n`;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => JSON.stringify(entry))
      .join("\n")
      .concat(value.length > 0 ? "\n" : "");
  }
  if (value == null) {
    return "";
  }
  return `${JSON.stringify(value)}\n`;
}

export function hasMeaningfulPayload(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return value != null;
}

export function pickBrainstormPayload(
  record: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

export function extractBrainstormCandidateRecords(
  value: unknown
): Array<{
  round: BrainstormCycleRoundStateLike;
  roundRecord: Record<string, unknown>;
  option: BrainstormCycleOptionStateLike;
  optionRecord: Record<string, unknown>;
}> {
  const rounds = Array.isArray(asRecord(value)?.rounds)
    ? (asRecord(value)?.rounds as unknown[])
    : [];
  const candidates: Array<{
    round: BrainstormCycleRoundStateLike;
    roundRecord: Record<string, unknown>;
    option: BrainstormCycleOptionStateLike;
    optionRecord: Record<string, unknown>;
  }> = [];
  for (const rawRound of rounds) {
    const roundRecord = asRecord(rawRound);
    const round = normalizeBrainstormCycleRoundState(rawRound);
    if (!round || !roundRecord) {
      continue;
    }
    const rawOptions = Array.isArray(roundRecord.options) ? roundRecord.options : [];
    for (const rawOption of rawOptions) {
      const optionRecord = asRecord(rawOption);
      const option = normalizeBrainstormCycleOptionState(rawOption);
      if (!option || !optionRecord) {
        continue;
      }
      candidates.push({
        round,
        roundRecord,
        option,
        optionRecord,
      });
    }
  }
  return candidates;
}

export function selectBrainstormCandidate(params: {
  brainstormCycle: Record<string, unknown>;
  current: BrainstormCycleStateLike;
}):
  | {
      round: BrainstormCycleRoundStateLike;
      roundRecord: Record<string, unknown>;
      option: BrainstormCycleOptionStateLike;
      optionRecord: Record<string, unknown>;
      mode: string | null;
    }
  | null {
  const candidates = extractBrainstormCandidateRecords(params.brainstormCycle);
  const selectedOptionId =
    (typeof params.brainstormCycle.selectedOptionId === "string"
      ? params.brainstormCycle.selectedOptionId
      : null) ?? params.current.selectedOptionId;
  if (selectedOptionId) {
    const selected =
      candidates.find((candidate) => candidate.option.optionId === selectedOptionId) ?? null;
    if (selected) {
      return {
        ...selected,
        mode:
          (typeof params.brainstormCycle.selectionMode === "string"
            ? params.brainstormCycle.selectionMode
            : null) ?? params.current.selectionMode,
      };
    }
  }
  const sorted = [...candidates].sort((left, right) => {
    const rightScore =
      typeof right.option.score === "number" && Number.isFinite(right.option.score)
        ? right.option.score
        : Number.NEGATIVE_INFINITY;
    const leftScore =
      typeof left.option.score === "number" && Number.isFinite(left.option.score)
        ? left.option.score
        : Number.NEGATIVE_INFINITY;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return (left.option.title ?? left.option.optionId).localeCompare(
      right.option.title ?? right.option.optionId
    );
  });
  return sorted.length > 0
    ? {
        ...sorted[0]!,
        mode:
          (typeof params.brainstormCycle.selectionMode === "string"
            ? params.brainstormCycle.selectionMode
            : null) ?? params.current.selectionMode,
      }
    : null;
}

export function extractReviewIssues(value: unknown): ReviewIssueStateLike[] {
  const record = asRecord(value);
  const issues = Array.isArray(record?.issues)
    ? record.issues
    : Array.isArray(value)
      ? value
      : [];
  return issues.map((issue) => normalizeReviewIssueState(issue));
}

export function summarizeReviewIssuesFromManifest(value: unknown): {
  issues: ReviewIssueStateLike[];
  counts: ReviewIssueCountsLike;
} {
  const issues = extractReviewIssues(value);
  const counts: ReviewIssueCountsLike = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const issue of issues) {
    if (["resolved", "closed", "waived", "accepted"].includes(normalizeStage(issue.status) ?? "")) {
      continue;
    }
    const severity = normalizeStage(issue.severity);
    if (severity === "critical") {
      counts.critical += 1;
    } else if (severity === "high") {
      counts.high += 1;
    } else if (severity === "medium") {
      counts.medium += 1;
    } else {
      counts.low += 1;
    }
  }
  return { issues, counts };
}
