import { asRecord, asStringArray, normalizeStage, pickNumber, pickString } from "../workflow-guard-core/coercion";

export type SurveyVisualEvidenceRow = {
  rowId: string;
  kind: "taxonomy" | "benchmark" | "tradeoff";
  label: string | null;
  evidence: string | null;
  caveat: string | null;
  sourceArtifacts: string[];
};

export type SurveyVisualCompilerState = {
  status: string;
  topic: string | null;
  evidenceRowsPath: string | null;
  insertionMapPath: string | null;
  assetIndexPath: string | null;
  taxonomyTablePath: string | null;
  benchmarkTablePath: string | null;
  taxonomyFigureSpecPath: string | null;
  benchmarkFigureSpecPath: string | null;
  rowCount: number;
  generatedAssetCount: number;
  pendingReason: string | null;
  lastUpdatedAt: string | null;
};

export const DEFAULT_SURVEY_VISUAL_EVIDENCE_ROWS_PATH =
  "academic_writer/SURVEY_VISUAL_EVIDENCE_ROWS.json";
export const DEFAULT_SURVEY_VISUAL_COMPILER_STATE_PATH =
  "academic_writer/SURVEY_VISUAL_COMPILER_STATE.json";
export const DEFAULT_SURVEY_VISUAL_INSERTION_MAP_PATH =
  "academic_writer/SURVEY_VISUAL_INSERTION_MAP.json";

export function normalizeSurveyVisualCompilerState(
  value: unknown
): SurveyVisualCompilerState {
  const record = asRecord(value) ?? {};
  return {
    status: normalizeStage(record.status) ?? "missing",
    topic: pickString(record, ["topic"]),
    evidenceRowsPath:
      pickString(record, ["evidenceRowsPath", "evidence_rows_path"]) ??
      DEFAULT_SURVEY_VISUAL_EVIDENCE_ROWS_PATH,
    insertionMapPath:
      pickString(record, ["insertionMapPath", "insertion_map_path"]) ??
      DEFAULT_SURVEY_VISUAL_INSERTION_MAP_PATH,
    assetIndexPath:
      pickString(record, ["assetIndexPath", "asset_index_path"]) ??
      "academic_writer/SURVEY_VISUAL_ASSET_INDEX.json",
    taxonomyTablePath:
      pickString(record, ["taxonomyTablePath", "taxonomy_table_path"]) ??
      "academic_writer/paper/tables/survey_taxonomy_overview.tex",
    benchmarkTablePath:
      pickString(record, ["benchmarkTablePath", "benchmark_table_path"]) ??
      "academic_writer/paper/tables/survey_benchmark_landscape.tex",
    taxonomyFigureSpecPath:
      pickString(record, ["taxonomyFigureSpecPath", "taxonomy_figure_spec_path"]) ??
      "academic_writer/paper/figures/survey_taxonomy_map.md",
    benchmarkFigureSpecPath:
      pickString(record, ["benchmarkFigureSpecPath", "benchmark_figure_spec_path"]) ??
      "academic_writer/paper/figures/survey_benchmark_comparison_map.md",
    rowCount: Math.max(0, Math.floor(pickNumber(record, ["rowCount", "row_count"]) ?? 0)),
    generatedAssetCount: Math.max(
      0,
      Math.floor(pickNumber(record, ["generatedAssetCount", "generated_asset_count"]) ?? 0)
    ),
    pendingReason: pickString(record, ["pendingReason", "pending_reason"]),
    lastUpdatedAt: pickString(record, ["lastUpdatedAt", "last_updated_at"]),
  };
}

export function serializeSurveyVisualCompilerState(
  value: SurveyVisualCompilerState
): Record<string, unknown> {
  return {
    status: value.status,
    topic: value.topic,
    evidence_rows_path: value.evidenceRowsPath,
    insertion_map_path: value.insertionMapPath,
    asset_index_path: value.assetIndexPath,
    taxonomy_table_path: value.taxonomyTablePath,
    benchmark_table_path: value.benchmarkTablePath,
    taxonomy_figure_spec_path: value.taxonomyFigureSpecPath,
    benchmark_figure_spec_path: value.benchmarkFigureSpecPath,
    row_count: value.rowCount,
    generated_asset_count: value.generatedAssetCount,
    pending_reason: value.pendingReason,
    last_updated_at: value.lastUpdatedAt,
  };
}

export function normalizeSurveyVisualEvidenceRows(value: unknown): SurveyVisualEvidenceRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const kind = normalizeStage(record.kind);
      return {
        rowId: pickString(record, ["rowId", "row_id"]) ?? `row-${index + 1}`,
        kind:
          kind === "taxonomy" || kind === "benchmark" || kind === "tradeoff"
            ? kind
            : "benchmark",
        label: pickString(record, ["label"]),
        evidence: pickString(record, ["evidence"]),
        caveat: pickString(record, ["caveat"]),
        sourceArtifacts: asStringArray(record.sourceArtifacts ?? record.source_artifacts),
      } satisfies SurveyVisualEvidenceRow;
    })
    .filter((entry): entry is SurveyVisualEvidenceRow => Boolean(entry));
}
