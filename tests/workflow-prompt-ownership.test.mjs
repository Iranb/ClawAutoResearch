import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

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
    papernexusMcpUrl: null,
    papernexusMcpTransport: null,
    papernexusMcpTimeoutMs: null,
    papernexusApiTokenEnv: null,
    papernexusApiTokenSource: null,
    papernexusApiTokenService: null,
    papernexusApiTokenAccount: null,
    papernexusMineruHttpUrl: null,
    papernexusAccessMode: null,
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
  assert.match(prompt, /route through the workflow runtime\/orchestrator path first/i);
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
  assert.match(
    prompt,
    /Stage completion rule: when your stage outputs are ready, call research_workflow\.auto_iterator_tick before narrating or starting the next stage yourself, so owner routing and handoff happen deterministically\./
  );
  assert.doesNotMatch(prompt, /Idle research:/);
  assert.doesNotMatch(prompt, /PaperNexus:/);
});

test("formatWorkflowSnapshotForPrompt keeps exact handoff and auto-iterator reminders in focused mode", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "coder",
      currentStage: "plan",
      currentMicroStage: "approved",
      ownerAgent: "orchestrator",
      recommendedOwner: "orchestrator",
      nextAction: "/plan-research",
      blockingReason: "waiting for orchestrator handoff",
      missingStageSignals: ["plan packet not handed off to coder yet"],
    },
    trigger: "heartbeat",
    detailLevel: "focused",
  });

  assert.match(prompt, /Owner gate: you are not the stage owner\./);
  assert.match(
    prompt,
    /Non-owner rule: if the user asks you to continue this stage, do not perform the stage work yourself\./
  );
  assert.match(
    prompt,
    /Stage completion rule: when your stage outputs are ready, call research_workflow\.auto_iterator_tick before narrating or starting the next stage yourself, so owner routing and handoff happen deterministically\./
  );
  assert.match(
    prompt,
    /Interruptibility rule: keep the main session interruptible/i
  );
  assert.doesNotMatch(prompt, /Idle research:/);
  assert.doesNotMatch(prompt, /Writing contract:/);
  assert.doesNotMatch(prompt, /PaperNexus local defaults:/);
});

test("formatWorkflowSnapshotForPrompt teaches researcher MCP-first graph work with queued import fallback", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      currentStage: "frontier_mapping",
      currentMicroStage: "frontiers_packaged",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      nextAction: "/frontier-mapping",
      paperSourceDir: "/Users/demo/.papernexus/papers",
      graphSourceDir: "/Users/demo/.papernexus/index-store",
      graphPresenceStatus: "ready",
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusMcpUrl: "https://papernexus.example/mcp",
      papernexusMcpTransport: "streamable-http",
      papernexusApiTokenSource: "auto",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
    },
  });

  assert.match(prompt, /queued wrapper path|queued PaperNexus wrapper tasks/i);
  assert.match(prompt, /remote MCP|remote PaperNexus MCP|HTTP MCP/i);
  assert.match(prompt, /PaperNexus MCP tools/i);
  assert.match(prompt, /research_lookup|research_briefing|idea_catalyst|import_workflow/i);
  assert.match(prompt, /pn_import_submit\.py/i);
  assert.match(prompt, /backup-export[\s\S]*backup-unpack[\s\S]*backup-load/i);
});

test("formatWorkflowSnapshotForPrompt tells Researcher to background queued literature-discovery work instead of monopolizing chat", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "researcher",
      currentStage: "idea",
      currentMicroStage: "graph_support_gap",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      nextAction: "/idea",
      paperIngestionQueuedRequestCount: 1,
      paperIngestionRunningRequestCount: 0,
    },
  });

  assert.match(
    prompt,
    /Foreground queue rule: if workflow-owned literature discovery or other long queue work is pending, keep the main chat session responsive/i
  );
  assert.match(
    prompt,
    /start_background_run/i
  );
  assert.match(
    prompt,
    /answer direct user questions in the foreground/i
  );
});

test("formatWorkflowSnapshotForPrompt renders local PaperNexus home paths with ~", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "researcher",
      currentStage: "graph_build",
      currentMicroStage: "graph_refresh_requested",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      paperSourceDir: path.join(os.homedir(), ".papernexus", "papers"),
      graphSourceDir: path.join(os.homedir(), ".papernexus", "index-store"),
      defaultPapernexusSourceDir: path.join(os.homedir(), ".papernexus", "papers"),
      defaultPapernexusIndexRoot: path.join(os.homedir(), ".papernexus", "index-store"),
    },
  });

  assert.match(prompt, /PaperNexus: paper_source=~\/\.papernexus\/papers, graph_source=~\/\.papernexus\/index-store/);
  assert.match(prompt, /PaperNexus local defaults: papers=~\/\.papernexus\/papers, index=~\/\.papernexus\/index-store/);
  assert.doesNotMatch(prompt, new RegExp(`${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.papernexus/`));
});

test("getWorkflowGuardPolicy normalizes PaperNexus remote access settings", () => {
  const policy = getWorkflowGuardPolicy({
    papernexusApiBaseUrl: "https://papernexus.example/api",
    papernexusMcpUrl: "https://papernexus.example/mcp",
    papernexusMcpTransport: "streamable-http",
    papernexusMcpTimeoutMs: 45000,
    papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    papernexusApiTokenSource: "auto",
    papernexusApiTokenService: "papernexus-api-token",
    papernexusApiTokenAccount: "default",
    papernexusMineruHttpUrl: "http://mineru.example:30000",
    papernexusAccessMode: "remote_mcp",
  });

  assert.equal(policy.papernexusApiBaseUrl, "https://papernexus.example/api");
  assert.equal(policy.papernexusMcpUrl, "https://papernexus.example/mcp");
  assert.equal(policy.papernexusMcpTransport, "streamable-http");
  assert.equal(policy.papernexusMcpTimeoutMs, 45000);
  assert.equal(policy.papernexusApiTokenEnv, "PAPERNEXUS_API_TOKEN");
  assert.equal(policy.papernexusApiTokenSource, "auto");
  assert.equal(policy.papernexusApiTokenService, "papernexus-api-token");
  assert.equal(policy.papernexusApiTokenAccount, "default");
  assert.equal(policy.papernexusMineruHttpUrl, "http://mineru.example:30000");
  assert.equal(policy.papernexusAccessMode, "remote_mcp");
});

test("getWorkflowGuardPolicy defaults zoteroProjectRoot to bot", () => {
  const policy = getWorkflowGuardPolicy({});
  assert.equal(policy.zoteroProjectRoot, "bot");
});

test("getWorkflowGuardPolicy preserves explicit zoteroProjectRoot", () => {
  const policy = getWorkflowGuardPolicy({
    zoteroProjectRoot: "Bot",
  });
  assert.equal(policy.zoteroProjectRoot, "Bot");
});

test("getWorkflowGuardPolicy does not expose deprecated Zotero credential fields", () => {
  const policy = getWorkflowGuardPolicy({
    zoteroApiKey: "secret-test-key",
    zoteroApiKeyEnv: "ZOTERO_API_KEY",
    zoteroUserId: "123456",
  });
  assert.equal("zoteroApiKey" in policy, false);
  assert.equal("zoteroApiKeyEnv" in policy, false);
  assert.equal("zoteroUserId" in policy, false);
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
    /never use local PaperNexus live-graph CLI reads/i
  );
  assert.match(
    prompt,
    /Prefer remote MinerU at http:\/\/mineru\.example:30000 for PDF materialization/i
  );
});

test("formatWorkflowSnapshotForPrompt only advertises the project Zotero path and MCP-managed access", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "researcher",
      currentStage: "graph_build",
      currentMicroStage: "graph_refresh_requested",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      researchProgramStatus: "approved",
      researchProgramOnboardingStatus: "complete",
      researchProgramPrimaryGoal: "Demo goal",
      researchProgramBaselineReference: "Baseline",
      researchProgramPrimaryMetricName: "Accuracy",
      researchProgramDatasetCount: 1,
      researchProgramSuccessCriteriaCount: 1,
      researchProgramTrackCount: 1,
      researchProgramActiveTrackCount: 1,
      researchProgramZoteroProjectPath: "Bot/demo-project",
    },
  });

  assert.match(prompt, /Research program Zotero path: Bot\/demo-project/i);
  assert.match(prompt, /use the local Zotero MCP server through \/zotero-project-library/i);
  assert.match(prompt, /ZOTERO_API_KEY|ZOTERO_USER_ID/i);
  assert.doesNotMatch(prompt, /Zotero local access:/);
  assert.doesNotMatch(prompt, /zoteroApiKey|zoteroApiKeyEnv|zoteroUserId/);
  assert.doesNotMatch(prompt, /plugin_config|configured Zotero API key|configured Zotero user id/i);
});

test("formatWorkflowSnapshotForPrompt does not advertise local PaperNexus storage in remote-only mode", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "researcher",
      currentStage: "graph_build",
      currentMicroStage: "graph_refresh_requested",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      defaultPapernexusSourceDir: "/Users/demo/.papernexus/papers/demo-project",
      defaultPapernexusIndexRoot: "/Users/demo/.papernexus/index-store",
      papernexusApiBaseUrl: "https://papernexus.example/api",
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
    },
  });

  assert.doesNotMatch(prompt, /PaperNexus local defaults:/);
  assert.match(
    prompt,
    /never use or inspect local PaperNexus storage under ~\/\.papernexus\/papers or ~\/\.papernexus\/index-store/i
  );
  assert.match(prompt, /project-local staging files/i);
});

test("formatWorkflowSnapshotForPrompt teaches Researcher to use configured remote PaperNexus MCP access safely", () => {
  const prompt = formatWorkflowSnapshotForPrompt({
    snapshot: {
      ...makeBaseSnapshot(),
      role: "researcher",
      currentStage: "graph_build",
      currentMicroStage: "graph_refresh_requested",
      ownerAgent: "researcher",
      recommendedOwner: "researcher",
      graphRefreshRequired: true,
      papernexusMcpUrl: "https://papernexus.example/mcp",
      papernexusMcpTransport: "streamable-http",
      papernexusMcpTimeoutMs: 45000,
      papernexusApiTokenEnv: "PAPERNEXUS_API_TOKEN",
      papernexusApiTokenSource: "auto",
      papernexusApiTokenService: "papernexus-api-token",
      papernexusApiTokenAccount: "default",
      papernexusAccessMode: "remote_mcp",
    },
  });

  assert.match(prompt, /PaperNexus remote access:/);
  assert.match(prompt, /mcp=https:\/\/papernexus\.example\/mcp/);
  assert.match(prompt, /mcp_transport=streamable-http/);
  assert.match(prompt, /Remote MCP rule:/);
  assert.match(prompt, /Use Authorization: Bearer from env PAPERNEXUS_API_TOKEN|Resolve the PaperNexus bearer token in auto mode/i);
  assert.match(prompt, /PaperNexus MCP tools/i);
  assert.match(prompt, /Do not use .*pn_graph_query\.py.*pn_research_chains\.py/i);
});
