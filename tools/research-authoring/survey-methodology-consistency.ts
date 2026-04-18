import * as path from "node:path";

import { asRecord, pickString } from "../workflow-guard-core/coercion";
import { readJsonIfExists, readTextIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review";

export const DEFAULT_SURVEY_METHODOLOGY_CONSISTENCY_PATH =
  "researcher/SURVEY_METHODOLOGY_CONSISTENCY.json";

function extractFirstCount(text: string | null | undefined): number | null {
  if (!text) {
    return null;
  }
  const match = text.match(/\b(\d{1,4})\s+(papers?|works?|studies|articles|preprints?)\b/i);
  return match ? Number(match[1]) : null;
}

function extractYearRange(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const match = text.match(/\b(20\d{2})\s*[–-]\s*(20\d{2})\b/);
  return match ? `${match[1]}-${match[2]}` : null;
}

export async function materializeSurveyMethodologyConsistency(params: {
  projectRoot: string;
}): Promise<{
  ready: boolean;
  path: string;
  blockingIssues: string[];
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const survey = normalizeSurveyReviewState(manifest.survey_review);

  const reviewProtocolPath =
    resolveProjectArtifactPath(params.projectRoot, survey.reviewProtocolPath) ?? "";
  const includedPath =
    resolveProjectArtifactPath(params.projectRoot, survey.includedPapersPath) ?? "";
  const excludedPath =
    resolveProjectArtifactPath(params.projectRoot, survey.excludedPapersPath) ?? "";
  const abstractPath = path.join(
    params.projectRoot,
    "academic_writer",
    "paper",
    "sections",
    "abstract.tex"
  );
  const introPath = path.join(
    params.projectRoot,
    "academic_writer",
    "paper",
    "sections",
    "introduction.tex"
  );
  const scopePath = path.join(
    params.projectRoot,
    "academic_writer",
    "paper",
    "sections",
    "scope_and_protocol.tex"
  );

  const [reviewProtocol, includedJson, excludedJson, abstractText, introText, scopeText] =
    await Promise.all([
      readTextIfExists(reviewProtocolPath),
      readJsonIfExists<Record<string, unknown>>(includedPath),
      readJsonIfExists<Record<string, unknown>>(excludedPath),
      readTextIfExists(abstractPath),
      readTextIfExists(introPath),
      readTextIfExists(scopePath),
    ]);

  const includedCount =
    Array.isArray(includedJson?.papers)
      ? includedJson.papers.length
      : Array.isArray(includedJson?.included)
        ? includedJson.included.length
        : 0;
  const excludedCount =
    Array.isArray(excludedJson?.papers)
      ? excludedJson.papers.length
      : Array.isArray(excludedJson?.excluded)
        ? excludedJson.excluded.length
        : 0;

  const abstractCount = extractFirstCount(abstractText);
  const introCount = extractFirstCount(introText);
  const protocolCount = extractFirstCount(scopeText ?? reviewProtocol);
  const counts = [abstractCount, introCount, protocolCount].filter(
    (value): value is number => typeof value === "number"
  );

  const abstractYears = extractYearRange(abstractText);
  const introYears = extractYearRange(introText);
  const scopeYears = extractYearRange(scopeText);
  const protocolYears = extractYearRange(reviewProtocol);
  const normalizedManifestYears = survey.years?.replace(/[–—]/g, "-") ?? null;
  const yearValues = [abstractYears, introYears, scopeYears, protocolYears, normalizedManifestYears].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  const blockingIssues: string[] = [];
  if (counts.length >= 2 && new Set(counts).size > 1) {
    blockingIssues.push(
      `Survey paper counts disagree across manuscript/protocol artifacts: ${counts.join(", ")}.`
    );
  }
  if (protocolCount != null && includedCount > 0 && protocolCount !== includedCount) {
    blockingIssues.push(
      `Protocol/manuscript paper count (${protocolCount}) disagrees with INCLUDED_PAPERS.json (${includedCount}).`
    );
  }
  if (yearValues.length >= 2 && new Set(yearValues).size > 1) {
    blockingIssues.push(
      `Survey year range drifts across artifacts: ${Array.from(new Set(yearValues)).join(", ")}.`
    );
  }
  const combinedManuscript = [abstractText, introText, scopeText].filter(Boolean).join("\n");
  if (/\bpublished papers\b/i.test(combinedManuscript) && /\barxiv\b/i.test(JSON.stringify({
    included: includedJson,
    excluded: excludedJson,
  }))) {
    blockingIssues.push(
      'The manuscript says "published papers" but the included set still references arXiv-style preprints.'
    );
  }

  const resultPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_SURVEY_METHODOLOGY_CONSISTENCY_PATH
  );
  if (!resultPath) {
    throw new Error("Unable to resolve survey methodology consistency path.");
  }
  await writeJsonEnsured(resultPath, {
    generated_at: new Date().toISOString(),
    survey_years: normalizedManifestYears,
    included_count: includedCount,
    excluded_count: excludedCount,
    abstract_count: abstractCount,
    introduction_count: introCount,
    protocol_count: protocolCount,
    abstract_years: abstractYears,
    introduction_years: introYears,
    scope_years: scopeYears,
    review_protocol_years: protocolYears,
    blocking_issues: blockingIssues,
    ready: blockingIssues.length === 0,
  });
  manifest.survey_methodology_consistency = {
    status: blockingIssues.length === 0 ? "ready" : "blocked",
    path: DEFAULT_SURVEY_METHODOLOGY_CONSISTENCY_PATH,
    blocking_issues: blockingIssues,
    included_count: includedCount,
    excluded_count: excludedCount,
    years: normalizedManifestYears,
    last_updated_at: new Date().toISOString(),
  };
  await writeJsonEnsured(manifestPath, manifest);

  return {
    ready: blockingIssues.length === 0,
    path: DEFAULT_SURVEY_METHODOLOGY_CONSISTENCY_PATH,
    blockingIssues,
  };
}
