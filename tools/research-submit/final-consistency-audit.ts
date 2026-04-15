import { materializeCitationAudit } from "../research-intel/citation-audit.ts";
import { materializeSurveyAnalysis } from "../research-authoring/survey-analysis.ts";
import { materializeClaimEvidenceAudit } from "../research-evidence/claim-evidence-hard-gate.ts";
import { materializeCameraReadyAudit } from "./camera-ready-gates.ts";
import { materializeReproPack } from "./repro-pack.ts";
import { materializeChecklistSyncReport } from "./checklist-sync.ts";
import { readProjectManifest, writeProjectText } from "../research-contracts/core/project-io.ts";
import { normalizeStatisticalEvidenceState } from "../research-contracts/evidence-contracts.ts";

export async function materializeFinalConsistencyAudit(params: {
  projectRoot: string;
  outputPath?: string;
}) {
  const [citation, survey, claimAudit, cameraReady, repro] = await Promise.all([
    materializeCitationAudit({ projectRoot: params.projectRoot }),
    materializeSurveyAnalysis({ projectRoot: params.projectRoot }).catch(() => null),
    materializeClaimEvidenceAudit({ projectRoot: params.projectRoot }),
    materializeCameraReadyAudit({ projectRoot: params.projectRoot }),
    materializeReproPack({ projectRoot: params.projectRoot }),
  ]);
  const manifest = await readProjectManifest(params.projectRoot);
  const statistics = normalizeStatisticalEvidenceState(manifest.statistical_evidence);
  const checklistSync = await materializeChecklistSyncReport({
    projectRoot: params.projectRoot,
    citationAudit: citation,
    statisticalEvidenceStatus: statistics.status,
    reproStatus: repro.status,
  });
  const lines = [
    "# Final Consistency Audit",
    "",
    `- Citation audit: ${citation.allCitationsReal ? "pass" : "fail"}`,
    `- Claim evidence: ${claimAudit.status}`,
    `- Camera ready: ${cameraReady.status}`,
    `- Repro pack: ${repro.status}`,
    `- Checklist sync: ${checklistSync.ready ? "pass" : "fail"}`,
    survey ? `- Survey analysis ready: ${survey.diagnostics.ready ? "yes" : "no"}` : "- Survey analysis: not applicable",
    "",
    "## Blocking issues",
    ...(citation.issues.length > 0 ? citation.issues.map((issue) => `- citation: ${issue}`) : ["- citation: none"]),
    ...(claimAudit.unsupportedClaimCount > 0 ? [`- claim-evidence: ${claimAudit.unsupportedClaimCount} unsupported claim(s)`] : ["- claim-evidence: none"]),
    ...(cameraReady.pendingReason ? [`- camera-ready: ${cameraReady.pendingReason}`] : ["- camera-ready: none"]),
    ...(repro.pendingReason ? [`- repro: ${repro.pendingReason}`] : ["- repro: none"]),
    ...(survey && survey.diagnostics.blockingIssues.length > 0
      ? survey.diagnostics.blockingIssues.map((issue) => `- survey: ${issue}`)
      : ["- survey: none"]),
  ];
  await writeProjectText(
    params.projectRoot,
    params.outputPath ?? "submit/FINAL_CONSISTENCY_AUDIT.md",
    `${lines.join("\n")}\n`
  );
  return {
    citation,
    survey,
    claimAudit,
    cameraReady,
    repro,
    checklistSync,
  };
}
