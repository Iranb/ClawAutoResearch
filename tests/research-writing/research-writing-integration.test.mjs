import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_FALLBACK_ACTIVATION_PATH,
  materializeFallbackActivation,
} from "../../tools/research-writing/fallback-activation.ts";
import {
  DEFAULT_FIGURE_ANCHOR_PLAN_PATH,
  materializeFigureAnchorPlan,
} from "../../tools/research-writing/figure-anchor.ts";
import {
  DEFAULT_PREWRITE_REJECTION_SIMULATION_PATH,
  materializePrewriteRejectionSimulation,
} from "../../tools/research-writing/prewrite-rejection.ts";
import {
  DEFAULT_PAPER_REVISION_STATE_PATH,
  materializeRevisionCycle,
} from "../../tools/research-writing/revision-cycle.ts";
import {
  DEFAULT_WRITING_REFERENCE_BUNDLE_PATH,
  materializeWritingReferenceBundle,
} from "../../tools/research-writing/reference-bundles.ts";
import {
  DEFAULT_CONTRIBUTION_TO_STORY_BRIDGE_PATH,
  materializeContributionToStoryBridge,
} from "../../tools/research-writing/story-bridge.ts";
import { normalizePaperStoryState } from "../../tools/workflow-guard-state/paper-story.ts";
import { normalizeReviewPressurePacketState } from "../../tools/workflow-guard-state/review-pressure.ts";

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeWritingProjectRoot() {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-research-writing-integration-")
  );

  await writeText(
    path.join(projectRoot, "academic_writer", "story", "STORY_SPINE.md"),
    "# Story Spine\n\n## Contribution\n- claim-1\n- claim-2\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "CLAIM_TO_EXPERIMENT_MAP.md"),
    "# Claim To Experiment Map\n\n## Claim 1 (claim-1)\n- Claim: Gain over baseline.\n- Evidence target: Table 1.\n\n## Claim 2 (claim-2)\n- Claim: Better support precision.\n- Evidence target: Fig 2.\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "FALLBACK_NARRATIVE.md"),
    "# Fallback Narrative\n- Narrow the claim to bounded support precision gains.\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "REJECTION_RISK_TABLE.md"),
    "# Rejection Risk Table\n- Novelty overlap\n- Weak empirical gain\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "PIPELINE_FIGURE_SKETCH.md"),
    "# Pipeline Figure Sketch\n- Inputs: baseline router\n- Core module: graph-grounded support router\n- Outputs: claim-evidence aligned draft\n"
  );
  await writeText(
    path.join(projectRoot, "academic_writer", "story", "MODULE_MOTIVATION_MAP.md"),
    "# Module Motivation Map\n- Router: preserve support precision\n"
  );
  await writeJson(
    path.join(projectRoot, "researcher", "idea-catalyst", "IDEA_TO_CLAIM_MAP.json"),
    {
      selected_track_id: "track-main",
      top_fragments: [
        {
          fragment_id: "frag-1",
          title: "Graph-grounded support router",
          contribution_hint: "Route claims through evidence packets",
          mapped_claims: [
            {
              claim_id: "claim-1",
              claim: "Graph-grounded routing beats the baseline on support precision.",
              section_hint: "method/results",
            },
            {
              claim_id: "claim-2",
              claim: "The routing layer improves support precision without harming clarity.",
              section_hint: "discussion",
            },
          ],
        },
      ],
      top3_directions: [
        {
          direction_id: "dir-1",
          title: "Graph-grounded support router",
          action: "advance",
        },
      ],
    }
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "REJECT_FIRST_REVIEW.md"),
    "# Reject First Review\n- Reviewer will ask whether the gain is just a baseline refinement.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "NOVELTY_ATTACK.md"),
    "# Novelty Attack\n- claim-2 looks too broad if clarity evidence stays weak.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "UNSUPPORTED_CLAIM_AUDIT.md"),
    "# Unsupported Claim Audit\n- claim-2: unsupported because clarity evidence is still sparse.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "REVERSE_OUTLINE.md"),
    "# Reverse Outline\n- intro drifts away from the real challenge.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "FIGURE_TABLE_QC.md"),
    "# Figure Table QC\n- Figure 1 should become the anchor figure.\n"
  );
  await writeText(
    path.join(projectRoot, "reviewer", "story-pressure", "LIMITATION_AUDIT.md"),
    "# Limitation Audit\n- scope should stay on bounded support precision.\n"
  );

  return projectRoot;
}

function buildPaperStoryState(overrides = {}) {
  return normalizePaperStoryState({
    status: "ready",
    claim_support_status: "partial",
    supported_claim_count: 1,
    partial_claim_count: 1,
    unsupported_claim_count: 1,
    story_spine_path: "academic_writer/story/STORY_SPINE.md",
    claim_to_experiment_map_path: "academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md",
    fallback_narrative_path: "academic_writer/story/FALLBACK_NARRATIVE.md",
    rejection_risk_table_path: "academic_writer/story/REJECTION_RISK_TABLE.md",
    pipeline_figure_sketch_path: "academic_writer/story/PIPELINE_FIGURE_SKETCH.md",
    module_motivation_map_path: "academic_writer/story/MODULE_MOTIVATION_MAP.md",
    idea_to_claim_map_path: "researcher/idea-catalyst/IDEA_TO_CLAIM_MAP.json",
    ...overrides,
  });
}

function buildReviewPressureState(overrides = {}) {
  return normalizeReviewPressurePacketState({
    status: "ready",
    reject_first_review_path: "reviewer/story-pressure/REJECT_FIRST_REVIEW.md",
    novelty_attack_path: "reviewer/story-pressure/NOVELTY_ATTACK.md",
    unsupported_claim_audit_path: "reviewer/story-pressure/UNSUPPORTED_CLAIM_AUDIT.md",
    reverse_outline_path: "reviewer/story-pressure/REVERSE_OUTLINE.md",
    figure_table_qc_path: "reviewer/story-pressure/FIGURE_TABLE_QC.md",
    limitation_audit_path: "reviewer/story-pressure/LIMITATION_AUDIT.md",
    ...overrides,
  });
}

test("writing reference bundle materializes section and stage bundles with wisdom-layer references", async (t) => {
  const projectRoot = await makeWritingProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await materializeWritingReferenceBundle({
    projectRoot,
    paperStoryState: buildPaperStoryState(),
    reviewPressureState: buildReviewPressureState(),
  });

  assert.equal(result.bundle.status, "ready");
  assert.ok(
    result.bundle.stageBundles.plan.referencePaths.some((entry) =>
      /story-planning-rules\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.plan.referencePaths.some((entry) =>
      /thesis-crystallization\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.plan.referencePaths.some((entry) =>
      /counterintuitive-writing\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.write.referencePaths.some((entry) =>
      /writing-quality-check\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.write.referencePaths.some((entry) =>
      /writing-judgment-framework\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.write.referencePaths.some((entry) =>
      /self-attack-protocol\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.write.referencePaths.some((entry) =>
      /figure-centric-writing\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.sectionBundles.introduction.referencePaths.some((entry) =>
      /introduction\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.sectionBundles.method.referencePaths.some((entry) =>
      /method\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.review.referencePaths.some((entry) =>
      /review-quality-lenses\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.review.referencePaths.some((entry) =>
      /claim-verification-protocol\.md$/i.test(entry)
    )
  );
  assert.ok(
    result.bundle.stageBundles.review.referencePaths.some((entry) =>
      /paper-review\.md$/i.test(entry)
    )
  );

  const persisted = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_WRITING_REFERENCE_BUNDLE_PATH), "utf8")
  );
  assert.equal(persisted.status, "ready");
  assert.ok(
    persisted.globalReferencePaths.some((entry) =>
      /writing-quality-check\.md$/i.test(entry)
    )
  );
  assert.ok(
    persisted.globalReferencePaths.some((entry) =>
      /writing-judgment-framework\.md$/i.test(entry)
    )
  );
});

test("fallback activation switches to fallback mode when story support and review pressure indicate risk", async (t) => {
  const projectRoot = await makeWritingProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const fallbackResult = await materializeFallbackActivation({
    projectRoot,
    paperStoryState: buildPaperStoryState({
      claim_support_status: "unsupported",
      supported_claim_count: 0,
      partial_claim_count: 1,
      unsupported_claim_count: 2,
    }),
    reviewPressureState: buildReviewPressureState(),
  });
  assert.equal(fallbackResult.activation.activeNarrativeMode, "fallback");
  assert.ok(fallbackResult.activation.blockingClaimIds.includes("claim-2"));
  assert.match(fallbackResult.activation.triggerReason ?? "", /unsupported|novelty|reject/i);

  const mainResult = await materializeFallbackActivation({
    projectRoot,
    paperStoryState: buildPaperStoryState({
      claim_support_status: "supported",
      supported_claim_count: 3,
      partial_claim_count: 0,
      unsupported_claim_count: 0,
    }),
    reviewPressureState: buildReviewPressureState({
      status: "missing",
    }),
  });
  assert.equal(mainResult.activation.activeNarrativeMode, "main");

  const persisted = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_FALLBACK_ACTIVATION_PATH), "utf8")
  );
  assert.ok(["main", "fallback"].includes(persisted.active_narrative_mode));
});

test("prewrite rejection, figure anchor, story bridge, and revision cycle are materialized as durable workflow-owned artifacts", async (t) => {
  const projectRoot = await makeWritingProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const paperStoryState = buildPaperStoryState();
  const reviewPressureState = buildReviewPressureState();

  const prewrite = await materializePrewriteRejectionSimulation({
    projectRoot,
    paperStoryState,
    reviewPressureState,
  });
  const bridge = await materializeContributionToStoryBridge({
    projectRoot,
    paperStoryState,
  });
  const figureAnchor = await materializeFigureAnchorPlan({
    projectRoot,
    paperStoryState,
  });
  const revision = await materializeRevisionCycle({
    projectRoot,
    stage: "write",
    paperStoryState,
    fallbackActivation: {
      activeNarrativeMode: "fallback",
      blockingClaimIds: ["claim-2"],
      triggerReason: "unsupported claim remains",
      recommendedStorySwitch: "narrow to bounded support precision gains",
    },
  });

  const prewriteText = await fs.readFile(
    path.join(projectRoot, DEFAULT_PREWRITE_REJECTION_SIMULATION_PATH),
    "utf8"
  );
  assert.match(prewriteText, /reject-first/i);
  assert.match(prewriteText, /novelty attack/i);
  assert.match(prewriteText, /claim-2/i);

  const bridgeText = await fs.readFile(
    path.join(projectRoot, DEFAULT_CONTRIBUTION_TO_STORY_BRIDGE_PATH),
    "utf8"
  );
  assert.match(bridgeText, /Contribution 1/i);
  assert.match(bridgeText, /claim-1/i);
  assert.match(bridgeText, /story role/i);

  const figureText = await fs.readFile(
    path.join(projectRoot, DEFAULT_FIGURE_ANCHOR_PLAN_PATH),
    "utf8"
  );
  assert.match(figureText, /Primary Anchor Figure/i);
  assert.match(figureText, /Figure 1/i);

  assert.equal(prewrite.path, DEFAULT_PREWRITE_REJECTION_SIMULATION_PATH);
  assert.equal(bridge.path, DEFAULT_CONTRIBUTION_TO_STORY_BRIDGE_PATH);
  assert.equal(figureAnchor.path, DEFAULT_FIGURE_ANCHOR_PLAN_PATH);
  assert.equal(revision.state.stage, "write");
  assert.equal(revision.state.passes.section_pass.status, "required");
  assert.equal(revision.state.passes.intro_method_consistency_pass.status, "pending");
  assert.equal(revision.state.passes.full_paper_adversarial_pass.status, "pending");
  assert.equal(revision.state.passes.writing_quality_pass.status, "pending");
  assert.equal(revision.state.passes.claim_verification_pass.status, "pending");

  const revisionState = JSON.parse(
    await fs.readFile(path.join(projectRoot, DEFAULT_PAPER_REVISION_STATE_PATH), "utf8")
  );
  assert.equal(revisionState.stage, "write");
  assert.ok(revisionState.passes.writing_quality_pass);
  assert.ok(revisionState.passes.claim_verification_pass);
});
