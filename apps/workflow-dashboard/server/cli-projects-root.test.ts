import { describe, expect, it } from "vitest";

import { readCliProjectsRoot } from "./cli-projects-root.js";

describe("readCliProjectsRoot", () => {
  it("reads an explicit projects root value", () => {
    expect(readCliProjectsRoot(["--projectsRoot", "./projects"])).toBe("./projects");
    expect(readCliProjectsRoot(["--projectsRoot=./projects"])).toBe("./projects");
  });

  it("throws when --projectsRoot is missing a value", () => {
    expect(() => readCliProjectsRoot(["--projectsRoot"])).toThrow(
      "--projectsRoot requires a path value.",
    );
    expect(() => readCliProjectsRoot(["--projectsRoot="])).toThrow(
      "--projectsRoot requires a path value.",
    );
  });

  it("throws when the next token still looks like a flag", () => {
    expect(() =>
      readCliProjectsRoot(["--projectsRoot", "--other-flag"]),
    ).toThrow("--projectsRoot requires a path value, but received another flag: --other-flag");
  });
});
