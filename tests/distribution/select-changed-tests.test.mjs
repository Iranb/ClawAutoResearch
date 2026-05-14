import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRepoPath,
  parseArgs,
  selectTestsForChanges,
} from "../../scripts/select_changed_tests.mjs";

const packageJson = {
  scripts: {
    test: "node --test $(find tests -name '*.test.mjs' -type f | sort)",
    "test:distribution":
      "node --test $(find tests/distribution -name '*.test.mjs' -type f | sort)",
    "test:paper-ingestion":
      "node --test $(find tests/paper-ingestion -name '*.test.mjs' -type f | sort)",
    "test:workflow:control-plane":
      "node --test $(find tests/workflow/control-plane -name '*.test.mjs' -type f | sort)",
    "test:workflow:runtime":
      "node --test $(find tests/workflow/runtime -name '*.test.mjs' -type f | sort)",
  },
};

test("normalizeRepoPath converts platform paths to repository paths", () => {
  assert.equal(normalizeRepoPath(".\\tools\\workflow-runtime-state.ts"), "tools/workflow-runtime-state.ts");
});

test("parseArgs accepts explicit files and run mode", () => {
  const options = parseArgs([
    "--run",
    "--base",
    "main",
    "--files",
    "tools/a.ts,tests/b.test.mjs",
  ]);

  assert.equal(options.run, true);
  assert.equal(options.base, "main");
  assert.deepEqual(options.files, ["tools/a.ts", "tests/b.test.mjs"]);
});

test("selectTestsForChanges selects directly changed tests", () => {
  const result = selectTestsForChanges({
    changedPaths: ["tests/workflow/runtime/workflow-runtime-tools.test.mjs"],
    files: ["tests/workflow/runtime/workflow-runtime-tools.test.mjs"],
    fileContents: {
      "tests/workflow/runtime/workflow-runtime-tools.test.mjs": "",
    },
    packageJson,
  });

  assert.deepEqual(result.testFiles, [
    "tests/workflow/runtime/workflow-runtime-tools.test.mjs",
  ]);
  assert.deepEqual(result.commands.npmScripts, ["npm run test:workflow:runtime"]);
});

test("selectTestsForChanges follows transitive imports from source to tests", () => {
  const result = selectTestsForChanges({
    changedPaths: ["tools/workflow-runtime-state.ts"],
    files: [
      "tools/workflow-runtime-state.ts",
      "tools/register-workflow-tools.ts",
      "tests/workflow/runtime/workflow-runtime-tools.test.mjs",
    ],
    fileContents: {
      "tools/workflow-runtime-state.ts": "export const queue = true;",
      "tools/register-workflow-tools.ts":
        'import { queue } from "./workflow-runtime-state.ts"; export { queue };',
      "tests/workflow/runtime/workflow-runtime-tools.test.mjs":
        'import { queue } from "../../../tools/register-workflow-tools.ts";',
    },
    packageJson,
  });

  assert.ok(
    result.testFiles.includes("tests/workflow/runtime/workflow-runtime-tools.test.mjs")
  );
  assert.ok(result.commands.npmScripts.includes("npm run test:workflow:runtime"));
});

test("selectTestsForChanges adds subsystem fallback suites for canonical control changes", () => {
  const result = selectTestsForChanges({
    changedPaths: ["tools/workflow-stage-completion.ts"],
    files: [
      "tools/workflow-stage-completion.ts",
      "tests/workflow/control-plane/workflow-stage-completion.test.mjs",
      "tests/workflow/control-plane/workflow-control-contract.test.mjs",
    ],
    fileContents: {
      "tools/workflow-stage-completion.ts": "export function resolveWorkflowStageCompletion() {}",
      "tests/workflow/control-plane/workflow-stage-completion.test.mjs": "",
      "tests/workflow/control-plane/workflow-control-contract.test.mjs": "",
    },
    packageJson,
  });

  assert.deepEqual(result.testFiles, [
    "tests/workflow/control-plane/workflow-control-contract.test.mjs",
    "tests/workflow/control-plane/workflow-stage-completion.test.mjs",
  ]);
  assert.ok(result.commands.npmScripts.includes("npm run test:workflow:control-plane"));
  assert.equal(
    result.scripts.find(({ script }) => script === "test:workflow:control-plane")?.reason,
    "canonical workflow control, reconciler, or completion resolver changed"
  );
});

test("selectTestsForChanges recommends build checks for package changes", () => {
  const result = selectTestsForChanges({
    changedPaths: ["package.json"],
    files: ["package.json", "tests/distribution/prepare-dist-runtime.test.mjs"],
    fileContents: {
      "package.json": "{}",
      "tests/distribution/prepare-dist-runtime.test.mjs": "",
    },
    packageJson,
  });

  assert.deepEqual(result.testFiles, ["tests/distribution/prepare-dist-runtime.test.mjs"]);
  assert.ok(result.commands.npmScripts.includes("npm run test:distribution"));
  assert.ok(result.commands.checks.includes("npm run build"));
});
