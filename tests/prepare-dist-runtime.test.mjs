import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { prepareDistRuntime } from "../scripts/prepare-dist-runtime.mjs";

test("prepareDistRuntime copies JS-only helpers and rewrites runtime import specifiers", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-prepare-dist-runtime-")
  );

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const toolsRoot = path.join(tempRoot, "tools");
  const distRoot = path.join(tempRoot, "dist");
  await fs.mkdir(path.join(toolsRoot, "nested"), { recursive: true });
  await fs.mkdir(path.join(distRoot, "tools", "nested"), { recursive: true });

  await fs.writeFile(
    path.join(toolsRoot, "workflow-line-routing.js"),
    [
      'import { value } from "./nested/value";',
      "export const routed = value;",
      "",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(distRoot, "index.js"),
    [
      'import { routed } from "./tools/workflow-line-routing";',
      "export default routed;",
      "",
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(distRoot, "tools", "nested", "value.js"),
    "export const value = 7;\n",
    "utf8"
  );

  const result = await prepareDistRuntime({
    repoRoot: tempRoot,
    distRoot,
    toolsRoot,
  });

  assert.equal(result.copiedHelpers.length, 1);

  const copiedHelper = await fs.readFile(
    path.join(distRoot, "tools", "workflow-line-routing.js"),
    "utf8"
  );
  assert.match(copiedHelper, /\.\/nested\/value\.js/);

  const rewrittenEntry = await fs.readFile(path.join(distRoot, "index.js"), "utf8");
  assert.match(rewrittenEntry, /\.\/tools\/workflow-line-routing\.js/);

  const imported = await import(pathToFileURL(path.join(distRoot, "index.js")).href);
  assert.equal(imported.default, 7);
});
