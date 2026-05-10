import path from "node:path";
import {
  asRecord,
  asString,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizePaperIngestionQueuedRequest,
  normalizePaperIngestionState,
  serializePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import { resolveWorkflowSharedPapernexusCorpus } from "../papernexus-shared-corpus";

function sanitizeIdFragment(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function normalizeStagePath(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeDiscoveryQueries(packet: Record<string, unknown>): Array<Record<string, unknown>> {
  const values = Array.isArray(packet.candidate_queries)
    ? packet.candidate_queries
    : Array.isArray(packet.search_queries)
      ? packet.search_queries
      : [];
  return values
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function isActiveQueuedRequestStatus(status: string | null | undefined): boolean {
  return ["queued", "launching", "running", "needs_repair"].includes(
    String(status ?? "").trim().toLowerCase()
  );
}

export function isLiteratureDiscoveryTriggerKind(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized === "idea_catalyst_requisition" ||
    normalized === "literature_discovery" ||
    normalized.endsWith("literature_discovery")
  );
}

export function hasActiveLiteratureDiscoveryRequest(params: {
  paperIngestion: unknown;
  graphPresenceStatus?: unknown;
}): boolean {
  const state = normalizePaperIngestionState(params.paperIngestion);
  const activeRequests = state.queuedRequests.filter(
    (entry) =>
      isLiteratureDiscoveryTriggerKind(entry.triggerKind) &&
      isActiveQueuedRequestStatus(entry.status)
  );
  if (activeRequests.length === 0) {
    return false;
  }
  return true;
}

export function shouldRouteLiteratureDiscoveryToGraphBuild(params: {
  currentStage: string | null;
  paperIngestion: unknown;
  graphPresenceStatus?: unknown;
}): boolean {
  if (!params.currentStage) {
    return false;
  }
  if (["setup", "graph_build", "frontier_mapping", "done"].includes(params.currentStage)) {
    return false;
  }
  return hasActiveLiteratureDiscoveryRequest({
    paperIngestion: params.paperIngestion,
    graphPresenceStatus: params.graphPresenceStatus,
  });
}

function buildLiteratureDiscoveryRequestId(params: {
  discoveryId: string | null;
  requestIdPrefix: string;
}) {
  return `${params.requestIdPrefix}-${sanitizeIdFragment(params.discoveryId)}`;
}

function buildLiteratureDiscoveryBatchManifest(params: {
  packet: Record<string, unknown>;
  sharedCorpus: string | null;
  originStage: string | null;
  triggerKind: string;
}) {
  return {
    version: 1,
    controller: "papernexus",
    operation: "literature_discovery_import",
    defaults: params.sharedCorpus ? { corpus: params.sharedCorpus } : {},
    papers: [],
    run_handle: {
      run_id: null,
      task_ids: [],
      artifact_path: null,
      queue_progress_path: null,
    },
    refresh_policy: "reuse_existing_handle",
    fallback: {
      allow_metadata_supported_survey: true,
      allow_degraded_graph_continue: true,
    },
    papernexus_literature_discovery: {
      operation: "ingest",
      async_fallback_operation: "import",
      supplement_operation: "supplement",
      prefer_markdown: true,
      generate_arxiv_markdown_sources: true,
      preserve_metadata_graph: true,
      preserve_metadata_only_candidates: true,
      accepted_candidate_source_kinds: ["markdown", "pdf", "metadata"],
      source_resolution: {
        preferred_source_kind: "markdown",
        pdf_fallback: true,
        metadata_only_status: "metadata_only_unresolved",
      },
      supplementation: {
        tool: "literature_discovery",
        reserved_operation: "supplement",
        preferred_source_kind: "markdown",
        accepted_inputs: [
          "candidateId",
          "canonicalId",
          "sourcePath",
          "markdownUrl",
          "pdfUrl",
          "paperMetadata",
        ],
      },
      artifacts: {
        run_handle_path: null,
        metadata_graph_path: null,
        source_index_path: "researcher/PAPER_SOURCE_INDEX.json",
      },
    },
    literature_discovery: {
      discovery_id:
        pickString(params.packet, ["discovery_id", "discoveryId"]) ??
        pickString(params.packet, ["requisition_id", "requisitionId"]) ??
        null,
      discovery_reason:
        pickString(params.packet, ["discovery_reason", "discoveryReason"]) ??
        null,
      target_question_ids: Array.isArray(params.packet.target_question_ids)
        ? params.packet.target_question_ids
        : [],
      target_domains: Array.isArray(params.packet.target_domains)
        ? params.packet.target_domains
        : Array.isArray(params.packet.missing_domains)
          ? params.packet.missing_domains
          : [],
      candidate_queries: normalizeDiscoveryQueries(params.packet),
      selected_papers: Array.isArray(params.packet.selected_papers)
        ? params.packet.selected_papers
        : [],
      rejected_papers: Array.isArray(params.packet.rejected_papers)
        ? params.packet.rejected_papers
        : [],
      required_stage_reentry: normalizeStagePath(
        params.packet.required_stage_reentry ?? params.packet.requiredStageReentry
      ),
      next_action_suggestion:
        pickString(params.packet, ["next_action_suggestion", "nextActionSuggestion"]) ??
        null,
      trigger_kind: params.triggerKind,
      origin_stage: params.originStage,
    },
  };
}

function buildLiteratureDiscoveryCommandText(params: {
  projectRoot: string;
  packetPath: string;
  batchManifestPath: string;
  sharedCorpus: string | null;
  requestId: string;
  packet: Record<string, unknown>;
  originStage: string | null;
}) {
  const queries = normalizeDiscoveryQueries(params.packet);
  const queryBlock =
    queries.length > 0
      ? queries
          .map((entry, index) => {
            const domain = pickString(entry, ["domain"]) ?? "unknown-domain";
            const query = pickString(entry, ["query"]) ?? "";
            return `${index + 1}. [${domain}] ${query}`;
          })
          .join("\n")
      : "1. Use the discovery packet to derive the missing graph-backed literature queries.";
  const targetDomains = Array.isArray(params.packet.target_domains)
    ? params.packet.target_domains
    : Array.isArray(params.packet.missing_domains)
      ? params.packet.missing_domains
      : [];
  const reentry = normalizeStagePath(
    params.packet.required_stage_reentry ?? params.packet.requiredStageReentry
  );
  return [
    "LITERATURE DISCOVERY WORKFLOW-OWNED REQUISITION EXECUTION",
    `Project root: ${params.projectRoot}`,
    `Request id: ${params.requestId}`,
    `Discovery packet: {PROJ}/${params.packetPath}`,
    `Requisition scaffold: {PROJ}/${params.batchManifestPath}`,
    `Shared corpus: ${params.sharedCorpus ?? "unset"}`,
    `Origin stage: ${params.originStage ?? "unknown"}`,
    `Target reentry path: ${(reentry.length > 0 ? reentry : ["graph_build", "frontier_mapping", "idea"]).join(" -> ")}`,
    "",
    "Execute this as a bounded PaperNexus-native literature discovery pass:",
    "1. Read the discovery packet and submit or refresh one PaperNexus MCP literature_discovery run for the stated evidence gaps.",
    "2. Prefer operation: ingest with importResolved=true, processImports=true, preferMarkdown=true, and generateArxivMarkdownSources=true when the pass is bounded enough to process inline; use operation: import only when import queue processing must remain asynchronous.",
    "3. Preserve the returned metadataGraph, partialPaperCount, resolutionSummary/coverage, source.supplementation, local Markdown/PDF paths, markdownUrl/pdfUrl hints, import task ids, queue progress, and shared corpus in paper_ingestion artifacts.",
    "4. For metadata-only candidates, keep them as coverage/taxonomy/search-direction records and use literature_discovery operation: supplement when a later Markdown/PDF/local source or URL becomes available.",
    "5. Poll PaperNexus import_workflow queue_progress for existing task ids instead of resubmitting discovery when a run handle already exists.",
    "6. Refresh graph presence from PaperNexus corpus_sources after import tasks reach a terminal state.",
    "7. If full text cannot be legally resolved for every candidate, preserve metadata-only candidates as limitations rather than blocking downstream survey planning; do not use them as source-backed manuscript proof.",
    "8. Re-enter /graph-build or /survey-review so AutoResearch can materialize local read-model artifacts from the PaperNexus discovery/graph evidence before downstream handoff.",
    "",
    `Discovery reason: ${pickString(params.packet, ["discovery_reason", "discoveryReason"]) ?? "unset"}`,
    `Target domains: ${targetDomains.length > 0 ? targetDomains.join(", ") : "unset"}`,
    "Queries to satisfy:",
    queryBlock,
  ].join("\n");
}

export async function queueLiteratureDiscoveryRequisition(params: {
  projectRoot: string;
  packetPath: string;
  triggerKind?: string | null;
  originStage?: string | null;
  summary?: string | null;
  sharedCorpus?: string | null;
  requestIdPrefix?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath =
    resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json") ??
    path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const packetResolvedPath = resolveProjectArtifactPath(projectRoot, params.packetPath);
  const packet =
    (await readJsonIfExists<Record<string, unknown>>(packetResolvedPath ?? "")) ?? null;
  if (!packet) {
    throw new Error(`Literature discovery packet is missing: ${params.packetPath}`);
  }

  const discoveryId =
    pickString(packet, ["discovery_id", "discoveryId"]) ??
    pickString(packet, ["requisition_id", "requisitionId"]) ??
    pickString(packet, ["last_updated_at", "lastUpdatedAt"]) ??
    "unknown";
  const triggerKind = params.triggerKind ?? "literature_discovery";
  const requestId = buildLiteratureDiscoveryRequestId({
    discoveryId,
    requestIdPrefix: params.requestIdPrefix ?? "literature-discovery",
  });
  const paperIngestion = normalizePaperIngestionState(manifest.paper_ingestion);
  const existing =
    paperIngestion.queuedRequests.find((entry) => entry.requestId === requestId) ??
    paperIngestion.queuedRequests.find(
      (entry) =>
        isLiteratureDiscoveryTriggerKind(entry.triggerKind) &&
        entry.detail?.includes(String(discoveryId))
    ) ??
    null;
  if (existing) {
    return {
      created: false,
      reason: isActiveQueuedRequestStatus(existing.status)
        ? "A literature-discovery-backed ingestion request already exists."
        : `A literature-discovery-backed ingestion request already completed with status ${existing.status}.`,
      state: paperIngestion,
      request: existing,
      packetPath: params.packetPath,
    };
  }

  const graphStatus =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, "graph/PAPERNEXUS_STATUS.json") ?? ""
    )) ?? null;
  const projectId =
    pickString(manifest, ["project_id", "projectId"]) ?? path.basename(projectRoot);
  const sharedCorpus = resolveWorkflowSharedPapernexusCorpus({
    candidates: [
      params.sharedCorpus,
      pickString(graphStatus ?? {}, ["corpus_name", "corpusName"]),
      paperIngestion.repairTargetCorpus,
    ],
    projectId,
    projectRoot,
  });
  const requisitionRelativePath = path.join(
    "researcher",
    "literature-discovery",
    "requisition",
    sanitizeIdFragment(discoveryId),
    "DISCOVERY_REQUISITION.json"
  );
  const requisitionResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    requisitionRelativePath
  );
  if (!requisitionResolvedPath) {
    throw new Error("Could not resolve the literature discovery requisition path.");
  }
  await writeJsonEnsured(
    requisitionResolvedPath,
    buildLiteratureDiscoveryBatchManifest({
      packet,
      sharedCorpus,
      originStage: params.originStage ?? null,
      triggerKind,
    })
  );

  const selectedPapers = Array.isArray(packet.selected_papers) ? packet.selected_papers : [];
  const normalizedRequest = normalizePaperIngestionQueuedRequest({
    request_id: requestId,
    status: "queued",
    wrapper: "pn_batch_import.py",
    args: [],
    command_text: buildLiteratureDiscoveryCommandText({
      projectRoot,
      packetPath: params.packetPath,
      batchManifestPath: requisitionRelativePath,
      sharedCorpus,
      requestId,
      packet,
      originStage: params.originStage ?? null,
    }),
    manifest_path: requisitionRelativePath,
    shared_corpus: sharedCorpus,
    paper_count: selectedPapers.length > 0 ? selectedPapers.length : null,
    summary:
      params.summary ??
      `Literature discovery ${discoveryId} for ${(
        Array.isArray(packet.target_domains) ? packet.target_domains : []
      ).join(", ") || "graph-backed evidence acquisition"}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    detail:
      `Structured literature discovery ${discoveryId}` +
      (params.originStage ? ` triggered from ${params.originStage}` : "") +
      "; route it through graph_build before continuing downstream work.",
    trigger_kind: triggerKind,
    request_kind: "requisition",
  });
  if (!normalizedRequest) {
    throw new Error("Failed to normalize the literature discovery queue request.");
  }

  const nextPaperIngestion = {
    ...paperIngestion,
    queuedRequests: [...paperIngestion.queuedRequests, normalizedRequest],
    lastUpdatedAt: normalizedRequest.updatedAt ?? new Date().toISOString(),
  };
  const paperIngestionRecord =
    manifest.paper_ingestion &&
    typeof manifest.paper_ingestion === "object" &&
    !Array.isArray(manifest.paper_ingestion)
      ? (manifest.paper_ingestion as Record<string, unknown>)
      : {};
  manifest.paper_ingestion = {
    ...paperIngestionRecord,
    ...serializePaperIngestionState(nextPaperIngestion),
  };
  await writeJsonEnsured(manifestPath, manifest);

  return {
    created: true,
    state: nextPaperIngestion,
    request: normalizedRequest,
    packetPath: params.packetPath,
    batchManifestPath: requisitionRelativePath,
  };
}
