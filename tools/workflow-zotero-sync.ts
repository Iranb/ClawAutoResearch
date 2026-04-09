import { createHash } from "node:crypto";
import * as path from "node:path";
import { asString } from "./workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "./workflow-guard-core/fs";
import { defaultResearchProgramZoteroProjectPath } from "./workflow-guard-project-state";

type ZoteroCollectionKind =
  | "selected"
  | "baselines"
  | "writing-shortlist";

export type ZoteroSyncStatus =
  | "pending"
  | "queued"
  | "running"
  | "synced"
  | "skipped"
  | "unavailable"
  | "failed"
  | "needs_manual_followup";

export type ZoteroSyncTrigger =
  | "manual_command"
  | "graph_build"
  | "auto_graph_refresh"
  | "auto_experiment_launch"
  | "auto_paper_set_changed"
  | "auto_retry_pending";

type ZoteroCollectionTarget = {
  kind: ZoteroCollectionKind;
  path: string;
  canonicalIds: string[];
};

type MaterializeZoteroSyncPacketParams = {
  projectRoot: string;
  projectId: string | null | undefined;
  explicitProjectPath?: string | null;
  zoteroProjectRoot?: string | null;
  trigger?: ZoteroSyncTrigger | string | null;
  triggerReason?: string | null;
};

type PaperSourceEntry = {
  canonicalId: string | null;
  title: string | null;
};

type ExperimentLedgerLike = {
  summary?: {
    activeExperimentIds?: unknown;
    active_experiment_ids?: unknown;
  } | null;
};

type StoredZoteroSyncPacket = {
  schema_version?: unknown;
  generated_at?: unknown;
  project_id?: unknown;
  trigger?: unknown;
  trigger_reason?: unknown;
  trigger_reason_detail?: unknown;
  status?: unknown;
  zotero_project_path?: unknown;
  removal_policy?: unknown;
  delete_missing_items?: unknown;
  trash_missing_items?: unknown;
  collection_fingerprint?: unknown;
  graph_last_built_at_seen?: unknown;
  active_experiment_ids_seen?: unknown;
  active_experiment_fingerprint_seen?: unknown;
  last_requested_at?: unknown;
  collections?: unknown;
};

export type ZoteroSyncStateSummary = {
  projectId: string | null;
  zoteroProjectPath: string | null;
  status: ZoteroSyncStatus | null;
  trigger: ZoteroSyncTrigger | string | null;
  triggerReason: string | null;
  lastRequestedAt: string | null;
  collectionFingerprint: string | null;
  graphLastBuiltAtSeen: string | null;
  activeExperimentIdsSeen: string[];
  activeExperimentFingerprintSeen: string | null;
  packetPath: string;
  markdownPath: string;
};

export type AutoZoteroSyncCandidate = {
  shouldLaunch: boolean;
  trigger: ZoteroSyncTrigger | null;
  triggerReason: string | null;
  dedupeKey: string | null;
  collectionFingerprint: string | null;
  graphLastBuiltAt: string | null;
  activeExperimentIds: string[];
  activeExperimentFingerprint: string | null;
  zoteroProjectPath: string | null;
  packetPath: string;
  markdownPath: string;
  currentPaperCount: number;
  status: ZoteroSyncStatus | null;
};

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
];

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => asString(value)).filter(Boolean))] as string[];
}

function hashStableJson(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function normalizeZoteroSyncStatus(value: unknown): ZoteroSyncStatus | null {
  const normalized = asString(value)?.toLowerCase() ?? null;
  switch (normalized) {
    case "pending":
    case "queued":
    case "running":
    case "synced":
    case "skipped":
    case "unavailable":
    case "failed":
    case "needs_manual_followup":
      return normalized;
    default:
      return null;
  }
}

function normalizeZoteroSyncTrigger(value: unknown): ZoteroSyncTrigger | string | null {
  const normalized = asString(value);
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case "manual_command":
    case "graph_build":
    case "auto_graph_refresh":
    case "auto_experiment_launch":
    case "auto_paper_set_changed":
    case "auto_retry_pending":
      return normalized;
    default:
      return normalized;
  }
}

function buildCollectionFingerprint(collections: ZoteroCollectionTarget[]): string | null {
  if (collections.length === 0) {
    return null;
  }
  return hashStableJson(
    collections.map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      canonicalIds: [...entry.canonicalIds].sort(),
    }))
  );
}

function collectActiveExperimentIds(raw: unknown): string[] {
  const ledger = raw && typeof raw === "object" ? (raw as ExperimentLedgerLike) : {};
  const values = Array.isArray(ledger.summary?.activeExperimentIds)
    ? ledger.summary?.activeExperimentIds
    : Array.isArray(ledger.summary?.active_experiment_ids)
      ? ledger.summary?.active_experiment_ids
      : [];
  return uniqueStrings((values as unknown[]).map((value) => asString(value)));
}

function buildExperimentFingerprint(activeExperimentIds: string[]): string | null {
  if (activeExperimentIds.length === 0) {
    return null;
  }
  return hashStableJson([...activeExperimentIds].sort());
}

function normalizePaperSourceEntries(raw: unknown): PaperSourceEntry[] {
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizePaperSourceEntry(entry));
  }
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const record = raw as Record<string, unknown>;
  for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).map((entry) => normalizePaperSourceEntry(entry));
    }
  }
  return [];
}

function normalizePaperSourceEntry(value: unknown): PaperSourceEntry {
  const record = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  return {
    canonicalId: asString(record.canonical_id ?? record.canonicalId),
    title: asString(record.title),
  };
}

function collectBaselineCanonicalIds(params: {
  paperEntries: PaperSourceEntry[];
  manifest: Record<string, unknown>;
}): string[] {
  const researchProgram =
    params.manifest.research_program &&
    typeof params.manifest.research_program === "object"
      ? (params.manifest.research_program as Record<string, unknown>)
      : {};
  const titleHints = uniqueStrings([
    asString(researchProgram.baseline_reference ?? researchProgram.baselineReference),
    ...((Array.isArray(researchProgram.required_baselines)
      ? researchProgram.required_baselines
      : Array.isArray(researchProgram.requiredBaselines)
        ? researchProgram.requiredBaselines
        : []) as unknown[]).map((entry) => asString(entry)),
  ]).map((entry) => entry.toLowerCase());

  if (titleHints.length === 0) {
    return [];
  }
  return uniqueStrings(
    params.paperEntries
      .filter((entry) => {
        const title = entry.title?.toLowerCase() ?? "";
        return Boolean(title) && titleHints.some((hint) => title.includes(hint));
      })
      .map((entry) => entry.canonicalId)
  );
}

function buildPacketMarkdown(params: {
  zoteroProjectPath: string;
  trigger: string;
  triggerReason: string | null;
  status: ZoteroSyncStatus;
  collectionFingerprint: string | null;
  collections: ZoteroCollectionTarget[];
  generatedAt: string;
}): string {
  const lines = [
    "# Zotero Sync Packet",
    "",
    `- collection path: ${params.zoteroProjectPath}`,
    `- trigger: ${params.trigger}`,
    `- trigger reason: ${params.triggerReason ?? "none"}`,
    `- generated at: ${params.generatedAt}`,
    `- status: ${params.status}`,
    `- collection fingerprint: ${params.collectionFingerprint ?? "none"}`,
    "- removal policy: remove from project collections only",
    "",
    "## Collections",
  ];
  for (const collection of params.collections) {
    lines.push(
      `- ${collection.kind}: ${collection.path} (${collection.canonicalIds.length} paper(s))`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function resolveEffectiveZoteroProjectPath(params: {
  projectId: string | null | undefined;
  explicitProjectPath?: string | null;
  zoteroProjectRoot?: string | null;
}): string | null {
  const explicitProjectPath = asString(params.explicitProjectPath);
  if (explicitProjectPath) {
    return explicitProjectPath;
  }
  return defaultResearchProgramZoteroProjectPath(
    params.projectId,
    params.zoteroProjectRoot
  );
}

async function loadZoteroSyncIntent(params: {
  projectRoot: string;
  projectId?: string | null;
  explicitProjectPath?: string | null;
  zoteroProjectRoot?: string | null;
}) {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const projectId =
    asString(params.projectId) ??
    asString(manifest.project_id) ??
    path.basename(params.projectRoot);
  const zoteroProjectPath =
    resolveEffectiveZoteroProjectPath({
      projectId,
      explicitProjectPath:
        params.explicitProjectPath ??
        asString(
          (manifest.research_program as Record<string, unknown> | undefined)
            ?.zotero_project_path
        ),
      zoteroProjectRoot: params.zoteroProjectRoot,
    });
  const paperSourceIndex =
    await readJsonIfExists<unknown>(
      path.join(params.projectRoot, "researcher", "PAPER_SOURCE_INDEX.json")
    );
  const paperEntries = normalizePaperSourceEntries(paperSourceIndex);
  const selectedCanonicalIds = uniqueStrings(paperEntries.map((entry) => entry.canonicalId));
  const baselineCanonicalIds = collectBaselineCanonicalIds({
    paperEntries,
    manifest,
  });
  const collections: ZoteroCollectionTarget[] = [
    {
      kind: "selected",
      path: `${zoteroProjectPath}/selected`,
      canonicalIds: selectedCanonicalIds,
    },
    {
      kind: "baselines",
      path: `${zoteroProjectPath}/baselines`,
      canonicalIds: baselineCanonicalIds,
    },
    {
      kind: "writing-shortlist",
      path: `${zoteroProjectPath}/writing-shortlist`,
      canonicalIds: [],
    },
  ];
  const collectionFingerprint = buildCollectionFingerprint(collections);
  const graphLastBuiltAt = asString(manifest.graph_last_built_at);
  const experimentLedger =
    await readJsonIfExists<ExperimentLedgerLike>(
      path.join(params.projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
    );
  const activeExperimentIds = collectActiveExperimentIds(experimentLedger);
  const activeExperimentFingerprint = buildExperimentFingerprint(activeExperimentIds);
  return {
    manifest,
    projectId,
    zoteroProjectPath,
    collections,
    collectionFingerprint,
    graphLastBuiltAt,
    activeExperimentIds,
    activeExperimentFingerprint,
  };
}

export async function readZoteroSyncStateSummary(params: {
  projectRoot: string;
  projectId?: string | null;
  explicitProjectPath?: string | null;
  zoteroProjectRoot?: string | null;
}): Promise<ZoteroSyncStateSummary> {
  const packetPath = path.join(params.projectRoot, "researcher", "ZOTERO_SYNC_PACKET.json");
  const markdownPath = path.join(params.projectRoot, "researcher", "ZOTERO_PACKET.md");
  const current = await loadZoteroSyncIntent(params);
  const packet =
    await readJsonIfExists<StoredZoteroSyncPacket>(packetPath);
  return {
    projectId: current.projectId,
    zoteroProjectPath:
      asString(packet?.zotero_project_path) ?? current.zoteroProjectPath,
    status: normalizeZoteroSyncStatus(packet?.status),
    trigger: normalizeZoteroSyncTrigger(packet?.trigger),
    triggerReason:
      asString(packet?.trigger_reason) ??
      asString(packet?.trigger_reason_detail) ??
      null,
    lastRequestedAt:
      asString(packet?.last_requested_at) ??
      asString(packet?.generated_at) ??
      null,
    collectionFingerprint:
      asString(packet?.collection_fingerprint) ?? current.collectionFingerprint,
    graphLastBuiltAtSeen: asString(packet?.graph_last_built_at_seen),
    activeExperimentIdsSeen: uniqueStrings(
      (Array.isArray(packet?.active_experiment_ids_seen)
        ? packet?.active_experiment_ids_seen
        : [])?.map((value) => asString(value)) ?? []
    ),
    activeExperimentFingerprintSeen:
      asString(packet?.active_experiment_fingerprint_seen) ?? null,
    packetPath,
    markdownPath,
  };
}

export async function deriveAutoZoteroSyncCandidate(params: {
  projectRoot: string;
  projectId?: string | null;
  explicitProjectPath?: string | null;
  zoteroProjectRoot?: string | null;
  stalePendingMs?: number;
}): Promise<AutoZoteroSyncCandidate> {
  const current = await loadZoteroSyncIntent(params);
  const summary = await readZoteroSyncStateSummary(params);
  const stalePendingMs = Math.max(60_000, params.stalePendingMs ?? 30 * 60 * 1000);
  const currentPaperCount = current.collections.reduce(
    (total, entry) => total + entry.canonicalIds.length,
    0
  );
  const stalePending =
    ["pending", "queued", "running"].includes(summary.status ?? "") &&
    Boolean(summary.lastRequestedAt) &&
    Date.now() - new Date(summary.lastRequestedAt ?? 0).getTime() >= stalePendingMs;
  let trigger: ZoteroSyncTrigger | null = null;
  let triggerReason: string | null = null;
  if (currentPaperCount === 0) {
    return {
      shouldLaunch: false,
      trigger: null,
      triggerReason: null,
      dedupeKey: null,
      collectionFingerprint: current.collectionFingerprint,
      graphLastBuiltAt: current.graphLastBuiltAt,
      activeExperimentIds: current.activeExperimentIds,
      activeExperimentFingerprint: current.activeExperimentFingerprint,
      zoteroProjectPath: current.zoteroProjectPath,
      packetPath: summary.packetPath,
      markdownPath: summary.markdownPath,
      currentPaperCount,
      status: summary.status,
    };
  }
  if (
    current.graphLastBuiltAt &&
    current.graphLastBuiltAt !== summary.graphLastBuiltAtSeen
  ) {
    trigger = "auto_graph_refresh";
    triggerReason = `Graph refresh observed at ${current.graphLastBuiltAt}.`;
  } else if (
    current.activeExperimentFingerprint &&
    current.activeExperimentFingerprint !== summary.activeExperimentFingerprintSeen
  ) {
    trigger = "auto_experiment_launch";
    triggerReason =
      `Experiment activity started for ${current.activeExperimentIds.join(", ")}.`;
  } else if (
    current.collectionFingerprint &&
    current.collectionFingerprint !== summary.collectionFingerprint
  ) {
    trigger = "auto_paper_set_changed";
    triggerReason = "Workflow paper selection changed since the last Zotero sync packet.";
  } else if (stalePending) {
    trigger = "auto_retry_pending";
    triggerReason =
      `Previous Zotero sync request stayed ${summary.status} since ${summary.lastRequestedAt}.`;
  }
  return {
    shouldLaunch: Boolean(trigger),
    trigger,
    triggerReason,
    dedupeKey: trigger
      ? [
          "workflow-auto-zotero",
          path.resolve(params.projectRoot),
          trigger,
          current.collectionFingerprint ?? "no-collections",
          current.graphLastBuiltAt ?? "no-graph-refresh",
          current.activeExperimentFingerprint ?? "no-active-experiments",
        ].join("::")
      : null,
    collectionFingerprint: current.collectionFingerprint,
    graphLastBuiltAt: current.graphLastBuiltAt,
    activeExperimentIds: current.activeExperimentIds,
    activeExperimentFingerprint: current.activeExperimentFingerprint,
    zoteroProjectPath: current.zoteroProjectPath,
    packetPath: summary.packetPath,
    markdownPath: summary.markdownPath,
    currentPaperCount,
    status: summary.status,
  };
}

export async function materializeZoteroSyncPacket(
  params: MaterializeZoteroSyncPacketParams
): Promise<{
  projectId: string | null;
  zoteroProjectPath: string | null;
  trigger: string;
  triggerReason: string | null;
  status: "pending";
  removalPolicy: "remove_from_project_collections_only";
  deleteMissingItems: false;
  trashMissingItems: false;
  collectionFingerprint: string | null;
  graphLastBuiltAtSeen: string | null;
  activeExperimentIdsSeen: string[];
  activeExperimentFingerprintSeen: string | null;
  collections: ZoteroCollectionTarget[];
  packetPath: string;
  markdownPath: string;
}> {
  const current = await loadZoteroSyncIntent(params);
  const trigger = asString(params.trigger) ?? "manual_command";
  const triggerReason = asString(params.triggerReason) ?? null;
  const generatedAt = new Date().toISOString();
  const packetPath = path.join(params.projectRoot, "researcher", "ZOTERO_SYNC_PACKET.json");
  const markdownPath = path.join(params.projectRoot, "researcher", "ZOTERO_PACKET.md");
  const packet = {
    schema_version: 2,
    generated_at: generatedAt,
    project_id: current.projectId,
    trigger,
    trigger_reason: triggerReason,
    status: "pending" as const,
    zotero_project_path: current.zoteroProjectPath,
    removal_policy: "remove_from_project_collections_only" as const,
    delete_missing_items: false as const,
    trash_missing_items: false as const,
    collection_fingerprint: current.collectionFingerprint,
    graph_last_built_at_seen: current.graphLastBuiltAt,
    active_experiment_ids_seen: current.activeExperimentIds,
    active_experiment_fingerprint_seen: current.activeExperimentFingerprint,
    last_requested_at: generatedAt,
    collections: current.collections.map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      canonical_ids: entry.canonicalIds,
    })),
  };
  await writeJsonEnsured(packetPath, packet);
  await writeTextEnsured(
    markdownPath,
    buildPacketMarkdown({
      zoteroProjectPath: current.zoteroProjectPath ?? "unset",
      trigger,
      triggerReason,
      status: "pending",
      collectionFingerprint: current.collectionFingerprint,
      collections: current.collections,
      generatedAt,
    })
  );
  return {
    projectId: current.projectId,
    zoteroProjectPath: current.zoteroProjectPath,
    trigger,
    triggerReason,
    status: "pending",
    removalPolicy: "remove_from_project_collections_only",
    deleteMissingItems: false,
    trashMissingItems: false,
    collectionFingerprint: current.collectionFingerprint,
    graphLastBuiltAtSeen: current.graphLastBuiltAt,
    activeExperimentIdsSeen: current.activeExperimentIds,
    activeExperimentFingerprintSeen: current.activeExperimentFingerprint,
    collections: current.collections,
    packetPath,
    markdownPath,
  };
}
