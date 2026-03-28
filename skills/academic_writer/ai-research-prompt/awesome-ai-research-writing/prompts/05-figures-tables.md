# Figures and Tables

## Purpose

Support paper-surface visual work for research writing. This spec covers four common tasks:

- `figure_concept`
- `chart_recommendation`
- `figure_title`
- `table_title`

## When to Use

Use this spec when the user needs help designing a method figure, choosing an experiment plot, or writing a strong figure or table title.

- Choose `figure_concept` when the user wants a main paper figure or system diagram.
- Choose `chart_recommendation` when the user has experimental data and needs the right visualization strategy.
- Choose `figure_title` or `table_title` when the structure already exists and only the title or heading is needed.

## Input Contract

Collect or infer:

- `task_variant`: one of `figure_concept`, `chart_recommendation`, `figure_title`, `table_title`
- `source_material`: abstract, method description, data table, result summary, or a short description
- `venue_style`: optional, such as NeurIPS, ICLR, CVPR, or journal
- `design_goal`: what the figure or table is meant to prove
- `format_target`: `spec_only`, `caption_title`, `prompt_for_generator`, or `plot_plan`

Defaults:

- Default to conference-style academic visuals.
- Default to English labels for figures and titles.

## Output Contract

For `figure_concept`:

- Return a concise figure specification with modules, data flow, labels, and layout guidance.
- If useful, also provide a generator-ready prompt in clean English.

For `chart_recommendation`:

- Recommend one or two chart types.
- Explain why the chart fits the evidence and the story.
- Specify axes, grouping, confidence intervals, and scale handling when relevant.

For `figure_title` and `table_title`:

- Return only the title unless the user asks for alternatives.
- Use concise academic wording with no `Figure 1:` or `Table 1:` prefix.

## Hard Constraints

- Do not recommend flashy commercial visuals that weaken academic credibility.
- Do not invent modules, results, or comparisons that are not supported by the input.
- Keep figure labels short and readable.
- Prefer a layout that makes the novelty legible in seconds.
- For chart recommendations, align the plot with the actual data structure rather than aesthetic preference alone.
- For titles, prefer clarity over cleverness.

## Procedure

1. Determine what the visual artifact is supposed to prove.
2. Extract the minimum set of entities, comparisons, or trends that must appear.
3. Pick the most evidence-aligned representation:
   - pipeline or block diagram for method structure
   - grouped bar, line, scatter, heatmap, box, violin, or Pareto-style plot for experiment evidence
   - concise noun phrase for titles when possible
4. Encode the design in practical terms: layout, labels, axes, grouping, and statistical markers.
5. Check whether the result would still make sense to a reviewer who has not read the surrounding text carefully.

## Failure Modes

- Recommending a beautiful figure that does not actually communicate the paper's novelty.
- Picking a chart type that hides uncertainty, imbalance, or key trade-offs.
- Writing figure or table titles that are too vague, too long, or too promotional.
- Suggesting decorative icons or visual elements that clutter the academic message.
- Omitting labels that a reader needs to parse the figure quickly.
