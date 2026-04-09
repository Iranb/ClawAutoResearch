const BLOCKER_LABEL_RULES: ReadonlyArray<readonly [string, string]> = [
  ["missing_sources", "missing sources"],
  ["missing sources", "missing sources"],
  ["graph_presence", "missing graph artifacts"],
  ["missing graph artifacts", "missing graph artifacts"],
  ["waiting selection", "waiting selection"],
  ["review", "review pending"],
  ["writing contract", "writing contract missing"],
] as const;

function normalizeReason(reason: string): string {
  return reason.trim().toLowerCase();
}

export function toBlockerLabel(
  blockerReason: string | null | undefined,
): string | null {
  if (!blockerReason) {
    return null;
  }

  const normalizedReason = normalizeReason(blockerReason);

  for (const [needle, label] of BLOCKER_LABEL_RULES) {
    if (normalizedReason.includes(needle)) {
      return label;
    }
  }

  return "blocked";
}
