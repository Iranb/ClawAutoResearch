---
name: scientific-visualization
description: Use when Coder needs implementation-phase scientific plots, publication-ready experiment figures, or custom matplotlib layouts to validate baseline-vs-proposed behavior before Analyzer finalizes the paper figures.
---

# Scientific Visualization

Coder can use plotting as an implementation aid, not only as a late analysis artifact. This skill combines publication-focused figure standards with lower-level matplotlib discipline so Coder can produce figures that are both readable now and reusable later.

## When To Use

- sanity-check baseline vs proposed curves, losses, or metrics during implementation
- inspect ablation deltas before handing off to Analyzer
- create publication-grade previews for experiment bundles
- build multi-panel figures that need explicit layout control
- produce custom plots where seaborn defaults are too limiting

Do not use this skill for final paper-owned figure packages if Analyzer has already taken ownership. In that case, leave reusable inputs plus a clear note for Analyzer instead of silently replacing final figures.

## Tool Selection

- Use matplotlib's object-oriented API by default: `fig, ax = plt.subplots(...)`
- Use seaborn only when it reduces boilerplate for statistical plots; keep final axis and export control in matplotlib
- Use `subplot_mosaic` or `GridSpec` for nontrivial multi-panel layouts
- Use plain pyplot only for quick local exploration, not for committed experiment figures

## Coder-Side Boundaries

- Write figures only under `{PROJ}/coder/`
- Preferred locations:
  - `{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/figures/`
  - `{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/results/`
- Treat Coder-owned figures as execution-support artifacts until Analyzer blesses or re-renders them
- If a figure materially supports a claim, record it in the experiment README and manifest so Analyzer can reproduce or upgrade it

## Core Standards

- label every axis with the quantity and units
- make baseline and proposed method visually distinct
- show seed variation, standard deviation, confidence interval, or error bars when available
- prefer colorblind-safe palettes such as Okabe-Ito; avoid red-green-only distinctions and never use `jet`
- use sentence case labels and readable tick sizes
- keep legends short and place them where they do not hide data
- use filenames tied to experiment id, metric, and split

## Matplotlib Defaults

Use explicit figure and axes objects:

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(4.0, 3.0), constrained_layout=True)
ax.plot(x, y_baseline, label="Baseline")
ax.plot(x, y_proposed, label="Proposed")
ax.set_xlabel("Epoch")
ax.set_ylabel("Top-1 Accuracy (%)")
ax.legend(frameon=False)
fig.savefig("accuracy_curve.pdf", bbox_inches="tight")
fig.savefig("accuracy_curve.png", dpi=300, bbox_inches="tight")
```

For multi-panel layouts, prefer:

- `plt.subplot_mosaic(...)` when panel names improve readability
- `matplotlib.gridspec.GridSpec` when widths/heights need custom ratios

Avoid implicit state chains like `plt.figure(); plt.plot(); plt.savefig()` in committed figure code unless the plot is trivial and single-use.

## Publication-Ready Figure Rules

- default to vector export for line art and charts: `PDF` or `SVG`
- also export `PNG` for quick preview or notebooks
- use at least `300 DPI` for raster exports; use `600 DPI` when line art would otherwise look soft
- keep figure widths realistic for the target medium:
  - single-column preview: about `3.3-3.6 in`
  - double-column preview: about `6.8-7.2 in`
- for multi-panel figures, use consistent axes, fonts, palette, and line widths across panels
- add panel labels only when the figure is meant to be referenced as a composite artifact

## Common Figure Patterns

### Baseline vs Proposed Curves

- same x-axis range and scaling for both methods
- include error bands or bars when multiple seeds exist
- do not truncate axes to exaggerate small gains

### Ablation Tables as Plots

- use horizontal bar charts or dot plots when comparing sub-point gains
- keep the baseline visible as a reference line or dedicated entry
- map each innovation sub-point to one visual comparison when possible

### Heatmaps and Matrices

- use perceptually uniform colormaps such as `viridis`, `cividis`, or `magma`
- include a labeled colorbar
- never use rainbow-style maps for quantitative claims

## Handoff To Analyzer

Escalate to Analyzer when:

- the figure will appear in the paper or rebuttal
- panel composition needs narrative refinement
- the plot requires publication-specific styling beyond an implementation preview
- multiple related figures should share a unified visual language

When handing off, leave:

- the data source or script path
- the exact run or manifest id
- output filenames
- any styling assumptions that matter for interpretation

## Common Mistakes

- using pyplot state instead of explicit `Figure/Axes` objects for committed figures
- hiding variance when seed-level data exists
- exporting only PNG when vector output would preserve line quality
- using color choices that fail in grayscale or for colorblind readers
- generating a polished-looking figure without linking it back to the experiment manifest
