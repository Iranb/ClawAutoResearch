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
  trigger?: string | null;
};

type PaperSourceEntry = {
  canonicalId: string | null;
  title: string | null;
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
  collections: ZoteroCollectionTarget[];
  generatedAt: string;
}): string {
  const lines = [
    "# Zotero Sync Packet",
    "",
    `- collection path: ${params.zoteroProjectPath}`,
    `- trigger: ${params.trigger}`,
    `- generated at: ${params.generatedAt}`,
    "- status: pending",
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

export async function materializeZoteroSyncPacket(
  params: MaterializeZoteroSyncPacketParams
): Promise<{
  projectId: string | null;
  zoteroProjectPath: string | null;
  trigger: string;
  status: "pending";
  removalPolicy: "remove_from_project_collections_only";
  deleteMissingItems: false;
  trashMissingItems: false;
  collections: ZoteroCollectionTarget[];
  packetPath: string;
  markdownPath: string;
}> {
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
  const trigger = asString(params.trigger) ?? "manual_command";
  const generatedAt = new Date().toISOString();
  const packetPath = path.join(params.projectRoot, "researcher", "ZOTERO_SYNC_PACKET.json");
  const markdownPath = path.join(params.projectRoot, "researcher", "ZOTERO_PACKET.md");
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
  const packet = {
    schema_version: 1,
    generated_at: generatedAt,
    project_id: projectId,
    trigger,
    status: "pending" as const,
    zotero_project_path: zoteroProjectPath,
    removal_policy: "remove_from_project_collections_only" as const,
    delete_missing_items: false as const,
    trash_missing_items: false as const,
    collections: collections.map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      canonical_ids: entry.canonicalIds,
    })),
  };
  await writeJsonEnsured(packetPath, packet);
  await writeTextEnsured(
    markdownPath,
    buildPacketMarkdown({
      zoteroProjectPath: zoteroProjectPath ?? "unset",
      trigger,
      collections,
      generatedAt,
    })
  );
  return {
    projectId,
    zoteroProjectPath,
    trigger,
    status: "pending",
    removalPolicy: "remove_from_project_collections_only",
    deleteMissingItems: false,
    trashMissingItems: false,
    collections,
    packetPath,
    markdownPath,
  };
}
