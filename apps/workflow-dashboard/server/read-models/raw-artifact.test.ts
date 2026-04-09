import path from "node:path";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readRawArtifact } from "./raw-artifact.js";

const fixtureProjectsRoot = path.resolve(
  "server/test/fixtures/projects-root",
);

const tempDirs: string[] = [];

async function createProjectsRootFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "workflow-dashboard-raw-artifact-"));
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

describe("readRawArtifact", () => {
  it("returns pretty JSON for json files", async () => {
    const projectsRoot = await createProjectsRootFixture();

    const result = await readRawArtifact({
      filePath: path.join(
        projectsRoot,
        "gcd-confirmation-bias-mitigation",
        "graph",
        "GRAPH_PRESENCE_CHECK.json",
      ),
      kind: "json",
    });

    expect(result).toMatchObject({
      kind: "json",
      status: "ok",
      content: expect.stringContaining('\n  "status": "missing_sources"'),
      metadata: {
        presentation: "pretty-json",
      },
    });
  });

  it("returns rendered-source metadata for markdown files", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const markdownPath = path.join(
      projectsRoot,
      "gcd-confirmation-bias-mitigation",
      "notes.md",
    );

    await writeFile(markdownPath, "# Notes\n\n- one\n- two\n");

    const result = await readRawArtifact({
      filePath: markdownPath,
      kind: "markdown",
    });

    expect(result).toMatchObject({
      kind: "markdown",
      status: "ok",
      content: "# Notes\n\n- one\n- two\n",
      metadata: {
        presentation: "rendered-source",
      },
    });
  });

  it("truncates jsonl files to recent lines and includes truncation metadata", async () => {
    const projectsRoot = await createProjectsRootFixture();

    const result = await readRawArtifact({
      filePath: path.join(
        projectsRoot,
        "gcd-confirmation-bias-mitigation",
        ".openclaw-research",
        "workflow-trace.jsonl",
      ),
      kind: "jsonl",
    });

    expect(result).toMatchObject({
      kind: "jsonl",
      status: "ok",
      metadata: {
        presentation: "recent-lines",
        totalLines: 7,
        shownLines: 5,
        truncated: true,
        truncationNote: "Showing the most recent 5 of 7 lines.",
      },
    });
    expect(result.content).not.toContain('"seq":1');
    expect(result.content).not.toContain('"seq":2');
    expect(result.content).toContain('"seq":3');
    expect(result.content).toContain('"seq":7');
  });

  it("returns invalid artifact metadata and raw text when json parsing fails", async () => {
    const projectsRoot = await createProjectsRootFixture();
    const invalidJsonPath = path.join(
      projectsRoot,
      "gcd-confirmation-bias-mitigation",
      "graph",
      "BROKEN.json",
    );

    await writeFile(invalidJsonPath, '{\n  "broken": true,\n');

    const result = await readRawArtifact({
      filePath: invalidJsonPath,
      kind: "json",
    });

    expect(result).toMatchObject({
      kind: "json",
      status: "invalid",
      content: '{\n  "broken": true,\n',
      metadata: {
        presentation: "plain-text",
        note: "invalid artifact",
      },
    });
  });
});
