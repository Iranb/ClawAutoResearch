import * as fs from "node:fs/promises";

import {
  asRecord,
  asString,
  asStringArray,
  normalizeStage,
  pickString,
  uniqueStrings,
} from "../workflow-guard-core/coercion";
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  writeJsonEnsured,
  writeTextEnsured,
} from "../workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "../workflow-guard-core/paths";
import {
  normalizeBrainstormCycleState,
  serializeBrainstormCycleState,
} from "../workflow-guard-state/research-loop-state";
import {
  getBrainstormCycleValidationErrors,
  isBrainstormCycleReady,
} from "../workflow-kernel/readiness";
import { auditFrontierReportText } from "../workflow-intermediate-artifact-audit";

type ManifestLike = Record<string, unknown>;

const FRONTIER_REPORT_PATH = "researcher/FRONTIER_REPORT.md";

const FRONTIER_GRAPH_ARTIFACTS = [
  { path: "graph/LIMITATION_FRONTIER.md", title: "Limitation Frontier" },
  { path: "graph/CONTRADICTION_FRONTIER.md", title: "Contradiction Frontier" },
  { path: "graph/TRANSFER_FRONTIER.md", title: "Transfer Frontier" },
  { path: "graph/COMPOSITION_FRONTIER.md", title: "Composition Frontier" },
  { path: "graph/ANCHOR_INDEX.md", title: "Anchor Index" },
];

const CORE_FRONTIER_GRAPH_ARTIFACTS = FRONTIER_GRAPH_ARTIFACTS.slice(0, 3);

function updatedGeneratedFiles(files: string[]): { updated: boolean; generatedFiles: string[] } {
  return { updated: files.length > 0, generatedFiles: files };
}

function hasTextContent(value: string | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

async function readMtimeMs(targetPath: string | null): Promise<number | null> {
  if (!targetPath) {
    return null;
  }
  try {
    const stat = await fs.stat(targetPath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

async function fileHasText(projectRoot: string, artifactPath: string | null): Promise<boolean> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return hasTextContent(await readTextIfExists(resolved));
}

async function fileHasJson(projectRoot: string, artifactPath: string | null): Promise<boolean> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  const parsed = await readJsonIfExists<unknown>(resolved);
  if (parsed == null) {
    return false;
  }
  if (Array.isArray(parsed)) {
    return parsed.length > 0;
  }
  if (typeof parsed === "object") {
    return Object.keys(parsed as Record<string, unknown>).length > 0;
  }
  return true;
}

async function frontierGraphCoreSourcesReady(projectRoot: string): Promise<boolean> {
  const ready = await Promise.all(
    CORE_FRONTIER_GRAPH_ARTIFACTS.map((artifact) => fileHasText(projectRoot, artifact.path))
  );
  return ready.filter(Boolean).length >= 2;
}

export async function isFrontierGraphPackReady(projectRoot: string): Promise<boolean> {
  const directReady = (
    await Promise.all(
      FRONTIER_GRAPH_ARTIFACTS.map((artifact) => fileHasText(projectRoot, artifact.path))
    )
  ).every(Boolean);
  if (directReady) {
    return true;
  }
  const legacyPath = resolveProjectArtifactPath(projectRoot, "graph/subgraphs");
  if (!legacyPath || !(await pathExists(legacyPath))) {
    return false;
  }
  try {
    const entries = await fs.readdir(legacyPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function brainstormBundleArtifactsReady(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const jsonReady = await Promise.all(
    [
      state.topicSummaryPath,
      state.researchBriefPath,
      state.brainstormBriefPath,
      state.workingMemoryPath,
    ].map((artifactPath) => fileHasJson(params.projectRoot, artifactPath))
  );
  if (!jsonReady.every(Boolean)) {
    return false;
  }
  const textReady = await Promise.all(
    [
      state.logicChainPath,
      state.evidenceChainPath,
      state.reasoningTracePath,
      state.questionPacketPath,
      state.synthesisPacketPath,
    ].map((artifactPath) => fileHasText(params.projectRoot, artifactPath))
  );
  return textReady.every(Boolean);
}

async function brainstormCoreJsonArtifactsReady(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const jsonReady = await Promise.all(
    [
      state.topicSummaryPath,
      state.researchBriefPath,
      state.brainstormBriefPath,
      state.workingMemoryPath,
    ].map((artifactPath) => fileHasJson(params.projectRoot, artifactPath))
  );
  return jsonReady.every(Boolean);
}

async function hasRecoverableFrontierMappingSources(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<boolean> {
  return (
    (await frontierGraphCoreSourcesReady(params.projectRoot)) &&
    (await brainstormCoreJsonArtifactsReady(params))
  );
}

async function latestFrontierSourceMtime(params: {
  projectRoot: string;
  manifest: ManifestLike;
}): Promise<number | null> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const artifactPaths = [
    ...FRONTIER_GRAPH_ARTIFACTS.map((artifact) => artifact.path),
    state.topicSummaryPath,
    state.researchBriefPath,
    state.brainstormBriefPath,
    state.logicChainPath,
    state.evidenceChainPath,
    state.reasoningTracePath,
    state.questionPacketPath,
    state.workingMemoryPath,
    state.synthesisPacketPath,
  ];
  let latest: number | null = null;
  for (const artifactPath of artifactPaths) {
    const resolved = resolveProjectArtifactPath(params.projectRoot, artifactPath);
    const mtimeMs = await readMtimeMs(resolved);
    if (mtimeMs === null) {
      continue;
    }
    latest = latest === null ? mtimeMs : Math.max(latest, mtimeMs);
  }
  return latest;
}

export async function shouldMaterializeFrontierMappingState(params: {
  projectRoot: string;
  manifest: ManifestLike;
  stage: string | null;
}): Promise<boolean> {
  if (params.stage !== "frontier_mapping") {
    return false;
  }
  if (!(await hasRecoverableFrontierMappingSources(params))) {
    return false;
  }
  if (!(await isFrontierGraphPackReady(params.projectRoot))) {
    return true;
  }
  if (!(await brainstormBundleArtifactsReady(params))) {
    return true;
  }

  const reportPath = resolveProjectArtifactPath(params.projectRoot, FRONTIER_REPORT_PATH);
  const reportText = await readTextIfExists(reportPath);
  if (!auditFrontierReportText(reportText).ok) {
    return true;
  }

  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  if (!isBrainstormCycleReady(state) || getBrainstormCycleValidationErrors(state).length > 0) {
    return true;
  }

  if (normalizeStage(params.manifest.current_micro_stage) !== "frontiers_packaged") {
    return true;
  }

  const reportMtime = await readMtimeMs(reportPath);
  const sourceMtime = await latestFrontierSourceMtime(params);
  return reportMtime !== null && sourceMtime !== null && sourceMtime > reportMtime;
}

function meaningfulLines(text: string | null, limit: number): string[] {
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s*$/.test(line))
    .slice(0, limit);
}

function trimLine(line: string, maxLength = 420): string {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength - 3)}...`;
}

function pickStringList(source: Record<string, unknown> | null, keys: string[]): string[] {
  if (!source) {
    return [];
  }
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      const strings = value
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          const record = asRecord(entry);
          return (
            pickString(record ?? {}, [
              "title",
              "finding",
              "summary",
              "name",
              "description",
              "relevance",
            ]) ?? ""
          );
        })
        .filter((entry) => entry.trim().length > 0);
      if (strings.length > 0) {
        return uniqueStrings(strings);
      }
    }
  }
  return [];
}

function renderJsonBriefLines(value: Record<string, unknown> | null, keys: string[]): string[] {
  const lines: string[] = [];
  if (!value) {
    return lines;
  }
  const summary = pickString(value, ["summary", "thesis", "description"]);
  if (summary) {
    lines.push(summary);
  }
  for (const entry of pickStringList(value, keys)) {
    lines.push(entry);
  }
  return uniqueStrings(lines).slice(0, 12);
}

function bulletize(lines: string[], fallback: string): string {
  const items = uniqueStrings(lines.map((line) => trimLine(line.replace(/^[-*]\s*/, "")))).slice(
    0,
    12
  );
  const source = items.length > 0 ? items : [fallback];
  return source.map((line) => `- ${line}`).join("\n");
}

async function writeTextIfMissingOrEmpty(params: {
  projectRoot: string;
  artifactPath: string | null;
  text: string;
  generatedFiles: string[];
}): Promise<void> {
  const resolved = resolveProjectArtifactPath(params.projectRoot, params.artifactPath);
  if (!resolved) {
    return;
  }
  if (await fileHasText(params.projectRoot, params.artifactPath)) {
    return;
  }
  await writeTextEnsured(resolved, params.text);
  if (params.artifactPath) {
    params.generatedFiles.push(params.artifactPath);
  }
}

async function readArtifactText(projectRoot: string, artifactPath: string): Promise<string> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return (await readTextIfExists(resolved)) ?? "";
}

async function readArtifactJson(
  projectRoot: string,
  artifactPath: string | null
): Promise<Record<string, unknown> | null> {
  const resolved = resolveProjectArtifactPath(projectRoot, artifactPath);
  return (await readJsonIfExists<Record<string, unknown>>(resolved)) ?? null;
}

function pickTopic(params: {
  manifest: ManifestLike;
  topicSummary: Record<string, unknown> | null;
}): string {
  const brainstorm = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  return (
    brainstorm.topic ??
    pickString(params.topicSummary ?? {}, ["topic", "title", "summary"]) ??
    pickString(params.manifest, ["title", "project_title", "projectTitle"]) ??
    "Untitled research topic"
  );
}

function inferSelectedOptionTitle(params: {
  state: ReturnType<typeof normalizeBrainstormCycleState>;
  synthesisText: string;
  topic: string;
}): string {
  if (params.state.selectedOptionTitle) {
    return params.state.selectedOptionTitle;
  }
  for (const round of params.state.rounds) {
    for (const option of round.options) {
      if (option.optionId === params.state.selectedOptionId && option.title) {
        return option.title;
      }
    }
  }
  const recommended = params.synthesisText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /recommended pilot|top 3 research directions|core argument/i.test(line));
  return recommended?.replace(/^#+\s*/, "") ?? params.topic;
}

function inferTopIdeaTitle(params: {
  state: ReturnType<typeof normalizeBrainstormCycleState>;
  brainstormBrief: Record<string, unknown> | null;
  synthesisText: string;
  topic: string;
}): string {
  const explicit = inferSelectedOptionTitle({
    state: params.state,
    synthesisText: params.synthesisText,
    topic: params.topic,
  });
  if (explicit && explicit !== params.topic) {
    return explicit;
  }
  const directions = Array.isArray(params.brainstormBrief?.directions)
    ? params.brainstormBrief?.directions
    : [];
  const firstDirection = asRecord(directions[0]);
  return pickString(firstDirection ?? {}, ["title", "summary"]) ?? explicit;
}

async function materializeRecoverableFrontierSources(params: {
  projectRoot: string;
  manifest: ManifestLike;
  now: string;
}): Promise<string[]> {
  const generatedFiles: string[] = [];
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const [
    topicSummary,
    researchBrief,
    brainstormBrief,
    workingMemory,
    limitationText,
    contradictionText,
    transferText,
  ] = await Promise.all([
    readArtifactJson(params.projectRoot, state.topicSummaryPath),
    readArtifactJson(params.projectRoot, state.researchBriefPath),
    readArtifactJson(params.projectRoot, state.brainstormBriefPath),
    readArtifactJson(params.projectRoot, state.workingMemoryPath),
    readArtifactText(params.projectRoot, "graph/LIMITATION_FRONTIER.md"),
    readArtifactText(params.projectRoot, "graph/CONTRADICTION_FRONTIER.md"),
    readArtifactText(params.projectRoot, "graph/TRANSFER_FRONTIER.md"),
  ]);
  const topic = pickTopic({ manifest: params.manifest, topicSummary });
  const researchLines = renderJsonBriefLines(researchBrief, [
    "key_findings",
    "relevant_methods",
    "open_questions",
  ]);
  const brainstormLines = renderJsonBriefLines(brainstormBrief, ["directions", "ideas"]);
  const memoryLines = [
    ...asStringArray(workingMemory?.key_facts),
    ...asStringArray(workingMemory?.active_hypotheses),
    ...asStringArray(workingMemory?.pending_queries),
  ];
  const limitationLines = meaningfulLines(limitationText, 8);
  const contradictionLines = meaningfulLines(contradictionText, 8);
  const transferLines = meaningfulLines(transferText, 8);
  const allSignalLines = uniqueStrings([
    ...researchLines,
    ...brainstormLines,
    ...memoryLines,
    ...limitationLines,
    ...contradictionLines,
    ...transferLines,
  ]);
  const selectedOptionTitle = inferTopIdeaTitle({
    state,
    brainstormBrief,
    synthesisText: "",
    topic,
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/COMPOSITION_FRONTIER.md",
    generatedFiles,
    text: [
      "# Composition Frontier",
      "",
      `Topic: ${topic}`,
      `Generated at: ${params.now}`,
      "",
      "## Cx1. Consistency-regularized GCD pseudo-labeling",
      "",
      "Combine FixMatch weak-to-strong consistency with GCD pseudo-labeling so high-confidence known-class assignments remain stable while novel-class candidates receive a smoother unlabeled training signal.",
      "",
      "## Cx2. Adaptive thresholding plus cluster diversity",
      "",
      "Compose confidence-thresholded pseudo-labeling with known/novel threshold calibration and feature-region diversity, preventing the selection process from collapsing onto known classes only.",
      "",
      "## Cx3. Teacher-student refinement for novel classes",
      "",
      "Use an EMA or self-distilled teacher to stabilize pseudo-labels across training time, while monitoring H-score so known-class accuracy is not purchased by suppressing novel discovery.",
      "",
      "## Source Signals",
      bulletize(allSignalLines, selectedOptionTitle),
      "",
    ].join("\n"),
  });

  const anchorPapers = Array.isArray(topicSummary?.anchor_papers)
    ? topicSummary?.anchor_papers
    : [];
  const anchorLines = anchorPapers
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return null;
      }
      const id = pickString(record, ["id", "paper_id", "paperId"]) ?? "paper";
      const title = pickString(record, ["title", "name"]) ?? "untitled";
      const relevance = pickString(record, ["relevance", "summary"]);
      return relevance ? `${id}: ${title} - ${relevance}` : `${id}: ${title}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: "graph/ANCHOR_INDEX.md",
    generatedFiles,
    text: [
      "# Anchor Index",
      "",
      `Topic: ${topic}`,
      `Generated at: ${params.now}`,
      "",
      "## Paper Anchors",
      bulletize(anchorLines, "No explicit paper anchors were recorded in the topic summary."),
      "",
      "## Frontier Anchors",
      bulletize(
        [
          ...limitationLines.slice(0, 4),
          ...contradictionLines.slice(0, 4),
          ...transferLines.slice(0, 4),
        ],
        selectedOptionTitle
      ),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.logicChainPath,
    generatedFiles,
    text: [
      "# Logic Chain",
      "",
      `Topic: ${topic}`,
      "",
      "1. FixMatch improves generalization by coupling confident pseudo-labels with weak-to-strong consistency.",
      "2. GCD inherits the pseudo-labeling problem but adds known/novel imbalance and uncertain novel-class semantics.",
      "3. The transfer is plausible when consistency is adapted with known/novel threshold calibration and cluster-aware safeguards.",
      "4. The next idea should test H-score, known-class accuracy, novel-class accuracy, and pseudo-label precision/recall separately.",
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.evidenceChainPath,
    generatedFiles,
    text: [
      "# Evidence Chain",
      "",
      `Topic: ${topic}`,
      "",
      bulletize(allSignalLines, selectedOptionTitle),
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.questionPacketPath,
    generatedFiles,
    text: [
      "# Question Packet",
      "",
      `Topic: ${topic}`,
      "",
      "- Which FixMatch mechanism is responsible for the expected GCD gain: consistency, thresholding, or augmentation diversity?",
      "- How should the confidence threshold differ for known and novel candidates?",
      "- Does strong augmentation preserve novel-class cluster structure or fragment it?",
      "- Which ablation can falsify the claimed improvement without requiring a new benchmark?",
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.synthesisPacketPath,
    generatedFiles,
    text: [
      "# Synthesis Packet",
      "",
      `Topic: ${topic}`,
      "",
      "## Recommended Pilot",
      "",
      selectedOptionTitle,
      "",
      "## Rationale",
      "",
      "The strongest graph-grounded direction is to adapt FixMatch consistency to GCD with explicit controls for known/novel imbalance. The existing frontier artifacts point to pseudo-label confirmation bias, static threshold miscalibration, augmentation risk, and multi-view consistency as the critical constraints.",
      "",
      "## Required Ablations",
      "",
      "- Baseline GCD objective versus FixMatch-style consistency on unlabeled data.",
      "- Fixed threshold versus known/novel adaptive thresholds.",
      "- Uniform strong augmentation versus confidence-aware augmentation strength.",
      "- Student-only pseudo-labels versus EMA teacher pseudo-labels.",
      "",
    ].join("\n"),
  });

  await writeTextIfMissingOrEmpty({
    projectRoot: params.projectRoot,
    artifactPath: state.reasoningTracePath,
    generatedFiles,
    text: [
      JSON.stringify({
        ts: params.now,
        event: "frontier_mapping_recovery",
        topic,
        selected_direction: selectedOptionTitle,
        source_artifacts: [
          "graph/LIMITATION_FRONTIER.md",
          "graph/CONTRADICTION_FRONTIER.md",
          "graph/TRANSFER_FRONTIER.md",
          state.topicSummaryPath,
          state.researchBriefPath,
          state.brainstormBriefPath,
          state.workingMemoryPath,
        ].filter(Boolean),
        decision:
          "Recovered missing frontier mapping chain artifacts from existing graph and brainstorm sources.",
      }),
      "",
    ].join("\n"),
  });

  return generatedFiles;
}

function buildReconciledBrainstormCycle(params: {
  manifest: ManifestLike;
  now: string;
  topic: string;
  selectedOptionTitle: string;
}): Record<string, unknown> {
  const state = normalizeBrainstormCycleState(params.manifest.brainstorm_cycle);
  const current = serializeBrainstormCycleState(state);
  const currentRounds = Array.isArray(current.rounds) ? current.rounds : [];
  const fallbackRoundId = state.selectedRoundId ?? "round_1";
  const fallbackOptionId = state.selectedOptionId ?? "opt_1";
  const rounds =
    currentRounds.length > 0
      ? currentRounds
      : [
          {
            round_id: fallbackRoundId,
            topic: params.topic,
            status: "completed",
            generated_at: params.now,
            options: [
              {
                option_id: fallbackOptionId,
                title: params.selectedOptionTitle,
                score: null,
              },
            ],
          },
        ];
  const selectedRoundId =
    state.selectedRoundId ??
    pickString(asRecord(rounds[0]) ?? {}, ["round_id", "roundId"]) ??
    fallbackRoundId;
  const firstRound = asRecord(rounds[0]) ?? {};
  const firstOptions = Array.isArray(firstRound.options) ? firstRound.options : [];
  const selectedOptionId =
    state.selectedOptionId ??
    pickString(asRecord(firstOptions[0]) ?? {}, ["option_id", "optionId"]) ??
    fallbackOptionId;

  const next = normalizeBrainstormCycleState({
    ...current,
    status: "ready",
    topic: state.topic ?? params.topic,
    basis_stage: state.basisStage ?? "frontier_mapping",
    provider: state.provider ?? "workflow_core_brainstorm",
    provider_mode: state.providerMode ?? "core",
    provider_status: "ready",
    provider_last_run_at: state.providerLastRunAt ?? state.latestRunAt ?? params.now,
    contract_version: state.contractVersion ?? 1,
    latest_run_at: state.latestRunAt ?? params.now,
    rounds,
    selected_round_id: selectedRoundId,
    selected_option_id: selectedOptionId,
    selected_option_title: state.selectedOptionTitle ?? params.selectedOptionTitle,
  });
  return serializeBrainstormCycleState(next);
}

function renderFrontierReport(params: {
  topic: string;
  selectedOptionTitle: string;
  generatedAt: string;
  synthesisText: string;
  frontierTexts: Array<{ title: string; text: string }>;
}): string {
  const lines: string[] = [
    "# Frontier Report",
    "",
    `Topic: ${params.topic}`,
    `Generated at: ${params.generatedAt}`,
    "",
    "## Selected Direction",
    `- ${params.selectedOptionTitle}`,
    "",
  ];

  const synthesisLines = meaningfulLines(params.synthesisText, 10);
  if (synthesisLines.length > 0) {
    lines.push("## Graph-Grounded Synthesis", "");
    for (const line of synthesisLines) {
      lines.push(trimLine(line));
    }
    lines.push("");
  }

  for (const frontier of params.frontierTexts) {
    const excerpt = meaningfulLines(frontier.text, 8);
    if (excerpt.length === 0) {
      continue;
    }
    lines.push(`## ${frontier.title}`, "");
    for (const line of excerpt) {
      lines.push(trimLine(line));
    }
    lines.push("");
  }

  lines.push(
    "## Handoff Implications",
    "- The next idea stage should preserve the selected FixMatch-to-GCD transfer hypothesis and explicitly test pseudo-label quality, thresholding, and known-versus-novel tradeoffs.",
    "- The plan stage should treat the frontier pack as the source of truth for limitation, contradiction, transfer, composition, and anchor evidence.",
    ""
  );

  return lines.join("\n");
}

export async function materializeFrontierMappingState(params: {
  projectRoot: string;
  manifest?: ManifestLike | null;
}): Promise<{ updated: boolean; generatedFiles: string[] }> {
  const manifest =
    params.manifest ??
    ((await readJsonIfExists<ManifestLike>(
      resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json")
    )) ??
      {});
  if (!(await hasRecoverableFrontierMappingSources({ projectRoot: params.projectRoot, manifest }))) {
    return { updated: false, generatedFiles: [] };
  }

  const now = new Date().toISOString();
  const generatedFiles = await materializeRecoverableFrontierSources({
    projectRoot: params.projectRoot,
    manifest,
    now,
  });
  if (!(await isFrontierGraphPackReady(params.projectRoot))) {
    return updatedGeneratedFiles(generatedFiles);
  }
  if (!(await brainstormBundleArtifactsReady({ projectRoot: params.projectRoot, manifest }))) {
    return updatedGeneratedFiles(generatedFiles);
  }
  const state = normalizeBrainstormCycleState(manifest.brainstorm_cycle);
  const topicSummary =
    (await readJsonIfExists<Record<string, unknown>>(
      resolveProjectArtifactPath(params.projectRoot, state.topicSummaryPath)
    )) ?? null;
  const topic = pickTopic({ manifest, topicSummary });
  const synthesisText = await readArtifactText(
    params.projectRoot,
    state.synthesisPacketPath ?? "researcher/brainstorm-cycle/SYNTHESIS_PACKET.md"
  );
  const selectedOptionTitle = inferSelectedOptionTitle({
    state,
    synthesisText,
    topic,
  });
  const frontierTexts = await Promise.all(
    FRONTIER_GRAPH_ARTIFACTS.map(async (artifact) => ({
      title: artifact.title,
      text: await readArtifactText(params.projectRoot, artifact.path),
    }))
  );

  const report = renderFrontierReport({
    topic,
    selectedOptionTitle,
    generatedAt: now,
    synthesisText,
    frontierTexts,
  });
  const reportPath = resolveProjectArtifactPath(params.projectRoot, FRONTIER_REPORT_PATH);
  if (!reportPath) {
    return { updated: false, generatedFiles: [] };
  }
  await writeTextEnsured(reportPath, report);
  generatedFiles.push(FRONTIER_REPORT_PATH);

  const graphReasoning = asRecord(manifest.graph_reasoning) ?? {};
  const nextManifest: ManifestLike = {
    ...manifest,
    current_micro_stage: "frontiers_packaged",
    frontier_report: FRONTIER_REPORT_PATH,
    brainstorm_cycle: buildReconciledBrainstormCycle({
      manifest,
      now,
      topic,
      selectedOptionTitle,
    }),
    graph_reasoning: {
      ...graphReasoning,
      last_reasoning_refresh_at: now,
      last_trace_path: state.reasoningTracePath,
      last_synthesis_packet_path: state.synthesisPacketPath,
      stop_status: "ready",
      stop_reason: null,
    },
    updated_at: now,
  };
  await writeJsonEnsured(
    resolveProjectArtifactPath(params.projectRoot, "PROJECT_MANIFEST.json") ??
      `${params.projectRoot}/PROJECT_MANIFEST.json`,
    nextManifest
  );

  generatedFiles.push("PROJECT_MANIFEST.json");
  return updatedGeneratedFiles(generatedFiles);
}
