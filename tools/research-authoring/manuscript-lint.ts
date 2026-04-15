import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { nowIso, projectPathExists, writeProjectJson } from "../research-contracts/core/project-io";

const LINT_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "placeholder_table", pattern: /Table\??\s*\?\?/g },
  { code: "placeholder_figure", pattern: /Figure\??\s*\?\?/g },
  { code: "anonymous_template", pattern: /Anonymous Author\(s\)|Affiliation|Address|email/gi },
  { code: "analyzer_residue", pattern: /\[analyzer\]/gi },
  { code: "double_question_ref", pattern: /\?\?/g },
];

async function collectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(resolved);
      } else if (/\.(tex|md|txt)$/i.test(entry.name)) {
        results.push(resolved);
      }
    }
  }
  await walk(root);
  return results;
}

export async function materializeManuscriptLintReport(params: {
  projectRoot: string;
  outputPath?: string;
}) {
  const root = path.join(params.projectRoot, "academic_writer");
  const issues: Array<{ code: string; file: string; count: number }> = [];
  if (await projectPathExists(params.projectRoot, "academic_writer")) {
    const files = await collectFiles(root);
    for (const filePath of files) {
      const text = await fs.readFile(filePath, "utf8");
      for (const rule of LINT_PATTERNS) {
        const count = (text.match(rule.pattern) ?? []).length;
        if (count > 0) {
          issues.push({
            code: rule.code,
            file: path.relative(params.projectRoot, filePath).replace(/\\/g, "/"),
            count,
          });
        }
      }
    }
  }
  const report = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    status: issues.length === 0 ? "clean" : "needs_revision",
    issueCount: issues.length,
    issues,
  };
  await writeProjectJson(
    params.projectRoot,
    params.outputPath ?? "academic_writer/MANUSCRIPT_LINT_REPORT.json",
    report
  );
  return report;
}
