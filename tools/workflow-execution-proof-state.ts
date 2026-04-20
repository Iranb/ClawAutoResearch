import * as path from "node:path";

import { readJsonIfExists, writeJsonEnsured } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import { collectExecutionProofReceipts } from "./workflow-execution-proof";
import {
  DEFAULT_EXECUTION_PROOF_PATH,
  serializeExecutionProofState,
  type ExecutionProofState,
} from "./workflow-guard-state/execution-proof";

export async function materializeExecutionProofState(params: {
  projectRoot: string;
}): Promise<{
  state: ExecutionProofState;
  receipts: Awaited<ReturnType<typeof collectExecutionProofReceipts>>["receipts"];
  generatedFiles: string[];
}> {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<Record<string, unknown>>(manifestPath)) ?? {};
  const ledger =
    (await readJsonIfExists<Record<string, unknown>>(
      path.join(params.projectRoot, "researcher", "EXPERIMENT_LEDGER.json")
    )) ?? null;
  const proof = await collectExecutionProofReceipts({
    projectRoot: params.projectRoot,
    experimentLedger: ledger,
    manifest,
  });
  const lastUpdatedAt = new Date().toISOString();
  const state: ExecutionProofState = {
    status:
      proof.receiptCount === 0
        ? "pending"
        : proof.ready
          ? "ready"
          : "blocked",
    path: DEFAULT_EXECUTION_PROOF_PATH,
    receiptCount: proof.receiptCount,
    ledgerMatchedReceiptCount: proof.receipts.filter((entry) => entry.ledgerMatched).length,
    lineageMatchedReceiptCount: proof.receipts.filter(
      (entry) =>
        entry.manifestCommitMatched && entry.searchCommitMatched && entry.stageRunMatched
    ).length,
    pendingReason: proof.missingReasons.join(" ") || null,
    lastUpdatedAt,
  };
  const resolvedPath = resolveProjectArtifactPath(
    params.projectRoot,
    DEFAULT_EXECUTION_PROOF_PATH
  );
  if (!resolvedPath) {
    throw new Error("Unable to resolve execution proof path.");
  }
  await writeJsonEnsured(resolvedPath, {
    schema_version: 1,
    generated_at: lastUpdatedAt,
    ...serializeExecutionProofState(state),
    receipts: proof.receipts,
    missing_reasons: proof.missingReasons,
  });
  manifest.execution_proof = serializeExecutionProofState(state);
  await writeJsonEnsured(manifestPath, manifest);
  return {
    state,
    receipts: proof.receipts,
    generatedFiles: [DEFAULT_EXECUTION_PROOF_PATH],
  };
}
