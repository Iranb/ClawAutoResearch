#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE_PATTERN = /^tests\/.*\.test\.mjs$/;
const CODE_FILE_PATTERN = /\.(cjs|js|jsx|json|mjs|ts|tsx)$/;
const DEFAULT_BASE_REF = "HEAD";

const FALLBACK_RULES = [
  {
    script: "test:agents",
    testDir: "tests/agents",
    reason: "agent dispatch or capability routing changed",
    patterns: [/^agents\//, /^tools\/agent-/, /^tools\/capability-completion\//],
  },
  {
    script: "test:distribution",
    testDir: "tests/distribution",
    reason: "package, dist preparation, or runtime packaging changed",
    patterns: [
      /^package(-lock)?\.json$/,
      /^tsconfig\.json$/,
      /^openclaw\.plugin\.json$/,
      /^index\.ts$/,
      /^runtime-api\.ts$/,
      /^scripts\/prepare-dist-runtime\.mjs$/,
      /^scripts\/verify-dist-runtime\.mjs$/,
    ],
  },
  {
    script: "test:experiment",
    testDir: "tests/experiment",
    reason: "experiment planning, trial, or local execution code changed",
    patterns: [
      /^tools\/workflow-guard-materializers\/experiment-/,
      /^tools\/workflow-guard-state\/experiment/,
      /^tools\/workflow-guard-stages\/experiment/,
      /^tools\/research-orchestrator\//,
      /^tools\/research-contracts\//,
    ],
  },
  {
    script: "test:gateway",
    testDir: "tests/gateway",
    reason: "gateway runtime or isolated gateway code changed",
    patterns: [/^scripts\/gateway_/, /^scripts\/isolated_gateway_server\.mjs$/],
  },
  {
    script: "test:idea-catalyst",
    testDir: "tests/idea-catalyst",
    reason: "Idea-Catalyst contracts, runtime tools, or state changed",
    patterns: [/^tools\/idea-catalyst\//],
  },
  {
    script: "test:literature",
    testDir: "tests/literature",
    reason: "literature discovery, provider, or Research30 bridge changed",
    patterns: [/^tools\/literature-discovery\//, /^tools\/research30\//, /^scripts\/research30_bridge\.py$/],
  },
  {
    script: "test:paper-ingestion",
    testDir: "tests/paper-ingestion",
    reason: "paper ingestion, graph catch-up, or source index code changed",
    patterns: [
      /^tools\/graph-/,
      /^tools\/paper-/,
      /^tools\/workflow-guard-state\/paper-ingestion/,
      /^tools\/literature-discovery\/requisition-/,
    ],
  },
  {
    script: "test:papernexus",
    testDir: "tests/papernexus",
    reason: "PaperNexus packets, remote stage, or MCP integration changed",
    patterns: [/^tools\/papernexus/, /^scripts\/papernexus_remote_stage\.py$/, /^scripts\/local_papernexus_config\.mjs$/],
  },
  {
    script: "test:research-memory",
    testDir: "tests/research-memory",
    reason: "research memory or portfolio code changed",
    patterns: [/^tools\/research-intel\//],
  },
  {
    script: "test:research-writing",
    testDir: "tests/research-writing",
    reason: "research writing, authoring, submit, or evidence code changed",
    patterns: [
      /^tools\/research-authoring\//,
      /^tools\/research-evidence\//,
      /^tools\/research-submit\//,
      /^tools\/research-writing\//,
    ],
  },
  {
    script: "test:survey",
    testDir: "tests/survey",
    reason: "survey workflow or storyline fixtures changed",
    patterns: [/^tests\/fixtures\/storyline-planner\//, /^tools\/workflow-guard-stages\/survey/, /^tools\/workflow-guard-state\/survey/],
  },
  {
    script: "test:workflow:auto-iterator",
    testDir: "tests/workflow/auto-iterator",
    reason: "auto iterator, stage routing, or auto mode code changed",
    patterns: [/^tools\/workflow-guard-runtime\/auto-iterator/, /^tools\/workflow-auto/, /^tools\/workflow-guard\.ts$/],
  },
  {
    script: "test:workflow:commands",
    testDir: "tests/workflow/commands",
    reason: "workflow command replay or slash command code changed",
    patterns: [/^tools\/workflow-commands\//, /^scripts\/run_local_workflow_command\.mjs$/, /^scripts\/workflow_command_harness_lib\.mjs$/],
  },
  {
    script: "test:workflow:control-plane",
    testDir: "tests/workflow/control-plane",
    reason: "canonical workflow control, reconciler, or completion resolver changed",
    patterns: [
      /^tools\/workflow-control-/,
      /^tools\/workflow-owner-runtime/,
      /^tools\/workflow-paper-terminal/,
      /^tools\/workflow-stage-completion/,
      /^tools\/workflow-guard-runtime\/stage-preflight/,
    ],
  },
  {
    script: "test:workflow:derived-state",
    testDir: "tests/workflow/derived-state",
    reason: "workflow derived state code changed",
    patterns: [/^tools\/workflow-derived-state\//, /^tools\/workflow-projection\//],
  },
  {
    script: "test:workflow:diagnostics",
    testDir: "tests/workflow/diagnostics",
    reason: "workflow diagnostics logging changed",
    patterns: [/^tools\/workflow-diagnostics/],
  },
  {
    script: "test:workflow:evidence",
    testDir: "tests/workflow/evidence",
    reason: "workflow evidence kernel or protocol code changed",
    patterns: [/^tools\/workflow-evidence\//],
  },
  {
    script: "test:workflow:execution",
    testDir: "tests/workflow/execution",
    reason: "workflow execution kernel, proof, or budget code changed",
    patterns: [/^tools\/workflow-execution\//],
  },
  {
    script: "test:workflow:frontier-mapping",
    testDir: "tests/workflow/frontier-mapping",
    reason: "frontier mapping materializer changed",
    patterns: [/^tools\/workflow-guard-materializers\/frontier/, /^tools\/workflow-guard-state\/frontier/],
  },
  {
    script: "test:workflow:guard",
    testDir: "tests/workflow/guard",
    reason: "workflow guard modules, setters, policies, or summaries changed",
    patterns: [
      /^tools\/workflow-guard-/,
      /^tools\/workflow-guard\.ts$/,
      /^tools\/workflow-notification-channels/,
    ],
  },
  {
    script: "test:workflow:handoff",
    testDir: "tests/workflow/handoff",
    reason: "handoff routing, delivery, receipts, or broadcasts changed",
    patterns: [/^tools\/workflow-handoff\//, /^tools\/stage-broadcast/, /^tools\/workflow-broadcast/],
  },
  {
    script: "test:workflow:hooks",
    testDir: "tests/workflow/hooks",
    reason: "workflow hooks or file audit code changed",
    patterns: [/^tools\/workflow-hooks\//],
  },
  {
    script: "test:workflow:kernel",
    testDir: "tests/workflow/kernel",
    reason: "workflow kernel helpers changed",
    patterns: [/^tools\/workflow-kernel\//],
  },
  {
    script: "test:workflow:project",
    testDir: "tests/workflow/project",
    reason: "project binding or migration code changed",
    patterns: [/^tools\/workflow-project/, /^tools\/channel-project/, /^tools\/project-/],
  },
  {
    script: "test:workflow:prompting",
    testDir: "tests/workflow/prompting",
    reason: "prompt ownership or prompt formatting code changed",
    patterns: [/^tools\/workflow-guard-guidance\//, /^tools\/workflow-prompt/],
  },
  {
    script: "test:workflow:runtime",
    testDir: "tests/workflow/runtime",
    reason: "runtime queue, service, orchestration, or background pool changed",
    patterns: [
      /^tools\/register-workflow-service/,
      /^tools\/register-workflow-tools/,
      /^tools\/workflow-background/,
      /^tools\/workflow-fast-paths/,
      /^tools\/workflow-runtime/,
      /^scripts\/auto_command_live_orchestrator\.mjs$/,
    ],
  },
  {
    script: "test:workflow:team",
    testDir: "tests/workflow/team",
    reason: "workflow team, collaboration, or task claim code changed",
    patterns: [/^tools\/workflow-team\//, /^tools\/workflow-collaboration\//],
  },
  {
    script: "test:workflow:writing",
    testDir: "tests/workflow/writing",
    reason: "workflow writing hooks, workbench, or revision control changed",
    patterns: [/^tools\/workflow-guard-writing\//, /^tools\/workflow-writing/, /^tools\/workflow-revision/],
  },
  {
    script: "test:workflow:zotero",
    testDir: "tests/workflow/zotero",
    reason: "Zotero workflow integration changed",
    patterns: [/zotero/i],
  },
  {
    script: "test:e2e",
    testDir: "tests/e2e",
    reason: "E2E harness, dashboard build, or live runner changed",
    patterns: [
      /^scripts\/build-e2e-project-dashboard\.mjs$/,
      /^scripts\/run-e2e-paper-generation\.mjs$/,
      /^scripts\/run_auto_command_end_to_end\.mjs$/,
      /^scripts\/run_auto_workflow_e2e_test\.mjs$/,
      /^scripts\/run_discord_native_slash_replay_test\.mjs$/,
    ],
  },
];

export function normalizeRepoPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortPaths(values) {
  return uniq(values).sort((a, b) => a.localeCompare(b));
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: options.cwd ?? REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }
    throw error;
  }
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE_REF,
    files: [],
    includeWorkingTree: true,
    json: false,
    list: false,
    run: false,
    staged: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      options.base = argv[++index] ?? DEFAULT_BASE_REF;
    } else if (arg === "--files") {
      const raw = argv[++index] ?? "";
      options.files.push(...raw.split(",").map(normalizeRepoPath));
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--no-working-tree") {
      options.includeWorkingTree = false;
    } else if (arg === "--run") {
      options.run = true;
    } else if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      options.files.push(normalizeRepoPath(arg));
    }
  }

  return options;
}

export function listChangedPaths(options = {}) {
  const explicitFiles = sortPaths(options.files ?? []);
  if (explicitFiles.length > 0) {
    return explicitFiles;
  }

  const changed = [];
  if (options.staged) {
    changed.push(...splitLines(runGit(["diff", "--name-only", "--diff-filter=ACMR", "--cached"], options)));
  } else {
    const base = options.base ?? DEFAULT_BASE_REF;
    changed.push(...splitLines(runGit(["diff", "--name-only", "--diff-filter=ACMR", base], options)));
    if (base !== DEFAULT_BASE_REF) {
      changed.push(...splitLines(runGit(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], {
        ...options,
        allowFailure: true,
      })));
    }
  }

  if (options.includeWorkingTree !== false && !options.staged) {
    changed.push(...splitLines(runGit(["ls-files", "--others", "--exclude-standard"], options)));
  }

  return sortPaths(changed.map(normalizeRepoPath));
}

function listRepositoryFiles(options = {}) {
  const tracked = splitLines(runGit(["ls-files"], options));
  const untracked = splitLines(runGit(["ls-files", "--others", "--exclude-standard"], options));
  return sortPaths([...tracked, ...untracked].map(normalizeRepoPath));
}

function isTestFile(repoPath) {
  return TEST_FILE_PATTERN.test(repoPath);
}

function isReadableCodeFile(repoPath) {
  return isTestFile(repoPath) || CODE_FILE_PATTERN.test(repoPath);
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  const importPattern =
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = importPattern.exec(source))) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

function candidateImportPaths(importerPath, specifier) {
  if (!specifier.startsWith(".")) {
    return [];
  }

  const base = normalizeRepoPath(path.posix.join(path.posix.dirname(importerPath), specifier));
  const candidates = [base];
  if (!path.posix.extname(base)) {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      `${base}.js`,
      `${base}.cjs`,
      `${base}.json`,
      `${base}/index.ts`,
      `${base}/index.mjs`,
      `${base}/index.js`
    );
  }
  return candidates;
}

function buildImportGraph(files, readFileText) {
  const fileSet = new Set(files);
  const dependentsByFile = new Map();

  for (const file of files) {
    if (!isReadableCodeFile(file)) {
      continue;
    }

    const source = readFileText(file);
    if (!source) {
      continue;
    }

    for (const specifier of extractImportSpecifiers(source)) {
      const resolved = candidateImportPaths(file, specifier).find((candidate) => fileSet.has(candidate));
      if (!resolved) {
        continue;
      }
      if (!dependentsByFile.has(resolved)) {
        dependentsByFile.set(resolved, new Set());
      }
      dependentsByFile.get(resolved).add(file);
    }
  }

  return dependentsByFile;
}

function readPackageScripts(packageJson = {}) {
  const scripts = packageJson.scripts ?? {};
  const entries = [];
  for (const [script, command] of Object.entries(scripts)) {
    const match = String(command).match(/find\s+(tests(?:\/[^\s]+)?)\s+-name\s+['"]\*\.test\.mjs['"]/);
    if (match) {
      entries.push({ script, testDir: normalizeRepoPath(match[1]) });
    }
  }
  return entries.sort((a, b) => b.testDir.length - a.testDir.length);
}

function scriptForTestFile(testFile, packageTestScripts) {
  return packageTestScripts.find(({ testDir }) => testFile.startsWith(`${testDir}/`))?.script ?? "test";
}

function listTestsUnderDir(files, testDir) {
  return files.filter((file) => isTestFile(file) && file.startsWith(`${testDir}/`));
}

function selectReverseDependencyTests(changedPath, dependentsByFile) {
  const selected = new Set();
  const seen = new Set([changedPath]);
  const queue = [changedPath];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of dependentsByFile.get(current) ?? []) {
      if (seen.has(dependent)) {
        continue;
      }
      seen.add(dependent);
      if (isTestFile(dependent)) {
        selected.add(dependent);
      }
      queue.push(dependent);
    }
  }

  return [...selected];
}

function fallbackRulesForPath(changedPath) {
  return FALLBACK_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(changedPath))
  );
}

export function selectTestsForChanges(params) {
  const files = sortPaths(params.files ?? []);
  const changedPaths = sortPaths((params.changedPaths ?? []).map(normalizeRepoPath));
  const packageTestScripts = readPackageScripts(params.packageJson ?? {});
  const fileContents = params.fileContents ?? {};
  const readFileText =
    params.readFileText ??
    ((repoPath) => (Object.hasOwn(fileContents, repoPath) ? fileContents[repoPath] : ""));
  const dependentsByFile = buildImportGraph(files, readFileText);

  const selectedTests = new Set();
  const selectedScripts = new Map();
  const reasons = [];
  const broadChecks = new Set();

  for (const changedPath of changedPaths) {
    if (isTestFile(changedPath)) {
      selectedTests.add(changedPath);
      const script = scriptForTestFile(changedPath, packageTestScripts);
      selectedScripts.set(script, `changed test file ${changedPath}`);
      reasons.push({ changedPath, kind: "direct_test", tests: [changedPath], scripts: [script] });
      continue;
    }

    const reverseDependencyTests = selectReverseDependencyTests(changedPath, dependentsByFile);
    for (const testFile of reverseDependencyTests) {
      selectedTests.add(testFile);
    }

    const scripts = new Set();
    for (const testFile of reverseDependencyTests) {
      scripts.add(scriptForTestFile(testFile, packageTestScripts));
    }

    const fallbackRules = fallbackRulesForPath(changedPath);
    for (const rule of fallbackRules) {
      scripts.add(rule.script);
      if (!selectedScripts.has(rule.script)) {
        selectedScripts.set(rule.script, rule.reason);
      }
      for (const testFile of listTestsUnderDir(files, rule.testDir)) {
        selectedTests.add(testFile);
      }
    }

    for (const script of scripts) {
      if (!selectedScripts.has(script)) {
        selectedScripts.set(script, `reverse import dependency from ${changedPath}`);
      }
    }

    if (/^(package(-lock)?\.json|tsconfig\.json|eslint\.config\.(js|mjs)|index\.ts)$/.test(changedPath)) {
      broadChecks.add("npm run build");
    }
    if (/^(eslint\.config\.(js|mjs)|tools\/|index\.ts|runtime-api\.ts)/.test(changedPath)) {
      broadChecks.add("npm run lint");
    }

    reasons.push({
      changedPath,
      kind: "source_or_config",
      tests: sortPaths(reverseDependencyTests),
      scripts: [...scripts].sort(),
      fallbackReasons: fallbackRules.map((rule) => rule.reason),
    });
  }

  const testFiles = sortPaths([...selectedTests]);
  const scripts = [...selectedScripts.entries()]
    .map(([script, reason]) => ({ script, reason }))
    .sort((a, b) => a.script.localeCompare(b.script));
  const directNodeCommand =
    testFiles.length > 0
      ? `node --test ${testFiles.map(shellQuote).join(" ")}`
      : null;

  return {
    changedPaths,
    testFiles,
    scripts,
    reasons,
    commands: {
      direct: directNodeCommand,
      npmScripts: scripts.map(({ script }) => `npm run ${script}`),
      checks: [...broadChecks].sort(),
    },
  };
}

function loadPackageJson(repoRoot) {
  const packagePath = path.join(repoRoot, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

function readFilesForGraph(repoRoot, files) {
  const contents = {};
  for (const repoPath of files) {
    if (!isReadableCodeFile(repoPath)) {
      continue;
    }
    try {
      contents[repoPath] = fs.readFileSync(path.join(repoRoot, repoPath), "utf8");
    } catch {
      contents[repoPath] = "";
    }
  }
  return contents;
}

function printHumanResult(result) {
  if (result.changedPaths.length === 0) {
    console.log("No changed files detected.");
    console.log("Tip: pass --base main to include committed branch changes.");
    return;
  }

  console.log("Changed files:");
  for (const file of result.changedPaths) {
    console.log(`- ${file}`);
  }

  if (result.testFiles.length === 0) {
    console.log("\nNo targeted test files were selected.");
    console.log("Use npm test if this was a broad or unsupported change.");
    return;
  }

  console.log("\nSelected test files:");
  for (const file of result.testFiles) {
    console.log(`- ${file}`);
  }

  console.log("\nCovering npm scripts:");
  for (const { script, reason } of result.scripts) {
    console.log(`- npm run ${script} (${reason})`);
  }

  console.log("\nNarrow command:");
  console.log(result.commands.direct);

  if (result.commands.checks.length > 0) {
    console.log("\nRecommended non-test checks:");
    for (const command of result.commands.checks) {
      console.log(`- ${command}`);
    }
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/select_changed_tests.mjs [--list] [--run] [--json]
  node scripts/select_changed_tests.mjs --base main
  node scripts/select_changed_tests.mjs --staged
  node scripts/select_changed_tests.mjs --files tools/workflow-stage-completion.ts,tests/foo.test.mjs

Default selection includes local changes against HEAD and untracked files.
Use --run to execute the selected node --test command.`);
}

function runSelectedTests(result) {
  if (result.testFiles.length === 0) {
    console.log("No selected tests to run.");
    return 0;
  }

  const child = spawnSync(process.execPath, ["--test", ...result.testFiles], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return child.status ?? 1;
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const files = listRepositoryFiles({ cwd: REPO_ROOT });
  const changedPaths = listChangedPaths({ ...options, cwd: REPO_ROOT });
  const result = selectTestsForChanges({
    changedPaths,
    files,
    fileContents: readFilesForGraph(REPO_ROOT, files),
    packageJson: loadPackageJson(REPO_ROOT),
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanResult(result);
  }

  if (options.run) {
    process.exit(runSelectedTests(result));
  }
}
