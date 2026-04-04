import path from "node:path";
import { asRecord, pickNumber, pickString } from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizePaperIngestionQueuedRequest,
  normalizePaperIngestionState,
  serializePaperIngestionQueuedRequest,
  serializePaperIngestionState,
} from "../workflow-guard-state/paper-ingestion";
import { normalizeIdeaCatalystState, serializeIdeaCatalystState } from "./state";

function sanitizeIdFragment(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

function isIdeaCatalystQueuedRequestActive(status: string | null | undefined): boolean {
  return ["queued", "launching", "running", "needs_repair"].includes(
    String(status ?? "").trim().toLowerCase()
  );
}

function buildIdeaCatalystRequisitionRequestId(requisitionId: string | null | undefined): string {
  return `idea-catalyst-${sanitizeIdFragment(requisitionId)}`;
}

function buildIdeaCatalystRequisitionBatchManifest(params: {
  requisition: Record<string, unknown>;
  sharedCorpus: string | null;
}) {
  return {
    version: 1,
    defaults: {
      corpus: params.sharedCorpus,
    },
    papers: [],
    catalyst_requisition: {
      requisition_id:
        pickString(params.requisition, ["requisition_id", "requisitionId"]) ?? null,
      target_domain:
        pickString(params.requisition, ["target_domain", "targetDomain"]) ?? null,
      missing_domains:
        Array.isArray(params.requisition.missing_domains)
          ? params.requisition.missing_domains
          : [],
      coverage_gap_questions:
        Array.isArray(params.requisition.coverage_gap_questions)
          ? params.requisition.coverage_gap_questions
          : [],
      search_queries: Array.isArray(params.requisition.search_queries)
        ? params.requisition.search_queries
        : [],
      required_stage_reentry: Array.isArray(params.requisition.required_stage_reentry)
        ? params.requisition.required_stage_reentry
        : [],
      minimum_sources_per_domain:
        pickNumber(params.requisition, [
          "minimum_sources_per_domain",
          "minimumSourcesPerDomain",
        ]) ?? null,
      minimum_bridge_nodes:
        pickNumber(params.requisition, [
          "minimum_bridge_nodes",
          "minimumBridgeNodes",
        ]) ?? null,
      retry_budget:
        pickNumber(params.requisition, ["retry_budget", "retryBudget"]) ?? null,
      saturation_signal:
        pickString(params.requisition, ["saturation_signal", "saturationSignal"]) ??
        null,
    },
  };
}

function buildIdeaCatalystRequisitionCommandText(params: {
  projectRoot: string;
  requisitionPath: string;
  batchManifestPath: string;
  sharedCorpus: string | null;
  requestId: string;
  requisition: Record<string, unknown>;
}): string {
  const searchQueries = Array.isArray(params.requisition.search_queries)
    ? params.requisition.search_queries
    : [];
  const missingDomains = Array.isArray(params.requisition.missing_domains)
    ? params.requisition.missing_domains
    : [];
  const reentry = Array.isArray(params.requisition.required_stage_reentry)
    ? params.requisition.required_stage_reentry.join(" -> ")
    : "graph_build -> frontier_mapping -> idea";
  const queryBlock =
    searchQueries.length > 0
      ? searchQueries
          .map((entry, index) => {
            const record = asRecord(entry) ?? {};
            const domain = pickString(record, ["domain"]) ?? "unknown-domain";
            const query = pickString(record, ["query"]) ?? "";
            return `${index + 1}. [${domain}] ${query}`;
          })
          .join("\n")
      : "1. Use the requisition packet to derive the missing cross-domain search queries.";
  const minimumSourcesPerDomain =
    pickNumber(params.requisition, [
      "minimum_sources_per_domain",
      "minimumSourcesPerDomain",
    ]) ?? 2;
  const minimumBridgeNodes =
    pickNumber(params.requisition, [
      "minimum_bridge_nodes",
      "minimumBridgeNodes",
    ]) ?? 2;
  return [
    "IDEA-CATALYST WORKFLOW-OWNED REQUISITION EXECUTION",
    `Project root: ${params.projectRoot}`,
    `Request id: ${params.requestId}`,
    `Requisition packet: {PROJ}/${params.requisitionPath}`,
    `Batch manifest scaffold: {PROJ}/${params.batchManifestPath}`,
    `Shared corpus: ${params.sharedCorpus ?? "unset"}`,
    `Target reentry path: ${reentry}`,
    "",
    "Execute this as a bounded workflow-owned catalyst requisition pass:",
    "1. Read the requisition packet and collect cross-domain papers that specifically close the listed coverage gaps.",
    `2. Aim for at least ${minimumSourcesPerDomain} staged papers per missing domain and at least ${minimumBridgeNodes} bridge-worthy candidates overall before stopping.`,
    "3. Use the existing project-local paper collection workflow to identify, retrieve, and stage candidate Markdown/PDF sources; update PAPER_SOURCE_INDEX.json and any project-local staging metadata durably.",
    "4. Populate the batch manifest scaffold with the staged local sources that should be imported into the shared graph.",
    "5. Run one manifest-driven PaperNexus batch import for the collected sources and keep progress durable through research_workflow.set_paper_ingestion. Keep queued_requests synchronized with this exact request_id.",
    "6. After the import finishes or the retry budget is exhausted, rerun /graph-build so the workflow can verify graph presence, refresh frontier packets, and then resume IDEA-CATALYST.",
    "",
    "Search queries to satisfy:",
    queryBlock,
  ].join("\n");
}

export function getIdeaCatalystRequiredArtifactPaths(value: unknown): string[] {
  const state = normalizeIdeaCatalystState(value);
  const required = [
    state.decompositionPacketPath,
    state.abstractionPacketPath,
    state.scoutingReportPath,
    state.gateDecisionPath,
  ];
  if (state.status === "ready") {
    required.push(state.ideaFragmentsPath, state.rankedFragmentsPath);
  }
  if (state.requisitionRequired || state.status === "requisition") {
    required.push(state.investigationRequisitionPath);
  }
  return required;
}

export function isIdeaCatalystReadyForPlan(value: unknown): boolean {
  return normalizeIdeaCatalystState(value).status === "ready";
}

export function getIdeaCatalystRequisitionBlockingSignal(value: unknown): string | null {
  const state = normalizeIdeaCatalystState(value);
  if (!state.requisitionRequired && state.status !== "requisition") {
    return null;
  }
  if (state.requisitionSaturated) {
    return (
      `IDEA-CATALYST investigation requisition is saturated at {PROJ}/${state.investigationRequisitionPath}; ` +
      "do not keep looping. Review the missing-domain strategy, revise the requisition or domain assumptions, and only then resume IDEA."
    );
  }
  return (
    `IDEA-CATALYST investigation requisition is pending; satisfy {PROJ}/${state.investigationRequisitionPath} ` +
    "through bounded literature acquisition, queue the resulting imports, rerun /graph-build, refresh frontiers, and only then resume IDEA synthesis."
  );
}

export function deriveIdeaCatalystMicroStage(
  value: unknown,
  fallback = "decomposition"
): string {
  const state = normalizeIdeaCatalystState(value);
  if (state.microStage) {
    return state.microStage;
  }
  if (state.status === "requisition") {
    return "gatekeeping";
  }
  if (state.status === "ready") {
    return "judging";
  }
  return fallback;
}

export function hasActiveIdeaCatalystRequisitionRequest(params: {
  ideaCatalyst: unknown;
  paperIngestion: unknown;
}): boolean {
  const ideaCatalyst = normalizeIdeaCatalystState(params.ideaCatalyst);
  if (!ideaCatalyst.requisitionRequired && ideaCatalyst.status !== "requisition") {
    return false;
  }
  const paperIngestion = normalizePaperIngestionState(params.paperIngestion);
  return paperIngestion.queuedRequests.some(
    (entry) =>
      entry.triggerKind === "idea_catalyst_requisition" &&
      isIdeaCatalystQueuedRequestActive(entry.status)
  );
}

export function shouldRouteIdeaCatalystToGraphBuild(params: {
  currentStage: string | null;
  ideaCatalyst: unknown;
  paperIngestion: unknown;
}): boolean {
  if (params.currentStage !== "idea") {
    return false;
  }
  return hasActiveIdeaCatalystRequisitionRequest({
    ideaCatalyst: params.ideaCatalyst,
    paperIngestion: params.paperIngestion,
  });
}

export async function queueIdeaCatalystRequisition(params: {
  projectRoot: string;
  trigger?: string | null;
  agentId?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifestPath =
    resolveProjectArtifactPath(projectRoot, "PROJECT_MANIFEST.json") ??
    path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const ideaCatalyst = normalizeIdeaCatalystState(manifest.idea_catalyst);
  if (!ideaCatalyst.requisitionRequired && ideaCatalyst.status !== "requisition") {
    return {
      created: false,
      reason: "idea_catalyst is not currently requesting an investigation requisition.",
      state: normalizePaperIngestionState(manifest.paper_ingestion),
      request: null,
    };
  }

  const requisitionPath = resolveProjectArtifactPath(
    projectRoot,
    ideaCatalyst.investigationRequisitionPath
  );
  const requisition =
    (await readJsonIfExists<Record<string, unknown>>(requisitionPath ?? "")) ?? null;
  if (!requisition) {
    throw new Error(
      `IDEA-CATALYST requisition packet is missing: ${ideaCatalyst.investigationRequisitionPath}`
    );
  }

  const paperIngestion = normalizePaperIngestionState(manifest.paper_ingestion);
  const requisitionId =
    pickString(requisition, ["requisition_id", "requisitionId"]) ??
    ideaCatalyst.lastUpdatedAt ??
    "unknown";
  const requestId = buildIdeaCatalystRequisitionRequestId(requisitionId);
  const existing =
    paperIngestion.queuedRequests.find((entry) => entry.requestId === requestId) ??
    paperIngestion.queuedRequests.find(
      (entry) =>
        entry.triggerKind === "idea_catalyst_requisition" &&
        entry.detail?.includes(String(requisitionId))
    ) ??
    null;
  if (existing && isIdeaCatalystQueuedRequestActive(existing.status)) {
    return {
      created: false,
      reason: "An IDEA-CATALYST requisition-backed ingestion request already exists.",
      state: paperIngestion,
      request: existing,
    };
  }

  const graphStatus =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(projectRoot, "graph/PAPERNEXUS_STATUS.json") ?? ""
    )) ?? null;
  const sharedCorpus =
    pickString(graphStatus ?? {}, ["corpus_name", "corpusName"]) ??
    paperIngestion.repairTargetCorpus ??
    null;
  const batchManifestRelativePath = path.join(
    "researcher",
    "idea-catalyst",
    "requisition",
    sanitizeIdFragment(requisitionId),
    "batch-import.json"
  );
  const batchManifestResolvedPath = resolveProjectArtifactPath(
    projectRoot,
    batchManifestRelativePath
  );
  if (!batchManifestResolvedPath) {
    throw new Error("Could not resolve the IDEA-CATALYST requisition batch manifest path.");
  }
  await writeJsonEnsured(
    batchManifestResolvedPath,
    buildIdeaCatalystRequisitionBatchManifest({
      requisition,
      sharedCorpus,
    })
  );

  const normalizedRequest = normalizePaperIngestionQueuedRequest({
    request_id: requestId,
    status: "queued",
    wrapper: "pn_batch_import.py",
    args: [],
    command_text: buildIdeaCatalystRequisitionCommandText({
      projectRoot,
      requisitionPath: ideaCatalyst.investigationRequisitionPath,
      batchManifestPath: batchManifestRelativePath,
      sharedCorpus,
      requestId,
      requisition,
    }),
    manifest_path: batchManifestRelativePath,
    shared_corpus: sharedCorpus,
    paper_count:
      pickNumber(requisition, [
        "minimum_bridge_nodes",
        "minimumBridgeNodes",
      ]) ??
      null,
    summary: `IDEA-CATALYST requisition ${requisitionId} for ${(
      Array.isArray(requisition.missing_domains) ? requisition.missing_domains : []
    ).join(", ") || "cross-domain bridge acquisition"}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    detail: `Structured requisition ${requisitionId} emitted by IDEA-CATALYST; route it through graph_build before rerunning IDEA.`,
    trigger_kind: "idea_catalyst_requisition",
  });
  if (!normalizedRequest) {
    throw new Error("Failed to normalize the IDEA-CATALYST requisition queue request.");
  }

  const currentCycle = ideaCatalyst.lastRequisitionCycle;
  const defaultRetryBudget =
    pickNumber(requisition, ["retry_budget", "retryBudget"]) ?? null;
  const sameCycle = currentCycle === requisitionId;
  const isRetryAttempt = sameCycle && existing !== null;
  const nextRetryBudget =
    isRetryAttempt && ideaCatalyst.requisitionRetryBudget != null
      ? Math.max(0, ideaCatalyst.requisitionRetryBudget - 1)
      : ideaCatalyst.requisitionRetryBudget ?? defaultRetryBudget;
  const nextSaturated =
    typeof nextRetryBudget === "number" ? nextRetryBudget <= 0 : false;
  if (nextSaturated) {
    manifest.idea_catalyst = serializeIdeaCatalystState({
      ...ideaCatalyst,
      requisitionRequired: true,
      status: "requisition",
      microStage: "gatekeeping",
      lastRequisitionCycle: requisitionId,
      requisitionRetryBudget: nextRetryBudget,
      requisitionSaturated: true,
      pendingReason:
        ideaCatalyst.pendingReason ??
        "IDEA-CATALYST requisition retry budget is exhausted; revise the bridge search strategy before retrying.",
      lastUpdatedAt: new Date().toISOString(),
    });
    await writeJsonEnsured(manifestPath, manifest);
    return {
      created: false,
      reason: "IDEA-CATALYST requisition retry budget is exhausted for the current cycle.",
      state: paperIngestion,
      request: null,
      requisitionPath: ideaCatalyst.investigationRequisitionPath,
      batchManifestPath: batchManifestRelativePath,
    };
  }

  const nextPaperIngestion = {
    ...paperIngestion,
    queuedRequests: [...paperIngestion.queuedRequests, normalizedRequest],
    lastUpdatedAt: normalizedRequest.updatedAt ?? new Date().toISOString(),
  };
  manifest.paper_ingestion = serializePaperIngestionState(nextPaperIngestion);
  manifest.idea_catalyst = serializeIdeaCatalystState({
    ...ideaCatalyst,
    requisitionRequired: true,
    status: "requisition",
    microStage: "gatekeeping",
    lastRequisitionCycle: requisitionId,
    requisitionRetryBudget: nextRetryBudget,
    requisitionSaturated: false,
    pendingReason:
      ideaCatalyst.pendingReason ??
      "IDEA-CATALYST issued a requisition-backed graph enrichment request.",
    lastUpdatedAt: normalizedRequest.updatedAt ?? new Date().toISOString(),
  });
  await writeJsonEnsured(manifestPath, manifest);

  return {
    created: true,
    state: nextPaperIngestion,
    request: normalizedRequest,
    requisitionPath: ideaCatalyst.investigationRequisitionPath,
    batchManifestPath: batchManifestRelativePath,
  };
}
