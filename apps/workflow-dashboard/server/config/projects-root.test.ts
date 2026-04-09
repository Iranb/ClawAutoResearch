import path from "node:path";

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

  it("throws a readable error when projectsRoot is missing", () => {
    expect(() => resolveProjectsRoot({})).toThrowError(
      /projectsRoot.*OPENCLAW_PROJECTS_ROOT/i,
    );
  });
});
