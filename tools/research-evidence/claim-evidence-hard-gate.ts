import { readProjectText, writeProjectJson, writeProjectText } from "../research-contracts/core/project-io.ts";

function extractMarkdownClaims(rawText: string): Array<{ claimId: string; claimText: string }> {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(\||-|\*|\d+\.)/.test(line) === false && line.length > 0)
    .slice(0, 12)
    .map((claimText, index) => ({ claimId: `claim-${index + 1}`, claimText }));
}

export async function materializeClaimEvidenceAudit(params: {
  projectRoot: string;
  matrixPath?: string;
  unsupportedClaimsPath?: string;
  outputJsonPath?: string;
  outputMdPath?: string;
}) {
  const matrixPath = params.matrixPath ?? "analyzer/CLAIM_EVIDENCE_MATRIX.md";
  const unsupportedPath = params.unsupportedClaimsPath ?? "analyzer/UNSUPPORTED_CLAIMS.md";
  const matrixText = await readProjectText(params.projectRoot, matrixPath);
  const unsupportedText = await readProjectText(params.projectRoot, unsupportedPath);
  const claims = extractMarkdownClaims(matrixText ?? "");
  const unsupportedClaims = extractMarkdownClaims(unsupportedText ?? "").map((entry) => entry.claimText.toLowerCase());
  const entries = claims.map((claim) => {
    const unsupported = unsupportedClaims.some((entry) => claim.claimText.toLowerCase().includes(entry.slice(0, 24)));
    return {
      claimId: claim.claimId,
      claimText: claim.claimText,
      supportLabel: unsupported ? "UNSUPPORTED" : "SUPPORTED",
    };
  });
  const supported = entries.filter((entry) => entry.supportLabel === "SUPPORTED").length;
  const unsupported = entries.length - supported;
  const status =
    entries.length === 0 ? "missing" : unsupported === 0 ? "supported" : supported > 0 ? "partial" : "unsupported";
  await writeProjectJson(
    params.projectRoot,
    params.outputJsonPath ?? "analyzer/CLAIM_EVIDENCE_AUDIT.json",
    {
      schemaVersion: 1,
      status,
      supportedClaimCount: supported,
      unsupportedClaimCount: unsupported,
      entries,
    }
  );
  await writeProjectText(
    params.projectRoot,
    params.outputMdPath ?? "analyzer/CLAIM_EVIDENCE_AUDIT.md",
    `# Claim Evidence Audit\n\n- Status: ${status}\n- Supported claims: ${supported}\n- Unsupported claims: ${unsupported}\n`
  );
  return {
    status,
    supportedClaimCount: supported,
    unsupportedClaimCount: unsupported,
    entries,
  };
}
