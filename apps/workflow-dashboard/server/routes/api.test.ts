import path from "node:path";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";

const fixtureProjectsRoot = path.resolve(
  "server/test/fixtures/projects-root",
);

const tempDirs: string[] = [];

async function createProjectsRootFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workflow-dashboard-api-"));
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

describe("workflow-dashboard api routes", () => {
  it("returns project overviews", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    const response = await request(app).get("/api/projects");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "gcd-confirmation-bias-mitigation",
        title: "Confirmation Bias Mitigation In Graph Retrieval",
        currentStage: "graph_build",
        status: "blocked",
        blockerLabel: "missing sources",
        source: "projects_state",
      }),
    ]);
  });

  it("returns project summary cards data", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    const response = await request(app).get(
      "/api/projects/gcd-confirmation-bias-mitigation/summary",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: "gcd-confirmation-bias-mitigation",
        title: "Confirmation Bias Mitigation In Graph Retrieval",
        currentStage: "graph_build",
        status: "blocked",
        papernexusPhase: "waiting_import",
      }),
    );
  });

  it("returns project artifact descriptors", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    const response = await request(app).get(
      "/api/projects/gcd-confirmation-bias-mitigation/artifacts",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "manifest",
          label: "Project Manifest",
          kind: "json",
          exists: true,
        }),
        expect.objectContaining({
          key: "runtime_trace",
          label: "Workflow Trace",
          kind: "jsonl",
          exists: true,
        }),
      ]),
    );
  });

  it("returns formatted raw artifact content", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    const response = await request(app).get(
      "/api/projects/gcd-confirmation-bias-mitigation/raw/graph_presence",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        kind: "json",
        status: "ok",
        content: expect.stringContaining('\n  "status": "missing_sources"'),
        metadata: expect.objectContaining({
          presentation: "pretty-json",
        }),
      }),
    );
    expect(response.body.path).toBe(
      path.join(
        projectsRoot,
        "gcd-confirmation-bias-mitigation",
        "graph",
        "GRAPH_PRESENCE_CHECK.json",
      ),
    );
  });

  it("returns a clean 404 for unknown projects", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    const response = await request(app).get("/api/projects/unknown-project/summary");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Project not found",
      projectId: "unknown-project",
    });
  });

  it("returns a clean 400 for invalid artifact keys", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    const response = await request(app).get(
      "/api/projects/gcd-confirmation-bias-mitigation/raw/not-a-real-artifact",
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid artifact key",
      artifactKey: "not-a-real-artifact",
    });
  });

  it("returns a json 500 when a read-model throws while parsing fixture data", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const app = createApp({ projectsRoot });

    await writeFile(
      path.join(projectsRoot, "PROJECTS_STATE.json"),
      '{\n  "projects": [\n',
    );

    const response = await request(app).get("/api/projects");

    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({
      error: "Internal server error",
    });
  });
});
