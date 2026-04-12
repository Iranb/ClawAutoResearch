import path from "node:path";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readProjectDetailSummary } from "./project-detail.js";

const fixtureProjectsRoot = path.resolve(
  "server/test/fixtures/projects-root",
);

const tempDirs: string[] = [];

async function createProjectsRootFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workflow-dashboard-project-detail-"));
  tempDirs.push(tempDir);

  const targetRoot = path.join(tempDir, "projects-root");
  await cp(fixtureProjectsRoot, targetRoot, { recursive: true });

  return targetRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("readProjectDetailSummary", () => {
  it("prefers PROJECT_MANIFEST.json for the summary and reads the papernexus phase from progress", async () => {
    const projectsRoot = await createProjectsRootFixture();

    const result = await readProjectDetailSummary({
      projectsRoot,
      projectId: "gcd-confirmation-bias-mitigation",
    });

    expect(result).toMatchObject({
      id: "gcd-confirmation-bias-mitigation",
      title: "Confirmation Bias Mitigation In Graph Retrieval",
      projectRoot: path.join(projectsRoot, "gcd-confirmation-bias-mitigation"),
      currentStage: "graph_build",
      workflowLine: "experiment",
      paperMode: null,
      owner: "researcher",
      status: "blocked",
      updatedAt: "2026-04-09T08:45:00.000Z",
      blockingReason:
        "missing_sources: canonical papers are still missing from the shared graph",
      nextAction: "Refresh the graph after the missing sources are imported.",
      resumeAction: null,
      surveyStatus: null,
      surveyTopic: null,
      surveyProgressSummary: null,
      papernexusPhase: "waiting_import",
      papernexusProgressSummary: "8/12 completed (4 remaining)",
      topTierVerdict: null,
      teamRoundLead: null,
      teamRoundActiveSessions: 0,
      teamRoundLastClaimedTaskId: null,
      teamRoundLastCompletedTaskId: null,
      teamTaskGraphTaskCount: 0,
      teamTaskGraphClaimableCount: 0,
      teamTaskGraphBlockedCount: 0,
      teamTaskGraphClaimedCount: 0,
      teamTaskGraphVerifyingCount: 0,
      teamTaskGraphNeedsRepairCount: 0,
      teamTaskGraphSatisfiedCount: 0,
      taskBoard: [],
      source: ["manifest", "papernexus_progress"],
    });
    expect(result?.evidenceBoard.evidenceCloseoutStatus).toBe("not_applicable");
  });

  it("keeps the summary usable when optional fields are missing", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const sparseProjectRoot = path.join(projectsRoot, "sparse-project");

    await mkdir(sparseProjectRoot, { recursive: true });
    await writeFile(
      path.join(sparseProjectRoot, "PROJECT_MANIFEST.json"),
      JSON.stringify({}, null, 2),
    );

    const result = await readProjectDetailSummary({
      projectsRoot,
      projectId: "sparse-project",
    });

    expect(result).toMatchObject({
      id: "sparse-project",
      title: null,
      projectRoot: sparseProjectRoot,
      currentStage: null,
      workflowLine: "experiment",
      paperMode: null,
      owner: null,
      status: "incomplete",
      updatedAt: null,
      blockingReason: null,
      nextAction: null,
      resumeAction: null,
      surveyStatus: null,
      surveyTopic: null,
      surveyProgressSummary: null,
      papernexusPhase: null,
      papernexusProgressSummary: null,
      topTierVerdict: null,
      teamRoundLead: null,
      teamRoundActiveSessions: 0,
      teamRoundLastClaimedTaskId: null,
      teamRoundLastCompletedTaskId: null,
      teamTaskGraphTaskCount: 0,
      teamTaskGraphClaimableCount: 0,
      teamTaskGraphBlockedCount: 0,
      teamTaskGraphClaimedCount: 0,
      teamTaskGraphVerifyingCount: 0,
      teamTaskGraphNeedsRepairCount: 0,
      teamTaskGraphSatisfiedCount: 0,
      taskBoard: [],
      source: ["manifest", "fallback"],
    });
    expect(result?.evidenceBoard.evidenceCloseoutStatus).toBe("not_applicable");
  });

  it("surfaces survey workflow details when the project is on the survey line", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const surveyProjectRoot = path.join(projectsRoot, "survey-multimodal-reasoning");

    await mkdir(surveyProjectRoot, { recursive: true });
    await writeFile(
      path.join(surveyProjectRoot, "PROJECT_MANIFEST.json"),
      JSON.stringify(
        {
          project_id: "survey-multimodal-reasoning",
          title: "Multimodal Reasoning Survey",
          current_stage: "survey_review",
          owner_agent: "researcher",
          next_action: "Expand screening coverage and finalize the survey brief.",
          updated_at: "2026-04-09T12:30:00.000Z",
          survey_review: {
            status: "screening",
            topic: "multimodal reasoning survey",
            candidate_paper_count: 42,
            included_paper_count: 16,
            excluded_paper_count: 9,
            graph_grounded_brief_ready: false,
          },
          writing_contract: {
            paper_mode: "survey",
          },
        },
        null,
        2,
      ),
    );

    const result = await readProjectDetailSummary({
      projectsRoot,
      projectId: "survey-multimodal-reasoning",
    });

    expect(result).toMatchObject({
      id: "survey-multimodal-reasoning",
      currentStage: "survey_review",
      workflowLine: "survey",
      paperMode: "survey",
      surveyStatus: "screening",
      surveyTopic: "multimodal reasoning survey",
      surveyProgressSummary: "42 candidates · 16 included · 9 excluded",
      status: "active",
      topTierVerdict: null,
      teamRoundLead: null,
      teamRoundActiveSessions: 0,
      teamRoundLastClaimedTaskId: null,
      teamRoundLastCompletedTaskId: null,
      teamTaskGraphTaskCount: 0,
      teamTaskGraphClaimableCount: 0,
      teamTaskGraphBlockedCount: 0,
      teamTaskGraphClaimedCount: 0,
      teamTaskGraphVerifyingCount: 0,
      teamTaskGraphNeedsRepairCount: 0,
      teamTaskGraphSatisfiedCount: 0,
      taskBoard: [],
    });
  });

  it("surfaces team round and task graph summaries when runtime artifacts exist", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const projectRoot = path.join(projectsRoot, "team-runtime-project");

    await mkdir(path.join(projectRoot, ".openclaw-research"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "PROJECT_MANIFEST.json"),
      JSON.stringify(
        {
          project_id: "team-runtime-project",
          current_stage: "code",
          owner_agent: "coder",
          opportunity_scorecard: {
            verdict: "worth_top_tier_bet",
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(projectRoot, ".openclaw-research", "workflow-team-round.json"),
      JSON.stringify(
        {
          leadRole: "coder",
          activeSessionKeys: ["agent:coder:discord:group:paper-lab"],
          lastClaimedTaskId: "code.implement_experiment_bundle",
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(projectRoot, ".openclaw-research", "workflow-task-graph.json"),
      JSON.stringify(
        {
          tasks: [
            {
              taskId: "code.implement_experiment_bundle",
              title: "Implement the experiment bundle",
              owner: "coder",
              status: "claimed",
            },
            {
              taskId: "code.verify_bundle",
              title: "Verify the experiment bundle",
              owner: "coder",
              status: "satisfied",
            },
            {
              taskId: "code.publish_notes",
              title: "Publish implementation notes",
              owner: "coder",
              status: "claimable",
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = await readProjectDetailSummary({
      projectsRoot,
      projectId: "team-runtime-project",
    });

    expect(result).toMatchObject({
      topTierVerdict: "worth_top_tier_bet",
      teamRoundLead: "coder",
      teamRoundActiveSessions: 1,
      teamRoundLastClaimedTaskId: "code.implement_experiment_bundle",
      teamRoundLastCompletedTaskId: null,
      teamTaskGraphTaskCount: 3,
      teamTaskGraphClaimableCount: 1,
      teamTaskGraphBlockedCount: 0,
      teamTaskGraphClaimedCount: 1,
      teamTaskGraphVerifyingCount: 0,
      teamTaskGraphNeedsRepairCount: 0,
      teamTaskGraphSatisfiedCount: 1,
    });
    expect(result?.taskBoard).toHaveLength(3);
  });

  it("rejects project ids that escape the configured projects root", async () => {
    const projectsRoot = await createProjectsRootFixture();

    const result = await readProjectDetailSummary({
      projectsRoot,
      projectId: "../outside",
    });

    expect(result).toBeNull();
  });
});
