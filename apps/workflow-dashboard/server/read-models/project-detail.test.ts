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
      owner: "researcher",
      status: "blocked",
      updatedAt: "2026-04-09T08:45:00.000Z",
      blockingReason:
        "missing_sources: canonical papers are still missing from the shared graph",
      nextAction: "Refresh the graph after the missing sources are imported.",
      resumeAction: null,
      papernexusPhase: "waiting_import",
      papernexusProgressSummary: "8/12 completed (4 remaining)",
      source: ["manifest", "papernexus_progress"],
    });
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
      owner: null,
      status: "incomplete",
      updatedAt: null,
      blockingReason: null,
      nextAction: null,
      resumeAction: null,
      papernexusPhase: null,
      papernexusProgressSummary: null,
      source: ["manifest", "fallback"],
    });
  });
});
