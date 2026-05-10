import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPaperDesignIntakePatch,
  normalizePaperDesignIntakeState,
  scorePaperDesignIntakeCompleteness,
  serializePaperDesignIntakeState,
  summarizePaperDesignIntakeForPrompt,
} from "../../tools/workflow-guard-state/paper-design-intake.ts";

test("paper design intake is nonblocking when absent and defaults to prompt-only figures", () => {
  const state = normalizePaperDesignIntakeState(null);

  assert.equal(state.status, "missing");
  assert.equal(state.figurePolicy.mode, "prompt_only");
  assert.equal(state.figurePolicy.allowGeneratedConceptFigures, true);
  assert.equal(state.figurePolicy.requireRealDataForResultFigures, true);
  assert.match(
    summarizePaperDesignIntakeForPrompt(state),
    /Paper design intake: missing/i
  );
});

test("paper design intake normalizes multi-domain fields and configurable image provider", () => {
  const state = normalizePaperDesignIntakeState({
    status: "ready",
    field: "medicine",
    subfield: "clinical prediction",
    paper_type: "empirical_study",
    target_venue: "Nature Medicine",
    experiment_data_status: "partial_results",
    innovation_directions: ["cohort design", "risk calibration", "risk calibration"],
    baseline_families: ["logistic regression", "Cox model"],
    figure_policy: {
      mode: "openai",
      model: "gpt-image-2",
      require_real_data_for_result_figures: true,
    },
  });

  assert.equal(state.status, "ready");
  assert.equal(state.paperType, "empirical_study");
  assert.equal(state.figurePolicy.mode, "openai_gpt_image");
  assert.equal(state.figurePolicy.provider, "openai");
  assert.equal(state.figurePolicy.model, "gpt-image-2");
  assert.deepEqual(state.innovationDirections, [
    "cohort design",
    "risk calibration",
  ]);
  assert.match(summarizePaperDesignIntakeForPrompt(state), /field=medicine/);
  assert.match(summarizePaperDesignIntakeForPrompt(state), /figures=openai_gpt_image\/gpt-image-2/);
});

test("paper design intake serializes as manifest-friendly snake_case and scores completeness", () => {
  const state = normalizePaperDesignIntakeState({
    field: "computer vision",
    paperType: "method_paper",
    targetVenue: "CVPR",
    dataStatus: "complete",
    baselineFamilies: ["DETR", "YOLO"],
  });

  const serialized = serializePaperDesignIntakeState(state);
  assert.equal(serialized.paper_type, "method_paper");
  assert.equal(serialized.target_venue, "CVPR");
  assert.deepEqual(serialized.baseline_families, ["DETR", "YOLO"]);

  const score = scorePaperDesignIntakeCompleteness(state);
  assert.equal(score.requiredKnown, 4);
  assert.equal(score.requiredTotal, 4);
  assert.deepEqual(score.missing, []);
});

test("paper design intake patch preserves existing figure policy unless changed", () => {
  const next = applyPaperDesignIntakePatch({
    current: {
      field: "economics",
      figure_policy: {
        mode: "prompt_only",
        allow_generated_concept_figures: false,
      },
    },
    patch: {
      paper_type: "causal_empirical",
      target_venue: "AER",
    },
    updatedAt: "2026-05-10T00:00:00.000Z",
  });

  assert.equal(next.field, "economics");
  assert.equal(next.paperType, "causal_empirical");
  assert.equal(next.figurePolicy.mode, "prompt_only");
  assert.equal(next.figurePolicy.allowGeneratedConceptFigures, false);
  assert.equal(next.lastUpdatedAt, "2026-05-10T00:00:00.000Z");
});
