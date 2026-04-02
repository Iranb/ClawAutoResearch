import type { GraphPresenceStatus } from "../graph-presence";
import type { UnknownRecord } from "./types";

export function normalizeStage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function normalizeGraphPresenceStatus(
  value: unknown
): GraphPresenceStatus | null {
  const normalized = normalizeStage(value);
  if (
    normalized === "ready" ||
    normalized === "missing_papers" ||
    normalized === "missing_corpus" ||
    normalized === "missing_sources"
  ) {
    return normalized;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

export function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
  );
}

export function pickString(
  source: UnknownRecord,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

export function pickNumber(
  source: UnknownRecord,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function pickBoolean(
  source: UnknownRecord,
  keys: string[]
): boolean | null {
  for (const key of keys) {
    if (typeof source[key] === "boolean") {
      return source[key] as boolean;
    }
  }
  return null;
}
