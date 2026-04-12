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
  "e2e_report",
  "e2e_artifact_checklist",
  "e2e_state_timeline",
] as const;

export type ArtifactKey = (typeof PROJECT_ARTIFACT_KEYS)[number];
export type ArtifactKind = "json" | "jsonl" | "markdown" | "text";

export type ArtifactDescriptor = {
  key: ArtifactKey;
  label: string;
  path: string;
  kind: ArtifactKind;
  exists: boolean;
};

type ArtifactDefinition = Omit<ArtifactDescriptor, "exists">;

const PROJECT_ARTIFACT_DEFINITIONS: ArtifactDefinition[] = [
  {
    key: "manifest",
    label: "Project Manifest",
    path: "PROJECT_MANIFEST.json",
    kind: "json",
  },
  {
    key: "graph_progress",
    label: "PaperNexus Progress",
    path: "graph/PAPERNEXUS_PROGRESS.json",
    kind: "json",
  },
  {
    key: "graph_presence",
    label: "Graph Presence Check",
    path: "graph/GRAPH_PRESENCE_CHECK.json",
    kind: "json",
  },
  {
    key: "graph_status",
    label: "PaperNexus Status",
    path: "graph/PAPERNEXUS_STATUS.json",
    kind: "json",
  },
  {
    key: "runtime_mailbox",
    label: "Workflow Mailbox",
    path: ".openclaw-research/workflow-mailbox.json",
    kind: "json",
  },
  {
    key: "runtime_queue",
    label: "Workflow Runtime Queue",
    path: ".openclaw-research/workflow-runtime-queue.json",
    kind: "json",
  },
  {
    key: "runtime_sessions",
    label: "Workflow Runtime Sessions",
    path: ".openclaw-research/workflow-runtime-sessions.json",
    kind: "json",
  },
  {
    key: "runtime_events",
    label: "Workflow Events",
    path: ".openclaw-research/workflow-events.jsonl",
    kind: "jsonl",
  },
  {
    key: "runtime_trace",
    label: "Workflow Trace",
    path: ".openclaw-research/workflow-trace.jsonl",
    kind: "jsonl",
  },
  {
    key: "handoff_intents",
    label: "Workflow Handoff Intents",
    path: ".openclaw-research/workflow-handoff-intents.json",
    kind: "json",
  },
  {
    key: "handoff_events",
    label: "Workflow Handoff Events",
    path: ".openclaw-research/workflow-handoff-events.jsonl",
    kind: "jsonl",
  },
  {
    key: "handoff_receipts",
    label: "Workflow Artifact Receipts",
    path: ".openclaw-research/workflow-handoff-receipts.json",
    kind: "json",
  },
  {
    key: "repair_queue",
    label: "Workflow Repair Queue",
    path: ".openclaw-research/workflow-repair-queue.json",
    kind: "json",
  },
  {
    key: "agent_capabilities",
    label: "Workflow Agent Capabilities",
    path: ".openclaw-research/workflow-agent-capabilities.json",
    kind: "json",
  },
  {
    key: "write_scopes",
    label: "Workflow Write Scopes",
    path: ".openclaw-research/workflow-write-scopes.json",
    kind: "json",
  },
  {
    key: "inbound_turns",
    label: "Workflow Inbound Turns",
    path: ".openclaw-research/workflow-inbound-turns.jsonl",
    kind: "jsonl",
  },
  {
    key: "e2e_report",
    label: "E2E Run Report",
    path: ".openclaw-research/E2E_RUN_REPORT.md",
    kind: "markdown",
  },
  {
    key: "e2e_artifact_checklist",
    label: "E2E Artifact Checklist",
    path: ".openclaw-research/E2E_ARTIFACT_CHECKLIST.json",
    kind: "json",
  },
  {
    key: "e2e_state_timeline",
    label: "E2E State Timeline",
    path: ".openclaw-research/E2E_STATE_TIMELINE.jsonl",
    kind: "jsonl",
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
