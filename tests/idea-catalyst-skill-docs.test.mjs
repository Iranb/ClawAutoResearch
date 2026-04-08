import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("canonical skill docs mention the staged public-aligned idea catalyst invariants", async () => {
  const [decompose, translate, scout, integrate, gatekeeper, ideaPhase] = await Promise.all([
    read("skills/researcher/idea-catalyst-decompose/SKILL.md"),
    read("skills/researcher/idea-catalyst-translate/SKILL.md"),
    read("skills/researcher/idea-catalyst-scout/SKILL.md"),
    read("skills/researcher/idea-catalyst-integrator/SKILL.md"),
    read("skills/researcher/idea-catalyst-gatekeeper/SKILL.md"),
    read("skills/researcher/idea-phase/SKILL.md"),
  ]);

  assert.match(decompose, /domain-specific/i);
  assert.match(decompose, /domain-agnostic/i);
  assert.match(decompose, /coarse-grained|fine-grained/i);

  assert.match(translate, /target-domain analysis|remaining challenges|overall assessment/i);
  assert.match(scout, /cross-domain search|source-domain|takeaways/i);
  assert.match(integrate, /idea_fragment|integration_mechanism|challenge_resolution/i);
  assert.match(gatekeeper, /requisition|sufficiency|decision boundary/i);
  assert.match(ideaPhase, /idea-catalyst/i);
  assert.match(ideaPhase, /graph grounding|sub-pipeline|cross-domain/i);
});
