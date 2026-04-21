import * as path from "node:path";
import {
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  collectSurveyBackgroundReferenceLines,
  collectSurveyEntries,
} from "../survey-review-artifacts";

export const DEFAULT_SURVEY_STORYLINE_PACKET_PATH =
  "academic_writer/SURVEY_STORYLINE_PACKET.json";
export const DEFAULT_SURVEY_STORYLINE_MEMO_PATH =
  "academic_writer/SURVEY_STORYLINE_PACKET.md";

const DEFAULT_SURVEY_BODY_SECTION_ORDER = [
  "scope_and_protocol",
  "taxonomy",
  "evidence_synthesis",
  "benchmark_landscape",
  "open_problems",
] as const;

export type SurveyStorylineStrategyId =
  | "taxonomy_first"
  | "evaluation_crisis_first"
  | "contradiction_first"
  | "historical_evolution_first"
  | "application_split_first";

export type SurveyBodySectionId = (typeof DEFAULT_SURVEY_BODY_SECTION_ORDER)[number];

export type SurveyStorylineSectionPlan = {
  sectionId: SurveyBodySectionId;
  prompt: string;
  objective: string;
  coreMessage: string;
  evidenceClusterIds: string[];
  anchorIds: string[];
  tensionIds: string[];
};

export type SurveyStorylineEvidenceCluster = {
  clusterId: string;
  label: string;
  kind: "scope" | "taxonomy" | "evidence" | "benchmark" | "gap" | "disagreement";
  summary: string;
  anchorIds: string[];
};

export type SurveyStorylineTension = {
  tensionId: string;
  label: string;
  signal: string;
  source: string;
};

export type SurveyStorylineCandidate = {
  strategyId: SurveyStorylineStrategyId;
  label: string;
  score: number;
  rationale: string[];
  bodySectionOrder: SurveyBodySectionId[];
  intellectualCenterSection: SurveyBodySectionId;
  thesis: string;
  openingMove: string;
};

export type SurveyStorylinePacket = {
  schemaVersion: number;
  topic: string | null;
  selectedStrategyId: SurveyStorylineStrategyId;
  selectedStrategyLabel: string;
  selectedStrategyRationale: string[];
  thesis: string;
  openingMove: string;
  organizingQuestion: string;
  intellectualCenterSection: SurveyBodySectionId;
  bodySectionOrder: SurveyBodySectionId[];
  fullSectionOrder: string[];
  primaryTensions: SurveyStorylineTension[];
  evidenceClusters: SurveyStorylineEvidenceCluster[];
  sectionPlans: SurveyStorylineSectionPlan[];
  candidates: SurveyStorylineCandidate[];
  generatedAt: string;
};

export type SurveyStorylineSignals = {
  topic: string;
  surveyBriefText: string | null;
  literatureReviewText: string | null;
  sotaMatrixText: string | null;
  gapSynthesisText: string | null;
  coverageSummaryText: string | null;
  reviewProtocolText: string | null;
  familyLines: string[];
  benchmarkLines: string[];
  benchmarkPressureLines: string[];
  gapLines: string[];
  coverageLines: string[];
  backgroundLines: string[];
  contradictionLines: string[];
  includedLabels: string[];
};

export type SurveyStorylineSelection = {
  selectedStrategyId: SurveyStorylineStrategyId;
  selectedStrategyRationale: string[];
  selectionMode: "heuristic" | "reviewer_judged" | "learned_shadow" | "learned_primary";
  selectionConfidence: number | null;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function sentenceCase(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function slugify(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function normalizeSectionId(value: string | null | undefined): string | null {
  const normalized = slugify(value, "");
  return normalized ? normalized.replace(/-/g, "_") : null;
}

function collectMarkdownSignalLines(rawText: string | null | undefined, limit = 8): string[] {
  if (!rawText) {
    return [];
  }
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !/^[-*_]{3,}$/.test(line)
    )
    .map((line) => line.replace(/^[-*+]\s+/, ""))
    .filter(Boolean);
  return uniqueStrings(lines).slice(0, limit);
}

function extractSectionListItems(text: string | null | undefined, headingKeywords: string[]): string[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const items: string[] = [];
  let capture = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,6}\s+/, "").toLowerCase();
      capture = headingKeywords.some((keyword) => heading.includes(keyword));
      continue;
    }
    if (!capture) {
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      items.push(trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim());
      continue;
    }
    if (!trimmed) {
      continue;
    }
    if (items.length === 0) {
      items.push(trimmed);
    }
  }
  return uniqueStrings(items);
}

function collectMarkdownTables(text: string | null | undefined): Array<{
  header: string[];
  rows: string[][];
}> {
  const lines = String(text ?? "").split(/\r?\n/);
  const tables: Array<{ header: string[]; rows: string[][] }> = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]?.trim() ?? "";
    const dividerLine = lines[index + 1]?.trim() ?? "";
    if (!headerLine.includes("|") || !dividerLine.includes("|")) {
      continue;
    }
    if (!/^[:|\-\s]+$/.test(dividerLine.replace(/\|/g, ""))) {
      continue;
    }
    const header = headerLine
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex]?.trim() ?? "";
      if (!rowLine.includes("|")) {
        break;
      }
      const row = rowLine
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (row.length === 0) {
        break;
      }
      rows.push(row);
    }
    tables.push({ header, rows });
    index += rows.length + 1;
  }
  return tables;
}

function countKeywordHits(text: string, patterns: RegExp[]): number {
  const normalized = text.toLowerCase();
  return patterns.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);
}

function firstMeaningfulLine(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const line = collectMarkdownSignalLines(value, 1)[0] ?? null;
    if (line) {
      return line;
    }
  }
  return null;
}

function sectionTitle(sectionId: SurveyBodySectionId): string {
  switch (sectionId) {
    case "scope_and_protocol":
      return "Scope and Protocol";
    case "taxonomy":
      return "Taxonomy";
    case "evidence_synthesis":
      return "Evidence Synthesis";
    case "benchmark_landscape":
      return "Benchmark Landscape";
    case "open_problems":
      return "Open Problems";
  }
}

function strategyLabel(strategyId: SurveyStorylineStrategyId): string {
  switch (strategyId) {
    case "taxonomy_first":
      return "Taxonomy-first";
    case "evaluation_crisis_first":
      return "Evaluation-crisis-first";
    case "contradiction_first":
      return "Contradiction-first";
    case "historical_evolution_first":
      return "Historical-evolution-first";
    case "application_split_first":
      return "Application-split-first";
  }
}

function asBodySectionOrder(value: string[]): SurveyBodySectionId[] {
  const allowed = new Set<string>(DEFAULT_SURVEY_BODY_SECTION_ORDER);
  return value.filter((entry): entry is SurveyBodySectionId => allowed.has(entry));
}

function buildSectionPrompt(params: {
  sectionId: SurveyBodySectionId;
  topic: string;
  strategyId: SurveyStorylineStrategyId;
  thesis: string;
}): { prompt: string; objective: string } {
  switch (params.sectionId) {
    case "scope_and_protocol":
      return {
        prompt: `What scope, inclusion protocol, and comparison boundaries define this survey on ${params.topic}?`,
        objective:
          "Open with the survey boundary conditions so every later synthesis claim inherits a visible scope contract.",
      };
    case "taxonomy":
      return {
        prompt:
          params.strategyId === "evaluation_crisis_first"
            ? `Which method families in ${params.topic} stay meaningful once benchmark comparability constraints are made explicit?`
            : params.strategyId === "application_split_first"
              ? `Which task or application splits best organize the field around ${params.topic}?`
              : `How should ${params.topic} be organized into stable families, themes, or field partitions?`,
        objective:
          params.strategyId === "contradiction_first"
            ? "Use taxonomy to resolve where families blur or hide contradictory evidence, not just to label clusters."
            : "Turn the literature into a durable organizing lens rather than a paper inventory.",
      };
    case "evidence_synthesis":
      return {
        prompt:
          params.strategyId === "contradiction_first"
            ? `Where do papers in ${params.topic} genuinely disagree, and what comparative evidence survives those disagreements?`
            : `What does the comparative evidence actually support across the major families in ${params.topic}?`,
        objective:
          "Make the survey teach trade-offs, contradictions, and supportable synthesis claims instead of stacking summaries.",
      };
    case "benchmark_landscape":
      return {
        prompt:
          params.strategyId === "evaluation_crisis_first"
            ? `Which benchmark and metric comparisons in ${params.topic} are fair, and where does evaluation drift break comparability?`
            : `Which benchmark and evaluation patterns in ${params.topic} are genuinely comparable, and where are they not?`,
        objective:
          "Keep benchmark claims honest about protocol mismatch, metric drift, and non-comparable settings.",
      };
    case "open_problems":
      return {
        prompt: `What unresolved problems, disagreement zones, or field bottlenecks remain once the story "${params.thesis}" is made explicit?`,
        objective:
          "Close the manuscript with evidence-backed open problems that fall naturally out of the selected thesis, not generic future work filler.",
      };
  }
}

function buildStrategyThesis(params: {
  strategyId: SurveyStorylineStrategyId;
  topic: string;
}): { thesis: string; openingMove: string; intellectualCenterSection: SurveyBodySectionId } {
  switch (params.strategyId) {
    case "evaluation_crisis_first":
      return {
        thesis: `For ${params.topic}, the decisive organizing question is which benchmark and metric comparisons are actually fair; method families only become meaningful after those comparability boundaries are explicit.`,
        openingMove:
          "Lead with the evaluation contract and use it to explain why some apparent gains cannot live in the same story until protocol boundaries are made explicit.",
        intellectualCenterSection: "benchmark_landscape",
      };
    case "contradiction_first":
      return {
        thesis: `For ${params.topic}, the real survey value is not another clean paper list, but making visible where results disagree, family boundaries blur, and evidence stops being directly comparable.`,
        openingMove:
          "Lead with the strongest contradiction or non-comparable split, then rebuild the field structure from that tension.",
        intellectualCenterSection: "evidence_synthesis",
      };
    case "historical_evolution_first":
      return {
        thesis: `For ${params.topic}, the field is best understood as an evolution from earlier families to later hybrids, with each transition redefining what counts as progress and which benchmarks matter.`,
        openingMove:
          "Lead with the historical turn points that changed the field's objectives, then use those transitions to justify the taxonomy.",
        intellectualCenterSection: "taxonomy",
      };
    case "application_split_first":
      return {
        thesis: `For ${params.topic}, the most reliable organizing lens is the split between problem settings and application constraints; method families only make sense once those task boundaries are visible.`,
        openingMove:
          "Lead with the problem-setting split that readers actually use to navigate the field, then map families inside each setting.",
        intellectualCenterSection: "taxonomy",
      };
    case "taxonomy_first":
    default:
      return {
        thesis: `For ${params.topic}, the cleanest story is which method families exist, where their boundaries blur, and what comparative evidence each family actually supports under explicit scope constraints.`,
        openingMove:
          "Lead with the stable field families and use them as the reader's map for every later comparison, benchmark warning, and open problem.",
        intellectualCenterSection: "taxonomy",
      };
  }
}

export function buildSurveyStorylineCandidates(params: {
  topic: string;
  familyLines: string[];
  benchmarkLines: string[];
  benchmarkPressureLines?: string[];
  gapLines: string[];
  contradictionLines: string[];
  coverageLines: string[];
  backgroundLines: string[];
  litReviewText: string | null;
  surveyBriefText: string | null;
  reviewProtocolText: string | null;
}): SurveyStorylineCandidate[] {
  const combinedText = [
    params.topic,
    params.familyLines.join("\n"),
    params.benchmarkLines.join("\n"),
    params.gapLines.join("\n"),
    params.contradictionLines.join("\n"),
    params.coverageLines.join("\n"),
    params.backgroundLines.join("\n"),
    params.litReviewText ?? "",
    params.surveyBriefText ?? "",
    params.reviewProtocolText ?? "",
  ]
    .join("\n")
    .toLowerCase();

  const contradictionSignalCount =
    params.contradictionLines.length +
    countKeywordHits(combinedText, [
      /\bcontradict/i,
      /\binconsistent/i,
      /\bmixed/i,
      /\btrade[-\s]?off/i,
      /\bnon[-\s]?comparable/i,
      /\bnot comparable/i,
      /\bboundary/i,
      /\bblur/i,
      /\boverlap/i,
      /\bcaveat/i,
    ]);
  const benchmarkSignalCount =
    (params.benchmarkPressureLines?.length ?? params.benchmarkLines.length) +
    countKeywordHits(combinedText, [
      /\bbenchmark/i,
      /\bdataset/i,
      /\bmetric/i,
      /\bprotocol/i,
      /\bfair/i,
      /\bcompar/i,
      /\bsetting/i,
      /\bevaluation/i,
    ]);
  const historicalSignalCount = countKeywordHits(combinedText, [
    /\bevolution/i,
    /\btimeline/i,
    /\bera/i,
    /\bgeneration/i,
    /\bearly/i,
    /\brecent/i,
    /\bshift/i,
    /\btransition/i,
  ]);
  const applicationSignalCount = countKeywordHits(combinedText, [
    /\bapplication/i,
    /\bscenario/i,
    /\bsetting/i,
    /\btask/i,
    /\bdownstream/i,
    /\bdomain/i,
    /\bopen world/i,
    /\bcategory discovery/i,
    /\bzero[-\s]?shot/i,
  ]);

  const candidates: Array<SurveyStorylineCandidate & { tieBreak: number }> = [
    {
      strategyId: "taxonomy_first",
      label: strategyLabel("taxonomy_first"),
      score:
        6 +
        params.familyLines.length * 3 +
        (params.familyLines.length >= 3 ? 2 : 0) +
        (params.coverageLines.length > 0 ? 1 : 0),
      rationale: uniqueStrings([
        params.familyLines[0]
          ? `Stable family signals already exist: ${params.familyLines[0]}`
          : null,
        params.familyLines[1]
          ? `Multiple organizing themes are visible: ${params.familyLines[1]}`
          : null,
        params.coverageLines[0]
          ? `Coverage notes can support a family-centered survey without hiding scope boundaries: ${params.coverageLines[0]}`
          : null,
      ]),
      bodySectionOrder: [...DEFAULT_SURVEY_BODY_SECTION_ORDER],
      ...buildStrategyThesis({
        strategyId: "taxonomy_first",
        topic: params.topic,
      }),
      tieBreak: 5,
    },
    {
      strategyId: "evaluation_crisis_first",
      label: strategyLabel("evaluation_crisis_first"),
      score:
        2 +
        benchmarkSignalCount * 2 +
        (params.benchmarkLines.length >= 3 ? 3 : 0) +
        (contradictionSignalCount > 0 ? 1 : 0),
      rationale: uniqueStrings([
        params.benchmarkLines[0]
          ? `Benchmark comparability is already a visible organizing tension: ${(params.benchmarkPressureLines ?? params.benchmarkLines)[0]}`
          : null,
        (params.benchmarkPressureLines ?? params.benchmarkLines)[1]
          ? `Protocol-level comparison pressure is strong enough to justify an evaluation-led opening: ${(params.benchmarkPressureLines ?? params.benchmarkLines)[1]}`
          : null,
      ]),
      bodySectionOrder: [
        "scope_and_protocol",
        "benchmark_landscape",
        "taxonomy",
        "evidence_synthesis",
        "open_problems",
      ],
      ...buildStrategyThesis({
        strategyId: "evaluation_crisis_first",
        topic: params.topic,
      }),
      tieBreak: 4,
    },
    {
      strategyId: "contradiction_first",
      label: strategyLabel("contradiction_first"),
      score:
        1 +
        contradictionSignalCount * 2 +
        params.backgroundLines.length +
        (params.gapLines.length > 0 ? 1 : 0),
      rationale: uniqueStrings([
        params.contradictionLines[0]
          ? `The survey packet already contains a disagreement zone worth leading with: ${params.contradictionLines[0]}`
          : null,
        params.backgroundLines[0]
          ? `Boundary references suggest that the field story is currently unstable at the edges: ${params.backgroundLines[0]}`
          : null,
      ]),
      bodySectionOrder: [
        "scope_and_protocol",
        "evidence_synthesis",
        "taxonomy",
        "benchmark_landscape",
        "open_problems",
      ],
      ...buildStrategyThesis({
        strategyId: "contradiction_first",
        topic: params.topic,
      }),
      tieBreak: 3,
    },
    {
      strategyId: "historical_evolution_first",
      label: strategyLabel("historical_evolution_first"),
      score: 1 + historicalSignalCount * 2 + Math.min(2, params.familyLines.length),
      rationale: uniqueStrings([
        historicalSignalCount > 0
          ? "The topic language contains explicit evolution / transition signals that could support a history-shaped opening."
          : null,
        params.familyLines[0]
          ? `The current family set looks like it may represent successive waves, not just parallel buckets: ${params.familyLines[0]}`
          : null,
      ]),
      bodySectionOrder: [...DEFAULT_SURVEY_BODY_SECTION_ORDER],
      ...buildStrategyThesis({
        strategyId: "historical_evolution_first",
        topic: params.topic,
      }),
      tieBreak: 2,
    },
    {
      strategyId: "application_split_first",
      label: strategyLabel("application_split_first"),
      score: 1 + applicationSignalCount * 2 + Math.min(2, params.backgroundLines.length),
      rationale: uniqueStrings([
        applicationSignalCount > 0
          ? "The topic language suggests multiple settings or downstream problem splits that may organize the survey better than raw method families."
          : null,
        params.backgroundLines[0]
          ? `Boundary references already point to adjacent settings that need to stay explicit: ${params.backgroundLines[0]}`
          : null,
      ]),
      bodySectionOrder: [...DEFAULT_SURVEY_BODY_SECTION_ORDER],
      ...buildStrategyThesis({
        strategyId: "application_split_first",
        topic: params.topic,
      }),
      tieBreak: 1,
    },
  ];

  return candidates
    .sort((left, right) => right.score - left.score || right.tieBreak - left.tieBreak)
    .map(({ tieBreak: _unused, ...candidate }) => candidate);
}

function collectEntryLabels(value: unknown, keys: string[], limit: number): string[] {
  return uniqueStrings(
    collectSurveyEntries(value, keys)
      .map((entry) =>
        String(
          entry.title ??
            entry.paper_title ??
            entry.paperTitle ??
            entry.name ??
            entry.canonical_id ??
            entry.canonicalId ??
            entry.paper_id ??
            entry.paperId ??
            entry.arxiv ??
            entry.arxiv_id ??
            entry.doi ??
            ""
        ).trim()
      )
      .filter(Boolean)
  ).slice(0, limit);
}

function collectSotaEvidenceLines(sotaMatrixText: string | null | undefined, limit: number): string[] {
  const tables = collectMarkdownTables(sotaMatrixText);
  const evidenceLines: string[] = [];
  for (const table of tables) {
    const header = table.header.map((entry) => entry.toLowerCase());
    const methodIndex = header.findIndex((entry) => /\bmethod\b|\bpaper\b/.test(entry));
    const datasetIndex = header.findIndex((entry) => /\bdataset\b|\bbenchmark\b/.test(entry));
    const metricIndex = header.findIndex((entry) => /\bmetric\b|\bscore\b|\baccuracy\b|\bf1\b|\bmAP\b|\bauc\b/i.test(entry));
    for (const row of table.rows) {
      const method = methodIndex >= 0 ? row[methodIndex] : row[0];
      const dataset = datasetIndex >= 0 ? row[datasetIndex] : null;
      const metric = metricIndex >= 0 ? row[metricIndex] : null;
      const summary = [method, dataset, metric].filter(Boolean).join(" | ");
      if (summary) {
        evidenceLines.push(summary);
      }
    }
  }
  return uniqueStrings(evidenceLines).slice(0, limit);
}

function buildSectionPlans(params: {
  topic: string;
  selected: SurveyStorylineCandidate;
  evidenceClusters: SurveyStorylineEvidenceCluster[];
  tensions: SurveyStorylineTension[];
}): SurveyStorylineSectionPlan[] {
  const clusterByKind = new Map(
    params.evidenceClusters.map((cluster) => [cluster.kind, cluster] as const)
  );
  return params.selected.bodySectionOrder.map((sectionId) => {
    const prompt = buildSectionPrompt({
      sectionId,
      topic: params.topic,
      strategyId: params.selected.strategyId,
      thesis: params.selected.thesis,
    });
    const relatedKinds =
      sectionId === "scope_and_protocol"
        ? ["scope"]
        : sectionId === "taxonomy"
          ? ["taxonomy", "disagreement"]
          : sectionId === "evidence_synthesis"
            ? ["evidence", "disagreement"]
            : sectionId === "benchmark_landscape"
              ? ["benchmark", "disagreement"]
              : ["gap", "disagreement"];
    const evidenceClusters = relatedKinds
      .map((kind) => clusterByKind.get(kind as SurveyStorylineEvidenceCluster["kind"]))
      .filter((cluster): cluster is SurveyStorylineEvidenceCluster => Boolean(cluster));
    const anchorIds = uniqueStrings(
      evidenceClusters.flatMap((cluster) => cluster.anchorIds)
    ).slice(0, 6);
    return {
      sectionId,
      prompt: prompt.prompt,
      objective: prompt.objective,
      coreMessage:
        sentenceCase(
          evidenceClusters[0]?.summary ?? params.selected.thesis,
          `${sectionTitle(sectionId)} should stay aligned with the selected survey thesis.`
        ),
      evidenceClusterIds: evidenceClusters.map((cluster) => cluster.clusterId),
      anchorIds,
      tensionIds:
        sectionId === "scope_and_protocol"
          ? []
          : params.tensions.slice(0, sectionId === "open_problems" ? 3 : 2).map((entry) => entry.tensionId),
    };
  });
}

export function renderSurveyStorylinePacketMarkdown(packet: SurveyStorylinePacket): string {
  const candidateRows = packet.candidates
    .map(
      (candidate, index) =>
        `| ${index + 1} | ${candidate.label} | ${candidate.score} | ${candidate.intellectualCenterSection} | ${candidate.rationale[0] ?? "No explicit rationale captured."} |`
    )
    .join("\n");
  return [
    "# Survey Storyline Packet",
    "",
    `- topic: ${packet.topic ?? "unset"}`,
    `- selected strategy: ${packet.selectedStrategyLabel}`,
    `- intellectual center: ${packet.intellectualCenterSection}`,
    "",
    "## Thesis",
    `- ${packet.thesis}`,
    "",
    "## Opening Move",
    `- ${packet.openingMove}`,
    "",
    "## Organizing Question",
    `- ${packet.organizingQuestion}`,
    "",
    "## Strategy Rationale",
    ...packet.selectedStrategyRationale.map((line) => `- ${line}`),
    "",
    "## Body Section Order",
    ...packet.bodySectionOrder.map((sectionId) => `- ${sectionId}`),
    "",
    "## Primary Tensions",
    ...(packet.primaryTensions.length > 0
      ? packet.primaryTensions.map((tension) => `- ${tension.label}: ${tension.signal}`)
      : ["- No strong disagreement packet was detected; keep the survey conservative about conflict claims."]),
    "",
    "## Evidence Clusters",
    ...packet.evidenceClusters.flatMap((cluster) => [
      `### ${cluster.label}`,
      `- kind: ${cluster.kind}`,
      `- summary: ${cluster.summary}`,
      `- anchor_ids: ${cluster.anchorIds.join(", ") || "none"}`,
      "",
    ]),
    "## Section Plans",
    ...packet.sectionPlans.flatMap((plan) => [
      `### ${plan.sectionId}`,
      `- prompt: ${plan.prompt}`,
      `- objective: ${plan.objective}`,
      `- core_message: ${plan.coreMessage}`,
      `- evidence_clusters: ${plan.evidenceClusterIds.join(", ") || "none"}`,
      `- anchor_ids: ${plan.anchorIds.join(", ") || "none"}`,
      `- tension_ids: ${plan.tensionIds.join(", ") || "none"}`,
      "",
    ]),
    "## Candidate Ranking",
    "| Rank | Strategy | Score | Intellectual center | Leading rationale |",
    "| --- | --- | --- | --- | --- |",
    candidateRows || "| 1 | taxonomy-first | 0 | taxonomy | No candidate evidence available. |",
  ].join("\n");
}

export async function collectSurveyStorylineSignals(params: {
  projectRoot: string;
  topic: string | null;
}): Promise<SurveyStorylineSignals> {
  const projectRoot = path.resolve(params.projectRoot);
  const [
    surveyBriefText,
    literatureReviewText,
    sotaMatrixText,
    gapSynthesisText,
    coverageSummaryText,
    reviewProtocolText,
    includedJson,
    excludedJson,
    screeningDecisionsJson,
  ] = await Promise.all([
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "researcher/SURVEY_BRIEF.md")),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "researcher/LITERATURE_REVIEW.md")),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "researcher/SOTA_MATRIX.md")),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "researcher/GAP_SYNTHESIS.md")),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "researcher/COVERAGE_SUMMARY.md")),
    readTextIfExists(resolveProjectArtifactPath(projectRoot, "researcher/REVIEW_PROTOCOL.md")),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, "researcher/INCLUDED_PAPERS.json") ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, "researcher/EXCLUDED_PAPERS.json") ?? ""
    ),
    readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, "researcher/CANDIDATE_SCREENING_DECISIONS.json") ?? ""
    ),
  ]);

  const topic =
    params.topic?.trim() ||
    firstMeaningfulLine(surveyBriefText, literatureReviewText) ||
    "the survey topic";
  const familyLines = uniqueStrings([
    ...extractSectionListItems(surveyBriefText, ["theme", "taxonomy", "family", "cluster"]),
    ...extractSectionListItems(literatureReviewText, ["taxonomy", "theme", "family", "cluster"]),
  ]).slice(0, 6);
  const benchmarkLines = uniqueStrings([
    ...collectMarkdownSignalLines(reviewProtocolText, 6).filter((line) =>
      /\bdataset\b|\bbenchmark\b|\bmetric\b|\bsetting\b|\bfair\b|\bcompar/i.test(line)
    ),
    ...collectMarkdownSignalLines(coverageSummaryText, 6).filter((line) =>
      /\bfair\b|\bcompar|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b/i.test(line)
    ),
    ...collectMarkdownSignalLines(gapSynthesisText, 6).filter((line) =>
      /\bfair\b|\bcompar|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b/i.test(line)
    ),
    ...collectMarkdownSignalLines(sotaMatrixText, 8).filter((line) =>
      /\bdataset\b|\bbenchmark\b|\bmetric\b|\bsetting\b|\bfair\b|\bcompar/i.test(line)
    ),
    ...collectSotaEvidenceLines(sotaMatrixText, 6),
  ]).slice(0, 8);
  const benchmarkPressureLines = uniqueStrings([
    ...collectMarkdownSignalLines(reviewProtocolText, 6).filter((line) =>
      /\bfair\b|\bcompar|\bnon[-\s]?comparable|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b|\bprotocol/i.test(
        line
      )
    ),
    ...collectMarkdownSignalLines(coverageSummaryText, 6).filter((line) =>
      /\bfair\b|\bcompar|\bnon[-\s]?comparable|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b/i.test(
        line
      )
    ),
    ...collectMarkdownSignalLines(gapSynthesisText, 6).filter((line) =>
      /\bfair\b|\bcompar|\bnon[-\s]?comparable|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b/i.test(
        line
      )
    ),
    ...collectMarkdownSignalLines(sotaMatrixText, 8).filter((line) =>
      /\bfair\b|\bcompar|\bnon[-\s]?comparable|\bdrift\b|\bmismatch\b|\bcaveat\b|\bwarning\b/i.test(
        line
      )
    ),
  ]).slice(0, 6);
  const gapLines = uniqueStrings([
    ...extractSectionListItems(gapSynthesisText, [
      "gap",
      "open problem",
      "limitation",
      "challenge",
      "future",
    ]),
    ...collectMarkdownSignalLines(gapSynthesisText, 6),
  ]).slice(0, 6);
  const coverageLines = collectMarkdownSignalLines(coverageSummaryText, 6);
  const backgroundLines = collectSurveyBackgroundReferenceLines({
    excludedPapers: excludedJson,
    screeningDecisions: screeningDecisionsJson,
    limit: 6,
  });
  const contradictionLines = uniqueStrings([
    ...collectMarkdownSignalLines(literatureReviewText, 8).filter((line) =>
      /\bcontradict|\binconsistent|\bmixed|\btrade[-\s]?off|\bnon[-\s]?comparable|\bboundary|\boverlap|\bcaveat/i.test(
        line
      )
    ),
    ...collectMarkdownSignalLines(gapSynthesisText, 8).filter((line) =>
      /\bcontradict|\binconsistent|\bmixed|\btrade[-\s]?off|\bnon[-\s]?comparable|\bboundary|\boverlap|\bcaveat/i.test(
        line
      )
    ),
    ...collectMarkdownSignalLines(sotaMatrixText, 8).filter((line) =>
      /\btrade[-\s]?off|\bnon[-\s]?comparable|\bcaveat|\bwarning/i.test(line)
    ),
    ...backgroundLines,
  ]).slice(0, 6);
  const includedLabels = collectEntryLabels(
    includedJson,
    ["papers", "items", "includedPapers", "included"],
    6
  );

  return {
    topic,
    surveyBriefText,
    literatureReviewText,
    sotaMatrixText,
    gapSynthesisText,
    coverageSummaryText,
    reviewProtocolText,
    familyLines,
    benchmarkLines,
    benchmarkPressureLines,
    gapLines,
    coverageLines,
    backgroundLines,
    contradictionLines,
    includedLabels,
  };
}

function buildSurveyStorylinePacketFromSelection(params: {
  signals: SurveyStorylineSignals;
  candidates: SurveyStorylineCandidate[];
  selection: SurveyStorylineSelection;
}): SurveyStorylinePacket {
  const selected =
    params.candidates.find(
      (candidate) => candidate.strategyId === params.selection.selectedStrategyId
    ) ?? params.candidates[0] ?? {
      strategyId: "taxonomy_first" as const,
      label: strategyLabel("taxonomy_first"),
      score: 0,
      rationale: [
        "No strong storyline signals were found, so the survey falls back to a conservative taxonomy-first plan.",
      ],
      bodySectionOrder: [...DEFAULT_SURVEY_BODY_SECTION_ORDER],
      ...buildStrategyThesis({
        strategyId: "taxonomy_first",
        topic: params.signals.topic,
      }),
    };

  const tensions: SurveyStorylineTension[] = uniqueStrings([
    ...params.signals.contradictionLines,
    ...params.signals.gapLines,
    ...params.signals.backgroundLines,
  ])
    .slice(0, 5)
    .map((signal, index) => ({
      tensionId: `tension-${index + 1}`,
      label:
        selected.strategyId === "evaluation_crisis_first"
          ? `Comparability fault line ${index + 1}`
          : selected.strategyId === "contradiction_first"
            ? `Disagreement zone ${index + 1}`
            : `Review pressure ${index + 1}`,
      signal,
      source:
        params.signals.backgroundLines.includes(signal)
          ? "background_reference"
          : params.signals.gapLines.includes(signal)
            ? "gap_synthesis"
            : "survey_packet",
    }));

  const evidenceClusters: SurveyStorylineEvidenceCluster[] = [
    {
      clusterId: "scope_protocol",
      label: "Scope and protocol anchors",
      kind: "scope",
      summary: sentenceCase(
        firstMeaningfulLine(
          params.signals.reviewProtocolText,
          params.signals.coverageSummaryText
        ),
        "The survey must make scope, inclusion, exclusion, and retrieval boundaries explicit before broader synthesis."
      ),
      anchorIds: uniqueStrings([
        "protocol:review",
        ...params.signals.coverageLines
          .slice(0, 3)
          .map((line, index) => `coverage:${slugify(line, `coverage-${index + 1}`)}`),
      ]),
    },
    {
      clusterId: "taxonomy",
      label: "Taxonomy anchors",
      kind: "taxonomy",
      summary: sentenceCase(
        params.signals.familyLines[0],
        "The field needs a stable family-level organizing lens before the manuscript broadens its comparative claims."
      ),
      anchorIds: uniqueStrings(
        params.signals.familyLines
          .slice(0, 6)
          .map((line, index) => `family:${slugify(line, `family-${index + 1}`)}`)
      ),
    },
    {
      clusterId: "evidence_synthesis",
      label: "Evidence synthesis anchors",
      kind: "evidence",
      summary: sentenceCase(
        firstMeaningfulLine(
          params.signals.surveyBriefText,
          params.signals.literatureReviewText
        ),
        "Comparative synthesis should be grounded in representative exemplars instead of a flat paper list."
      ),
      anchorIds: uniqueStrings([
        ...params.signals.includedLabels.map(
          (label, index) => `paper:${slugify(label, `paper-${index + 1}`)}`
        ),
        ...params.signals.benchmarkLines
          .slice(0, 2)
          .map((line, index) => `comparison:${slugify(line, `comparison-${index + 1}`)}`),
      ]).slice(0, 6),
    },
    {
      clusterId: "benchmark_landscape",
      label: "Benchmark landscape anchors",
      kind: "benchmark",
      summary: sentenceCase(
        params.signals.benchmarkLines[0],
        "Benchmark comparisons must stay explicit about datasets, metrics, and non-comparable settings."
      ),
      anchorIds: uniqueStrings(
        params.signals.benchmarkLines
          .slice(0, 6)
          .map((line, index) => `benchmark:${slugify(line, `benchmark-${index + 1}`)}`)
      ),
    },
    {
      clusterId: "open_problems",
      label: "Open-problem anchors",
      kind: "gap",
      summary: sentenceCase(
        params.signals.gapLines[0],
        "Open problems should be tied back to concrete comparison gaps, boundary cases, or unresolved disagreements."
      ),
      anchorIds: uniqueStrings(
        params.signals.gapLines
          .slice(0, 6)
          .map((line, index) => `gap:${slugify(line, `gap-${index + 1}`)}`)
      ),
    },
    {
      clusterId: "disagreement_zone",
      label: "Disagreement / boundary anchors",
      kind: "disagreement",
      summary: sentenceCase(
        params.signals.contradictionLines[0],
        "The survey should keep disagreement zones and non-comparable evidence visible instead of smoothing them away."
      ),
      anchorIds: uniqueStrings(
        params.signals.contradictionLines
          .slice(0, 6)
          .map(
            (line, index) =>
              `tension:${slugify(line, `tension-anchor-${index + 1}`)}`
          )
      ),
    },
  ];

  const sectionPlans = buildSectionPlans({
    topic: params.signals.topic,
    selected,
    evidenceClusters,
    tensions,
  });

  return {
    schemaVersion: 1,
    topic: params.signals.topic,
    selectedStrategyId: selected.strategyId,
    selectedStrategyLabel: selected.label,
    selectedStrategyRationale:
      params.selection.selectedStrategyRationale.length > 0
        ? params.selection.selectedStrategyRationale
        : selected.rationale.length > 0
          ? selected.rationale
          : [
              "No strong storyline-specific signal was detected, so the survey falls back to a conservative thesis.",
            ],
    thesis: selected.thesis,
    openingMove: selected.openingMove,
    organizingQuestion: `What manuscript order best teaches ${params.signals.topic} without flattening its benchmark constraints, family structure, and unresolved gaps?`,
    intellectualCenterSection: selected.intellectualCenterSection,
    bodySectionOrder: selected.bodySectionOrder,
    fullSectionOrder: [
      "abstract",
      "introduction",
      ...selected.bodySectionOrder,
      "conclusion",
    ],
    primaryTensions: tensions,
    evidenceClusters,
    sectionPlans,
    candidates: params.candidates,
    generatedAt: nowIso(),
  };
}

export function normalizeSurveyStorylinePacket(value: unknown): SurveyStorylinePacket | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sectionPlansRaw = Array.isArray(record.sectionPlans)
    ? record.sectionPlans
    : Array.isArray(record.section_plans)
      ? record.section_plans
      : [];
  const evidenceClustersRaw = Array.isArray(record.evidenceClusters)
    ? record.evidenceClusters
    : Array.isArray(record.evidence_clusters)
      ? record.evidence_clusters
      : [];
  const tensionsRaw = Array.isArray(record.primaryTensions)
    ? record.primaryTensions
    : Array.isArray(record.primary_tensions)
      ? record.primary_tensions
      : [];
  const candidatesRaw = Array.isArray(record.candidates) ? record.candidates : [];
  const topic =
    typeof record.topic === "string" && record.topic.trim().length > 0
      ? record.topic.trim()
      : null;
  const selectedStrategyId = (
    typeof record.selectedStrategyId === "string"
      ? record.selectedStrategyId
      : typeof record.selected_strategy_id === "string"
        ? record.selected_strategy_id
        : "taxonomy_first"
  ) as SurveyStorylineStrategyId;
  const bodySectionOrder = asBodySectionOrder(
    Array.isArray(record.bodySectionOrder)
      ? record.bodySectionOrder.map((entry) => String(entry))
      : Array.isArray(record.body_section_order)
        ? record.body_section_order.map((entry) => String(entry))
        : [...DEFAULT_SURVEY_BODY_SECTION_ORDER]
  );
  const fullSectionOrder = uniqueStrings([
    "abstract",
    "introduction",
    ...bodySectionOrder,
    "conclusion",
  ]);
  return {
    schemaVersion:
      typeof record.schemaVersion === "number"
        ? Math.max(1, Math.floor(record.schemaVersion))
        : typeof record.schema_version === "number"
          ? Math.max(1, Math.floor(record.schema_version))
          : 1,
    topic,
    selectedStrategyId,
    selectedStrategyLabel:
      typeof record.selectedStrategyLabel === "string"
        ? record.selectedStrategyLabel
        : strategyLabel(selectedStrategyId),
    selectedStrategyRationale: uniqueStrings(
      Array.isArray(record.selectedStrategyRationale)
        ? record.selectedStrategyRationale.map((entry) => String(entry))
        : Array.isArray(record.selected_strategy_rationale)
          ? record.selected_strategy_rationale.map((entry) => String(entry))
          : []
    ),
    thesis:
      typeof record.thesis === "string" && record.thesis.trim().length > 0
        ? record.thesis.trim()
        : buildStrategyThesis({
            strategyId: selectedStrategyId,
            topic: topic ?? "the survey topic",
          }).thesis,
    openingMove:
      typeof record.openingMove === "string"
        ? record.openingMove
        : typeof record.opening_move === "string"
          ? record.opening_move
          : buildStrategyThesis({
              strategyId: selectedStrategyId,
              topic: topic ?? "the survey topic",
            }).openingMove,
    organizingQuestion:
      typeof record.organizingQuestion === "string"
        ? record.organizingQuestion
        : typeof record.organizing_question === "string"
          ? record.organizing_question
          : `What is the most reviewer-legible way to teach ${topic ?? "this survey topic"} without flattening its tensions?`,
    intellectualCenterSection:
      (typeof record.intellectualCenterSection === "string"
        ? normalizeSectionId(record.intellectualCenterSection)
        : typeof record.intellectual_center_section === "string"
          ? normalizeSectionId(record.intellectual_center_section)
          : buildStrategyThesis({
              strategyId: selectedStrategyId,
              topic: topic ?? "the survey topic",
            }).intellectualCenterSection) as SurveyBodySectionId,
    bodySectionOrder,
    fullSectionOrder,
    primaryTensions: tensionsRaw
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry, index) => ({
        tensionId:
          typeof entry.tensionId === "string"
            ? entry.tensionId
            : typeof entry.tension_id === "string"
              ? entry.tension_id
              : `tension-${index + 1}`,
        label:
          typeof entry.label === "string"
            ? entry.label
            : `Tension ${index + 1}`,
        signal:
          typeof entry.signal === "string"
            ? entry.signal
            : typeof entry.summary === "string"
              ? entry.summary
              : "No signal recorded.",
        source:
          typeof entry.source === "string"
            ? entry.source
            : "survey_packet",
      })),
    evidenceClusters: evidenceClustersRaw
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry, index) => ({
        clusterId:
          typeof entry.clusterId === "string"
            ? entry.clusterId
            : typeof entry.cluster_id === "string"
              ? entry.cluster_id
              : `cluster-${index + 1}`,
        label:
          typeof entry.label === "string" ? entry.label : `Cluster ${index + 1}`,
        kind:
          typeof entry.kind === "string" &&
          ["scope", "taxonomy", "evidence", "benchmark", "gap", "disagreement"].includes(entry.kind)
            ? (entry.kind as SurveyStorylineEvidenceCluster["kind"])
            : "evidence",
        summary:
          typeof entry.summary === "string" ? entry.summary : "No summary recorded.",
        anchorIds: uniqueStrings(
          Array.isArray(entry.anchorIds)
            ? entry.anchorIds.map((item) => String(item))
            : Array.isArray(entry.anchor_ids)
              ? entry.anchor_ids.map((item) => String(item))
              : []
        ),
      })),
    sectionPlans: sectionPlansRaw
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry, index) => {
        const sectionId = normalizeSectionId(
          typeof entry.sectionId === "string"
            ? entry.sectionId
            : typeof entry.section_id === "string"
              ? entry.section_id
              : DEFAULT_SURVEY_BODY_SECTION_ORDER[index] ?? "taxonomy"
        ) as SurveyBodySectionId;
        return {
          sectionId,
          prompt:
            typeof entry.prompt === "string"
              ? entry.prompt
              : typeof entry.question === "string"
                ? entry.question
                : buildSectionPrompt({
                    sectionId,
                    topic: topic ?? "the survey topic",
                    strategyId: selectedStrategyId,
                    thesis:
                      typeof record.thesis === "string"
                        ? record.thesis
                        : buildStrategyThesis({
                            strategyId: selectedStrategyId,
                            topic: topic ?? "the survey topic",
                          }).thesis,
                  }).prompt,
          objective:
            typeof entry.objective === "string"
              ? entry.objective
              : "Keep the section aligned with the selected survey thesis.",
          coreMessage:
            typeof entry.coreMessage === "string"
              ? entry.coreMessage
              : typeof entry.core_message === "string"
                ? entry.core_message
                : `Keep ${sectionTitle(sectionId)} aligned with the selected survey thesis.`,
          evidenceClusterIds: uniqueStrings(
            Array.isArray(entry.evidenceClusterIds)
              ? entry.evidenceClusterIds.map((item) => String(item))
              : Array.isArray(entry.evidence_cluster_ids)
                ? entry.evidence_cluster_ids.map((item) => String(item))
                : []
          ),
          anchorIds: uniqueStrings(
            Array.isArray(entry.anchorIds)
              ? entry.anchorIds.map((item) => String(item))
              : Array.isArray(entry.anchor_ids)
                ? entry.anchor_ids.map((item) => String(item))
                : []
          ),
          tensionIds: uniqueStrings(
            Array.isArray(entry.tensionIds)
              ? entry.tensionIds.map((item) => String(item))
              : Array.isArray(entry.tension_ids)
                ? entry.tension_ids.map((item) => String(item))
                : []
          ),
        };
      }),
    candidates: candidatesRaw
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => {
        const strategyId = (
          typeof entry.strategyId === "string"
            ? entry.strategyId
            : typeof entry.strategy_id === "string"
              ? entry.strategy_id
              : "taxonomy_first"
        ) as SurveyStorylineStrategyId;
        const fallback = buildStrategyThesis({
          strategyId,
          topic: topic ?? "the survey topic",
        });
        return {
          strategyId,
          label:
            typeof entry.label === "string" ? entry.label : strategyLabel(strategyId),
          score:
            typeof entry.score === "number" ? entry.score : 0,
          rationale: uniqueStrings(
            Array.isArray(entry.rationale)
              ? entry.rationale.map((item) => String(item))
              : []
          ),
          bodySectionOrder: asBodySectionOrder(
            Array.isArray(entry.bodySectionOrder)
              ? entry.bodySectionOrder.map((item) => String(item))
              : Array.isArray(entry.body_section_order)
                ? entry.body_section_order.map((item) => String(item))
                : [...DEFAULT_SURVEY_BODY_SECTION_ORDER]
          ),
          intellectualCenterSection:
            (typeof entry.intellectualCenterSection === "string"
              ? normalizeSectionId(entry.intellectualCenterSection)
              : typeof entry.intellectual_center_section === "string"
                ? normalizeSectionId(entry.intellectual_center_section)
                : fallback.intellectualCenterSection) as SurveyBodySectionId,
          thesis:
            typeof entry.thesis === "string" ? entry.thesis : fallback.thesis,
          openingMove:
            typeof entry.openingMove === "string"
              ? entry.openingMove
              : typeof entry.opening_move === "string"
                ? entry.opening_move
                : fallback.openingMove,
        };
      }),
    generatedAt:
      typeof record.generatedAt === "string"
        ? record.generatedAt
        : typeof record.generated_at === "string"
          ? record.generated_at
          : nowIso(),
  };
}

export async function materializeSurveyStorylinePacket(params: {
  projectRoot: string;
  topic: string | null;
  packetPath?: string | null;
  memoPath?: string | null;
  selection?: SurveyStorylineSelection | null;
  candidates?: SurveyStorylineCandidate[] | null;
  signals?: SurveyStorylineSignals | null;
}): Promise<{
  packet: SurveyStorylinePacket;
  generatedFiles: string[];
}> {
  const projectRoot = path.resolve(params.projectRoot);
  const packetPath = params.packetPath ?? DEFAULT_SURVEY_STORYLINE_PACKET_PATH;
  const memoPath = params.memoPath ?? DEFAULT_SURVEY_STORYLINE_MEMO_PATH;
  const signals =
    params.signals ??
    (await collectSurveyStorylineSignals({
      projectRoot,
      topic: params.topic,
    }));
  const candidates =
    params.candidates ??
    buildSurveyStorylineCandidates({
      topic: signals.topic,
      familyLines: signals.familyLines,
      benchmarkLines: signals.benchmarkLines,
      benchmarkPressureLines: signals.benchmarkPressureLines,
      gapLines: signals.gapLines,
      contradictionLines: signals.contradictionLines,
      coverageLines: signals.coverageLines,
      backgroundLines: signals.backgroundLines,
      litReviewText: signals.literatureReviewText,
      surveyBriefText: signals.surveyBriefText,
      reviewProtocolText: signals.reviewProtocolText,
    });
  const selection =
    params.selection ?? {
      selectedStrategyId:
        candidates[0]?.strategyId ?? "taxonomy_first",
      selectedStrategyRationale:
        candidates[0]?.rationale.length
          ? candidates[0].rationale
          : [
              "No strong storyline-specific signal was detected, so the survey falls back to a conservative thesis.",
            ],
      selectionMode: "heuristic",
      selectionConfidence: null,
      fallbackTriggered: false,
      fallbackReason: null,
    };
  const packet = buildSurveyStorylinePacketFromSelection({
    signals,
    candidates,
    selection,
  });

  const resolvedPacketPath = resolveProjectArtifactPath(projectRoot, packetPath);
  const resolvedMemoPath = resolveProjectArtifactPath(projectRoot, memoPath);
  if (!resolvedPacketPath || !resolvedMemoPath) {
    throw new Error("Unable to resolve survey storyline packet paths.");
  }
  await writeJsonEnsured(resolvedPacketPath, {
    schema_version: packet.schemaVersion,
    topic: packet.topic,
    selected_strategy_id: packet.selectedStrategyId,
    selected_strategy_label: packet.selectedStrategyLabel,
    selected_strategy_rationale: packet.selectedStrategyRationale,
    thesis: packet.thesis,
    opening_move: packet.openingMove,
    organizing_question: packet.organizingQuestion,
    intellectual_center_section: packet.intellectualCenterSection,
    body_section_order: packet.bodySectionOrder,
    full_section_order: packet.fullSectionOrder,
    primary_tensions: packet.primaryTensions.map((entry) => ({
      tension_id: entry.tensionId,
      label: entry.label,
      signal: entry.signal,
      source: entry.source,
    })),
    evidence_clusters: packet.evidenceClusters.map((entry) => ({
      cluster_id: entry.clusterId,
      label: entry.label,
      kind: entry.kind,
      summary: entry.summary,
      anchor_ids: entry.anchorIds,
    })),
    section_plans: packet.sectionPlans.map((entry) => ({
      section_id: entry.sectionId,
      prompt: entry.prompt,
      objective: entry.objective,
      core_message: entry.coreMessage,
      evidence_cluster_ids: entry.evidenceClusterIds,
      anchor_ids: entry.anchorIds,
      tension_ids: entry.tensionIds,
    })),
    candidates: packet.candidates.map((entry) => ({
      strategy_id: entry.strategyId,
      label: entry.label,
      score: entry.score,
      rationale: entry.rationale,
      body_section_order: entry.bodySectionOrder,
      intellectual_center_section: entry.intellectualCenterSection,
      thesis: entry.thesis,
      opening_move: entry.openingMove,
    })),
    generated_at: packet.generatedAt,
  });
  await writeTextEnsured(
    resolvedMemoPath,
    `${renderSurveyStorylinePacketMarkdown(packet)}\n`
  );

  return {
    packet,
    generatedFiles: uniqueStrings([packetPath, memoPath]),
  };
}
