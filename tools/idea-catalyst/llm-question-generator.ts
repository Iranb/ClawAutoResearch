import { asRecord, pickString } from "../workflow-guard-core/coercion";

export type GeneratedCatalystQuestion = {
  domain_specific_question: string;
  domain_agnostic_question?: string | null;
  rationale?: string | null;
};

export function buildQuestionGenerationPrompt(params: {
  targetDomain: string;
  problemStatement: string | null;
  challengeClusters: string[];
  longTermGoal: string | null;
}) {
  const challengeLines =
    params.challengeClusters.length > 0
      ? params.challengeClusters.map((entry) => `- ${entry}`).join("\n")
      : "- none";
  return `You are generating IDEA-CATALYST decomposition questions.

Target domain:
${params.targetDomain}

Problem statement:
${params.problemStatement ?? "not provided"}

Long-term goal:
${params.longTermGoal ?? "not provided"}

Existing challenge clusters:
${challengeLines}

Generate 1-3 additional non-incremental questions that are missing from the current graph decomposition.

Return strict JSON:
{
  "questions": [
    {
      "domain_specific_question": "string",
      "domain_agnostic_question": "string",
      "rationale": "string"
    }
  ]
}`;
}

export function parseGeneratedQuestions(raw: string): GeneratedCatalystQuestion[] {
  const text = String(raw ?? "").trim();
  let record = asRecord(text);
  if (!record) {
    try {
      record = asRecord(JSON.parse(text));
    } catch {
      record = null;
    }
  }
  if (!record || !Array.isArray(record.questions)) {
    return [];
  }
  return record.questions
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      domain_specific_question:
        pickString(entry, ["domain_specific_question", "domainSpecificQuestion"]) ?? "",
      domain_agnostic_question: pickString(entry, [
        "domain_agnostic_question",
        "domainAgnosticQuestion",
      ]),
      rationale: pickString(entry, ["rationale"]),
    }))
    .filter((entry) => entry.domain_specific_question.trim().length > 0);
}
