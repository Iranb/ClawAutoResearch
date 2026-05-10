import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeFigurePromptContractState } from "../../tools/workflow-guard.ts";

async function writeJson(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("figure prompt contract creates prompt-only placeholders without an image API key", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-figure-prompt-contract-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "figure-prompt-contract",
    paper_design_intake: {
      field: "computer vision",
      subfield: "open vocabulary detection",
      figure_policy: {
        mode: "prompt_only",
      },
    },
  });
  await writeText(
    path.join(projectRoot, "academic_writer", "FIGURE_ANCHOR_PLAN.md"),
    [
      "# Figure Anchor Plan",
      "",
      "## Primary Anchor Figure",
      "- Figure 1: pipeline / method anchor",
      "- Purpose: make the contribution structure visible before prose expands",
      "",
    ].join("\n")
  );

  const result = await materializeFigurePromptContractState({
    projectRoot,
    trigger: "test",
    agentId: "academic_writer",
  });

  assert.equal(result.mode, "prompt_only");
  assert.equal(result.figures.length, 1);
  assert.equal(result.figures[0].generation_status, "prompt_ready");
  assert.equal(result.generatedFiles.includes("academic_writer/FIGURE_PROMPT_CONTRACT.json"), true);
  assert.equal(result.generatedFiles.includes("academic_writer/FIGURE_REGISTRY.json"), true);

  const contract = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "academic_writer", "FIGURE_PROMPT_CONTRACT.json"),
      "utf8"
    )
  );
  assert.equal(contract.mode, "prompt_only");
  assert.match(contract.figures[0].prompt_path, /fig1_pipeline_method_anchor\.prompt\.md$/);

  const prompt = await fs.readFile(
    path.join(
      projectRoot,
      "academic_writer",
      "paper",
      "figures",
      "prompts",
      "fig1_pipeline_method_anchor.prompt.md"
    ),
    "utf8"
  );
  assert.match(prompt, /Do not invent empirical curves/i);
  assert.match(prompt, /metadata-only candidates can guide taxonomy\/coverage placeholders only/i);

  const placeholder = await fs.readFile(
    path.join(
      projectRoot,
      "academic_writer",
      "paper",
      "figures",
      "placeholders",
      "fig1_pipeline_method_anchor_placeholder.tex"
    ),
    "utf8"
  );
  assert.match(placeholder, /\\begin\{figure\}/);
  assert.match(placeholder, /Prompt-ready placeholder/);
});

test("figure prompt contract blocks real-data figures instead of generating fake prompts", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-figure-real-data-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "figure-real-data",
    paper_design_intake: {
      field: "machine learning",
      figure_policy: {
        mode: "openai_gpt_image",
        provider: "openai",
        model: "gpt-image-2",
      },
    },
  });

  const result = await materializeFigurePromptContractState({
    projectRoot,
    figurePromptContractMaterialization: {
      figures: [
        {
          figure_id: "fig_results_curve",
          kind: "result_curve",
          title: "Main benchmark curve",
          purpose: "Show measured accuracy over training.",
        },
      ],
    },
    trigger: "test",
    agentId: "academic_writer",
  });

  assert.equal(result.mode, "openai_gpt_image");
  assert.equal(result.figures[0].generation_status, "blocked_needs_real_data");
  assert.equal(result.figures[0].prompt_path, null);
  assert.ok(
    result.receipts.some((receipt) => receipt.status === "skipped_real_data_required")
  );

  await assert.rejects(
    fs.access(
      path.join(
        projectRoot,
        "academic_writer",
        "paper",
        "figures",
        "prompts",
        "fig_results_curve.prompt.md"
      )
    )
  );
});

test("figure prompt contract keeps skipped OpenAI receipts project-relative", async (t) => {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-figure-openai-skip-")
  );
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "figure-openai-skip",
    paper_design_intake: {
      field: "robotics",
      figure_policy: {
        mode: "openai_gpt_image",
        provider: "openai",
        model: "gpt-image-2",
      },
    },
  });

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (originalKey == null) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  const result = await materializeFigurePromptContractState({
    projectRoot,
    figurePromptContractMaterialization: {
      figures: [
        {
          figure_id: "fig_architecture",
          kind: "architecture",
          title: "System architecture",
          purpose: "Show the workflow modules and handoff boundaries.",
        },
      ],
    },
    trigger: "test",
    agentId: "academic_writer",
  });

  assert.equal(result.figures[0].generation_status, "skipped_missing_key");
  assert.equal(result.receipts[0].status, "skipped_missing_key");
  assert.equal(
    result.receipts[0].output_path,
    "academic_writer/paper/figures/generated/fig_architecture.png"
  );
  assert.equal(path.isAbsolute(result.receipts[0].output_path), false);
});
