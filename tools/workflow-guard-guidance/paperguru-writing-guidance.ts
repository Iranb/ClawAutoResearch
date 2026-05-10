import {
  normalizePaperDesignIntakeState,
  summarizePaperDesignIntakeForPrompt,
} from "../workflow-guard-state/paper-design-intake";
import { buildPapernexusEvidenceGuidance } from "./papernexus-evidence-guidance";
import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
  GuidanceContribution,
} from "./types";

const PAPERGURU_PROMPT_PACK_PATH =
  "skills/academic_writer/paperguru-prompt-pack";

function normalizePaperType(value: string | null): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function buildPaperTypeGuidance(paperType: string | null): string {
  const normalized = normalizePaperType(paperType);
  if (normalized.includes("survey") || normalized.includes("review")) {
    return "PaperGuru survey guidance: prioritize protocol, inclusion/exclusion counts, taxonomy, SOTA matrix, gap synthesis, and evidence-level warnings over method-style novelty claims.";
  }
  if (
    normalized.includes("benchmark") ||
    normalized.includes("dataset") ||
    normalized.includes("empirical")
  ) {
    return "PaperGuru benchmark/empirical guidance: center metric definitions, sample or dataset scope, baseline fairness, uncertainty where available, and never bold or claim wins from unverified results.";
  }
  if (
    normalized.includes("method") ||
    normalized.includes("model") ||
    normalized.includes("algorithm")
  ) {
    return "PaperGuru method guidance: keep one clean problem-gap-method-evidence arc, make the proposed module reproducible, and route result claims to real experiment artifacts.";
  }
  return "PaperGuru default guidance: adapt structure to field, venue, paper type, and evidence status; use conservative academic prose when intake is incomplete.";
}

function buildFigureGuidance(mode: string): string {
  return `PaperGuru figure rule: concept, architecture, taxonomy, and workflow figures may use ${mode}; result curves, ablations, datasets, qualitative examples, and failure cases require real project data or an explicit placeholder.`;
}

export function buildPaperGuruWritingGuidance(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): GuidanceContribution {
  const prepend: string[] = [];
  const append: string[] = [];
  const stage = params.currentStage ?? "";
  if (!["write", "review", "submit"].includes(stage)) {
    return { prepend, append };
  }

  const paperDesignIntake = normalizePaperDesignIntakeState(
    params.manifest?.paper_design_intake
  );
  const evidenceGuidance = buildPapernexusEvidenceGuidance(params, deps);
  prepend.push(...evidenceGuidance.prepend);
  append.push(...evidenceGuidance.append);

  if (params.role === "academic_writer") {
    prepend.push(summarizePaperDesignIntakeForPrompt(paperDesignIntake));
    append.push(
      `PaperGuru prompt pack: keep full prompts in ${PAPERGURU_PROMPT_PACK_PATH}; inject only this short guidance into workflow prompts.`
    );
    append.push(buildPaperTypeGuidance(paperDesignIntake.paperType));
    append.push(buildFigureGuidance(paperDesignIntake.figurePolicy.mode));
    append.push(
      "PaperGuru writing rule: no fabricated citations, BibTeX, numbers, datasets, patient/sample imagery, venues, DOIs, or unsupported novelty claims."
    );
  }

  if (params.role === "reviewer" || params.role === "cross-reviewer") {
    append.push(
      `PaperGuru review rule: use ${PAPERGURU_PROMPT_PACK_PATH}/references/editing-pass-prompts.md for anti-pattern and integrity checks, but do not modify citation or compile gates in this phase.`
    );
    append.push(
      "PaperGuru anti-pattern sweep: flag fake data figures, placeholder-as-final figures, unsupported headline claims, uncited prior-work claims, and one-sentence final prose paragraphs."
    );
  }

  return { prepend, append };
}
