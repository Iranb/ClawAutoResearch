import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const JS_RUNTIME_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".node"];
const CONFLICT_COPY_RUNTIME_ARTIFACT_PATTERN =
  / [0-9]+\.(?:[cm]?js|d\.[cm]?ts)(?:\.map)?$/;
const TS_SOURCE_SUFFIXES = [
  [".ts", ".js"],
  [".mts", ".mjs"],
  [".cts", ".cjs"],
];

async function walkFiles(rootDir, predicate) {
  const results = [];

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!predicate || predicate(entryPath)) {
        results.push(entryPath);
      }
    }
  }

  await visit(rootDir);
  return results;
}

function hasRuntimeExtension(specifier) {
  return JS_RUNTIME_EXTENSIONS.some((extension) => specifier.endsWith(extension));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isConflictCopyRuntimeArtifact(filePath) {
  return CONFLICT_COPY_RUNTIME_ARTIFACT_PATTERN.test(path.basename(filePath));
}

async function removeConflictCopyRuntimeArtifacts(distRoot) {
  const conflictArtifacts = await walkFiles(distRoot, isConflictCopyRuntimeArtifact);
  for (const artifactPath of conflictArtifacts) {
    await fs.rm(artifactPath, { force: true });
  }
  return conflictArtifacts;
}

async function syncTemplatesDir({ repoRoot, distRoot }) {
  const sourceTemplatesRoot = path.join(repoRoot, "templates");
  const distTemplatesRoot = path.join(distRoot, "templates");
  if (!(await fileExists(sourceTemplatesRoot))) {
    return false;
  }
  await fs.rm(distTemplatesRoot, { recursive: true, force: true });
  await fs.cp(sourceTemplatesRoot, distTemplatesRoot, { recursive: true });
  return true;
}

async function resolveRuntimeSpecifier(filePath, specifier) {
  if (!specifier.startsWith(".")) {
    return specifier;
  }

  const fileDir = path.dirname(filePath);
  const directBase = path.resolve(fileDir, specifier);
  const candidates = [];

  if (hasRuntimeExtension(specifier)) {
    return specifier;
  }

  for (const [sourceSuffix, runtimeSuffix] of TS_SOURCE_SUFFIXES) {
    if (specifier.endsWith(sourceSuffix)) {
      candidates.push({
        runtimePath: directBase.slice(0, -sourceSuffix.length) + runtimeSuffix,
        replacement: specifier.slice(0, -sourceSuffix.length) + runtimeSuffix,
      });
    }
  }

  candidates.push(
    ...JS_RUNTIME_EXTENSIONS.map((extension) => ({
      runtimePath: `${directBase}${extension}`,
      replacement: `${specifier}${extension}`,
    })),
    ...JS_RUNTIME_EXTENSIONS.map((extension) => ({
      runtimePath: path.join(directBase, `index${extension}`),
      replacement: `${specifier}/index${extension}`,
    }))
  );

  for (const candidate of candidates) {
    if (await fileExists(candidate.runtimePath)) {
      return candidate.replacement;
    }
  }

  return specifier;
}

async function rewriteRelativeSpecifiers(filePath) {
  const original = await fs.readFile(filePath, "utf8");
  const replacements = [];
  const patterns = [
    { regex: /(from\s+)(["'])(\.[^"'()\s]+)\2/g, specifierIndex: 3 },
    {
      regex: /(^|[;\n]\s*)(import\s+)(["'])(\.[^"'()\s]+)\3/gm,
      specifierIndex: 4,
    },
    {
      regex: /(import\s*\(\s*)(["'])(\.[^"'()\s]+)\2(\s*\))/g,
      specifierIndex: 3,
    },
  ];

  for (const pattern of patterns) {
    for (const match of original.matchAll(pattern.regex)) {
      const specifier = match[pattern.specifierIndex];
      const offset = match.index ?? -1;
      if (typeof specifier !== "string" || offset < 0) {
        continue;
      }
      const replacement = await resolveRuntimeSpecifier(filePath, specifier);
      if (replacement === specifier) {
        continue;
      }
      replacements.push({
        start: offset,
        end: offset + match[0].length,
        originalText: match[0],
        nextText: match[0].replace(specifier, replacement),
      });
    }
  }

  if (replacements.length === 0) {
    return false;
  }

  replacements.sort((left, right) => left.start - right.start);
  let rewritten = "";
  let cursor = 0;
  for (const replacement of replacements) {
    if (replacement.start < cursor) {
      continue;
    }
    rewritten += original.slice(cursor, replacement.start);
    rewritten += replacement.nextText;
    cursor = replacement.end;
  }
  rewritten += original.slice(cursor);

  if (rewritten === original) {
    return false;
  }

  await fs.writeFile(filePath, rewritten, "utf8");
  return true;
}

async function copyJsOnlyToolHelpers({ toolsRoot, distToolsRoot }) {
  if (!(await fileExists(toolsRoot))) {
    return [];
  }

  const helperFiles = await walkFiles(
    toolsRoot,
    (entryPath) => entryPath.endsWith(".js")
  );
  const copied = [];

  for (const helperFile of helperFiles) {
    const siblingTs = helperFile.slice(0, -3) + ".ts";
    if (await fileExists(siblingTs)) {
      continue;
    }
    const relativePath = path.relative(toolsRoot, helperFile);
    const distPath = path.join(distToolsRoot, relativePath);
    await fs.mkdir(path.dirname(distPath), { recursive: true });
    await fs.copyFile(helperFile, distPath);
    copied.push(distPath);
  }

  return copied;
}

export async function prepareDistRuntime({
  repoRoot = process.cwd(),
  distRoot = path.join(repoRoot, "dist"),
  toolsRoot = path.join(repoRoot, "tools"),
} = {}) {
  if (!(await fileExists(distRoot))) {
    throw new Error(`dist root not found: ${distRoot}`);
  }

  const removedConflictArtifacts =
    await removeConflictCopyRuntimeArtifacts(distRoot);
  const distToolsRoot = path.join(distRoot, "tools");
  const templatesCopied = await syncTemplatesDir({ repoRoot, distRoot });
  const copiedHelpers = await copyJsOnlyToolHelpers({ toolsRoot, distToolsRoot });
  const runtimeFiles = await walkFiles(
    distRoot,
    (entryPath) =>
      entryPath.endsWith(".js") ||
      entryPath.endsWith(".mjs") ||
      entryPath.endsWith(".cjs")
  );

  let rewrittenCount = 0;
  for (const runtimeFile of runtimeFiles) {
    if (await rewriteRelativeSpecifiers(runtimeFile)) {
      rewrittenCount += 1;
    }
  }

  return {
    copiedHelpers,
    removedConflictArtifactCount: removedConflictArtifacts.length,
    templatesCopied,
    runtimeFileCount: runtimeFiles.length,
    rewrittenCount,
  };
}

async function main() {
  const [distRootArg, toolsRootArg] = process.argv.slice(2);
  const repoRoot = process.cwd();
  const result = await prepareDistRuntime({
    repoRoot,
    distRoot: distRootArg ? path.resolve(distRootArg) : path.join(repoRoot, "dist"),
    toolsRoot: toolsRootArg ? path.resolve(toolsRootArg) : path.join(repoRoot, "tools"),
  });

  console.log(
    `[prepare-dist-runtime] copied_helpers=${result.copiedHelpers.length} templates_copied=${result.templatesCopied} rewritten_files=${result.rewrittenCount} scanned_runtime_files=${result.runtimeFileCount}`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error("[prepare-dist-runtime] failed");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
