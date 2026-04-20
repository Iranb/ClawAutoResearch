import * as fs from "node:fs/promises";
import * as path from "node:path";

import { readJsonIfExists } from "./workflow-guard-core/fs";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function findFilesByName(rootDir: string, fileName: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  for (const entry of entries) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFilesByName(targetPath, fileName)));
    } else if (entry.isFile() && entry.name === fileName) {
      results.push(targetPath);
    }
  }
  return results;
}

export type ExecutionProofReceipt = {
  experimentId: string;
  remoteRunPath: string;
  resultSummaryPath: string | null;
  terminalPath: string | null;
  hasResultMetrics: boolean;
  hasResultPaths: boolean;
  ledgerMatched: boolean;
  manifestCommitMatched: boolean;
  searchCommitMatched: boolean;
  stageRunMatched: boolean;
};

export async function collectExecutionProofReceipts(params: {
  projectRoot: string;
  experimentLedger: Record<string, unknown> | null;
  manifest?: Record<string, unknown> | null;
}): Promise<{
  ready: boolean;
  receiptCount: number;
  receipts: ExecutionProofReceipt[];
  missingReasons: string[];
}> {
  const ledgerExperiments = Array.isArray(params.experimentLedger?.experiments)
    ? (params.experimentLedger?.experiments as Record<string, unknown>[])
    : [];
  const ledgerByExperimentId = new Map(
    ledgerExperiments
      .map((entry) => {
        const experimentId =
          readString(entry.experiment_id) ?? readString(entry.experimentId);
        return experimentId ? [experimentId, entry] : null;
      })
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry))
  );
  const experimentSearch =
    params.manifest && typeof params.manifest === "object"
      ? ((params.manifest as Record<string, unknown>).experiment_search as Record<string, unknown> | undefined)
      : undefined;
  const orchestration =
    params.manifest && typeof params.manifest === "object"
      ? ((params.manifest as Record<string, unknown>).orchestration_state as Record<string, unknown> | undefined)
      : undefined;
  const expectedCandidateCommit =
    readString(experimentSearch?.candidate_head_commit) ??
    readString(experimentSearch?.last_candidate_commit) ??
    readString(experimentSearch?.candidate_commit);
  const expectedStageRunId =
    readString(orchestration?.stage_run_id) ?? readString(orchestration?.stageRunId);

  const remoteRuns = await findFilesByName(path.join(params.projectRoot, "coder"), "REMOTE_RUN.json");
  const receipts: ExecutionProofReceipt[] = [];

  for (const remoteRunPath of remoteRuns) {
    const remoteRun =
      (await readJsonIfExists<Record<string, unknown>>(remoteRunPath)) ?? {};
    const experimentId =
      readString(remoteRun.experiment_id) ??
      readString(remoteRun.experimentId) ??
      readString(remoteRun.experiment_name) ??
      readString(remoteRun.experimentName);
    if (!experimentId) {
      continue;
    }
    const runDir = path.dirname(remoteRunPath);
    const manifestPath = path.join(runDir, "EXPERIMENT_MANIFEST.json");
    const experimentManifest =
      (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
    const resultSummaryPath = path.join(runDir, "RESULT_SUMMARY.json");
    const terminalPath = path.join(runDir, "RUN_TERMINAL.json");
    const resultSummary =
      (await readJsonIfExists<Record<string, unknown>>(resultSummaryPath)) ?? null;
    const terminal =
      (await readJsonIfExists<Record<string, unknown>>(terminalPath)) ?? null;
    const ledgerEntry = ledgerByExperimentId.get(experimentId) ?? null;
    const resultPaths = Array.isArray(resultSummary?.result_paths)
      ? resultSummary?.result_paths
      : Array.isArray(resultSummary?.resultPaths)
        ? resultSummary?.resultPaths
        : [];
    const hasResultMetrics =
      resultSummary?.metrics != null ||
      resultSummary?.key_metric != null ||
      resultSummary?.keyMetric != null;
    const hasLedgerResultPaths = Array.isArray(ledgerEntry?.result_paths)
      ? (ledgerEntry?.result_paths as unknown[]).length > 0
      : Array.isArray(ledgerEntry?.resultPaths)
        ? (ledgerEntry?.resultPaths as unknown[]).length > 0
        : false;
    const manifestGit =
      experimentManifest.git && typeof experimentManifest.git === "object"
        ? (experimentManifest.git as Record<string, unknown>)
        : {};
    const manifestCandidateCommit =
      readString(manifestGit.last_candidate_commit) ??
      readString(manifestGit.lastCandidateCommit) ??
      readString(manifestGit.candidate_commit) ??
      readString(manifestGit.candidateCommit);
    const remoteRunCommit =
      readString(remoteRun.git_commit) ??
      readString(remoteRun.gitCommit) ??
      readString(remoteRun.candidate_commit) ??
      readString(remoteRun.candidateCommit);
    const remoteRunStageRunId =
      readString(remoteRun.stage_run_id) ?? readString(remoteRun.stageRunId);
    const resultSummaryStageRunId =
      readString(resultSummary?.stage_run_id) ?? readString(resultSummary?.stageRunId);
    const manifestCommitMatched =
      !manifestCandidateCommit ||
      !remoteRunCommit ||
      manifestCandidateCommit === remoteRunCommit;
    const searchCommitMatched =
      !expectedCandidateCommit ||
      !remoteRunCommit ||
      expectedCandidateCommit === remoteRunCommit;
    const stageRunMatched =
      !expectedStageRunId ||
      (!remoteRunStageRunId && !resultSummaryStageRunId) ||
      expectedStageRunId === remoteRunStageRunId ||
      expectedStageRunId === resultSummaryStageRunId;

    if (
      (resultSummary || terminal) &&
      (resultPaths.length > 0 || hasResultMetrics || hasLedgerResultPaths)
    ) {
      receipts.push({
        experimentId,
        remoteRunPath: path.relative(params.projectRoot, remoteRunPath),
        resultSummaryPath: resultSummary ? path.relative(params.projectRoot, resultSummaryPath) : null,
        terminalPath: terminal ? path.relative(params.projectRoot, terminalPath) : null,
        hasResultMetrics,
        hasResultPaths: resultPaths.length > 0 || hasLedgerResultPaths,
        ledgerMatched: Boolean(ledgerEntry),
        manifestCommitMatched,
        searchCommitMatched,
        stageRunMatched,
      });
    }
  }

  const missingReasons: string[] = [];
  if (ledgerExperiments.length === 0) {
    missingReasons.push("No experiments are recorded in EXPERIMENT_LEDGER.json.");
  }
  if (remoteRuns.length === 0) {
    missingReasons.push("No REMOTE_RUN.json files were found under coder/ experiments.");
  }
  if (receipts.length === 0) {
    missingReasons.push(
      "No execution proof receipt was found. Need REMOTE_RUN.json plus RESULT_SUMMARY.json or RUN_TERMINAL.json tied to a recorded experiment."
    );
  }
  if (
    receipts.length > 0 &&
    receipts.every(
      (entry) => !entry.manifestCommitMatched || !entry.searchCommitMatched || !entry.stageRunMatched
    )
  ) {
    missingReasons.push(
      "Execution receipts exist, but their commit lineage or stage_run_id does not match the current candidate/search state."
    );
  }
  if (receipts.length > 0 && receipts.every((entry) => !entry.ledgerMatched)) {
    missingReasons.push(
      "Execution receipts exist, but none of them match an experiment recorded in EXPERIMENT_LEDGER.json."
    );
  }

  return {
    ready:
      receipts.length > 0 &&
      receipts.some(
        (entry) =>
          entry.ledgerMatched &&
          entry.manifestCommitMatched &&
          entry.searchCommitMatched &&
          entry.stageRunMatched
      ),
    receiptCount: receipts.length,
    receipts,
    missingReasons,
  };
}
