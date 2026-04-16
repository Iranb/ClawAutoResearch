import path from "node:path";

import { pathExists } from "../file-access/fs.js";

export const PROJECT_ARTIFACT_KEYS = [
  "manifest",
  "graph_progress",
  "graph_presence",
  "graph_status",
  "runtime_mailbox",
  "runtime_queue",
  "runtime_sessions",
  "runtime_events",
  "runtime_trace",
  "handoff_intents",
  "handoff_events",
  "handoff_receipts",
  "repair_queue",
  "agent_capabilities",
  "write_scopes",
  "inbound_turns",
  "paper_story_spine",
  "paper_story_claim_map",
  "paper_story_bridge",
  "review_pressure_reverse_outline",
  "review_pressure_novelty_attack",
  "results_question_order",
  "experiment_evidence_sequence",
  "innovation_synthesis_memo",
  "innovation_synthesis_graph",
  "integrated_contribution_statement",
  "title_candidates",
  "abstract_workbench",
  "intro_workbench",
  "figure_alignment",
  "figure_registry",
  "table_registry",
  "citation_calibration_json",
  "citation_calibration_md",
  "citation_verification",
  "citation_audit",
  "survey_comparative_analysis",
  "survey_comparability_report",
  "survey_section_briefs",
  "survey_self_review",
  "e2e_report",
  "e2e_artifact_checklist",
  "e2e_state_timeline",
] as const;

export type ArtifactKey = (typeof PROJECT_ARTIFACT_KEYS)[number];
export type ArtifactKind = "json" | "jsonl" | "markdown" | "text";
export type ArtifactGroup = "manifest" | "graph" | "runtime" | "outputs";

export type ArtifactDescriptor = {
  key: ArtifactKey;
  label: string;
  path: string;
  kind: ArtifactKind;
  group: ArtifactGroup;
  exists: boolean;
};

type ArtifactDefinition = Omit<ArtifactDescriptor, "exists">;

const PROJECT_ARTIFACT_DEFINITIONS: ArtifactDefinition[] = [
  {
    key: "manifest",
    label: "Project Manifest",
    path: "PROJECT_MANIFEST.json",
    kind: "json",
    group: "manifest",
  },
  {
    key: "graph_progress",
    label: "PaperNexus Progress",
    path: "graph/PAPERNEXUS_PROGRESS.json",
    kind: "json",
    group: "graph",
  },
  {
    key: "graph_presence",
    label: "Graph Presence Check",
    path: "graph/GRAPH_PRESENCE_CHECK.json",
    kind: "json",
    group: "graph",
  },
  {
    key: "graph_status",
    label: "PaperNexus Status",
    path: "graph/PAPERNEXUS_STATUS.json",
    kind: "json",
    group: "graph",
  },
  {
    key: "runtime_mailbox",
    label: "Workflow Mailbox",
    path: ".openclaw-research/workflow-mailbox.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "runtime_queue",
    label: "Workflow Runtime Queue",
    path: ".openclaw-research/workflow-runtime-queue.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "runtime_sessions",
    label: "Workflow Runtime Sessions",
    path: ".openclaw-research/workflow-runtime-sessions.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "runtime_events",
    label: "Workflow Events",
    path: ".openclaw-research/workflow-events.jsonl",
    kind: "jsonl",
    group: "runtime",
  },
  {
    key: "runtime_trace",
    label: "Workflow Trace",
    path: ".openclaw-research/workflow-trace.jsonl",
    kind: "jsonl",
    group: "runtime",
  },
  {
    key: "handoff_intents",
    label: "Workflow Handoff Intents",
    path: ".openclaw-research/workflow-handoff-intents.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "handoff_events",
    label: "Workflow Handoff Events",
    path: ".openclaw-research/workflow-handoff-events.jsonl",
    kind: "jsonl",
    group: "runtime",
  },
  {
    key: "handoff_receipts",
    label: "Workflow Artifact Receipts",
    path: ".openclaw-research/workflow-handoff-receipts.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "repair_queue",
    label: "Workflow Repair Queue",
    path: ".openclaw-research/workflow-repair-queue.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "agent_capabilities",
    label: "Workflow Agent Capabilities",
    path: ".openclaw-research/workflow-agent-capabilities.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "write_scopes",
    label: "Workflow Write Scopes",
    path: ".openclaw-research/workflow-write-scopes.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "inbound_turns",
    label: "Workflow Inbound Turns",
    path: ".openclaw-research/workflow-inbound-turns.jsonl",
    kind: "jsonl",
    group: "runtime",
  },
  {
    key: "paper_story_spine",
    label: "Paper Story Spine",
    path: "academic_writer/story/STORY_SPINE.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "paper_story_claim_map",
    label: "Claim To Experiment Map",
    path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "paper_story_bridge",
    label: "Contribution To Story Bridge",
    path: "academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "review_pressure_reverse_outline",
    label: "Reverse Outline",
    path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "review_pressure_novelty_attack",
    label: "Novelty Attack",
    path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "results_question_order",
    label: "Results Question Order",
    path: "academic_writer/RESULTS_QUESTION_ORDER.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "experiment_evidence_sequence",
    label: "Experiment Evidence Sequence",
    path: "academic_writer/EXPERIMENT_EVIDENCE_SEQUENCE.json",
    kind: "json",
    group: "outputs",
  },
  {
    key: "innovation_synthesis_memo",
    label: "Innovation Synthesis Memo",
    path: "academic_writer/INNOVATION_SYNTHESIS_MEMO.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "innovation_synthesis_graph",
    label: "Innovation Synthesis Graph",
    path: "academic_writer/INNOVATION_SYNTHESIS_GRAPH.json",
    kind: "json",
    group: "outputs",
  },
  {
    key: "integrated_contribution_statement",
    label: "Integrated Contribution Statement",
    path: "academic_writer/INTEGRATED_CONTRIBUTION_STATEMENT.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "title_candidates",
    label: "Title Candidates",
    path: "academic_writer/TITLE_CANDIDATES.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "abstract_workbench",
    label: "Abstract Workbench",
    path: "academic_writer/ABSTRACT_5_SENTENCE_WORKBENCH.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "intro_workbench",
    label: "Intro Workbench",
    path: "academic_writer/INTRO_5_PARAGRAPH_WORKBENCH.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "figure_alignment",
    label: "Figure/Table Alignment",
    path: "academic_writer/FIGURE_TABLE_ALIGNMENT.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "figure_registry",
    label: "Figure Registry",
    path: "academic_writer/FIGURE_REGISTRY.json",
    kind: "json",
    group: "outputs",
  },
  {
    key: "table_registry",
    label: "Table Registry",
    path: "academic_writer/TABLE_REGISTRY.json",
    kind: "json",
    group: "outputs",
  },
  {
    key: "citation_calibration_json",
    label: "Citation Calibration JSON",
    path: "reviewer/CITATION_CALIBRATION.json",
    kind: "json",
    group: "outputs",
  },
  {
    key: "citation_calibration_md",
    label: "Citation Calibration Report",
    path: "reviewer/CITATION_CALIBRATION.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "citation_verification",
    label: "Citation Verification",
    path: "reviewer/CITATION_VERIFICATION.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "citation_audit",
    label: "Citation Audit Report",
    path: "researcher/CITATION_AUDIT_REPORT.json",
    kind: "json",
    group: "outputs",
  },
  {
    key: "survey_comparative_analysis",
    label: "Survey Comparative Analysis",
    path: "academic_writer/SURVEY_COMPARATIVE_ANALYSIS.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "survey_comparability_report",
    label: "Survey Comparability Report",
    path: "academic_writer/SURVEY_COMPARABILITY_REPORT.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "survey_section_briefs",
    label: "Survey Section Briefs",
    path: "academic_writer/SURVEY_SECTION_BRIEFS.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "survey_self_review",
    label: "Survey Self Review",
    path: "academic_writer/SURVEY_SELF_REVIEW.md",
    kind: "markdown",
    group: "outputs",
  },
  {
    key: "e2e_report",
    label: "E2E Run Report",
    path: ".openclaw-research/E2E_RUN_REPORT.md",
    kind: "markdown",
    group: "runtime",
  },
  {
    key: "e2e_artifact_checklist",
    label: "E2E Artifact Checklist",
    path: ".openclaw-research/E2E_ARTIFACT_CHECKLIST.json",
    kind: "json",
    group: "runtime",
  },
  {
    key: "e2e_state_timeline",
    label: "E2E State Timeline",
    path: ".openclaw-research/E2E_STATE_TIMELINE.jsonl",
    kind: "jsonl",
    group: "runtime",
  },
];

export async function listProjectArtifacts(params: {
  projectRoot: string;
}): Promise<ArtifactDescriptor[]> {
  return Promise.all(
    PROJECT_ARTIFACT_DEFINITIONS.map(async (artifact) => ({
      ...artifact,
      exists: await pathExists(path.join(params.projectRoot, artifact.path)),
    })),
  );
}

export function isArtifactKey(value: string): value is ArtifactKey {
  return PROJECT_ARTIFACT_KEYS.includes(value as ArtifactKey);
}

export async function getProjectArtifact(params: {
  projectRoot: string;
  artifactKey: ArtifactKey;
}): Promise<ArtifactDescriptor> {
  const artifact = PROJECT_ARTIFACT_DEFINITIONS.find(
    (candidate) => candidate.key === params.artifactKey,
  );

  if (!artifact) {
    throw new Error(`Unknown artifact key: ${params.artifactKey}`);
  }

  return {
    ...artifact,
    exists: await pathExists(path.join(params.projectRoot, artifact.path)),
  };
}
