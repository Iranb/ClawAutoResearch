import { asRecord, asStringArray, pickNumber, pickString } from "../workflow-guard-core/coercion";

export type SufficiencyJudgment = {
  preferredDecision: "brainstorm" | "requisition";
  reasoning: string;
  confidence: number;
  missingDomains: string[];
  missingQuestionIds: string[];
  recommendedRetryBudget: number | null;
};

function normalizeDecision(value: unknown): "brainstorm" | "requisition" {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "brainstorm" ? "brainstorm" : "requisition";
}

export function buildSufficiencyPrompt(params: {
  targetDomain: string;
  questionGaps: Array<{
    question_id: string;
    question: string;
    coverage_status?: string | null;
  }>;
  selectedDomains: string[];
  insufficientDomains: string[];
}) {
  const questionLines =
    params.questionGaps.length > 0
      ? params.questionGaps
          .map(
            (entry) =>
              `- ${entry.question_id}: ${entry.question} (${entry.coverage_status ?? "partial"})`
          )
          .join("\n")
      : "- none";
  const selectedDomains =
    params.selectedDomains.length > 0 ? params.selectedDomains.join(", ") : "none";
  const insufficientDomains =
    params.insufficientDomains.length > 0
      ? params.insufficientDomains.join(", ")
      : "none";

  return `You are the IDEA-CATALYST sufficiency judge.

Target domain:
${params.targetDomain}

Currently selected source domains:
${selectedDomains}

Domains that still look insufficient:
${insufficientDomains}

Unresolved catalyst questions:
${questionLines}

Decide whether the workflow should:
- brainstorm: current bridge evidence is sufficient to continue idea integration
- requisition: more literature discovery / graph ingestion is still required

Return strict JSON:
{
  "preferred_decision": "brainstorm|requisition",
  "reasoning": "short explanation",
  "confidence": 0.0,
  "missing_domains": ["domain"],
  "missing_question_ids": ["q1"],
  "recommended_retry_budget": 1
}`;
}

export function parseSufficiencyJudgment(raw: string): SufficiencyJudgment {
  const text = String(raw ?? "").trim();
  let record = asRecord(text);
  if (!record) {
    try {
      record = asRecord(JSON.parse(text));
    } catch {
      record = null;
    }
  }

  if (!record) {
    return {
      preferredDecision:
        /brainstorm/i.test(text) && !/requisition/i.test(text)
          ? "brainstorm"
          : "requisition",
      reasoning: text || "No explicit sufficiency reasoning provided.",
      confidence: 0,
      missingDomains: [],
      missingQuestionIds: [],
      recommendedRetryBudget: null,
    };
  }

  const confidence = pickNumber(record, ["confidence"]) ?? 0;
  const retryBudget = pickNumber(record, [
    "recommendedRetryBudget",
    "recommended_retry_budget",
  ]);
  return {
    preferredDecision: normalizeDecision(
      record.preferredDecision ?? record.preferred_decision
    ),
    reasoning:
      pickString(record, ["reasoning"]) ?? "No explicit sufficiency reasoning provided.",
    confidence:
      typeof confidence === "number" && Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0,
    missingDomains: asStringArray(
      record.missingDomains ?? record.missing_domains
    ),
    missingQuestionIds: asStringArray(
      record.missingQuestionIds ?? record.missing_question_ids
    ),
    recommendedRetryBudget:
      typeof retryBudget === "number" && Number.isFinite(retryBudget)
        ? Math.max(0, Math.floor(retryBudget))
        : null,
  };
}
