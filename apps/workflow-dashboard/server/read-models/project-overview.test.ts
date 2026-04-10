import path from "node:path";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readProjectOverviews } from "./project-overview.js";

const fixtureProjectsRoot = path.resolve(
  "server/test/fixtures/projects-root",
);

const tempDirs: string[] = [];

async function createProjectsRootFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workflow-dashboard-projects-"));
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

describe("readProjectOverviews", () => {
  it("prefers PROJECTS_STATE for the primary list and fills missing fields from the manifest", async () => {
    const projectsRoot = await createProjectsRootFixture();

    const result = await readProjectOverviews({ projectsRoot });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "gcd-confirmation-bias-mitigation",
      title: "Confirmation Bias Mitigation In Graph Retrieval",
      currentStage: "graph_build",
      currentStageIndex: 1,
      workflowLine: "experiment",
      paperMode: null,
      surveyStatus: null,
      status: "blocked",
      blockerLabel: "missing sources",
      blockerReason:
        "missing_sources: canonical papers are still missing from the shared graph",
      nextAction: "Refresh the graph after the missing sources are imported.",
      updatedAt: "2026-04-09T08:45:00.000Z",
      source: "projects_state",
    });
    expect(result[0]?.projectRoot).toBe(
      path.join(projectsRoot, "gcd-confirmation-bias-mitigation"),
    );
  });

  it("creates manifest_fallback entries only for directories that contain PROJECT_MANIFEST.json", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const fallbackProjectRoot = path.join(projectsRoot, "latent-planning-sandbox");
    const ignoredDir = path.join(projectsRoot, "notes-only");

    await mkdir(fallbackProjectRoot, { recursive: true });
    await mkdir(ignoredDir, { recursive: true });
    await writeFile(
      path.join(fallbackProjectRoot, "PROJECT_MANIFEST.json"),
      JSON.stringify(
        {
          project_id: "latent-planning-sandbox",
          title: "Latent Planning Sandbox",
          current_stage: "review",
          blocking_reason: "Review queue is waiting selection from the reviewer.",
          next_action: "Select the review packet and resume the reviewer loop.",
          updated_at: "2026-04-09T11:15:00.000Z",
        },
        null,
        2,
      ),
    );
    await writeFile(path.join(ignoredDir, "README.md"), "# ignore me\n");

    const result = await readProjectOverviews({ projectsRoot });

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: "latent-planning-sandbox",
      title: "Latent Planning Sandbox",
      currentStage: "review",
      currentStageIndex: 8,
      workflowLine: "experiment",
      paperMode: null,
      surveyStatus: null,
      status: "blocked",
      blockerLabel: "waiting selection",
      blockerReason: "Review queue is waiting selection from the reviewer.",
      nextAction: "Select the review packet and resume the reviewer loop.",
      updatedAt: "2026-04-09T11:15:00.000Z",
      source: "manifest_fallback",
    });
  });

  it("keeps blocker labels short and rule-based", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const fallbackProjectRoot = path.join(projectsRoot, "paper-polish");

    await mkdir(fallbackProjectRoot, { recursive: true });
    await writeFile(
      path.join(fallbackProjectRoot, "PROJECT_MANIFEST.json"),
      JSON.stringify(
        {
          project_id: "paper-polish",
          title: "Paper Polish",
          current_stage: "write",
          blocking_reason:
            "The writing contract is complete, but review is still pending before final prose can continue.",
          updated_at: "2026-04-09T12:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const result = await readProjectOverviews({ projectsRoot });
    const paperPolish = result.find((entry) => entry.id === "paper-polish");

    expect(paperPolish).toMatchObject({
      workflowLine: "experiment",
      blockerLabel: "review pending",
      status: "blocked",
    });
    expect(paperPolish?.blockerLabel?.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("recognizes survey projects as a first-class workflow line", async () => {
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
          updated_at: "2026-04-09T12:30:00.000Z",
          next_action: "Finish screening and synthesize the survey brief.",
          survey_review: {
            status: "screening",
          },
          writing_contract: {
            paper_mode: "survey",
          },
        },
        null,
        2,
      ),
    );

    const result = await readProjectOverviews({ projectsRoot });
    const surveyProject = result.find((entry) => entry.id === "survey-multimodal-reasoning");

    expect(surveyProject).toMatchObject({
      currentStage: "survey_review",
      currentStageIndex: 2,
      workflowLine: "survey",
      paperMode: "survey",
      surveyStatus: "screening",
      status: "active",
    });
  });

  it("prefers manifest stage fields over stale PROJECTS_STATE values", async () => {
    const projectsRoot = await createProjectsRootFixture();

    await writeFile(
      path.join(projectsRoot, "PROJECTS_STATE.json"),
      JSON.stringify(
        {
          projects: [
            {
              id: "gcd-confirmation-bias-mitigation",
              stage: "setup",
              blocked_by: "old blocker",
              next_action: "old action",
              updated: "2026-04-09T09:30:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = await readProjectOverviews({ projectsRoot });

    expect(result[0]).toMatchObject({
      currentStage: "graph_build",
      blockerReason:
        "missing_sources: canonical papers are still missing from the shared graph",
      nextAction: "Refresh the graph after the missing sources are imported.",
      updatedAt: "2026-04-09T08:45:00.000Z",
    });
  });

  it("ignores malformed projects state and skips invalid project ids outside projectsRoot", async () => {
    const projectsRoot = await createProjectsRootFixture();

    await writeFile(
      path.join(projectsRoot, "PROJECTS_STATE.json"),
      '{\n  "projects": [\n    { "id": "../escape" }\n',
    );

    const result = await readProjectOverviews({ projectsRoot });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("gcd-confirmation-bias-mitigation");
  });
});
