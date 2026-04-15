import * as path from "node:path";
import {
  readJsonIfExists,
  withAdvisoryLock,
  writeJsonAtomicEnsured,
} from "./workflow-guard-core/fs";
import {
  buildCanonicalPaperRecordFromRecord,
  mergeCanonicalPaperRecords,
  serializeCanonicalPaperRecord,
  type CanonicalPaperRecord,
} from "./paper-source-contract";

const PAPER_SOURCE_INDEX_CANDIDATE_KEYS = [
  "papers",
  "entries",
  "items",
  "sources",
  "canonical_papers",
  "canonicalPapers",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function resolvePaperSourceIndexPath(projectRoot: string): string {
  return path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
}

export function parsePaperSourceIndexEntries(raw: unknown): CanonicalPaperRecord[] {
  if (!raw) {
    return [];
  }
  let entries: Array<{ key?: string; value: unknown }> = [];
  if (Array.isArray(raw)) {
    entries = raw.map((value) => ({ value }));
  } else {
    const record = asRecord(raw);
    if (record) {
      for (const key of PAPER_SOURCE_INDEX_CANDIDATE_KEYS) {
        if (Array.isArray(record[key])) {
          entries = (record[key] as unknown[]).map((value) => ({ value }));
          break;
        }
        const nested = asRecord(record[key]);
        if (nested) {
          entries = Object.entries(nested).map(([nestedKey, value]) => ({
            key: nestedKey,
            value,
          }));
          break;
        }
      }
      if (entries.length === 0) {
        entries = Object.entries(record).map(([key, value]) => ({ key, value }));
      }
    }
  }

  const byCanonicalId = new Map<string, CanonicalPaperRecord>();
  for (const entry of entries) {
    const parsed = buildCanonicalPaperRecordFromRecord(entry.value, entry.key);
    if (!parsed) {
      continue;
    }
    const existing = byCanonicalId.get(parsed.canonicalId);
    byCanonicalId.set(
      parsed.canonicalId,
      existing ? mergeCanonicalPaperRecords(existing, parsed) : parsed
    );
  }
  return [...byCanonicalId.values()].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  );
}

export async function readPaperSourceIndexForUpdate(params: {
  projectRoot: string;
}): Promise<{
  sourceIndexPath: string;
  entries: CanonicalPaperRecord[];
}> {
  const sourceIndexPath = resolvePaperSourceIndexPath(params.projectRoot);
  const raw = await readJsonIfExists<unknown>(sourceIndexPath);
  return {
    sourceIndexPath,
    entries: parsePaperSourceIndexEntries(raw),
  };
}

export async function upsertPaperSourceIndexEntries(params: {
  projectRoot: string;
  entries: Array<CanonicalPaperRecord | Record<string, unknown>>;
}): Promise<{
  sourceIndexPath: string;
  entryCount: number;
  updatedCanonicalIds: string[];
}> {
  const sourceIndexPath = resolvePaperSourceIndexPath(params.projectRoot);
  const lockPath = `${sourceIndexPath}.lock`;
  return withAdvisoryLock({
    lockPath,
    task: async () => {
      const currentRaw = await readJsonIfExists<unknown>(sourceIndexPath);
      const byCanonicalId = new Map<string, CanonicalPaperRecord>();
      for (const entry of parsePaperSourceIndexEntries(currentRaw)) {
        byCanonicalId.set(entry.canonicalId, entry);
      }
      const updatedCanonicalIds: string[] = [];
      for (const rawEntry of params.entries) {
        const normalized =
          "canonicalId" in rawEntry
            ? (rawEntry as CanonicalPaperRecord)
            : buildCanonicalPaperRecordFromRecord(rawEntry);
        if (!normalized) {
          continue;
        }
        const existing = byCanonicalId.get(normalized.canonicalId);
        byCanonicalId.set(
          normalized.canonicalId,
          existing ? mergeCanonicalPaperRecords(existing, normalized) : normalized
        );
        updatedCanonicalIds.push(normalized.canonicalId);
      }
      const records = [...byCanonicalId.values()].sort((left, right) =>
        left.canonicalId.localeCompare(right.canonicalId)
      );
      await writeJsonAtomicEnsured(sourceIndexPath, {
        papers: records.map((record) => serializeCanonicalPaperRecord(record)),
      });
      return {
        sourceIndexPath,
        entryCount: records.length,
        updatedCanonicalIds: [...new Set(updatedCanonicalIds)],
      };
    },
  });
}
