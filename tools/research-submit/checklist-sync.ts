import { writeProjectJson } from "../research-contracts/core/project-io";
import type { CitationAuditReport } from "../research-intel/citation-audit";

export async function materializeChecklistSyncReport(params: {
  projectRoot: string;
  citationAudit: CitationAuditReport;
  statisticalEvidenceStatus: string | null;
  reproStatus: string | null;
  outputPath?: string;
}) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    citationVerified: params.citationAudit.allCitationsReal,
    statisticalEvidenceStatus: params.statisticalEvidenceStatus,
    reproducibilityPackStatus: params.reproStatus,
    ready:
      params.citationAudit.allCitationsReal &&
      params.statisticalEvidenceStatus !== "missing" &&
      params.reproStatus !== "missing",
  };
  await writeProjectJson(
    params.projectRoot,
    params.outputPath ?? "submit/CHECKLIST_SYNC_REPORT.json",
    report
  );
  return report;
}
