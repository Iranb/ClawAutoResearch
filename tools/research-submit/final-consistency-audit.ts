import { materializeCitationAudit } from "../research-intel/citation-audit";
import { materializeSurveyAnalysis } from "../research-authoring/survey-analysis";
import { materializeClaimEvidenceAudit } from "../research-evidence/claim-evidence-hard-gate";
import { materializeCameraReadyAudit } from "./camera-ready-gates";
import { materializeReproPack } from "./repro-pack";
import { materializeChecklistSyncReport } from "./checklist-sync";
import { readProjectManifest, writeProjectText } from "../research-contracts/core/project-io";
import { normalizeStatisticalEvidenceState } from "../research-contracts/evidence-contracts";

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
    survey
      ? `- Survey analysis ready: ${survey.diagnostics.ready && survey.traceabilityReady && survey.comparabilityReady ? "yes" : "no"}`
      : "- Survey analysis: not applicable",
    survey ? `- Survey benchmark contract: ${survey.benchmarkProtocolStatus}` : "- Survey benchmark contract: not applicable",
    survey ? `- Survey competitor contract: ${survey.venueCompetitionStatus}` : "- Survey competitor contract: not applicable",
    survey ? `- Survey competitor objections: ${survey.venueCompetitionObjectionCount}` : "- Survey competitor objections: not applicable",
    "",
    "## Blocking issues",
    ...(citation.issues.length > 0 ? citation.issues.map((issue) => `- citation: ${issue}`) : ["- citation: none"]),
    ...(claimAudit.unsupportedClaimCount > 0 ? [`- claim-evidence: ${claimAudit.unsupportedClaimCount} unsupported claim(s)`] : ["- claim-evidence: none"]),
    ...(cameraReady.pendingReason ? [`- camera-ready: ${cameraReady.pendingReason}`] : ["- camera-ready: none"]),
    ...(repro.pendingReason ? [`- repro: ${repro.pendingReason}`] : ["- repro: none"]),
    ...(survey && (survey.diagnostics.blockingIssues.length > 0 || survey.blockingIssues.length > 0)
      ? [...survey.diagnostics.blockingIssues, ...survey.blockingIssues].map((issue) => `- survey: ${issue}`)
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
