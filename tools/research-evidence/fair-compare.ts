import { nowIso, writeProjectJson } from "../research-contracts/core/project-io.ts";

export type FairCompareRow = {
  method: string;
  benchmark: string | null;
  metric: string | null;
  backbone: string | null;
  protocol: string | null;
  fairness: "same_backbone_same_protocol" | "backbone_confounded" | "protocol_confounded" | "unclear";
};

function parseMarkdownMatrix(text: string): FairCompareRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex((line) => line.startsWith("|") && /method/i.test(line));
  if (headerIndex < 0 || headerIndex + 1 >= lines.length) {
    return [];
  }
  const headers = lines[headerIndex]
    .split("|")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const rows: FairCompareRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line.split("|").map((entry) => entry.trim()).filter(Boolean);
    if (cells.length !== headers.length) {
      continue;
    }
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? null]));
    rows.push({
      method: String(row.method ?? "unknown"),
      benchmark: (row.dataset as string) ?? (row.benchmark as string) ?? null,
      metric: (row.metric as string) ?? null,
      backbone: (row.backbone as string) ?? null,
      protocol: (row.protocol as string) ?? (row.setting as string) ?? null,
      fairness:
        row.backbone && row.protocol
          ? "same_backbone_same_protocol"
          : row.backbone
            ? "protocol_confounded"
            : row.protocol
              ? "backbone_confounded"
              : "unclear",
    });
  }
  return rows;
}

export async function materializeFairCompareMatrix(params: {
  projectRoot: string;
  matrixText: string;
  outputPath?: string;
}) {
  const rows = parseMarkdownMatrix(params.matrixText);
  await writeProjectJson(
    params.projectRoot,
    params.outputPath ?? "analyzer/FAIR_COMPARE_MATRIX.json",
    {
      schemaVersion: 1,
      generatedAt: nowIso(),
      rows,
    }
  );
  return rows;
}
