import * as path from "node:path";

import {
  asRecord,
  asStringArray,
  normalizeStage,
  pickNumber,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  readJsonIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import {
  normalizeInnovationReflectionState,
  serializeInnovationReflectionState,
} from "../workflow-guard-state/research-loop-state";
import {
  isInnovationReflectionDue,
} from "../workflow-kernel/readiness";
import { appendWorkflowDiagnosticEvent } from "../workflow-diagnostics.js";

type ManifestLike = Record<string, unknown>;

const REFLECTION_PATH = "researcher/INNOVATION_REFLECTION.md";
const LEDGER_PATH = "researcher/EXPERIMENT_LEDGER.json";

function nowIso(): string {
  return new Date().toISOString();
}

function resolve(projectRoot: string, artifactPath: string): string {
  return path.join(projectRoot, ...artifactPath.split("/"));
}

function experimentRecords(ledger: unknown): Array<Record<string, unknown>> {
  const record = asRecord(ledger);
  const raw = Array.isArray(record?.experiments) ? record.experiments : [];
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function experimentId(entry: Record<string, unknown>, index: number): string {
  return (
    pickString(entry, ["experimentId", "experiment_id", "id"]) ??
    `experiment-${index + 1}`
  );
}

function experimentUpdatedAt(entry: Record<string, unknown>): string | null {
  return pickString(entry, [
    "updatedAt",
    "updated_at",
    "completedAt",
    "completed_at",
    "createdAt",
    "created_at",
  ]);
}

function isReflectableExperiment(entry: Record<string, unknown>): boolean {
  return Boolean(
    normalizeStage(pickString(entry, ["status"])) ||
      experimentUpdatedAt(entry) ||
      pickString(entry, ["decision", "failureSignature", "failure_signature"]) ||
      Array.isArray(entry.resultPaths) ||
      Array.isArray(entry.result_paths) ||
      Array.isArray(entry.evidencePointers) ||
      Array.isArray(entry.evidence_pointers)
  );
}

function reflectionBasis(ledger: unknown): {
  latestExperimentUpdateAt: string | null;
  experimentIds: string[];
  experiments: Array<Record<string, unknown>>;
} {
  const experiments = experimentRecords(ledger)
    .filter(isReflectableExperiment)
    .sort((left, right) => {
      const leftUpdated = experimentUpdatedAt(left) ?? "";
      const rightUpdated = experimentUpdatedAt(right) ?? "";
      return rightUpdated.localeCompare(leftUpdated);
    });
  return {
    latestExperimentUpdateAt:
      experiments.length > 0 ? experimentUpdatedAt(experiments[0]) : null,
    experimentIds: experiments.map(experimentId),
    experiments,
  };
}

function metricSummary(entry: Record<string, unknown>): string[] {
  const metrics = asRecord(entry.metrics) ?? {};
  const resultSummary = asRecord(entry.result_summary ?? entry.resultSummary) ?? {};
  const proposed = asRecord(resultSummary.proposed) ?? {};
  const baseline = asRecord(resultSummary.baseline) ?? {};
  const values = [
    ["h_score", pickNumber(metrics, ["h_score", "hScore"]) ?? pickNumber(proposed, ["h_score", "hScore"])],
    [
      "baseline_h_score",
      pickNumber(metrics, ["baseline_h_score", "baselineHScore"]) ??
        pickNumber(baseline, ["h_score", "hScore"]),
    ],
    [
      "delta_h_score",
      pickNumber(metrics, ["delta_h_score", "deltaHScore"]) ??
        pickNumber(resultSummary, ["delta_h_score", "deltaHScore"]),
    ],
    [
      "known_accuracy",
      pickNumber(metrics, ["known_accuracy", "knownAccuracy"]) ??
        pickNumber(proposed, ["known_accuracy", "knownAccuracy"]),
    ],
    [
      "novel_accuracy",
      pickNumber(metrics, ["novel_accuracy", "novelAccuracy"]) ??
        pickNumber(proposed, ["novel_accuracy", "novelAccuracy"]),
    ],
  ];
  return values
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([name, value]) => `${name}=${Number(value).toFixed(4)}`);
}

function experimentLine(entry: Record<string, unknown>, index: number): string {
  const id = experimentId(entry, index);
  const status = normalizeStage(pickString(entry, ["status"])) ?? "unknown";
  const decision =
    pickString(entry, ["decision", "lastDecision", "last_decision"]) ?? "undecided";
  const metricText = metricSummary(entry);
  const oneChange =
    pickString(entry, [
      "oneChangeSignature",
      "one_change_signature",
      "hypothesis",
      "summary",
      "title",
    ]) ?? "experiment evidence";
  return [
    `- ${id}: status=${status}; decision=${decision}; change=${oneChange}.`,
    metricText.length > 0 ? `  Metrics: ${metricText.join(", ")}.` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function collectEvidencePointers(experiments: Array<Record<string, unknown>>): string[] {
  return uniqueStrings(
    experiments.flatMap((entry) => [
      ...asStringArray(entry.evidencePointers ?? entry.evidence_pointers),
      ...asStringArray(entry.resultPaths ?? entry.result_paths),
      pickString(entry, ["evaluationSummaryPath", "evaluation_summary_path"]),
      pickString(entry, ["plotPackPath", "plot_pack_path"]),
    ]).filter((value): value is string => Boolean(value))
  );
}

function buildReflectionMarkdown(params: {
  manifest: ManifestLike;
  basis: ReturnType<typeof reflectionBasis>;
  generatedAt: string;
}): string {
  const projectId =
    pickString(params.manifest, ["project_id", "projectId"]) ?? "unknown-project";
  const topic =
    pickString(params.manifest, ["topic", "research_topic", "title"]) ??
    pickString(asRecord(params.manifest.research_program) ?? {}, ["goal"]) ??
    "unknown topic";
  const evidencePointers = collectEvidencePointers(params.basis.experiments);
  const experimentLines =
    params.basis.experiments.length > 0
      ? params.basis.experiments.map(experimentLine).join("\n")
      : "- No reflectable experiment entries were found.";

  return [
    "# Innovation Reflection",
    "",
    `Generated at: ${params.generatedAt}`,
    `Project: ${projectId}`,
    `Topic: ${topic}`,
    "",
    "## Experiment Evidence Reflected",
    "",
    experimentLines,
    "",
    "## Keep / Discard Interpretation",
    "",
    "The current experiment ledger has been reflected into ideation memory. If the latest trial is marked keep or innovation_supported, the next IDEA pass should preserve the validated one-change signature and only explore follow-up tracks that are comparable under the same dataset and metric envelope. If later evidence regresses, the next reflection should reopen the direction rather than silently reusing this memo.",
    "",
    "## Evidence Pointers",
    "",
    evidencePointers.length > 0
      ? evidencePointers.map((entry) => `- ${entry}`).join("\n")
      : "- No explicit evidence pointer paths were recorded in the ledger.",
    "",
    "## Workflow Decision",
    "",
    "Status: fresh. The latest experiment evidence is now safe for the next idea proposal or judging pass.",
    "",
  ].join("\n");
}

export async function shouldMaterializeInnovationReflection(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (!params.stage || !["idea", "plan", "review", "write", "submit"].includes(params.stage)) {
    return false;
  }
  const ledger = await readJsonIfExists<Record<string, unknown>>(
    resolve(params.projectRoot, LEDGER_PATH)
  );
  return isInnovationReflectionDue({
    state: normalizeInnovationReflectionState(params.manifest.innovation_reflection),
    ledger,
  });
}

export async function materializeInnovationReflection(params: {
  projectRoot: string;
  trigger?: string | null;
  agentId?: string | null;
}): Promise<{ materialized: boolean; generatedFiles: string[] }> {
  const manifestPath = resolve(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest =
    (await readJsonIfExists<ManifestLike>(manifestPath)) ?? {};
  const ledger =
    (await readJsonIfExists<Record<string, unknown>>(
      resolve(params.projectRoot, LEDGER_PATH)
    )) ?? {};
  const state = normalizeInnovationReflectionState(manifest.innovation_reflection);
  if (!isInnovationReflectionDue({ state, ledger })) {
    return { materialized: false, generatedFiles: [] };
  }

  const basis = reflectionBasis(ledger);
  const generatedAt = nowIso();
  const reflectionMarkdown = buildReflectionMarkdown({
    manifest,
    basis,
    generatedAt,
  });
  await writeTextEnsured(resolve(params.projectRoot, REFLECTION_PATH), reflectionMarkdown);

  manifest.innovation_reflection = serializeInnovationReflectionState({
    ...state,
    requiredAfterExperiments: true,
    status: "fresh",
    lastReflectionAt: generatedAt,
    lastReflectionPath: REFLECTION_PATH,
    reflectedThroughExperimentUpdateAt:
      basis.latestExperimentUpdateAt ?? generatedAt,
    reflectedExperimentIds: basis.experimentIds,
    pendingReason: null,
  });
  manifest.updated_at = generatedAt;
  await writeJsonEnsured(manifestPath, manifest);

  await appendWorkflowDiagnosticEvent({
    projectRoot: params.projectRoot,
    projectId: pickString(manifest, ["project_id", "projectId"]),
    component: "stage_preflight",
    action: "innovation_reflection_materialized",
    status: "completed",
    stage: "idea",
    owner: "researcher",
    summary: "Materialized deterministic innovation reflection from experiment ledger.",
    details: {
      trigger: params.trigger ?? null,
      agentId: params.agentId ?? null,
      reflectionPath: REFLECTION_PATH,
      reflectedExperimentIds: basis.experimentIds,
      reflectedThroughExperimentUpdateAt:
        basis.latestExperimentUpdateAt ?? generatedAt,
    },
  });

  return {
    materialized: true,
    generatedFiles: [REFLECTION_PATH],
  };
}
