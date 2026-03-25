import test from "node:test";
import assert from "node:assert/strict";

import { formatWorkflowSnapshotForPrompt } from "../tools/workflow-guard.ts";

function makeBaseSnapshot() {
  return {
    projectRoot: "/tmp/demo-project",
    projectId: "demo-project",
    projectResolutionSource: "channel_binding",
    channelProjectBindingsEnabled: true,
    channelProjectBindingKey: "discord:paper-lab",
    channelProjectBindingStorePath: "/tmp/demo-project/.openclaw-research/channel-project-bindings.json",
    role: "researcher",
    currentStage: "plan",
    currentMicroStage: "pending",
    ownerAgent: "orchestrator",
    recommendedOwner: "orchestrator",
    nextAction: "/plan-research",
    resumeAction: "/resume-pipeline",
    blockingReason: null,
    allowedWriteScopes: ["{PROJ}/researcher/**"],
    allowedContacts: ["orchestrator"],
    allowedSpawns: ["orchestrator"],
    missingStageSignals: [],
    graphRefreshRequired: false,
    graphRefreshReason: null,
    graphLastBuiltAt: null,
    graphPresenceCheckedAt: null,
    graphPresenceStatus: null,
    graphPresenceReportPath: null,
    graphPresenceExpectedPapers: null,
    graphPresencePresentPapers: null,
    graphPresenceMissingPapers: null,
    paperSourceDir: null,
    graphSourceDir: null,
    defaultPapernexusSourceDir: null,
    defaultPapernexusIndexRoot: null,
    idleResearchEnabled: false,
    idleResearchTopic: null,
    idleResearchStatus: null,
    idleResearchDue: false,
    idleResearchCooldownMinutes: null,
    idleResearchLastRunAt: null,
    idleResearchNextDueAt: null,
    idleResearchDigestPath: null,
    experimentLedgerPath: null,
    experimentLedgerUpdatedAt: null,
    experimentSyncRequired: false,
    experimentPapernexusSyncStatus: null,
    innovationReflectionStatus: null,
    innovationReflectionDue: false,
    innovationReflectionLastAt: null,
    innovationReflectionPath: null,
    innovationReflectionPendingReason: null,
    theorySupportStatus: null,
    theorySupportSignal: null,
    theoryStatePath: null,
    theoryProofPacketDir: null,
    theoryAppendixPacketPath: null,
    theoryPacketCount: null,
    theoryBodyReady: false,
    theoryPendingReason: null,
    writingTemplateRequired: false,
    writingPaperMode: null,
    writingBodyPageBudget: null,
    writingReferencePageBudget: null,
    writingBodyWordTargetMin: null,
    writingBodyWordTargetMax: null,
    writingMaxCoreIdeas: null,
    writingMaxHeadlineClaims: null,
    writingTemplatePath: null,
    writingProjectTemplatePath: null,
    writingTemplateStatus: null,
    writingTemplateCopyStatus: null,
    writingTemplateMappingPath: null,
    mainTextProofStyle: null,
    proofAppendixRequired: false,
    proofAppendixPath: null,
    proofAppendixStatus: null,
    theoryNotePath: null,
    proofChecklist: [],
    kgStorylineRequired: false,
    kgStorylineStatus: null,
    kgStorylinePacketPath: null,
    storylineSource: null,
    storylineChecklist: [],
    writingRequiredSections: [],
    writingSectionOrder: [],
    paragraphLogicStatus: null,
    paragraphLogicChecklist: [],
    writingContractPendingReason: null,
    citationVerificationRequired: false,
    citationVerificationStatus: null,
    citationVerificationReportPath: null,
    citationBibliographyPath: null,
    citationSourceOfTruth: [],
    citationUnresolvedPlaceholderCount: null,
    citationAllowedPlaceholderCount: null,
    citationVerifiedCount: 0,
    citationSuspiciousCount: 0,
    citationHallucinatedCount: 0,
    citationPendingReason: null,
    recentExperiments: [],
    unreadMailbox: [],
    backgroundTasks: [],
  };
}

test("formatWorkflowSnapshotForPrompt tells non-owner agents to hand off instead of doing the stage", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: makeBaseSnapshot(),
  });

  assert.match(prompt, /Owner gate: you are not the stage owner\./);
  assert.match(prompt, /orchestrator must lead substantive plan work/i);
  assert.match(prompt, /do not perform the stage work yourself/i);
  assert.match(prompt, /route or hand off the task to orchestrator/i);
  assert.match(prompt, /Stage completion rule:/);
});

test("formatWorkflowSnapshotForPrompt tells the expected owner to complete the stage artifacts", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "orchestrator",
    },
  });

  assert.match(prompt, /Owner gate: you are the responsible owner for plan\./i);
  assert.match(prompt, /Produce the stage artifacts/i);
});
