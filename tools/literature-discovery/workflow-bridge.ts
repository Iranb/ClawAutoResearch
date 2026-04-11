import path from "node:path";
import {
  asRecord,
  asString,
  normalizeGraphPresenceStatus,
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
  const graphPresenceReady =
    normalizeGraphPresenceStatus(params.graphPresenceStatus) === "ready";
  const onlyDormantQueuedRequests = activeRequests.every(
    (entry) =>
      entry.status === "queued" &&
      !entry.startedAt &&
      !entry.lastRunId &&
      !entry.lastSessionKey &&
      entry.attemptCount === 0
  );
  if (graphPresenceReady && onlyDormantQueuedRequests) {
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
    defaults: {
      corpus: params.sharedCorpus,
    },
    papers: [],
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
    `Batch manifest scaffold: {PROJ}/${params.batchManifestPath}`,
    `Shared corpus: ${params.sharedCorpus ?? "unset"}`,
    `Origin stage: ${params.originStage ?? "unknown"}`,
    `Target reentry path: ${(reentry.length > 0 ? reentry : ["graph_build", "frontier_mapping", "idea"]).join(" -> ")}`,
    "",
    "Execute this as a bounded workflow-owned literature discovery pass:",
    "1. Read the discovery packet and collect only the papers that close the stated evidence gaps.",
    "2. Use the project-local paper collection workflow to identify, retrieve, and stage candidate Markdown/PDF sources; update PAPER_SOURCE_INDEX.json and staging metadata durably.",
    "3. Populate the batch manifest scaffold with the staged local sources that should be imported into the shared graph.",
    "4. Run one manifest-driven PaperNexus batch import for the collected sources and keep progress durable through research_workflow.set_paper_ingestion.",
    "5. After the import finishes, rerun /graph-build so the workflow can refresh graph presence, frontier packets, and then continue from the appropriate downstream stage.",
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
  const batchManifestRelativePath = path.join(
    "researcher",
    "literature-discovery",
    "requisition",
    sanitizeIdFragment(discoveryId),
    "batch-import.json"
  );
  const batchManifestResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    batchManifestRelativePath
  );
  if (!batchManifestResolvedPath) {
    throw new Error("Could not resolve the literature discovery batch manifest path.");
  }
  await writeJsonEnsured(
    batchManifestResolvedPath,
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
      batchManifestPath: batchManifestRelativePath,
      sharedCorpus,
      requestId,
      packet,
      originStage: params.originStage ?? null,
    }),
    manifest_path: batchManifestRelativePath,
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
  });
  if (!normalizedRequest) {
    throw new Error("Failed to normalize the literature discovery queue request.");
  }

  const nextPaperIngestion = {
    ...paperIngestion,
    queuedRequests: [...paperIngestion.queuedRequests, normalizedRequest],
    lastUpdatedAt: normalizedRequest.updatedAt ?? new Date().toISOString(),
  };
  manifest.paper_ingestion = serializePaperIngestionState(nextPaperIngestion);
  await writeJsonEnsured(manifestPath, manifest);

  return {
    created: true,
    state: nextPaperIngestion,
    request: normalizedRequest,
    packetPath: params.packetPath,
    batchManifestPath: batchManifestRelativePath,
  };
}
