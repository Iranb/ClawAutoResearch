import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test("plugin identity is aligned to ClawAutoResearch", () => {
  const manifest = readJson("openclaw.plugin.json");
  const pkg = readJson("package.json");
  const entrySource = readText("index.ts");
  const recommended = readText("openclaw.RECOMMENDED.json");
  const installScript = readText("install.sh");

  assert.equal(manifest.id, "ClawAutoResearch");
  assert.equal(manifest.name, "ClawAutoResearch");
  assert.equal(pkg.openclaw?.pluginId, "ClawAutoResearch");
  assert.match(pkg.repository?.url ?? "", /ClawAutoResearch\.git$/);
  assert.match(pkg.homepage ?? "", /ClawAutoResearch(#readme)?$/);
  assert.match(entrySource, /id:\s*"ClawAutoResearch"/);
  assert.match(entrySource, /name:\s*"ClawAutoResearch"/);
  assert.match(recommended, /"ClawAutoResearch":\s*\{/);
  assert.match(installScript, /PLUGIN_LINK="\$OC_PLUGINS_DIR\/ClawAutoResearch"/);
});
