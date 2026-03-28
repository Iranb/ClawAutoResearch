# Experiments

## Purpose

Turn experiment results into evidence-grounded paper writing. This spec is for interpreting tables, metrics, ablations, and trends and converting them into publishable analysis paragraphs.

## When to Use

Use this spec when the user has experiment outputs and wants writing help, not new experiments.

Typical triggers:

- result table to paragraph
- ablation results to analysis
- sensitivity study to narrative
- efficiency or trade-off results to paper text
- honest summary of weak, mixed, or negative findings

## Input Contract

Collect or infer:

- `results_input`: table, CSV-like text, bullet summary, or notes
- `target_format`: `latex_paragraphs`, `plain_text`, or `outline`
- `analysis_focus`: `sota_comparison`, `ablation`, `tradeoff`, `robustness`, `sensitivity`, or `mixed`
- `section_context`: optional, such as main results, ablations, or appendix
- `must_report`: metrics, baselines, units, variance, and known caveats

Defaults:

- Default to `latex_paragraphs` when the user mentions paper writing.
- Default to paragraph form rather than bullets.

## Output Contract

Return analysis paragraphs first.

- For `latex_paragraphs`, prefer compact research-style paragraphs and use `\paragraph{...}` only when it improves integration with the paper.
- Lead with the main evidence-backed conclusion.
- Include the supporting comparison or trend immediately after the claim.
- Mention negative or mixed results when they matter to the interpretation.
- Add a short note only if the input is too incomplete to support a confident paragraph.

## Hard Constraints

- Every claim must be supported by the provided results.
- Do not invent statistical significance, causal explanations, or hidden trends.
- Do not exaggerate weak gains or ignore regressions.
- Keep metric directionality correct.
- Distinguish between absolute gains, relative gains, and qualitative interpretation.
- If the data is inconclusive, say so plainly.

## Procedure

1. Parse the structure of the results and identify what comparison is actually being made.
2. Determine the strongest evidence-backed conclusion.
3. Write the paragraph around the conclusion, then add the concrete numerical support.
4. Cover the relevant interpretation pattern:
   - superiority versus baselines
   - contribution of components in ablations
   - stability or sensitivity across settings
   - trade-offs among accuracy, cost, latency, or memory
5. Mention limitations or mixed outcomes when they change the scientific reading.
6. Re-check that every sentence can be traced back to the input.

## Failure Modes

- Turning a result table into a list of numbers with no interpretation.
- Overstating a tiny gain as decisive progress.
- Ignoring baselines or regressions that weaken the narrative.
- Mixing up which metric is better.
- Writing elegant prose that cannot be defended from the data.
