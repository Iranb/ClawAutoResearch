import * as path from "node:path";
import { writeJsonEnsured } from "../workflow-guard-core/fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SectionScore = {
  section: string;
  argumentClarity: number;
  evidenceDensity: number;
  venueFit: number;
  average: number;
  needsRevision: boolean;
  notes: string[];
};

export type SectionScoresResult = {
  sections: SectionScore[];
  allAboveThreshold: boolean;
  threshold: number;
  scoredAt: string;
};

// ---------------------------------------------------------------------------
// Scoring heuristics
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 7.5;

const EVIDENCE_KEYWORDS = [
  "table", "figure", "fig.", "tab.", "experiment", "result",
  "evaluation", "ablation", "baseline", "benchmark", "dataset",
  "accuracy", "f1", "bleu", "rouge", "metric", "p-value",
  "significant", "outperform", "improve",
];

const CLARITY_PENALTIES = [
  { pattern: /\b(very|really|extremely|quite|rather|fairly)\b/gi, penalty: 0.3, note: "hedging/filler words" },
  { pattern: /\b(it is|there is|there are)\b/gi, penalty: 0.2, note: "weak constructions" },
  { pattern: /\b(etc\.?|and so on|and more)\b/gi, penalty: 0.4, note: "vague enumeration" },
];

function scoreArgumentClarity(content: string): { score: number; notes: string[] } {
  let score = 8.0;
  const notes: string[] = [];
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  if (sentences.length === 0) return { score: 3.0, notes: ["Empty section"] };

  // Penalize very long sentences (avg > 35 words)
  const avgWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;
  if (avgWords > 35) {
    score -= 1.0;
    notes.push(`Long average sentence length (${Math.round(avgWords)} words)`);
  }

  for (const { pattern, penalty, note } of CLARITY_PENALTIES) {
    const matches = content.match(pattern);
    if (matches && matches.length > 2) {
      score -= penalty * Math.min(matches.length, 5);
      notes.push(`${note} (${matches.length} instances)`);
    }
  }

  return { score: Math.max(1, Math.min(10, score)), notes };
}

function scoreEvidenceDensity(content: string): { score: number; notes: string[] } {
  const notes: string[] = [];
  const words = content.split(/\s+/).length;
  if (words < 20) return { score: 3.0, notes: ["Section too short for evidence assessment"] };

  let evidenceHits = 0;
  for (const keyword of EVIDENCE_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "gi");
    const matches = content.match(pattern);
    if (matches) evidenceHits += matches.length;
  }

  // Normalize by word count (per 100 words)
  const density = (evidenceHits / words) * 100;
  let score: number;
  if (density >= 3.0) {
    score = 9.0;
  } else if (density >= 1.5) {
    score = 7.5;
  } else if (density >= 0.5) {
    score = 6.0;
    notes.push("Low evidence density — consider adding more experimental references");
  } else {
    score = 4.0;
    notes.push("Very low evidence density — section lacks concrete evidence pointers");
  }

  return { score: Math.max(1, Math.min(10, score)), notes };
}

function scoreVenueFit(
  content: string,
  venue: string,
  section: string
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 7.5; // Default: neutral fit

  const normalized = venue.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sectionLower = section.toLowerCase();

  // NeurIPS/ICML: expect theoretical grounding
  if (/neurips|nips|icml/.test(normalized)) {
    if (sectionLower.includes("introduction") || sectionLower.includes("method")) {
      const hasTheory = /theorem|proposition|lemma|proof|bound|complexity/i.test(content);
      if (hasTheory) {
        score += 1.5;
        notes.push("Contains theoretical elements (good for NeurIPS/ICML)");
      } else {
        score -= 0.5;
        notes.push("NeurIPS/ICML values theoretical grounding in method sections");
      }
    }
  }

  // ICLR: expect reproducibility details
  if (/iclr/.test(normalized)) {
    if (sectionLower.includes("experiment") || sectionLower.includes("setup")) {
      const hasRepro = /seed|hyperparameter|learning rate|batch size|code.*available|reproducib/i.test(content);
      if (hasRepro) {
        score += 1.0;
      } else {
        score -= 1.0;
        notes.push("ICLR expects detailed reproducibility information in experiment sections");
      }
    }
  }

  // ACL: expect human evaluation
  if (/acl|emnlp|naacl/.test(normalized)) {
    if (sectionLower.includes("evaluation") || sectionLower.includes("result")) {
      const hasHuman = /human.*(eval|judge|annot)|inter.?annotator|kappa|agreement/i.test(content);
      if (!hasHuman) {
        score -= 0.5;
        notes.push("ACL venues typically expect human evaluation alongside automatic metrics");
      }
    }
  }

  return { score: Math.max(1, Math.min(10, score)), notes };
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function scorePaperSection(params: {
  sectionName: string;
  content: string;
  venue: string;
}): SectionScore {
  const { sectionName, content, venue } = params;
  const clarity = scoreArgumentClarity(content);
  const evidence = scoreEvidenceDensity(content);
  const fit = scoreVenueFit(content, venue, sectionName);
  const average = (clarity.score + evidence.score + fit.score) / 3;

  return {
    section: sectionName,
    argumentClarity: Math.round(clarity.score * 10) / 10,
    evidenceDensity: Math.round(evidence.score * 10) / 10,
    venueFit: Math.round(fit.score * 10) / 10,
    average: Math.round(average * 10) / 10,
    needsRevision: average < DEFAULT_THRESHOLD,
    notes: [...clarity.notes, ...evidence.notes, ...fit.notes],
  };
}

// ---------------------------------------------------------------------------
// Batch scoring + JSON output
// ---------------------------------------------------------------------------

export async function scorePaperSections(params: {
  projectRoot: string;
  sections: Array<{ name: string; content: string }>;
  venue: string;
  outputPath?: string | null;
  threshold?: number;
}): Promise<SectionScoresResult> {
  const threshold = params.threshold ?? DEFAULT_THRESHOLD;
  const sections = params.sections.map((s) =>
    scorePaperSection({
      sectionName: s.name,
      content: s.content,
      venue: params.venue,
    })
  );
  const allAboveThreshold = sections.every((s) => s.average >= threshold);
  const result: SectionScoresResult = {
    sections,
    allAboveThreshold,
    threshold,
    scoredAt: new Date().toISOString(),
  };

  const outputPath = params.outputPath ?? "academic_writer/SECTION_SCORES.json";
  const resolvedPath = path.join(path.resolve(params.projectRoot), outputPath);
  await writeJsonEnsured(resolvedPath, result);

  return result;
}
