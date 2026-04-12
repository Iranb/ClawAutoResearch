import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";

const execFileAsync = promisify(execFile);

type RemoteStageReport = {
  ssh_target: string;
  remote_base_dir: string;
  project_id: string;
  timeout_seconds: number;
  uploads: Array<Record<string, unknown>>;
  rewrite_manifest_out: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findRepoRootFromModule(moduleUrl: string): string {
  const filePath = fileURLToPath(moduleUrl);
  const candidates = [
    path.resolve(path.dirname(filePath), ".."),
    path.resolve(path.dirname(filePath), "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    const scriptPath = path.join(candidate, "scripts", "papernexus_remote_stage.py");
    try {
      fs.accessSync(scriptPath);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0] ?? path.resolve(path.dirname(filePath), "..");
}

const REPO_ROOT = findRepoRootFromModule(import.meta.url);
const PAPERNEXUS_REMOTE_STAGE_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "papernexus_remote_stage.py"
);

function resolveArtifactPath(projectRoot: string, targetPath: string): string {
  return path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(projectRoot, targetPath);
}

export async function stagePapernexusRemoteSources(params: {
  projectRoot: string;
  sshTarget?: string | null;
  remoteBaseDir?: string | null;
  projectId?: string | null;
  sourcePaths?: string[] | null;
  manifestPath?: string | null;
  rewriteManifestOut?: string | null;
  reportPath?: string | null;
  timeoutSeconds?: number | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(projectRoot, "PROJECT_MANIFEST.json")
    )) ?? {};
  const projectId =
    readString(params.projectId) ??
    readString(manifest.project_id) ??
    path.basename(projectRoot);
  const sshTarget =
    readString(params.sshTarget) ??
    readString(process.env.OPENCLAW_PAPERNEXUS_STAGE_SSH_TARGET);
  const remoteBaseDir =
    readString(params.remoteBaseDir) ??
    readString(process.env.OPENCLAW_PAPERNEXUS_STAGE_BASE_DIR);
  if (!sshTarget || !remoteBaseDir) {
    return {
      available: false,
      error:
        "Missing PaperNexus remote staging configuration. Set sshTarget/remoteBaseDir or OPENCLAW_PAPERNEXUS_STAGE_SSH_TARGET and OPENCLAW_PAPERNEXUS_STAGE_BASE_DIR.",
      reportPath: null,
      report: null,
    };
  }

  const command = [
    "python3",
    PAPERNEXUS_REMOTE_STAGE_SCRIPT,
    "--ssh-target",
    sshTarget,
    "--remote-base-dir",
    remoteBaseDir,
    "--project-id",
    projectId,
    "--timeout-seconds",
    String(Math.max(5, Math.floor(params.timeoutSeconds ?? 60))),
  ];
  if (readString(params.manifestPath)) {
    command.push("--manifest", resolveArtifactPath(projectRoot, readString(params.manifestPath)!));
  }
  for (const sourcePath of params.sourcePaths ?? []) {
    const resolved = readString(sourcePath);
    if (!resolved) continue;
    command.push("--source", resolveArtifactPath(projectRoot, resolved));
  }
  const rewriteManifestOut =
    readString(params.rewriteManifestOut) ??
    (readString(params.manifestPath)
      ? readString(params.manifestPath)!.replace(/\.json$/i, ".remote.json")
      : null);
  if (rewriteManifestOut) {
    command.push(
      "--rewrite-manifest-out",
      resolveArtifactPath(projectRoot, rewriteManifestOut)
    );
  }

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(command[0], command.slice(1), {
      cwd: REPO_ROOT,
      env: process.env,
    }));
  } catch (error) {
    const captured = (error as { stdout?: string }).stdout;
    if (typeof captured !== "string" || !captured.trim()) {
      throw error;
    }
    stdout = captured;
  }

  const report = JSON.parse(stdout) as RemoteStageReport;
  const reportPath =
    readString(params.reportPath) ??
    "researcher/paper-staging/REMOTE_PAPERNEXUS_STAGE.json";
  await writeJsonEnsured(resolveArtifactPath(projectRoot, reportPath), report);
  return {
    available: true,
    reportPath,
    report,
    rewriteManifestOut,
  };
}
