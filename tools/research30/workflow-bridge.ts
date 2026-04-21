import * as path from "node:path";
import { writeJsonEnsured, writeTextEnsured } from "../workflow-guard-core/fs";
import {
  auditLiteratureCoverage,
  planCitationExpansion,
  type CitationExpansionPacket,
  type LiteratureCoverageAudit,
} from "../paper-discovery-diagnostics";
import {
  upsertPaperSourceIndexEntries,
} from "../paper-source-index-writer";
import { buildBroadPaperSearchDiagnostics, renderBroadPaperSearchMarkdown } from "./diagnostics";
import {
  mergeProviderQueryResults,
  serializeMergedPaperCandidate,
  type MergedPaperCandidate,
} from "./merge";
import { searchCore } from "./provider-core";
import {
  type BroadPaperProviderName,
  type BroadPaperProviderQueryResult,
  type BroadPaperSearchDepth,
  type BroadPaperSearchQuery,
} from "./provider-contract";
import { searchCrossref } from "./provider-crossref";
import { searchDblp } from "./provider-dblp";
import { searchOpenAlex } from "./provider-openalex";
import { searchSemanticScholar } from "./provider-semanticscholar";
import { buildBroadPaperSearchPlan } from "./query-planner";
import {
  resolveMergedCandidatesToStaging,
  serializeUnresolvedCandidates,
} from "./source-resolution";

const DEFAULT_PROVIDERS: BroadPaperProviderName[] = [
  "openalex",
  "semanticscholar",
  "crossref",
  "dblp",
  "core",
];

function shouldRetryProviderResult(result: BroadPaperProviderQueryResult): boolean {
  if (result.status !== "error" || !result.error) {
    return false;
  }
  return /HTTP 429|timed? ?out|ECONNRESET|ETIMEDOUT/i.test(result.error);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeProviderQueries(params: {
  providers: BroadPaperProviderName[];
  queries: BroadPaperSearchQuery[];
  depth: BroadPaperSearchDepth;
  maxResultsPerQuery: number;
  fromYear: number | null;
}): Promise<BroadPaperProviderQueryResult[]> {
  const results: BroadPaperProviderQueryResult[] = [];
  for (const provider of params.providers) {
    for (const query of params.queries) {
      let result = await runProviderQuery({
        provider,
        query,
        depth: params.depth,
        maxResultsPerQuery: params.maxResultsPerQuery,
        fromYear: params.fromYear,
      });
      if (shouldRetryProviderResult(result)) {
        for (const backoffMs of [150, 400]) {
          await delay(backoffMs);
          result = await runProviderQuery({
            provider,
            query,
            depth: params.depth,
            maxResultsPerQuery: params.maxResultsPerQuery,
            fromYear: params.fromYear,
          });
          if (!shouldRetryProviderResult(result)) {
            break;
          }
        }
      }
      results.push(result);
    }
  }
  return results;
}

async function runProviderQuery(params: {
  provider: BroadPaperProviderName;
  query: BroadPaperSearchQuery;
  depth: BroadPaperSearchDepth;
  maxResultsPerQuery: number;
  fromYear: number | null;
}): Promise<BroadPaperProviderQueryResult> {
  const common = {
    query: params.query,
    depth: params.depth,
    maxResults: params.maxResultsPerQuery,
    fromYear: params.fromYear,
  } as const;
  switch (params.provider) {
    case "openalex":
      return searchOpenAlex(common);
    case "semanticscholar":
      return searchSemanticScholar(common);
    case "crossref":
      return searchCrossref(common);
    case "dblp":
      return searchDblp(common);
    case "core":
      return searchCore(common);
    default:
      return {
        provider: params.provider,
        queryId: params.query.id,
        status: "skipped",
        capabilities: {
          provider: params.provider,
          availability: "unsupported",
          authMode: "anonymous",
          supportsSearch: false,
          supportsOaResolution: false,
          supportsFullTextHints: false,
          supportsVenueExpansion: false,
          reason: "Unsupported provider.",
        },
        totalHits: 0,
        hits: [],
        warnings: [],
        error: "Unsupported provider.",
      };
  }
}

function buildArtifactPaths(projectRoot: string, generatedAt: string) {
  const timestamp = generatedAt.replace(/[:.]/g, "-");
  const researcherRoot = path.join(projectRoot, "researcher");
  return {
    queryPlanPath: path.join(researcherRoot, "search_plans", `${timestamp}_query_plan.json`),
    providerResultsPath: path.join(researcherRoot, "search_raw", `${timestamp}_provider_results.json`),
    mergedCandidatesPath: path.join(researcherRoot, "search_merged", `${timestamp}_merged_candidates.json`),
    reportMarkdownPath: path.join(researcherRoot, "search_reports", `${timestamp}_broad_search_report.md`),
    unresolvedPath: path.join(researcherRoot, "search_reports", `${timestamp}_metadata_only_unresolved.json`),
  };
}

function shouldPersistCandidate(candidate: MergedPaperCandidate): boolean {
  const topicRelevant = candidate.topicRelevanceScore >= 18;
  return (
    (topicRelevant && candidate.selectionScore >= 40) ||
    (candidate.providerAgreementCount >= 2 && candidate.topicRelevanceScore >= 20) ||
    (candidate.venuePackHits.length > 0 && candidate.topicRelevanceScore >= 20) ||
    ((candidate.resolutionStatus === "resolved_pdf" ||
      candidate.resolutionStatus === "resolved_markdown") &&
      candidate.topicRelevanceScore >= 18) ||
    (candidate.resolutionStatus === "metadata_only_unresolved" &&
      candidate.topicRelevanceScore >= 30)
  );
}

export async function runBroadPaperSearch(params: {
  projectRoot: string;
  topic: string;
  depth?: BroadPaperSearchDepth;
  maxQueries?: number;
  maxResultsPerQuery?: number;
  maxIndexEntries?: number;
  maxResolutionAttempts?: number;
  fromYear?: number | null;
  providers?: BroadPaperProviderName[] | null;
}): Promise<{
  generatedAt: string;
  topic: string;
  preferredVenuePacks: string[];
  queryPlan: BroadPaperSearchQuery[];
  queryResults: BroadPaperProviderQueryResult[];
  mergedCandidates: MergedPaperCandidate[];
  sourceIndexUpdate: {
    sourceIndexPath: string;
    entryCount: number;
    updatedCanonicalIds: string[];
  };
  artifacts: ReturnType<typeof buildArtifactPaths>;
  coverageAudit: LiteratureCoverageAudit;
  citationExpansionPacket: CitationExpansionPacket | null;
}> {
  const generatedAt = new Date().toISOString();
  const depth = params.depth ?? "default";
  const maxResultsPerQuery =
    typeof params.maxResultsPerQuery === "number" && Number.isFinite(params.maxResultsPerQuery)
      ? Math.max(5, Math.min(50, Math.floor(params.maxResultsPerQuery)))
      : depth === "quick"
        ? 12
        : depth === "deep"
          ? 30
          : 20;
  const plan = buildBroadPaperSearchPlan({
    topic: params.topic,
    depth,
    maxQueries: params.maxQueries,
  });
  const providers = params.providers?.length ? params.providers : DEFAULT_PROVIDERS;
  const queryResults = (
    await executeProviderQueries({
      providers,
      queries: plan.queries,
      depth,
      maxResultsPerQuery,
      fromYear: params.fromYear ?? null,
    })
  ).sort((left, right) => left.provider.localeCompare(right.provider) || left.queryId.localeCompare(right.queryId));
  const merged = mergeProviderQueryResults({
    topic: params.topic,
    queryResults,
    preferredVenuePacks: plan.preferredVenuePacks,
  });
  const resolution = await resolveMergedCandidatesToStaging({
    projectRoot: params.projectRoot,
    candidates: merged,
    maxCandidates: params.maxResolutionAttempts ?? 12,
  });
  const finalCandidates = resolution.candidates;
  const sourceIndexUpdate = await upsertPaperSourceIndexEntries({
    projectRoot: params.projectRoot,
    entries: finalCandidates
      .filter(shouldPersistCandidate)
      .slice(0, Math.max(5, Math.floor(params.maxIndexEntries ?? 25))),
  });
  const artifacts = buildArtifactPaths(params.projectRoot, generatedAt);
  const diagnostics = buildBroadPaperSearchDiagnostics({
    topic: params.topic,
    queryPlan: plan.queries,
    queryResults,
    mergedCandidates: finalCandidates,
  });
  await Promise.all([
    writeJsonEnsured(artifacts.queryPlanPath, {
      generated_at: generatedAt,
      topic: params.topic,
      preferred_venue_packs: plan.preferredVenuePacks,
      queries: plan.queries,
    }),
    writeJsonEnsured(artifacts.providerResultsPath, {
      generated_at: generatedAt,
      topic: params.topic,
      providers,
      query_results: queryResults,
    }),
    writeJsonEnsured(artifacts.mergedCandidatesPath, {
      generated_at: generatedAt,
      topic: params.topic,
      candidates: finalCandidates.map((candidate) => serializeMergedPaperCandidate(candidate)),
      diagnostics,
    }),
    writeJsonEnsured(artifacts.unresolvedPath, {
      generated_at: generatedAt,
      topic: params.topic,
      candidates: serializeUnresolvedCandidates(resolution.unresolved),
    }),
    writeTextEnsured(
      artifacts.reportMarkdownPath,
      renderBroadPaperSearchMarkdown({
        topic: params.topic,
        queryPlan: plan.queries,
        queryResults,
        mergedCandidates: finalCandidates,
        diagnostics,
      })
    ),
  ]);
  const coverageAudit = await auditLiteratureCoverage({
    projectRoot: params.projectRoot,
  });
  const citationExpansionPacket =
    coverageAudit.verdict !== "strong" ||
    coverageAudit.missingBaselineHints.length > 0 ||
    coverageAudit.pendingRoundCount > 0 ||
    coverageAudit.pendingScreeningCount > 0
      ? await planCitationExpansion({
          projectRoot: params.projectRoot,
        })
      : null;
  return {
    generatedAt,
    topic: params.topic,
    preferredVenuePacks: plan.preferredVenuePacks,
    queryPlan: plan.queries,
    queryResults,
    mergedCandidates: finalCandidates,
    sourceIndexUpdate,
    artifacts,
    coverageAudit,
    citationExpansionPacket,
  };
}
