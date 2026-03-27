import test from "node:test";
import assert from "node:assert/strict";

import {
  formatWorkflowSnapshotForPrompt,
  getWorkflowGuardPolicy,
} from "../tools/workflow-guard.ts";

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
    papernexusApiBaseUrl: null,
    papernexusApiTokenEnv: null,
    papernexusApiTokenSource: null,
    papernexusApiTokenService: null,
    papernexusApiTokenAccount: null,
    papernexusMineruHttpUrl: null,
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
    writingSessionStatus: null,
    writingCurrentSection: null,
    writingDraftOrder: [],
    writingFinalizedSections: [],
    writingCompileSafeSections: [],
    writingSectionPacketsReady: false,
    writingCurrentSectionReviewVerdict: null,
    writingGraphEvidenceCoverageStatus: null,
    writingGraphEvidenceCoverageSummary: null,
    reviewSessionStatus: null,
    reviewSessionStageScope: null,
    reviewSessionRound: 0,
    reviewSessionVerdict: null,
    reviewSessionSummary: null,
    reviewRubricSummary: {
      originality: null,
      quality: null,
      clarity: null,
      significance: null,
      soundness: null,
      citationIntegrity: null,
      graphGroundedEvidenceSufficiency: null,
    },
    graphGuidedWritingStatus: null,
    graphGuidedWritingEvidenceCoverageStatus: null,
    graphGuidedWritingMissingEvidenceClaims: [],
    graphGuidedWritingScholarReserved: false,
    graphGuidedWritingScholarSkillSlot: null,
    externalReviewStatus: null,
    externalReviewRecommendation: null,
    externalReviewRequiredAction: null,
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

test("formatWorkflowSnapshotForPrompt can emit a focused writer prompt without flooding in distant workflow state", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "academic_writer",
      currentStage: "write",
      currentMicroStage: "drafting",
      ownerAgent: "academic_writer",
      recommendedOwner: "academic_writer",
      nextAction: "Revise the results section packet and resolve citation placeholders.",
      writingSessionStatus: "revise_required",
      writingCurrentSection: "results",
      writingDraftOrder: ["method", "results", "conclusion"],
      writingFinalizedSections: ["method"],
      writingCompileSafeSections: ["method"],
      writingCurrentSectionReviewVerdict: "needs_revision",
      writingGraphEvidenceCoverageStatus: "partial",
      writingGraphEvidenceCoverageSummary:
        "The results section still lacks one evidence pointer and one citation fix.",
      missingStageSignals: [
        "results packet still has missing citation placeholders",
      ],
    },
    detailLevel: "focused",
  });

  assert.match(prompt, /Layer 1: Stable Policy/i);
  assert.match(prompt, /Layer 2: Stage-Local Control State/i);
  assert.match(prompt, /Layer 3: Primary Payload/i);
  assert.match(prompt, /section_context=results/i);
  assert.doesNotMatch(prompt, /Idle research:/);
  assert.doesNotMatch(prompt, /PaperNexus:/);
});

test("getWorkflowGuardPolicy normalizes PaperNexus remote access settings", () => {
  const policy = getWorkflowGuardPolicy({
    papernexusApiBaseUrl: "https://papernexus.example/api",
    papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    papernexusApiTokenSource: "auto",
    papernexusApiTokenService: "papernexus-api-token",
    papernexusApiTokenAccount: "default",
    papernexusMineruHttpUrl: "http://mineru.example:30000",
  });

  assert.equal(policy.papernexusApiBaseUrl, "https://papernexus.example/api");
  assert.equal(policy.papernexusApiTokenEnv, "PAPERNEXUS_API_TOKEN");
  assert.equal(policy.papernexusApiTokenSource, "auto");
  assert.equal(policy.papernexusApiTokenService, "papernexus-api-token");
  assert.equal(policy.papernexusApiTokenAccount, "default");
  assert.equal(policy.papernexusMineruHttpUrl, "http://mineru.example:30000");
});

test("formatWorkflowSnapshotForPrompt teaches Researcher to use configured remote PaperNexus access safely", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "researcher",
      currentStage: "graph_build",
      currentMicroStage: "graph_refresh_requested",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      graphRefreshRequired: true,
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenSource: "auto",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
      papernexusMineruHttpUrl: "http://mineru.example:30000",
    },
  });

  assert.match(prompt, /PaperNexus remote access:/);
  assert.match(prompt, /api=https:\/\/papernexus\.example\/api/);
  assert.match(prompt, /token_source=auto/);
  assert.match(prompt, /token_env=PAPERNEXUS_API_TOKEN/);
  assert.match(prompt, /keychain_service=papernexus-api-token/);
  assert.match(prompt, /keychain_account=default/);
  assert.match(prompt, /mineru_http=http:\/\/mineru\.example:30000/);
  assert.match(
    prompt,
    /Resolve the PaperNexus bearer token in auto mode/i
  );
  assert.match(
    prompt,
    /Prefer remote MinerU at http:\/\/mineru\.example:30000 for PDF materialization/i
  );
});
