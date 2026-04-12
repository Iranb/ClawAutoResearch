import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readJsonIfExists, writeTextEnsured } from "../workflow-guard-core/fs";

const execFileAsync = promisify(execFile);

type CitationCalibrationReport = {
  input_bib: string;
  output_bib: string;
  tool_runs: Array<Record<string, unknown>>;
  summary: {
    verified: number;
    needs_review: number;
    suspicious: number;
    hallucinated: number;
  };
  checks: Array<Record<string, unknown>>;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findRepoRootFromModule(moduleUrl: string): string {
  const filePath = fileURLToPath(moduleUrl);
  const candidates = [
    path.resolve(path.dirname(filePath), "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", ".."),
    path.resolve(path.dirname(filePath), "..", "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    const scriptPath = path.join(candidate, "scripts", "citation_calibrate.py");
    try {
      fs.accessSync(scriptPath);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates.at(-1) ?? path.resolve(path.dirname(filePath), "..", "..");
}

const REPO_ROOT = findRepoRootFromModule(import.meta.url);
const CITATION_CALIBRATION_SCRIPT = path.join(REPO_ROOT, "scripts", "citation_calibrate.py");

function augmentPathWithCitationToolBins(envPath: string | undefined): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (candidate: string | null | undefined) => {
    if (!candidate) return;
    try {
      const resolved = path.resolve(candidate);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory() || seen.has(resolved)) {
        return;
      }
      seen.add(resolved);
      ordered.push(resolved);
    } catch {
      return;
    }
  };

  const home = process.env.HOME || os.homedir();
  for (const entry of (envPath ?? "").split(path.delimiter)) {
    add(entry);
  }
  add(path.join(home, ".local", "bin"));
  const pythonLibraryRoot = path.join(home, "Library", "Python");
  try {
    for (const entry of fs.readdirSync(pythonLibraryRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        add(path.join(pythonLibraryRoot, entry.name, "bin"));
      }
    }
  } catch {
    // Best-effort only.
  }
  return ordered.join(path.delimiter);
}

export async function runCitationCalibration(params: {
  projectRoot: string;
  bibliographyPath?: string | null;
  outputBibPath?: string | null;
  reportJsonPath?: string | null;
  reportMarkdownPath?: string | null;
  replaceArxiv?: boolean;
  syncVerificationReport?: boolean;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const bibliographyPath =
    readString(params.bibliographyPath) ?? "academic_writer/paper/refs.bib";
  const outputBibPath =
    readString(params.outputBibPath) ?? "academic_writer/paper/refs.calibrated.bib";
  const reportJsonPath =
    readString(params.reportJsonPath) ?? "reviewer/CITATION_CALIBRATION.json";
  const reportMarkdownPath =
    readString(params.reportMarkdownPath) ?? "reviewer/CITATION_CALIBRATION.md";
  const command = [
    "python3",
    CITATION_CALIBRATION_SCRIPT,
    "--bib",
    path.join(projectRoot, bibliographyPath),
    "--out",
    path.join(projectRoot, outputBibPath),
    "--report-json",
    path.join(projectRoot, reportJsonPath),
    "--report-md",
    path.join(projectRoot, reportMarkdownPath),
  ];
  if (params.replaceArxiv) {
    command.push("--replace-arxiv");
  }

  const calibrationEnv = {
    ...process.env,
    PATH: augmentPathWithCitationToolBins(process.env.PATH),
  };
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(command[0], command.slice(1), {
      cwd: REPO_ROOT,
      env: calibrationEnv,
    }));
  } catch (error) {
    const captured = (error as { stdout?: string }).stdout;
    if (typeof captured !== "string" || !captured.trim()) {
      throw error;
    }
    stdout = captured;
  }
  const report = JSON.parse(stdout) as CitationCalibrationReport;
  const summary = report.summary;
  let verificationReportPath = null;
  if (params.syncVerificationReport !== false) {
    verificationReportPath = path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md");
    await writeTextEnsured(
      verificationReportPath,
      [
        "# Citation Verification",
        "",
        "## Calibration Summary",
        `- verified: ${summary.verified}`,
        `- needs_review: ${summary.needs_review}`,
        `- suspicious: ${summary.suspicious}`,
        `- hallucinated: ${summary.hallucinated}`,
        "",
        "## Calibration Report",
        `- json: {PROJ}/${reportJsonPath}`,
        `- markdown: {PROJ}/${reportMarkdownPath}`,
      ].join("\n")
    );
  }
  return {
    report,
    bibliographyPath,
    outputBibPath,
    reportJsonPath,
    reportMarkdownPath,
    verificationReportPath:
      verificationReportPath != null
        ? "reviewer/CITATION_VERIFICATION.md"
        : null,
    suspiciousCount: summary.suspicious,
    hallucinatedCount: summary.hallucinated,
    verifiedCount: summary.verified,
    needsReviewCount: summary.needs_review,
  };
}

export async function readCitationCalibrationReport(params: {
  projectRoot: string;
  reportJsonPath?: string | null;
}) {
  const projectRoot = path.resolve(params.projectRoot);
  const reportJsonPath =
    readString(params.reportJsonPath) ?? "reviewer/CITATION_CALIBRATION.json";
  return readJsonIfExists<CitationCalibrationReport>(path.join(projectRoot, reportJsonPath));
}
