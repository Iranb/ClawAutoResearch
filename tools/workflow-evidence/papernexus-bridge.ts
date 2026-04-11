import { pathExists } from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH,
  DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH,
  DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH,
  DEFAULT_MECHANISM_BRIDGE_PACKET_PATH,
} from "../papernexus-packets/materializer";
import type { WorkflowGraphContextStatus } from "../workflow-kernel/graph-context";

export type PapernexusBridgeArtifactKey =
  | "mechanism_bridge_packet"
  | "challenge_insight_packet"
  | "graph_storyline_packet"
  | "idea_catalyst_bundle";

export type PapernexusBridgeArtifactInspection = {
  key: PapernexusBridgeArtifactKey;
  configuredPath: string;
  resolvedPath: string | null;
  exists: boolean;
};

export type PapernexusBridgeArtifacts = {
  mechanismBridgePacket: PapernexusBridgeArtifactInspection;
  challengeInsightPacket: PapernexusBridgeArtifactInspection;
  graphStorylinePacket: PapernexusBridgeArtifactInspection;
  ideaCatalystBundle: PapernexusBridgeArtifactInspection;
  anyArtifactsPresent: boolean;
};

export type PapernexusEvidenceStatus =
  | "ready"
  | "missing_artifacts"
  | "graph_unavailable"
  | "unverified_graph_context";

function buildArtifactInspection(params: {
  key: PapernexusBridgeArtifactKey;
  configuredPath: string;
  resolvedPath: string | null;
  exists: boolean;
}): PapernexusBridgeArtifactInspection {
  return {
    key: params.key,
    configuredPath: params.configuredPath,
    resolvedPath: params.resolvedPath,
    exists: params.exists,
  };
}

export async function inspectPapernexusBridgeArtifacts(params: {
  projectRoot: string;
  pathExistsImpl?: typeof pathExists;
}): Promise<PapernexusBridgeArtifacts> {
  const pathExistsImpl = params.pathExistsImpl ?? pathExists;
  const inspections = await Promise.all(
    [
      {
        key: "mechanism_bridge_packet" as const,
        configuredPath: DEFAULT_MECHANISM_BRIDGE_PACKET_PATH,
      },
      {
        key: "challenge_insight_packet" as const,
        configuredPath: DEFAULT_CHALLENGE_INSIGHT_PACKET_PATH,
      },
      {
        key: "graph_storyline_packet" as const,
        configuredPath: DEFAULT_GRAPH_STORYLINE_PACKET_SOURCE_PATH,
      },
      {
        key: "idea_catalyst_bundle" as const,
        configuredPath: DEFAULT_IDEA_CATALYST_PACKET_BUNDLE_PATH,
      },
    ].map(async (entry) => {
      const resolvedPath = resolveProjectArtifactPath(
        params.projectRoot,
        entry.configuredPath
      );
      const exists = Boolean(resolvedPath && (await pathExistsImpl(resolvedPath)));
      return buildArtifactInspection({
        key: entry.key,
        configuredPath: entry.configuredPath,
        resolvedPath,
        exists,
      });
    })
  );

  const [
    mechanismBridgePacket,
    challengeInsightPacket,
    graphStorylinePacket,
    ideaCatalystBundle,
  ] = inspections;
  return {
    mechanismBridgePacket,
    challengeInsightPacket,
    graphStorylinePacket,
    ideaCatalystBundle,
    anyArtifactsPresent: inspections.some((entry) => entry.exists),
  };
}

export function derivePapernexusEvidenceStatus(params: {
  artifacts: Pick<PapernexusBridgeArtifacts, "anyArtifactsPresent">;
  requireGraphContext: boolean;
  graphContextStatus?: WorkflowGraphContextStatus | null;
}): PapernexusEvidenceStatus {
  const graphStatus = params.graphContextStatus ?? null;
  if (params.artifacts.anyArtifactsPresent) {
    if (
      params.requireGraphContext &&
      (graphStatus === "missing" || graphStatus === "unavailable")
    ) {
      return "unverified_graph_context";
    }
    return "ready";
  }
  if (
    params.requireGraphContext &&
    (graphStatus === "missing" || graphStatus === "unavailable")
  ) {
    return "graph_unavailable";
  }
  return "missing_artifacts";
}
