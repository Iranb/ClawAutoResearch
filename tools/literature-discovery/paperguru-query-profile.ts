import { buildBroadPaperSearchPlan } from "../research30/query-planner";
import type { BroadPaperSearchDepth } from "../research30/provider-contract";
import { asStringArray, uniqueStrings } from "../workflow-guard-core/coercion";

export type PaperGuruQueryIntent =
  | "broad_landscape"
  | "must_cite_anchor"
  | "venue_targeted"
  | "subfield_scan"
  | "method_axis"
  | "gap_citation_chasing";

export type PaperGuruQueryProfileEntry = {
  query_id: string;
  round: number;
  query_text: string;
  intent: PaperGuruQueryIntent;
  provider_route: "papernexus.literature_discovery";
  expected_use: string;
  requires_papernexus_import: boolean;
  source_artifacts: string[];
  year_filter: string | null;
  venue_filter: string | null;
};

export type PaperGuruQueryProfile = {
  schema_version: 1;
  topic: string;
  field: string | null;
  subfield: string | null;
  paper_type: string | null;
  venue: string | null;
  field_family: string;
  source_broad_plan_query_count: number;
  queries: PaperGuruQueryProfileEntry[];
};

function clean(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeFieldFamily(field: string | null, subfield: string | null): string {
  const text = `${field ?? ""} ${subfield ?? ""}`.toLowerCase();
  if (/medicine|clinical|biomed|biology|health|patient|cohort/.test(text)) {
    return "medicine";
  }
  if (/economics|social|policy|political|psychology|sociology/.test(text)) {
    return "social_science";
  }
  if (/chemistry|material|spectroscopy|catalyst|polymer/.test(text)) {
    return "chemistry_materials";
  }
  if (/history|humanities|literature|philosophy|archive/.test(text)) {
    return "humanities";
  }
  if (/\bnlp\b|language|linguistics|retrieval|llm/.test(text)) {
    return "nlp";
  }
  if (/vision|image|detection|segmentation|video|robotics/.test(text)) {
    return "computer_vision";
  }
  return "cs_ml";
}

function domainSeedQueries(params: {
  fieldFamily: string;
  topic: string;
  subfield: string;
  methodParadigm: string;
  noveltyModule: string;
  venue: string | null;
}): string[] {
  const venue = params.venue ?? "top venue";
  switch (params.fieldFamily) {
    case "medicine":
      return [
        `${params.subfield} ${params.methodParadigm} systematic review`,
        `${params.subfield} prediction model validation cohort study`,
        `${params.topic} confidence interval calibration clinical outcome`,
        `${params.noveltyModule} ${params.subfield} protocol guideline`,
      ];
    case "social_science":
      return [
        `${params.subfield} causal inference`,
        `${params.topic} difference in differences field experiment`,
        `${params.topic} robustness check effect size`,
        `${params.noveltyModule} identification strategy`,
      ];
    case "chemistry_materials":
      return [
        `${params.subfield} synthesis characterization`,
        `${params.topic} mechanism spectroscopy microscopy`,
        `${params.noveltyModule} stability benchmark performance`,
        `${params.methodParadigm} ${params.subfield} material property`,
      ];
    case "humanities":
      return [
        `${params.subfield} historiography`,
        `${params.topic} primary sources archive`,
        `${params.noveltyModule} critical debate`,
        `${params.topic} source analysis`,
      ];
    case "nlp":
      return [
        `${params.subfield} survey natural language processing`,
        `${params.methodParadigm} ${params.topic}`,
        `${params.noveltyModule} retrieval document benchmark`,
        `${venue} ${params.subfield} recent NLP`,
      ];
    case "computer_vision":
      return [
        `${params.subfield} survey deep learning`,
        `${params.topic} benchmark state of the art`,
        `${params.methodParadigm} ${params.topic}`,
        `${venue} ${params.subfield} recent computer vision`,
      ];
    default:
      return [
        `${params.subfield} survey machine learning`,
        `${params.topic} benchmark baseline`,
        `${params.methodParadigm} ${params.topic}`,
        `${venue} ${params.subfield} recent research`,
      ];
  }
}

function addQuery(
  queries: PaperGuruQueryProfileEntry[],
  seen: Set<string>,
  params: Omit<PaperGuruQueryProfileEntry, "query_id" | "provider_route">
): void {
  const queryText = clean(params.query_text);
  if (!queryText) {
    return;
  }
  const key = `${params.intent}:${queryText.toLowerCase()}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  queries.push({
    ...params,
    query_id: `pgq${queries.length + 1}`,
    query_text: queryText,
    provider_route: "papernexus.literature_discovery",
  });
}

export function buildPaperGuruQueryProfile(params: {
  topic: string;
  field?: string | null;
  subfield?: string | null;
  venue?: string | null;
  paperType?: string | null;
  methodParadigm?: string | null;
  noveltyModule?: string | null;
  baselineFamilies?: unknown;
  sourceArtifacts?: string[] | null;
  depth?: BroadPaperSearchDepth;
  maxQueries?: number | null;
}): PaperGuruQueryProfile {
  const topic = clean(params.topic) ?? "current research topic";
  const field = clean(params.field);
  const subfield = clean(params.subfield) ?? topic;
  const venue = clean(params.venue);
  const paperType = clean(params.paperType);
  const methodParadigm = clean(params.methodParadigm) ?? subfield;
  const noveltyModule = clean(params.noveltyModule) ?? "proposed method or lens";
  const baselineFamilies = uniqueStrings(asStringArray(params.baselineFamilies));
  const sourceArtifacts = uniqueStrings(params.sourceArtifacts ?? []);
  const fieldFamily = normalizeFieldFamily(field, subfield);
  const broadPlan = buildBroadPaperSearchPlan({
    topic,
    depth: params.depth ?? "default",
    maxQueries: Math.max(4, Math.min(12, params.maxQueries ?? 8)),
  });
  const queries: PaperGuruQueryProfileEntry[] = [];
  const seen = new Set<string>();

  addQuery(queries, seen, {
    round: 1,
    query_text: `${subfield} survey benchmark state of the art`,
    intent: "broad_landscape",
    expected_use: "Map field structure, recent surveys, benchmarks, and dominant paradigms.",
    requires_papernexus_import: true,
    source_artifacts: sourceArtifacts,
    year_filter: "recent",
    venue_filter: null,
  });
  addQuery(queries, seen, {
    round: 2,
    query_text: `${subfield} foundational seminal must cite`,
    intent: "must_cite_anchor",
    expected_use: "Recover reviewer-expected anchors and prior-work baselines.",
    requires_papernexus_import: true,
    source_artifacts: sourceArtifacts,
    year_filter: null,
    venue_filter: null,
  });
  addQuery(queries, seen, {
    round: 3,
    query_text: `${venue ?? "top venue"} ${subfield} recent`,
    intent: "venue_targeted",
    expected_use: "Check venue-adjacent framing, terminology, and reviewer expectations.",
    requires_papernexus_import: true,
    source_artifacts: sourceArtifacts,
    year_filter: "recent",
    venue_filter: venue,
  });
  addQuery(queries, seen, {
    round: 4,
    query_text: subfield,
    intent: "subfield_scan",
    expected_use: "Fill subfield-specific terminology and adjacent work.",
    requires_papernexus_import: true,
    source_artifacts: sourceArtifacts,
    year_filter: null,
    venue_filter: null,
  });
  for (const queryText of [
    `${methodParadigm} ${subfield}`,
    `${noveltyModule} ${subfield}`,
    ...baselineFamilies.map((baseline) => `${baseline} ${subfield}`),
  ]) {
    addQuery(queries, seen, {
      round: 5,
      query_text: queryText,
      intent: "method_axis",
      expected_use: "Compare method families, novelty modules, and fair baseline scope.",
      requires_papernexus_import: true,
      source_artifacts: sourceArtifacts,
      year_filter: null,
      venue_filter: null,
    });
  }
  for (const queryText of [
    `${topic} limitations open challenges`,
    `${topic} citation graph gap`,
    ...domainSeedQueries({
      fieldFamily,
      topic,
      subfield,
      methodParadigm,
      noveltyModule,
      venue,
    }),
    ...broadPlan.queries.map((query) => query.query),
  ]) {
    addQuery(queries, seen, {
      round: 6,
      query_text: queryText,
      intent: "gap_citation_chasing",
      expected_use: "Backfill missing claims, reviewer concerns, and PaperNexus graph gaps.",
      requires_papernexus_import: true,
      source_artifacts: sourceArtifacts,
      year_filter: null,
      venue_filter: null,
    });
  }

  return {
    schema_version: 1,
    topic,
    field,
    subfield,
    paper_type: paperType,
    venue,
    field_family: fieldFamily,
    source_broad_plan_query_count: broadPlan.queries.length,
    queries: queries.slice(0, params.maxQueries ?? 18),
  };
}
