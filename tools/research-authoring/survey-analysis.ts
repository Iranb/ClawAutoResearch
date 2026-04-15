import {
  materializeSurveyReviewDiagnostics,
} from "../survey-review-diagnostics.ts";
import {
  nowIso,
  readProjectManifest,
  readProjectText,
  writeProjectJson,
  writeProjectText,
} from "../research-contracts/core/project-io.ts";
import { normalizeSurveyReviewState } from "../workflow-guard-state/survey-review.ts";
import { materializeFairCompareMatrix } from "../research-evidence/fair-compare.ts";

function extractMatrixMethods(matrixText: string): string[] {
  const methods = new Set<string>();
  for (const line of matrixText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cells = trimmed
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (cells.length >= 2 && !/^---+$/.test(cells[0].replace(/:/g, "")) && cells[0].toLowerCase() !== "method") {
      methods.add(cells[0]);
    }
  }
  return [...methods];
}

export async function materializeSurveyAnalysis(params: {
  projectRoot: string;
  outputReportPath?: string;
  outputIndexPath?: string;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const surveyState = normalizeSurveyReviewState(manifest.survey_review);
  const diagnostics = await materializeSurveyReviewDiagnostics({
    projectRoot: params.projectRoot,
    state: surveyState,
  });
  const [briefText, reviewText, matrixText] = await Promise.all([
    readProjectText(params.projectRoot, surveyState.surveyBriefPath),
    readProjectText(params.projectRoot, surveyState.literatureReviewPath),
    readProjectText(params.projectRoot, surveyState.sotaMatrixPath),
  ]);
  const methods = extractMatrixMethods(matrixText ?? "");
  const fairCompareRows = await materializeFairCompareMatrix({
    projectRoot: params.projectRoot,
    matrixText: matrixText ?? "",
  }).catch(() => []);
  const claims = `${briefText ?? ""}\n${reviewText ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.startsWith("1)") || line.startsWith("1."))
    .map((line, index) => ({
      claimId: `survey-claim-${index + 1}`,
      text: line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""),
      supportingMethods: methods.filter((method) =>
        line.toLowerCase().includes(method.toLowerCase())
      ),
    }));
  const reportLines = [
    "# Survey Comparability Report",
    "",
    `- Ready: ${diagnostics.ready ? "yes" : "no"}`,
    `- Coverage: ${diagnostics.coverage.status}`,
    `- Taxonomy: ${diagnostics.taxonomyStability.status}`,
    `- Benchmark alignment: ${diagnostics.benchmarkAlignment.status}`,
    `- Fair compare rows: ${fairCompareRows.length}`,
    "",
    "## Warnings",
    ...diagnostics.warnings.map((warning) => `- ${warning}`),
    "",
    "## Blocking issues",
    ...diagnostics.blockingIssues.map((issue) => `- ${issue}`),
  ];
  await writeProjectText(
    params.projectRoot,
    params.outputReportPath ?? "academic_writer/SURVEY_COMPARABILITY_REPORT.md",
    `${reportLines.join("\n")}\n`
  );
  await writeProjectJson(
    params.projectRoot,
    params.outputIndexPath ?? "researcher/SOURCE_TO_CLAIM_INDEX.json",
    {
      schemaVersion: 1,
      generatedAt: nowIso(),
      methods,
      fairCompareRows,
      claims,
    }
  );
  return {
    diagnostics,
    methodCount: methods.length,
    claimCount: claims.length,
  };
}
