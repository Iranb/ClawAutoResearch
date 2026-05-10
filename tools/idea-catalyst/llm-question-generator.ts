import { asRecord, pickString } from "../workflow-guard-core/coercion";
import {
  getPromptLines,
  getPromptText,
  loadWorkflowPromptConfig,
  type WorkflowPromptConfig,
} from "../workflow-prompt-config";
import { getIdeaCatalystPromptContract } from "./prompt-contracts";

export type GeneratedCatalystQuestion = {
  coarse_grained_domain?: string | null;
  fine_grained_domain?: string | null;
  core_challenge?: string | null;
  domain_specific_question: string;
  domain_agnostic_question?: string | null;
  rationale?: string | null;
  target_domain_queries?: string[] | null;
};

export function buildQuestionGenerationPrompt(params: {
  targetDomain: string;
  problemStatement: string | null;
  challengeClusters: string[];
  longTermGoal: string | null;
  promptConfig?: WorkflowPromptConfig | null;
}) {
  const challengeLines =
    params.challengeClusters.length > 0
      ? params.challengeClusters.map((entry) => `- ${entry}`).join("\n")
      : "- none";
  const contract = getIdeaCatalystPromptContract();
  const config = params.promptConfig ?? loadWorkflowPromptConfig();
  const configRoot = ["ideaCatalyst", "questionGeneration"];
  const role = getPromptText(
    config,
    [...configRoot, "role"],
    "You are generating IDEA-CATALYST decomposition questions."
  );
  const task = getPromptText(
    config,
    [...configRoot, "task"],
    "Generate 1-3 additional non-incremental questions that are missing from the current graph decomposition."
  );
  const qualityRules = getPromptLines(config, [...configRoot, "qualityRules"], [
    "Use metacognitive decomposition: identify what is known, what remains uncertain, and which gap is actionable.",
    "Write each domain-specific question in target-domain vocabulary and each domain-agnostic question as a mechanism-level abstraction.",
    "Prioritize partial or unexplored conceptual challenges over obvious extensions of occupied solution zones.",
    "Do not propose source domains, methods, or final solutions in this stage.",
    "Provide 3-5 target-domain search queries that can retrieve literature for progress assessment.",
  ]);

  return `${role}

Target domain:
${params.targetDomain}

Problem statement:
${params.problemStatement ?? "not provided"}

Long-term goal:
${params.longTermGoal ?? "not provided"}

Existing challenge clusters:
${challengeLines}

Stage goal:
${contract.initial_decomposition.stage_goal}

Task:
${task}

Paper-aligned guidance:
${contract.initial_decomposition.guidance.map((entry) => `- ${entry}`).join("\n")}

Quality rules:
${qualityRules.map((entry) => `- ${entry}`).join("\n")}

Quality checks:
${contract.initial_decomposition.quality_checks.map((entry) => `- ${entry}`).join("\n")}

Each question must support the public IDEA-CATALYST initial decomposition contract and help downstream target-domain analysis.

Required fields for each proposed question:
${contract.initial_decomposition.required_fields.map((entry) => `- ${entry}`).join("\n")}

Return strict JSON:
{
  "questions": [
    {
      "coarse_grained_domain": "string",
      "fine_grained_domain": "string",
      "core_challenge": "string",
      "domain_specific_question": "string",
      "domain_agnostic_question": "string",
      "rationale": "string",
      "target_domain_queries": ["string", "string", "string"]
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
    .map((entry) => {
      const rawQueries = entry.target_domain_queries ?? entry.targetDomainQueries;
      const targetDomainQueries = Array.isArray(rawQueries)
        ? rawQueries
            .map((item: unknown) => pickString({ value: item }, ["value"]))
            .filter((item): item is string => Boolean(item))
        : [];
      return {
      coarse_grained_domain: pickString(entry, [
        "coarse_grained_domain",
        "coarseGrainedDomain",
      ]),
      fine_grained_domain: pickString(entry, [
        "fine_grained_domain",
        "fineGrainedDomain",
      ]),
      core_challenge: pickString(entry, ["core_challenge", "coreChallenge"]),
      domain_specific_question:
        pickString(entry, ["domain_specific_question", "domainSpecificQuestion"]) ?? "",
      domain_agnostic_question: pickString(entry, [
        "domain_agnostic_question",
        "domainAgnosticQuestion",
      ]),
      rationale: pickString(entry, ["rationale"]),
      target_domain_queries: targetDomainQueries,
    };
    })
    .filter((entry) => entry.domain_specific_question.trim().length > 0);
}
