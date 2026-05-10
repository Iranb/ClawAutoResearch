# PaperGuru Figure Prompt Pack

Source: `OpenClaw-PaperGuru-PaperNexus-native-bridge-融合执行计划-2026-05-10.md`.

These prompts drive prompt-only figure planning and the optional GPT Image
provider. They must never route real result/data figures to synthetic image
generation.

## F0. Figure Prompt Refiner

```text
You are refining a rough scientific figure request into a publication-ready
English image prompt.

Inputs:
- field: {{FIELD}}
- subfield: {{SUBFIELD}}
- venue: {{VENUE}}
- paper type: {{PAPER_TYPE}}
- figure kind: {{FIGURE_KIND}}
- method paradigm: {{METHOD_PARADIGM}}
- novelty module or organizing lens: {{NOVELTY_MODULE}}
- evidence status: {{EVIDENCE_STATUS}}
- required caption claim: {{CAPTION_CLAIM}}
- target aspect ratio: {{ASPECT_RATIO}}

Produce:
1. final English prompt, 400-700 words.
2. negative constraints.
3. caption draft.
4. label suggestion.
5. data integrity note.

Rules:
- Use layered injection: base layout, field, subfield, method paradigm,
  novelty module, venue style, evidence constraints.
- Never include fabricated numeric results, fake dataset samples, fake patient
  images, fake microscopy images, or fake qualitative examples.
- If real data is required and unavailable, generate a placeholder plan rather
  than an image prompt that pretends data exists.
- Use colorblind-safe palettes and strict layout.
- All text in the generated figure must be short, legible, and in English
  unless the manuscript language requires otherwise.
```

## F1. Teaser Figure Prompt

```text
Create a high-impact teaser figure for the first page of a top-tier
{{FIELD}} research paper. Render it as a clean, publication-quality,
flat 2D scientific visual on a pure white background.

The figure should communicate the paper's central promise in one glance:
{{PROBLEM}} -> {{NOVELTY_MODULE_OR_LENS}} -> {{EXPECTED_OUTPUT_OR_INSIGHT}}.

Layout:
- aspect ratio {{ASPECT_RATIO}}, suitable for {{VENUE}}.
- three visual zones from left to right: problem/context, proposed idea,
  outcome/insight.
- the proposed idea is the only highlighted element.
- use restrained, colorblind-safe colors.
- include no logos, watermarks, decorative gradients, or fake screenshots.

Field adaptation:
- For computer vision, use abstract thumbnails, bounding boxes, masks, or
  model tokens only when they reflect the real task.
- For NLP, use text blocks, token flows, retrieval/document nodes, or
  evaluation panels.
- For medicine/biology, use schematic cohorts, cells, imaging placeholders,
  or pathways without inventing patient data.
- For social science/economics, use causal pathways, treatment/control
  structure, or coefficient interpretation.
- For humanities, use source/argument maps rather than fake archival images.

Caption must state what the teaser illustrates, not claim unverified results.
```

## F2. Architecture / Framework Figure Prompt

```text
Create a high-resolution, publication-quality scientific architecture diagram
for a research paper, rendered in flat 2D vector style on a white background.

The diagram presents an end-to-end pipeline laid out horizontally from left to
right with four to six aligned functional blocks:
1. input or evidence source.
2. representation or preprocessing stage.
3. core processing stage.
4. proposed module, intervention, or organizing lens.
5. output, prediction, decision, or synthesis.
6. optional evaluation or feedback signal.

Use {{METHOD_PARADIGM}} terminology when available. The proposed component
{{NOVELTY_MODULE}} should be visually emphasized with one accent color and an
"Ours" or "Proposed" badge only if the paper is a method paper. For surveys
or review papers, replace the badge with "Organizing lens".

Every arrow must have a semantic label. Tensor shapes, variable names, or
data types may appear only when known from project artifacts. Do not invent
dimensions, metric values, or module names.

Use strict alignment, minimal ink, readable labels, colorblind-safe palette,
and no 3D effects, logos, watermarks, fake screenshots, or ornamental
backgrounds.
```

## F3. Core Module Zoom-In Prompt

```text
Create a module-level zoom-in figure for {{NOVELTY_MODULE}} in a
{{FIELD}} manuscript.

The figure should show the internal logic of one contribution, not the whole
pipeline. Use a compact 4:3 or single-column aspect ratio unless {{VENUE}}
requires otherwise.

Required structure:
- left side: inputs to the module.
- center: two to five internal subcomponents, operations, assumptions, or
  reasoning steps.
- right side: module output and how it reconnects to the larger method.
- bottom or side legend: symbols, colors, or line styles.

For method papers, show data/control flow. For theory papers, show dependency
between definitions, lemmas, and conclusions. For surveys, show taxonomy
criteria. For empirical studies, show study design or measurement logic.

Do not add numerical results unless supplied by project artifacts. Do not add
technical components that are not in the method description.
```

## F4. Concept Comparison Prompt

```text
Create a concept comparison figure contrasting prior approaches with the
proposed approach or organizing lens.

Layout:
- two or three panels with equal visual weight.
- left panel: conventional approach or baseline family.
- middle panel optional: intermediate or competing paradigm.
- right panel: proposed method/lens.
- each panel uses the same visual grammar so differences are meaningful.

The comparison should highlight one specific difference:
{{COMPARISON_AXIS}}.

Valid comparison axes include: data flow, supervision signal, causal
assumption, architecture dependency, evaluation scope, evidence coverage,
taxonomy boundary, or practical tradeoff.

Avoid strawman visuals. Prior work should be represented fairly and neutrally.
Use labels such as "Existing family A" rather than mocking language. If the
project lacks evidence for superiority, phrase the visual as a structural
contrast rather than a performance claim.
```

## F5. Mathematical / Algorithmic Idea Prompt

```text
Create a mathematical or algorithmic concept figure explaining the intuition
behind {{METHOD_PARADIGM}} or {{NOVELTY_MODULE}}.

Use a clean 1:1 or 4:3 layout. The figure should bridge notation and
intuition:
- show variables or objects as simple labeled nodes.
- show operations as arrows or small operator boxes.
- show objective/constraint/assumption relationships visually.
- reserve formulas for short, readable snippets only.

Do not display a full derivation. Do not invent equations. If the project has
a specific equation label, use that notation exactly. Otherwise use symbolic
placeholders and state that final notation must be aligned with the paper.
```

## F6. Workflow / Algorithm Steps Prompt

```text
Create a workflow or algorithm-step diagram for {{PAPER_TYPE}} in {{FIELD}}.

Use a vertical or horizontal sequence depending on venue space:
- step 1: input/source/setup.
- step 2: preprocessing or selection.
- step 3: core operation.
- step 4: validation/evaluation.
- step 5: output/artifact/decision.

Each step should have one short verb phrase and one concise object phrase.
Use dashed arrows for optional feedback loops and solid arrows for required
flow. Do not include implementation details that are not in the method.

For survey papers, use search -> screen -> classify -> synthesize -> audit.
For experiments, use dataset -> train -> evaluate -> analyze -> report.
For clinical/observational work, use cohort -> inclusion/exclusion ->
measurement -> model/statistics -> interpretation.
```

## F7. Dataset / Evidence Example Prompt

```text
Create a dataset or evidence example figure only if real examples are
available. If real examples are unavailable, create a placeholder layout plan
instead of a fake sample image.

When real examples exist:
- arrange 3-6 examples in a clean grid.
- preserve source identity and privacy constraints.
- include labels, masks, boxes, annotations, or metadata only if present in
  source artifacts.
- include scale bars for microscopy, medical imaging, spatial, or remote
  sensing figures when relevant.

When real examples do not exist:
- produce a prompt-only artifact that describes the intended grid and caption.
- insert a LaTeX placeholder box.
- set generation_status to `blocked_needs_real_data`.
```

## F8. Failure Case / Limitation Figure Prompt

```text
Create a limitation or failure-case figure only from real evidence. The goal
is to make boundaries inspectable, not to dramatize weakness.

The figure should include:
- failure or limitation category.
- real example or evidence reference.
- short explanation of why the method/lens fails or remains uncertain.
- boundary statement for the caption.

If real examples are unavailable, do not generate a synthetic failure image.
Create a limitation-table placeholder or textual figure plan instead.
```

## F9. Data Visualization Routing Prompt

```text
Decide whether this requested figure can be generated by an image model.

Route to Python/data plotting when the figure requires:
- PR, ROC, mAP, loss, calibration, or survival curves.
- ablation matrix or heatmap.
- real qualitative examples.
- dataset histograms or statistics.
- speed/accuracy/compute tradeoff scatter plots.
- clinical, biological, or microscopy examples.

Route to concept prompt generation only when the figure is conceptual,
schematic, architectural, taxonomic, or illustrative without fake data.

If uncertain, choose Python/data plotting or prompt-only placeholder.
```

## F10. Placeholder Generation Prompt

```text
Generate a LaTeX placeholder for a planned figure.

Inputs:
- figure_id
- label
- caption
- prompt_path
- target_image_path
- required_width
- placement

Output a LaTeX figure or figure* environment with:
- visible framed placeholder.
- prompt path.
- replacement image path.
- caption.
- label.

Do not pretend the image exists. The placeholder must be visually obvious in
drafts and easy to grep before submission.
```
