import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CONFLICT_COPY_BASENAME_PATTERN = / [0-9]+(?:\..*)?$/;
const DEFAULT_SKIPPED_DIR_NAMES = new Set([
  ".git",
  ".gitnexus",
  ".next",
  ".nuxt",
  ".openclaw-research",
  ".vitepress",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const SOURCE_IMPORTER_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const RELATIVE_JS_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isConflictCopyBasename(name) {
  return CONFLICT_COPY_BASENAME_PATTERN.test(name);
}

function stripDirectoryConflictCopySuffix(name) {
  return name.replace(/ [0-9]+$/, "");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripImportSpecifierSuffix(specifier) {
  return specifier.split(/[?#]/, 1)[0];
}

function isSourceImporterFile(filePath) {
  return SOURCE_IMPORTER_EXTENSIONS.has(path.extname(filePath));
}

function isRelativeJavaScriptSpecifier(specifier) {
  const cleanSpecifier = stripImportSpecifierSuffix(specifier);
  return (
    cleanSpecifier.endsWith(".js") &&
    (cleanSpecifier.startsWith("./") || cleanSpecifier.startsWith("../"))
  );
}

function extractRelativeJavaScriptImports(sourceText) {
  const imports = [];
  RELATIVE_JS_IMPORT_PATTERN.lastIndex = 0;
  let match;
  while ((match = RELATIVE_JS_IMPORT_PATTERN.exec(sourceText)) !== null) {
    const specifier = match[1];
    if (isRelativeJavaScriptSpecifier(specifier)) {
      imports.push(stripImportSpecifierSuffix(specifier));
    }
  }
  return imports;
}

function mergeSourceHygieneReports(conflictReport, jsShadowReport) {
  if (!jsShadowReport) {
    return conflictReport;
  }
  return {
    ...conflictReport,
    ok: conflictReport.ok && jsShadowReport.ok,
    jsShadowPairCount: jsShadowReport.shadowPairCount,
    jsShadowPairs: jsShadowReport.shadowPairs,
  };
}

export async function findIgnoredConflictCopies({
  repoRoot = process.cwd(),
  skippedDirNames = DEFAULT_SKIPPED_DIR_NAMES,
} = {}) {
  const root = path.resolve(repoRoot);
  const findings = [];

  async function visit(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      const relativePath = toPosixPath(path.relative(root, entryPath));

      if (entry.isDirectory()) {
        const canonicalDirName = stripDirectoryConflictCopySuffix(entry.name);
        if (
          skippedDirNames.has(entry.name) ||
          skippedDirNames.has(canonicalDirName)
        ) {
          continue;
        }
        if (isConflictCopyBasename(entry.name)) {
          findings.push({
            kind: "directory",
            path: relativePath,
          });
          continue;
        }
        await visit(entryPath);
        continue;
      }

      if (entry.isFile() && isConflictCopyBasename(entry.name)) {
        findings.push({
          kind: "file",
          path: relativePath,
        });
      }
    }
  }

  await visit(root);
  findings.sort((left, right) => left.path.localeCompare(right.path));
  return {
    ok: findings.length === 0,
    repoRoot: root,
    findingCount: findings.length,
    findings,
  };
}

export async function findSourceJavaScriptShadowPairs({
  repoRoot = process.cwd(),
  skippedDirNames = DEFAULT_SKIPPED_DIR_NAMES,
} = {}) {
  const root = path.resolve(repoRoot);
  const shadowPairs = [];
  const sourceFiles = [];

  async function visit(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (skippedDirNames.has(entry.name)) {
          continue;
        }
        await visit(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }
      if (isSourceImporterFile(entryPath)) {
        sourceFiles.push(entryPath);
      }
      if (!entry.name.endsWith(".js")) {
        continue;
      }
      const tsPath = entryPath.slice(0, -".js".length) + ".ts";
      if (!(await pathExists(tsPath))) {
        continue;
      }
      shadowPairs.push({
        kind: "source_js_shadow",
        jsPath: toPosixPath(path.relative(root, entryPath)),
        tsPath: toPosixPath(path.relative(root, tsPath)),
      });
    }
  }

  await visit(root);
  const pairByJavaScriptPath = new Map(
    shadowPairs.map((pair) => [path.resolve(root, pair.jsPath), pair])
  );
  for (const sourceFile of sourceFiles) {
    let sourceText;
    try {
      sourceText = await fs.readFile(sourceFile, "utf8");
    } catch {
      continue;
    }
    const importerPath = toPosixPath(path.relative(root, sourceFile));
    for (const specifier of extractRelativeJavaScriptImports(sourceText)) {
      const importedPath = path.resolve(path.dirname(sourceFile), specifier);
      const pair = pairByJavaScriptPath.get(importedPath);
      if (!pair) {
        continue;
      }
      if (!pair.importedBy) {
        pair.importedBy = [];
      }
      if (!pair.importedBy.includes(importerPath)) {
        pair.importedBy.push(importerPath);
      }
    }
  }
  for (const pair of shadowPairs) {
    pair.importedBy = pair.importedBy ?? [];
    pair.importedBy.sort();
    pair.sourceImportCount = pair.importedBy.length;
  }
  shadowPairs.sort((left, right) => left.jsPath.localeCompare(right.jsPath));
  return {
    ok: shadowPairs.length === 0,
    repoRoot: root,
    shadowPairCount: shadowPairs.length,
    shadowPairs,
  };
}

function usage() {
  return [
    "Usage: node scripts/check_source_hygiene.mjs [--root <repo>] [--json] [--fail-on-findings] [--include-js-shadows]",
    "",
    "Reports local macOS/iCloud conflict copies such as 'foo 2.ts'.",
    "With --include-js-shadows, also reports source .js files that shadow same-basename .ts files.",
    "The command is read-only and skips generated directories like dist, build, coverage, and node_modules.",
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    failOnFindings: false,
    includeJsShadows: false,
    json: false,
    root: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fail-on-findings") {
      parsed.failOnFindings = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--include-js-shadows") {
      parsed.includeJsShadows = true;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a value");
      }
      parsed.root = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

export function formatConflictCopyReport(report) {
  const jsShadowPairCount = report.jsShadowPairCount ?? 0;
  if (report.findingCount === 0 && jsShadowPairCount === 0) {
    return `source_hygiene_ok root=${report.repoRoot}`;
  }
  const lines = [];
  if (report.findingCount > 0) {
    lines.push(
      `source_hygiene_conflict_copies_found count=${report.findingCount} root=${report.repoRoot}`
    );
    for (const finding of report.findings) {
      lines.push(`- ${finding.kind}: ${finding.path}`);
    }
  }
  if (jsShadowPairCount > 0) {
    lines.push(
      `source_hygiene_js_shadows_found count=${jsShadowPairCount} root=${report.repoRoot}`
    );
    for (const pair of report.jsShadowPairs ?? []) {
      const importSuffix =
        pair.sourceImportCount > 0
          ? ` imported_by=${pair.sourceImportCount}`
          : " imported_by=0";
      lines.push(
        `- ${pair.kind}: ${pair.jsPath} shadows ${pair.tsPath}${importSuffix}`
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const conflictReport = await findIgnoredConflictCopies({ repoRoot: args.root });
  const jsShadowReport = args.includeJsShadows
    ? await findSourceJavaScriptShadowPairs({ repoRoot: args.root })
    : null;
  const report = mergeSourceHygieneReports(conflictReport, jsShadowReport);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatConflictCopyReport(report));
  }
  if (!report.ok && args.failOnFindings) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error("[check-source-hygiene] failed");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
