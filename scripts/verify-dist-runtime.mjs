import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RUNTIME_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".node"];
const RELATIVE_SPECIFIER_PATTERNS = [
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelativeSpecifier(filePath, specifier) {
  const basePath = path.resolve(path.dirname(filePath), specifier);

  for (const extension of RUNTIME_EXTENSIONS) {
    if (specifier.endsWith(extension)) {
      return (await fileExists(basePath)) ? basePath : null;
    }
  }

  for (const extension of RUNTIME_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  for (const extension of RUNTIME_EXTENSIONS) {
    const candidate = path.join(basePath, `index${extension}`);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function collectRelativeSpecifiers(contents) {
  const specifiers = [];
  for (const pattern of RELATIVE_SPECIFIER_PATTERNS) {
    for (const match of contents.matchAll(pattern.regex)) {
      const specifier = match[pattern.specifierIndex];
      if (typeof specifier === "string" && specifier.startsWith(".")) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

export async function verifyDistRuntime({ distRoot = path.join(process.cwd(), "dist") } = {}) {
  const runtimeFiles = await walkFiles(
    distRoot,
    (entryPath) =>
      entryPath.endsWith(".js") ||
      entryPath.endsWith(".mjs") ||
      entryPath.endsWith(".cjs")
  );

  const unresolved = [];
  const extensionless = [];

  for (const runtimeFile of runtimeFiles) {
    const contents = await fs.readFile(runtimeFile, "utf8");
    for (const specifier of collectRelativeSpecifiers(contents)) {
      if (!RUNTIME_EXTENSIONS.some((extension) => specifier.endsWith(extension))) {
        extensionless.push(`${runtimeFile}: ${specifier}`);
      }
      const resolved = await resolveRelativeSpecifier(runtimeFile, specifier);
      if (!resolved) {
        unresolved.push(`${runtimeFile}: ${specifier}`);
      }
    }
  }

  if (extensionless.length > 0 || unresolved.length > 0) {
    const problems = [
      ...extensionless.map((entry) => `extensionless import: ${entry}`),
      ...unresolved.map((entry) => `unresolved import: ${entry}`),
    ];
    throw new Error(problems.join("\n"));
  }

  return {
    runtimeFileCount: runtimeFiles.length,
  };
}

async function main() {
  const [distRootArg] = process.argv.slice(2);
  const distRoot = distRootArg
    ? path.resolve(distRootArg)
    : path.join(process.cwd(), "dist");

  const result = await verifyDistRuntime({ distRoot });
  console.log(
    `[verify-dist-runtime] relative_import_graph_ok runtime_files=${result.runtimeFileCount}`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error("[verify-dist-runtime] failed");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
