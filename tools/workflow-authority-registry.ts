export const LITERATURE_REQUISITION_SATISFACTION_AUTHORITY =
  "literature_requisition_satisfaction" as const;
export const GRAPH_BUILD_DECISION_AUTHORITY = "graph_build_decision" as const;
export const IDEA_CATALYST_CONTRACT_AUTHORITY =
  "idea_catalyst_contract" as const;
export const INNOVATION_PACKET_AUTHORITY = "innovation_packet" as const;

export const DEFAULT_REQUISITION_SATISFACTION_REPORT_BASENAME =
  "REQUISITION_SATISFACTION_REPORT.json";
export const DEFAULT_GRAPH_BUILD_DECISION_PATH =
  "graph/GRAPH_BUILD_DECISION.json";
export const DEFAULT_IDEA_CATALYST_CONTRACT_PATH =
  "researcher/idea-catalyst/IDEA_CATALYST_CONTRACT.json";
export const DEFAULT_INNOVATION_PACKET_PATH =
  "orchestrator/INNOVATION_PACKET.json";

export type WorkflowDirectAuthority = {
  transition: string;
  directAuthority: string;
  authorityPath: string;
  authorityOwner: string;
};

export const WORKFLOW_DIRECT_AUTHORITIES: WorkflowDirectAuthority[] = [
  {
    transition: "literature_requisition_terminal_satisfied",
    directAuthority: LITERATURE_REQUISITION_SATISFACTION_AUTHORITY,
    authorityPath:
      "request-scoped researcher/**/REQUISITION_SATISFACTION_REPORT.json",
    authorityOwner: "literature_requisition_executor",
  },
  {
    transition: "graph_build_complete",
    directAuthority: GRAPH_BUILD_DECISION_AUTHORITY,
    authorityPath: DEFAULT_GRAPH_BUILD_DECISION_PATH,
    authorityOwner: "graph_build_decision_writer",
  },
  {
    transition: "idea_complete",
    directAuthority: IDEA_CATALYST_CONTRACT_AUTHORITY,
    authorityPath: DEFAULT_IDEA_CATALYST_CONTRACT_PATH,
    authorityOwner: "idea_evidence_bridge",
  },
  {
    transition: "experiment_plan_complete",
    directAuthority: INNOVATION_PACKET_AUTHORITY,
    authorityPath: DEFAULT_INNOVATION_PACKET_PATH,
    authorityOwner: "innovation_packet_materializer",
  },
];
