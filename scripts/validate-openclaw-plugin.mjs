import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const REQUIRED_NODE_FLOOR = "22.19.0";
export const REQUIRED_OPENCLAW_FLOOR = "2026.5.18";
export const REQUIRED_PLUGIN_TOOLS = [
  "research_memory",
  "research_workflow",
  "auto_research",
  "auto_review",
];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function parseVersion(value) {
  const match = String(value ?? "").match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1] ?? "0", 10),
    Number.parseInt(match[2] ?? "0", 10),
    Number.parseInt(match[3] ?? "0", 10),
  ];
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) {
      return 1;
    }
    if (left[index] < right[index]) {
      return -1;
    }
  }
  return 0;
}

function hasCompatibleFloor(range, requiredVersion) {
  const required = parseVersion(requiredVersion);
  if (!required || typeof range !== "string") {
    return false;
  }

  for (const match of range.matchAll(/(?:^|\s)(>=|>)\s*v?(\d+(?:\.\d+){0,2})/g)) {
    const comparator = match[1];
    const version = parseVersion(match[2]);
    if (!version) {
      continue;
    }
    if (compareVersion(version, required) > 0) {
      return true;
    }
    if (comparator === ">=" && compareVersion(version, required) === 0) {
      return true;
    }
  }

  return false;
}

function finding(code, message, filePath) {
  return { code, message, path: filePath ?? null };
}

function validatePackageContract(packageJson, packagePath) {
  const findings = [];
  const engines = asObject(packageJson.engines);
  const peerDependencies = asObject(packageJson.peerDependencies);
  const peerDependenciesMeta = asObject(packageJson.peerDependenciesMeta);
  const openclawPackage = asObject(packageJson.openclaw);
  const exportsBlock = asObject(packageJson.exports);

  if (!hasCompatibleFloor(engines?.node, REQUIRED_NODE_FLOOR)) {
    findings.push(
      finding(
        "node_floor_outdated",
        `package engines.node must declare >=${REQUIRED_NODE_FLOOR}.`,
        packagePath
      )
    );
  }

  if (!hasCompatibleFloor(peerDependencies?.openclaw, REQUIRED_OPENCLAW_FLOOR)) {
    findings.push(
      finding(
        "openclaw_floor_outdated",
        `package peerDependencies.openclaw must declare >=${REQUIRED_OPENCLAW_FLOOR}.`,
        packagePath
      )
    );
  }

  if (!asObject(peerDependenciesMeta?.openclaw)?.optional) {
    findings.push(
      finding(
        "openclaw_peer_not_optional",
        "package peerDependenciesMeta.openclaw.optional must remain true.",
        packagePath
      )
    );
  }

  if (!Array.isArray(openclawPackage?.extensions) || !openclawPackage.extensions.includes("./dist/index.js")) {
    findings.push(
      finding(
        "openclaw_extension_missing",
        'package openclaw.extensions must include "./dist/index.js".',
        packagePath
      )
    );
  }

  if (!exportsBlock?.["./openclaw.plugin.json"]) {
    findings.push(
      finding(
        "plugin_manifest_export_missing",
        'package exports must expose "./openclaw.plugin.json".',
        packagePath
      )
    );
  }

  return findings;
}

function validateManifestContract(packageJson, manifest, manifestPath) {
  const findings = [];
  const contracts = asObject(manifest.contracts);
  const toolMetadata = asObject(manifest.toolMetadata);
  const configSchema = asObject(manifest.configSchema);
  const openclawPackage = asObject(packageJson.openclaw);
  const tools = Array.isArray(contracts?.tools) ? contracts.tools : [];

  if (!manifest.id || manifest.id !== openclawPackage?.pluginId) {
    findings.push(
      finding(
        "plugin_id_mismatch",
        "openclaw.plugin.json id must match package openclaw.pluginId.",
        manifestPath
      )
    );
  }

  for (const toolName of REQUIRED_PLUGIN_TOOLS) {
    if (!tools.includes(toolName)) {
      findings.push(
        finding(
          "plugin_tool_contract_missing",
          `openclaw.plugin.json contracts.tools must include ${toolName}.`,
          manifestPath
        )
      );
    }
    if (!asObject(toolMetadata?.[toolName])) {
      findings.push(
        finding(
          "plugin_tool_metadata_missing",
          `openclaw.plugin.json toolMetadata must include ${toolName}.`,
          manifestPath
        )
      );
    }
  }

  if (configSchema?.type !== "object" || !asObject(configSchema.properties)) {
    findings.push(
      finding(
        "plugin_config_schema_invalid",
        "openclaw.plugin.json configSchema must be an object schema with properties.",
        manifestPath
      )
    );
  }

  if (configSchema?.additionalProperties !== false) {
    findings.push(
      finding(
        "plugin_config_schema_allows_unknowns",
        "openclaw.plugin.json configSchema.additionalProperties must remain false.",
        manifestPath
      )
    );
  }

  return findings;
}

async function maybeRunOpenClawCliValidate({ repoRoot, enabled }) {
  if (!enabled) {
    return {
      attempted: false,
      status: "skipped",
    };
  }

  try {
    const result = await execFileAsync("openclaw", [
      "plugins",
      "validate",
      repoRoot,
    ]);
    return {
      attempted: true,
      status: "passed",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      attempted: true,
      status: "failed",
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      error: error?.code === "ENOENT"
        ? "openclaw CLI not found"
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

export async function validateOpenClawPluginRepository({
  repoRoot = process.cwd(),
  withOpenClawCli = false,
} = {}) {
  const packagePath = path.join(repoRoot, "package.json");
  const manifestPath = path.join(repoRoot, "openclaw.plugin.json");
  const packageJson = await readJsonFile(packagePath);
  const manifest = await readJsonFile(manifestPath);
  const cliValidation = await maybeRunOpenClawCliValidate({
    repoRoot,
    enabled: withOpenClawCli,
  });
  const findings = [
    ...validatePackageContract(packageJson, packagePath),
    ...validateManifestContract(packageJson, manifest, manifestPath),
  ];

  if (cliValidation.status === "failed") {
    findings.push(
      finding(
        "openclaw_cli_validate_failed",
        `openclaw plugins validate failed: ${cliValidation.error}`,
        repoRoot
      )
    );
  }

  return {
    ok: findings.length === 0,
    findingCount: findings.length,
    findings,
    requiredNodeFloor: REQUIRED_NODE_FLOOR,
    requiredOpenClawFloor: REQUIRED_OPENCLAW_FLOOR,
    requiredTools: [...REQUIRED_PLUGIN_TOOLS],
    openclawCli: cliValidation,
  };
}

export function formatOpenClawPluginValidationReport(result) {
  if (result.ok) {
    return [
      "openclaw_plugin_validation_ok",
      `node_floor=>=${result.requiredNodeFloor}`,
      `openclaw_floor=>=${result.requiredOpenClawFloor}`,
      `required_tools=${result.requiredTools.join(",")}`,
      `openclaw_cli=${result.openclawCli.status}`,
    ].join(" ");
  }

  return [
    `openclaw_plugin_validation_failed count=${result.findingCount}`,
    ...result.findings.map((entry) =>
      `${entry.code}${entry.path ? ` path=${entry.path}` : ""}: ${entry.message}`
    ),
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    repoRoot: process.cwd(),
    json: false,
    withOpenClawCli: process.env.OPENCLAW_PLUGIN_VALIDATE_WITH_CLI === "1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      parsed.repoRoot = path.resolve(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--with-openclaw-cli") {
      parsed.withOpenClawCli = true;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await validateOpenClawPluginRepository({
    repoRoot: args.repoRoot,
    withOpenClawCli: args.withOpenClawCli,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatOpenClawPluginValidationReport(result));
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error("[validate-openclaw-plugin] failed");
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
