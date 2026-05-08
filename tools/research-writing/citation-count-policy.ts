export const MIN_CONFERENCE_PAPER_CITATION_COUNT = 30;
export const MIN_JOURNAL_PAPER_CITATION_COUNT = 40;
export const MIN_SURVEY_PAPER_CITATION_COUNT = 50;

export type CitationPaperMode = "conference" | "journal" | "survey";

function normalizeCitationPaperMode(value: unknown): CitationPaperMode | null {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (!normalized) {
    return null;
  }
  if (
    [
      "conference",
      "conf",
      "conference_9p_2refs",
      "conference_9_body_2_refs",
    ].includes(normalized)
  ) {
    return "conference";
  }
  if (
    ["journal", "journal_12p_2refs", "journal_12_body_2_refs"].includes(
      normalized
    )
  ) {
    return "journal";
  }
  if (
    [
      "survey",
      "survey_review",
      "survey_paper",
      "review_paper",
      "literature_review",
    ].includes(normalized)
  ) {
    return "survey";
  }
  return null;
}

function normalizeCitationCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

export function minimumCitationCountForPaperMode(value: unknown): number {
  const paperMode = normalizeCitationPaperMode(value);
  if (paperMode === "survey") {
    return MIN_SURVEY_PAPER_CITATION_COUNT;
  }
  if (paperMode === "journal") {
    return MIN_JOURNAL_PAPER_CITATION_COUNT;
  }
  if (paperMode === "conference") {
    return MIN_CONFERENCE_PAPER_CITATION_COUNT;
  }
  return 0;
}

export function minimumCitationCountForPaperModeHints(
  values: readonly unknown[]
): number {
  for (const value of values) {
    const minimumCitationCount = minimumCitationCountForPaperMode(value);
    if (minimumCitationCount > 0) {
      return minimumCitationCount;
    }
  }
  return 0;
}

export function effectiveMinimumCitationCount(params: {
  configuredMinimumCitationCount?: unknown;
  paperMode?: unknown;
  paperModeHints?: readonly unknown[];
  fallbackMinimumCitationCount?: unknown;
}): number {
  const modeMinimumCitationCount = params.paperModeHints
    ? minimumCitationCountForPaperModeHints(params.paperModeHints)
    : minimumCitationCountForPaperMode(params.paperMode);
  return Math.max(
    normalizeCitationCount(params.configuredMinimumCitationCount),
    modeMinimumCitationCount,
    normalizeCitationCount(params.fallbackMinimumCitationCount)
  );
}
