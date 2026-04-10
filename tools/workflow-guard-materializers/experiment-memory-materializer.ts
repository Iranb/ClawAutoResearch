import * as path from "node:path";
import {
  asRecord,
  asString,
  asStringArray,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import { readJsonIfExists, writeJsonEnsured } from "../workflow-guard-core/fs";
import {
  loadExperimentSearchState,
  saveExperimentSearchStateFile,
} from "../workflow-guard-experiment-history";
import {
  serializeExperimentSearchState,
} from "../workflow-guard-state/execution-state";

type MaterializerDeps = {
  readManifestEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
  saveManifest: (
    projectRoot: string,
    manifest: Record<string, unknown>
  ) => Promise<void>;
  readExperimentLedgerEnsured: (projectRoot: string) => Promise<Record<string, unknown>>;
};

function resolveProjectPath(projectRoot: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(projectRoot, targetPath);
}

function sortDesc<T>(values: T[], getTime: (value: T) => string | null): T[] {
  return [...values].sort((left, right) =>
    (getTime(right) ?? "").localeCompare(getTime(left) ?? "")
  );
}

function getEntryTimestamp(entry: Record<string, unknown>): string | null {
  return (
    pickString(entry, ["updatedAt", "updated_at"]) ??
    pickString(entry, ["completedAt", "completed_at"]) ??
    pickString(entry, ["launchedAt", "launched_at"]) ??
    null
  );
}

function getEntryMetadata(entry: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(entry.metadata);
}

function buildComparableRun(entry: Record<string, unknown>) {
  const metadata = getEntryMetadata(entry);
  const searchGit = asRecord(metadata?.searchGit ?? metadata?.search_git);
  return {
    experiment_id:
      pickString(entry, ["experimentId", "experiment_id"]) ?? "unknown-experiment",
    track_id: pickString(entry, ["trackId", "track_id"]),
    status: pickString(entry, ["status"]),
    decision: pickString(entry, ["decision"]),
    key_metric: asRecord(entry.keyMetric ?? entry.key_metric ?? entry.metric),
    summary: pickString(entry, ["summary"]),
    updated_at: getEntryTimestamp(entry),
    git_lineage: {
      incumbent_branch: pickString(searchGit ?? {}, [
        "incumbentBranch",
        "incumbent_branch",
      ]),
      incumbent_commit: pickString(searchGit ?? {}, [
        "incumbentCommit",
        "incumbent_commit",
      ]),
      candidate_branch: pickString(searchGit ?? {}, [
        "candidateBranch",
        "candidate_branch",
      ]),
      candidate_commit: pickString(searchGit ?? {}, [
        "candidateCommit",
        "candidate_commit",
      ]),
      retained:
        searchGit?.retained === true ||
        pickString(entry, ["decision"]) === "advance",
    },
  };
}

function buildExperimentMemoryPacket(params: {
  trackId: string | null;
  baselineReference: string | null;
  primaryMetric: string | null;
  ledger: Record<string, unknown>;
  searchState: ReturnType<typeof serializeExperimentSearchState> | Record<string, unknown>;
  now: string;
}) {
  const experiments = Array.isArray(params.ledger.experiments)
    ? params.ledger.experiments
    : [];
  const filtered = experiments
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null
    )
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => {
      if (!params.trackId) {
        return true;
      }
      return pickString(entry, ["trackId", "track_id"]) === params.trackId;
    });
  const ordered = sortDesc(filtered, getEntryTimestamp);

  const successful = ordered.filter((entry) =>
    ["advance", "keep"].includes(
      (pickString(entry, ["decision"]) ?? "").toLowerCase()
    )
  );
  const failed = ordered.filter((entry) =>
    ["discard", "failed", "timeout", "stalled", "killed", "cancelled"].includes(
      (pickString(entry, ["decision", "status"]) ?? "").toLowerCase()
    )
  );
  const repair = ordered.filter((entry) => {
    const notes = asStringArray(entry.notes);
    return notes.some((note) => /repair|debug|fix/i.test(note));
  });
  const graphRefs = uniqueStrings(
    ordered.flatMap((entry) => {
      const papernexusSync = asRecord(entry.papernexusSync ?? entry.papernexus_sync);
      return [
        ...asStringArray(entry.evidencePointers ?? entry.evidence_pointers),
        ...asStringArray(papernexusSync?.nodeRefs ?? papernexusSync?.node_refs),
      ];
    })
  );
  const searchRecord = asRecord(params.searchState);
  const openFrontiers = uniqueStrings([
    ...asStringArray(
      searchRecord?.frontierExperimentIds ?? searchRecord?.frontier_experiment_ids
    ),
    ...asStringArray(searchRecord?.frontierNodeIds ?? searchRecord?.frontier_node_ids),
  ]);

  return {
    track_id: params.trackId,
    baseline_reference: params.baselineReference,
    primary_metric: params.primaryMetric,
    comparable_runs: ordered.slice(0, 12).map(buildComparableRun),
    successful_patterns: successful.slice(0, 6).map((entry) => ({
      experiment_id: pickString(entry, ["experimentId", "experiment_id"]),
      summary: pickString(entry, ["summary"]),
      decision: pickString(entry, ["decision"]),
      notes: asStringArray(entry.notes),
    })),
    failure_patterns: failed.slice(0, 8).map((entry) => ({
      experiment_id: pickString(entry, ["experimentId", "experiment_id"]),
      status: pickString(entry, ["status"]),
      decision: pickString(entry, ["decision"]),
      failure_signature: pickString(entry, [
        "failureSignature",
        "failure_signature",
      ]),
      notes: asStringArray(entry.notes),
    })),
    repair_patterns: repair.slice(0, 6).map((entry) => ({
      experiment_id: pickString(entry, ["experimentId", "experiment_id"]),
      notes: asStringArray(entry.notes),
      updated_at: getEntryTimestamp(entry),
    })),
    do_not_repeat_constraints: uniqueStrings(
      failed
        .flatMap((entry) => [
          pickString(entry, ["failureSignature", "failure_signature"]),
          ...asStringArray(entry.notes),
        ])
        .filter((entry): entry is string => Boolean(entry))
    ).slice(0, 12),
    open_frontiers: openFrontiers,
    graph_refs: graphRefs,
    last_materialized_at: params.now,
    reflected_through_experiment_update_at:
      pickString(params.ledger, ["updatedAt", "updated_at"]) ?? null,
  };
}

function buildExperimentMemorySyncStatus(params: {
  packetPath: string;
  ledger: Record<string, unknown>;
  now: string;
}) {
  const experiments = Array.isArray(params.ledger.experiments)
    ? params.ledger.experiments
    : [];
  const terminal = experiments
    .map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null
    )
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) =>
      ["done", "failed", "timeout", "stalled", "killed", "cancelled", "merged", "completed"].includes(
        (pickString(entry, ["status"]) ?? "").toLowerCase()
      )
    );
  const pendingExperimentIds = terminal
    .filter((entry) => {
      const sync = asRecord(entry.papernexusSync ?? entry.papernexus_sync);
      const status = (pickString(sync ?? {}, ["status"]) ?? "pending").toLowerCase();
      return ["pending", "failed", "missing", ""].includes(status);
    })
    .map((entry) => pickString(entry, ["experimentId", "experiment_id"]))
    .filter((entry): entry is string => Boolean(entry));
  const lastSyncedExperimentIds = terminal
    .filter((entry) => {
      const sync = asRecord(entry.papernexusSync ?? entry.papernexus_sync);
      return (pickString(sync ?? {}, ["status"]) ?? "").toLowerCase() === "synced";
    })
    .map((entry) => pickString(entry, ["experimentId", "experiment_id"]))
    .filter((entry): entry is string => Boolean(entry));
  return {
    status: pendingExperimentIds.length > 0 ? "pending" : "synced",
    last_sync_started_at: params.now,
    last_sync_completed_at: params.now,
    pending_experiment_ids: pendingExperimentIds,
    last_synced_experiment_ids: lastSyncedExperimentIds,
    last_packet_path: params.packetPath,
    pending_reason:
      pendingExperimentIds.length > 0
        ? "terminal experiment outcomes still need PaperNexus/graph reconciliation"
        : null,
  };
}

export async function materializeExperimentMemoryPacketImpl(
  params: {
    projectRoot: string;
    experimentMemoryMaterialization?: Record<string, unknown>;
  },
  deps: MaterializerDeps
): Promise<{
  packetPath: string;
  syncStatusPath: string;
  packet: Record<string, unknown>;
  syncStatus: Record<string, unknown>;
  searchStatePath: string;
}> {
  const now = new Date().toISOString();
  const manifest = await deps.readManifestEnsured(params.projectRoot);
  const manifestMemory = asRecord(manifest.experiment_memory) ?? {};
  const manifestResearchProgram = asRecord(manifest.research_program) ?? {};
  const patch = asRecord(params.experimentMemoryMaterialization) ?? {};
  const ledger = await deps.readExperimentLedgerEnsured(params.projectRoot);
  const searchState = await loadExperimentSearchState({
    projectRoot: params.projectRoot,
    manifest,
    readJsonIfExists,
  });
  const packetPath =
    pickString(patch, ["packetPath", "packet_path"]) ??
    pickString(manifestMemory, ["graph_memory_packet_path"]) ??
    searchState.graphMemoryPacketPath ??
    "researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json";
  const syncStatusPath =
    pickString(patch, ["syncStatusPath", "sync_status_path"]) ??
    pickString(manifestMemory, ["graph_memory_sync_status_path"]) ??
    "researcher/papernexus/EXPERIMENT_MEMORY_SYNC_STATUS.json";
  const trackId =
    pickString(patch, ["trackId", "track_id"]) ?? searchState.trackId ?? null;
  const packet = buildExperimentMemoryPacket({
    trackId,
    baselineReference:
      pickString(manifest, ["baseline_reference"]) ??
      pickString(manifestResearchProgram, [
        "baseline_reference",
        "baselineReference",
      ]),
    primaryMetric:
      pickString(manifest, ["primary_metric"]) ??
      pickString(manifestResearchProgram, [
        "primary_metric",
        "primaryMetric",
      ]),
    ledger,
    searchState: serializeExperimentSearchState(searchState),
    now,
  });
  const syncStatus = buildExperimentMemorySyncStatus({
    packetPath,
    ledger,
    now,
  });
  await writeJsonEnsured(resolveProjectPath(params.projectRoot, packetPath), packet);
  await writeJsonEnsured(resolveProjectPath(params.projectRoot, syncStatusPath), syncStatus);

  manifest.experiment_memory = {
    ...manifestMemory,
    graph_memory_packet_path: packetPath,
    graph_memory_sync_status_path: syncStatusPath,
    graph_memory_last_materialized_at: now,
  };
  const updatedSearchState = {
    ...searchState,
    graphMemoryPacketPath: packetPath,
    graphMemorySyncStatus: asString(syncStatus.status) ?? "pending",
    lastGraphMemoryRefreshAt: now,
  };
  manifest.experiment_search = serializeExperimentSearchState(updatedSearchState);
  await saveExperimentSearchStateFile({
    projectRoot: params.projectRoot,
    state: updatedSearchState,
    writeJsonEnsured,
  });
  await deps.saveManifest(params.projectRoot, manifest);

  return {
    packetPath,
    syncStatusPath,
    packet,
    syncStatus,
    searchStatePath:
      updatedSearchState.searchStatePath ?? "researcher/EXPERIMENT_SEARCH.json",
  };
}
