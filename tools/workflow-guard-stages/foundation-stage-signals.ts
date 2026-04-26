import * as path from "node:path";
import type { ManifestLike, StageSignalsContext } from "./types";
import { readTextIfExists } from "../workflow-guard-core/fs";
import { auditFrontierReportText } from "../workflow-intermediate-artifact-audit";
import { deriveGraphBuildPartialReadiness } from "../workflow-guard-state/paper-ingestion";

export interface FoundationStageDeps {
  pathExists: (targetPath: string) => Promise<boolean>;
  isNonEmptyDirectory: (targetPath: string) => Promise<boolean>;
  fileHasMeaningfulJsonContent: (targetPath: string | null) => Promise<boolean>;
  manifestFieldExists: (manifest: ManifestLike | null, pathSpec: string[]) => boolean;
  getExperimentLedgerPath: (projectRoot: string) => string;
  pickString: (record: Record<string, unknown>, keys: string[]) => string | null;
  normalizeResearchProgramState: (value: unknown) => any;
  getResearchProgramOnboardingGaps: (params: {
    state: any;
    projectId: string | null;
  }) => string[];
  asRecord: (value: unknown) => Record<string, unknown> | null;
  normalizeGraphPresenceStatus: (value: unknown) => string | null;
  normalizePaperIngestionState: (value: unknown) => any;
  hasActiveWorkflowOwnedPaperUpload: (state: any) => boolean;
  derivePaperIngestionWorkflowDecision?: (params: {
    state: any;
    graphPresenceStatus?: unknown;
  }) => {
    action: "continue" | "wait" | "repair";
    blocking: boolean;
    reason: string | null;
    ignoredDormantQueuedRequestCount?: number;
  };
  summarizeGraphPresenceMissing: (
    paperIngestion: Record<string, unknown> | null
  ) => string | null;
  getBrainstormCycleMissingSignals: (params: {
    projectRoot: string;
    manifest: ManifestLike | null;
  }) => Promise<string[]>;
  normalizeStage: (value: unknown) => string | null;
}

export async function collectSetupStageMissingSignals(
  ctx: StageSignalsContext,
  deps: FoundationStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "PROJECT_MANIFEST.json")))) {
    missing.push("{PROJ}/PROJECT_MANIFEST.json");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "TRACK_REGISTRY.json")))) {
    missing.push("{PROJ}/TRACK_REGISTRY.json");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "CLAIM_POLICY.md")))) {
    missing.push("{PROJ}/CLAIM_POLICY.md");
  }
  if (!(await deps.pathExists(deps.getExperimentLedgerPath(ctx.projectRoot)))) {
    missing.push("{PROJ}/researcher/EXPERIMENT_LEDGER.json");
  }
  if (!deps.manifestFieldExists(ctx.manifest, ["idle_research"])) {
    missing.push("PROJECT_MANIFEST.json.idle_research");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "graph")))) {
    missing.push("{PROJ}/graph/");
  }
  const researchProgram = deps.normalizeResearchProgramState(
    ctx.manifest?.research_program
  );
  missing.push(
    ...deps.getResearchProgramOnboardingGaps({
      state: researchProgram,
      projectId: deps.pickString(ctx.manifest ?? {}, ["project_id", "projectId"]),
    })
  );
  return missing;
}

export async function collectGraphBuildStageMissingSignals(
  ctx: StageSignalsContext,
  deps: FoundationStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "graph", "PAPERNEXUS_STATUS.json")))) {
    missing.push("{PROJ}/graph/PAPERNEXUS_STATUS.json");
  }
  if (!(await deps.pathExists(path.join(ctx.projectRoot, "graph", "GRAPH_BUILD_REPORT.md")))) {
    missing.push("{PROJ}/graph/GRAPH_BUILD_REPORT.md");
  }
  if (
    !(await deps.pathExists(path.join(ctx.projectRoot, "graph", "GRAPH_PRESENCE_CHECK.json")))
  ) {
    missing.push("{PROJ}/graph/GRAPH_PRESENCE_CHECK.json");
  }
  if (!deps.manifestFieldExists(ctx.manifest, ["paper_ingestion", "graph_presence_checked_at"])) {
    missing.push("PROJECT_MANIFEST.json.paper_ingestion.graph_presence_checked_at");
  }

  const paperIngestion = deps.asRecord(ctx.manifest?.paper_ingestion);
  const paperIngestionState = deps.normalizePaperIngestionState(paperIngestion);
  const graphPresenceStatus = deps.normalizeGraphPresenceStatus(
    paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
  );
  const ingestionDecision = deps.derivePaperIngestionWorkflowDecision?.({
    state: paperIngestionState,
    graphPresenceStatus,
  });
  const partialGraphReadiness = deriveGraphBuildPartialReadiness({
    paperIngestion,
    state: paperIngestionState,
    graphPresenceStatus,
  });
  const allowPartialGraphReadiness =
    partialGraphReadiness.ready &&
    deps.normalizeStage(ctx.manifest?.current_stage) === "graph_build";
  if (
    (ingestionDecision?.blocking && !allowPartialGraphReadiness) ||
    (!ingestionDecision && deps.hasActiveWorkflowOwnedPaperUpload(paperIngestionState))
  ) {
    missing.push(
      ingestionDecision?.reason ??
        "workflow-owned PaperNexus ingestion is still active; wait for upload / graph sync completion before frontier mapping"
    );
  }
  if (graphPresenceStatus !== "ready" && !allowPartialGraphReadiness) {
    missing.push(
      `PROJECT_MANIFEST.json.paper_ingestion.graph_presence_status = ready (current: ${graphPresenceStatus ?? "unset"})`
    );
    const missingSummary = deps.summarizeGraphPresenceMissing(paperIngestion);
    if (missingSummary) {
      missing.push(`PaperNexus corpus still misses canonical papers: ${missingSummary}`);
    }
  }
  return missing;
}

export async function collectFrontierMappingStageMissingSignals(
  ctx: StageSignalsContext,
  deps: FoundationStageDeps
): Promise<string[]> {
  const missing: string[] = [];
  const frontierReportPath = path.join(ctx.projectRoot, "researcher", "FRONTIER_REPORT.md");
  if (!(await deps.pathExists(frontierReportPath))) {
    missing.push("{PROJ}/researcher/FRONTIER_REPORT.md");
  } else {
    const audit = auditFrontierReportText(await readTextIfExists(frontierReportPath));
    if (!audit.ok) {
      missing.push(...audit.issues);
    }
  }

  const directFrontierFiles = [
    "LIMITATION_FRONTIER.md",
    "CONTRADICTION_FRONTIER.md",
    "TRANSFER_FRONTIER.md",
    "COMPOSITION_FRONTIER.md",
    "ANCHOR_INDEX.md",
  ];
  const directFrontiersReady = (
    await Promise.all(
      directFrontierFiles.map((fileName) =>
        deps.pathExists(path.join(ctx.projectRoot, "graph", fileName))
      )
    )
  ).every(Boolean);
  const legacySubgraphsReady = await deps.isNonEmptyDirectory(
    path.join(ctx.projectRoot, "graph", "subgraphs")
  );
  const frontierPackReady = directFrontiersReady || legacySubgraphsReady;
  if (!frontierPackReady) {
    missing.push(
      "{PROJ}/graph/LIMITATION_FRONTIER.md, CONTRADICTION_FRONTIER.md, TRANSFER_FRONTIER.md, COMPOSITION_FRONTIER.md, ANCHOR_INDEX.md (or legacy {PROJ}/graph/subgraphs/)"
    );
  }

  if (
    deps.normalizeStage(ctx.manifest?.current_stage) === "frontier_mapping" &&
    deps.normalizeStage(ctx.manifest?.current_micro_stage) !== "frontiers_packaged" &&
    !frontierPackReady
  ) {
    missing.push("PROJECT_MANIFEST.json.current_micro_stage = frontiers_packaged");
  }

  missing.push(
    ...(await deps.getBrainstormCycleMissingSignals({
      projectRoot: ctx.projectRoot,
      manifest: ctx.manifest,
    }))
  );
  return missing;
}
