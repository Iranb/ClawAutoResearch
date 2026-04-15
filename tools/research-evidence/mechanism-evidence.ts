import { derivePapernexusEvidenceStatus, inspectPapernexusBridgeArtifacts } from "../workflow-evidence/papernexus-bridge.ts";
import {
  normalizeMechanismEvidenceState,
  serializeMechanismEvidenceState,
} from "../research-contracts/evidence-contracts.ts";
import {
  nowIso,
  readProjectManifest,
  readProjectText,
  writeProjectJson,
  writeProjectManifest,
  writeProjectText,
} from "../research-contracts/core/project-io.ts";

function inferMechanismFamilies(text: string): string[] {
  const families: string[] = [];
  const normalized = text.toLowerCase();
  if (/\bfrequency\b/.test(normalized)) families.push("frequency");
  if (/\bprototype\b/.test(normalized)) families.push("prototype");
  if (/\battention\b|\btoken\b/.test(normalized)) families.push("attention");
  if (/\bclip\b|\bmultimodal\b|\btext\b/.test(normalized)) families.push("multimodal");
  if (families.length === 0) families.push("generic");
  return families;
}

export async function materializeMechanismEvidence(params: {
  projectRoot: string;
  patch?: Record<string, unknown>;
}) {
  const manifest = await readProjectManifest(params.projectRoot);
  const current = normalizeMechanismEvidenceState(manifest.mechanism_evidence);
  const patch = params.patch ?? {};
  const [storyText, claimMatrixText] = await Promise.all([
    readProjectText(params.projectRoot, "academic_writer/KG_STORYLINE_PACKET.md"),
    readProjectText(params.projectRoot, "analyzer/CLAIM_EVIDENCE_MATRIX.md"),
  ]);
  const families = inferMechanismFamilies(`${storyText ?? ""}\n${claimMatrixText ?? ""}`);
  const papernexusArtifacts = await inspectPapernexusBridgeArtifacts({ projectRoot: params.projectRoot });
  const graphContextStatus = derivePapernexusEvidenceStatus({
    artifacts: papernexusArtifacts,
    requireGraphContext: true,
    graphContextStatus: papernexusArtifacts.anyArtifactsPresent ? "ready" : "missing",
  });
  const defaultPacketPath = current.packetPath ?? "researcher/MECHANISM_EVIDENCE.json";
  const defaultPlanPath = current.planPath ?? "researcher/MECHANISM_EVIDENCE_PLAN.md";
  const packetPath =
    (typeof patch.packet_path === "string" && patch.packet_path) ||
    (typeof patch.packetPath === "string" && patch.packetPath) ||
    defaultPacketPath;
  const planPath =
    (typeof patch.plan_path === "string" && patch.plan_path) ||
    (typeof patch.planPath === "string" && patch.planPath) ||
    defaultPlanPath;
  await writeProjectJson(params.projectRoot, packetPath, {
    schemaVersion: 1,
    generatedAt: nowIso(),
    families,
    graphContextStatus,
    availableArtifacts: papernexusArtifacts,
  });
  const requiredEvidenceByFamily: Record<string, string[]> = {
    frequency: ["frequency visualization", "filter response analysis", "spectral ablation"],
    prototype: ["prototype drift plot", "cluster separation", "prototype update ablation"],
    attention: ["attention heatmap", "token importance", "background vs object focus"],
    multimodal: ["modality ablation", "text contribution analysis", "alignment failure cases"],
    generic: ["failure cases", "mechanism-targeted ablation", "qualitative inspection"],
  };
  const planLines = [
    "# Mechanism Evidence Plan",
    "",
    `- Families: ${families.join(", ")}`,
    `- Graph context status: ${graphContextStatus}`,
    "",
    "## Required evidence",
    ...families.flatMap((family) =>
      (requiredEvidenceByFamily[family] ?? requiredEvidenceByFamily.generic).map(
        (item) => `- [ ] ${family}: ${item}`
      )
    ),
  ];
  await writeProjectText(params.projectRoot, planPath, `${planLines.join("\n")}\n`);
  const next = normalizeMechanismEvidenceState({
    ...serializeMechanismEvidenceState(current),
    schema_version: 2,
    status:
      (typeof patch.status === "string" && patch.status) ||
      (families.length > 0 ? "ready" : "missing"),
    packet_path: packetPath,
    plan_path: planPath,
    evidence_tier:
      (typeof patch.evidence_tier === "string" && patch.evidence_tier) ||
      (typeof patch.evidenceTier === "string" && patch.evidenceTier) ||
      (families.includes("generic") ? "baseline" : "targeted"),
    graph_context_status:
      (typeof patch.graph_context_status === "string" && patch.graph_context_status) ||
      (typeof patch.graphContextStatus === "string" && patch.graphContextStatus) ||
      graphContextStatus,
    pending_reason:
      (typeof patch.pending_reason === "string" && patch.pending_reason) ||
      (typeof patch.pendingReason === "string" && patch.pendingReason) ||
      (graphContextStatus === "missing" || graphContextStatus === "graph_unavailable"
        ? "Mechanism evidence is not yet graph-grounded."
        : null),
    last_materialized_at: nowIso(),
  });
  manifest.mechanism_evidence = serializeMechanismEvidenceState(next);
  await writeProjectManifest(params.projectRoot, manifest);
  return next;
}
