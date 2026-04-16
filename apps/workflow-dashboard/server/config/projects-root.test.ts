import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { describe, expect, it } from "vitest";

import { resolveProjectsRoot } from "./projects-root.js";

describe("resolveProjectsRoot", () => {
  it("prefers explicit projectsRoot over env", () => {
    const explicitRoot = path.join("/tmp", "dashboard", "projects", "..", "projects-a");
    const envRoot = path.join("/tmp", "dashboard", "env-projects");

    expect(
      resolveProjectsRoot({
        cliProjectsRoot: explicitRoot,
        envProjectsRoot: envRoot,
      }),
    ).toBe(path.resolve(explicitRoot));
  });

  it("falls back to OPENCLAW_PROJECTS_ROOT", () => {
    const envRoot = path.join("/tmp", "dashboard", "env", "..", "env-projects");

    expect(
      resolveProjectsRoot({
        envProjectsRoot: envRoot,
      }),
    ).toBe(path.resolve(envRoot));
  });

  it("reads projectsRoot from the default plugin config when no CLI or env override is passed", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-config-"));
    const configPath = path.join(tempDir, "openclaw.json");
    const configuredRoot = path.join(tempDir, "projects-from-config");
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          plugins: {
            entries: {
              ClawAutoResearch: {
                config: {
                  projectsRoot: configuredRoot,
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    expect(
      resolveProjectsRoot({
        configPath,
      }),
    ).toBe(path.resolve(configuredRoot));
  });

  it("falls back to ~/.openclaw/projects when CLI, env, and plugin config are all absent", () => {
    expect(
      resolveProjectsRoot({
        configPath: path.join(os.tmpdir(), "missing-openclaw-config.json"),
      }),
    ).toBe(path.resolve(os.homedir(), ".openclaw", "projects"));
  });
});
