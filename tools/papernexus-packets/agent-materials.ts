import * as path from "node:path";

import {
  asRecord,
  asStringArray,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import { writeJsonAtomicEnsured } from "../workflow-guard-core/fs";
import {
  callPapernexusMcpTool,
  type PapernexusMcpClientConfig,
} from "./mcp-client";

export const DEFAULT_PAPERNEXUS_AGENT_MATERIALS_BUNDLE_PATH =
  "researcher/papernexus/AGENT_MATERIALS_BUNDLE.json";
export const LEGACY_PAPERNEXUS_AGENT_MATERIALS_PACK_PATH =
  "researcher/papernexus/AGENT_MATERIALS_PACK.json";

type AgentMaterialsPayloads = {
  sourceDiscoveryPlan: Record<string, unknown> | null;
  materialPack: Record<string, unknown> | null;
  importRequisitionPack: Record<string, unknown> | null;
};

export type PapernexusAgentMaterialsResult = AgentMaterialsPayloads & {
  attempted: boolean;
  available: boolean;
  error: string | null;
  artifactPaths: {
    bundle: string | null;
  };
  literatureDiscoveryQueries: string[];
  seedPapers: Record<string, unknown>[];
  summary: Record<string, unknown>;
};

function nowIso() {
  return new Date().toISOString();
}

function parseMcpToolJsonPayload(value: unknown): Record<string, unknown> | null {
  const envelope = asRecord(value);
  const content = Array.isArray(envelope?.content) ? envelope.content : [];
  const textBlock = content
    .map((entry) => asRecord(entry))
    .find((entry) => typeof entry?.text === "string");
  const raw = typeof textBlock?.text === "string" ? textBlock.text : value;
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return asRecord(raw);
}

function compactString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function collectQueryTexts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return compactString(entry);
      }
      const record = asRecord(entry);
      return record ? pickString(record, ["query", "topic", "text"]) : null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function collectGeneratedQueryTexts(pack: Record<string, unknown> | null): string[] {
  const generated = asRecord(pack?.generated_queries ?? pack?.generatedQueries);
  if (!generated) {
    return [];
  }
  return uniqueStrings([
    ...collectQueryTexts(generated.target),
    ...collectQueryTexts(generated.near_source ?? generated.nearSource),
    ...collectQueryTexts(generated.far_source ?? generated.farSource),
    ...collectQueryTexts(generated.source_domains ?? generated.sourceDomains),
  ]);
}

function collectPlanQueryTexts(plan: Record<string, unknown> | null): string[] {
  if (!plan) {
    return [];
  }
  return uniqueStrings([
    ...collectQueryTexts(plan.target_queries ?? plan.targetQueries),
    ...collectQueryTexts(plan.near_source_queries ?? plan.nearSourceQueries),
    ...collectQueryTexts(plan.far_source_queries ?? plan.farSourceQueries),
    ...collectQueryTexts(plan.source_domain_queries ?? plan.sourceDomainQueries),
  ]);
}

function collectPackQueryTexts(pack: Record<string, unknown> | null): string[] {
  const discovery = asRecord(pack?.source_discovery ?? pack?.sourceDiscovery);
  return uniqueStrings([
    ...collectPlanQueryTexts(discovery),
    ...collectGeneratedQueryTexts(pack),
  ]);
}

function readImportRequisitions(payload: Record<string, unknown> | null): Record<string, unknown>[] {
  const direct = payload?.import_requisitions ?? payload?.importRequisitions;
  if (!Array.isArray(direct)) {
    return [];
  }
  return direct
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function seedPaperFromImportRequisition(
  requisition: Record<string, unknown>
): Record<string, unknown> | null {
  const identifiers = asRecord(requisition.identifiers) ?? {};
  const title = pickString(requisition, ["title", "paper_title", "paperTitle"]);
  const sourceHints = uniqueStrings([
    ...asStringArray(requisition.source_hints ?? requisition.sourceHints),
    pickString(requisition, ["markdown_url", "markdownUrl"]),
    pickString(requisition, ["pdf_url", "pdfUrl"]),
  ].filter((entry): entry is string => Boolean(entry)));
  const seed: Record<string, unknown> = {
    title,
    doi: pickString(identifiers, ["doi"]),
    arxivId: pickString(identifiers, ["arxivId", "arxiv_id", "arxiv"]),
    arxiv_id: pickString(identifiers, ["arxivId", "arxiv_id", "arxiv"]),
    pmid: pickString(identifiers, ["pmid"]),
    pmcid: pickString(identifiers, ["pmcid"]),
    expectedRole: pickString(requisition, ["expected_role", "expectedRole"]),
    expected_role: pickString(requisition, ["expected_role", "expectedRole"]),
    sourceHints,
    source_hints: sourceHints,
  };
  const compact = Object.fromEntries(
    Object.entries(seed).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== null && value !== undefined && value !== "";
    })
  );
  return Object.keys(compact).length > 0 ? compact : null;
}

function collectSeedPapersFromMaterialPayloads(
  payloads: AgentMaterialsPayloads
): Record<string, unknown>[] {
  const requisitions = [
    ...readImportRequisitions(payloads.sourceDiscoveryPlan),
    ...readImportRequisitions(payloads.materialPack),
    ...readImportRequisitions(payloads.importRequisitionPack),
  ];
  const seen = new Set<string>();
  const seeds: Record<string, unknown>[] = [];
  for (const requisition of requisitions) {
    const seed = seedPaperFromImportRequisition(requisition);
    if (!seed) {
      continue;
    }
    const key = JSON.stringify([
      seed.title ?? null,
      seed.doi ?? null,
      seed.arxivId ?? null,
      seed.pmid ?? null,
      seed.pmcid ?? null,
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    seeds.push(seed);
  }
  return seeds.slice(0, 12);
}

function buildSummary(payloads: AgentMaterialsPayloads, artifactPaths: PapernexusAgentMaterialsResult["artifactPaths"]): Record<string, unknown> {
  const materialGroups = Array.isArray(payloads.materialPack?.groups)
    ? payloads.materialPack.groups
    : [];
  const missingMaterials = Array.isArray(payloads.materialPack?.missing_materials)
    ? payloads.materialPack.missing_materials
    : Array.isArray(payloads.materialPack?.missingMaterials)
      ? payloads.materialPack.missingMaterials
      : [];
  const importRequisitions = [
    ...readImportRequisitions(payloads.sourceDiscoveryPlan),
    ...readImportRequisitions(payloads.materialPack),
    ...readImportRequisitions(payloads.importRequisitionPack),
  ];
  const sourceDomainQueries = collectQueryTexts(
    payloads.sourceDiscoveryPlan?.source_domain_queries ??
      payloads.sourceDiscoveryPlan?.sourceDomainQueries
  );
  return {
    contract: "papernexus_agent_materials_adapter",
    bundle_path: artifactPaths.bundle,
    material_group_count: materialGroups.length,
    missing_material_count: missingMaterials.length,
    import_requisition_count: importRequisitions.length,
    source_domain_query_count: sourceDomainQueries.length,
  };
}

async function callAgentMaterials(
  clientConfig: PapernexusMcpClientConfig,
  args: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const result = await callPapernexusMcpTool(clientConfig, "agent_materials", args);
  if (!result.ok) {
    throw new Error(result.error ?? "PaperNexus agent_materials failed.");
  }
  return parseMcpToolJsonPayload(result.data);
}

export async function materializePapernexusAgentMaterials(params: {
  projectRoot: string;
  clientConfig: PapernexusMcpClientConfig;
  sharedCorpus: string | null;
  projectId: string | null;
  targetProblem: string;
  targetDomain?: string | null;
  constraints?: string[];
  seedPapers?: Record<string, unknown>[];
  now?: string;
}): Promise<PapernexusAgentMaterialsResult> {
  const generatedAt = params.now ?? nowIso();
  const baseArgs: Record<string, unknown> = {
    corpus: params.sharedCorpus ?? "",
    project: params.projectId ?? null,
    targetProblem: params.targetProblem,
    query: params.targetProblem,
    autoDiscoverSources: true,
    includeProviderEvidence: false,
    ...(params.targetDomain ? { targetDomain: params.targetDomain } : {}),
    ...(params.constraints && params.constraints.length > 0
      ? { constraints: params.constraints }
      : {}),
    ...(params.seedPapers && params.seedPapers.length > 0
      ? { seedPapers: params.seedPapers }
      : {}),
  };

  try {
    const sourceDiscoveryPlan = await callAgentMaterials(params.clientConfig, {
      ...baseArgs,
      operation: "source_discovery_plan",
    });
    if (!sourceDiscoveryPlan) {
      throw new Error("PaperNexus agent_materials source_discovery_plan returned an unreadable payload.");
    }
    const materialPack = await callAgentMaterials(params.clientConfig, {
      ...baseArgs,
      operation: "research_material_pack",
    });
    if (!materialPack) {
      throw new Error("PaperNexus agent_materials research_material_pack returned an unreadable payload.");
    }
    const importRequisitionPack = await callAgentMaterials(params.clientConfig, {
      ...baseArgs,
      operation: "import_requisition_pack",
    });
    if (!importRequisitionPack) {
      throw new Error("PaperNexus agent_materials import_requisition_pack returned an unreadable payload.");
    }
    const payloads = {
      sourceDiscoveryPlan,
      materialPack,
      importRequisitionPack,
    };
    const artifactPaths = {
      bundle: DEFAULT_PAPERNEXUS_AGENT_MATERIALS_BUNDLE_PATH,
    };
    const literatureDiscoveryQueries = uniqueStrings([
      ...collectPlanQueryTexts(sourceDiscoveryPlan),
      ...collectPackQueryTexts(materialPack),
      ...collectGeneratedQueryTexts(importRequisitionPack),
    ]).slice(0, 18);
    const seedPapers = collectSeedPapersFromMaterialPayloads(payloads);
    const summary = buildSummary(payloads, artifactPaths);
    await writeJsonAtomicEnsured(
      path.join(params.projectRoot, DEFAULT_PAPERNEXUS_AGENT_MATERIALS_BUNDLE_PATH),
      {
        contractVersion: "autoresearch-papernexus-agent-materials-bundle-v1",
        kind: "papernexus_agent_materials_bundle",
        generated_at: generatedAt,
        source: "papernexus:agent_materials",
        corpus: params.sharedCorpus ?? null,
        project_id: params.projectId ?? null,
        target_problem: params.targetProblem,
        target_domain: params.targetDomain ?? null,
        constraints: params.constraints ?? [],
        source_discovery_plan: sourceDiscoveryPlan,
        research_material_pack: materialPack,
        import_requisition_pack: importRequisitionPack,
        derived: {
          literature_discovery_queries: literatureDiscoveryQueries,
          seed_papers: seedPapers,
        },
        summary,
      }
    );
    return {
      attempted: true,
      available: true,
      error: null,
      artifactPaths,
      sourceDiscoveryPlan,
      materialPack,
      importRequisitionPack,
      literatureDiscoveryQueries,
      seedPapers,
      summary,
    };
  } catch (error) {
    return {
      attempted: true,
      available: false,
      error: error instanceof Error ? error.message : String(error),
      artifactPaths: {
        bundle: null,
      },
      sourceDiscoveryPlan: null,
      materialPack: null,
      importRequisitionPack: null,
      literatureDiscoveryQueries: [],
      seedPapers: [],
      summary: {
        contract: "papernexus_agent_materials_adapter",
        unavailable_reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
