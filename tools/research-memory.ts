/**
 * research-memory tool
 *
 * Manages structured research memory files.
 *
 * Preferred (project-isolated) locations when `OPENCLAW_PROJECT` is set:
 *   - {PROJ}/memory/ideation-memory.md  (IDE/IVE patterns)
 *   - {PROJ}/memory/experiment-memory.md (ESE patterns)
 *   - {PROJ}/researcher/REVIEW_STATE.json (review loop state)
 *
 * Legacy fallback (workspace-level) when `OPENCLAW_PROJECT` is not set:
 *   - memory/ideation-memory.md
 *   - memory/experiment-memory.md
 *   - research/REVIEW_STATE.json
 *
 * Exposed as an OpenClaw custom tool. Agents call it via the tool API
 * rather than writing raw markdown, ensuring consistent formatting and
 * preventing accidental overwrites.
 */

import * as fs from "fs/promises";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IdeaEntry {
  title: string;
  domain: string;
  hypothesis: string;
  outcome: "success" | "abandoned";
  // success fields
  whyNovel?: string;
  pilotResult?: string;
  generalizablePattern?: string;
  // failure fields
  failureMode?: string;
  retryCondition?: string;
}

interface ExperimentEntry {
  name: string;
  taskType: string;
  dataset: string;
  hyperparams: Record<string, string | number>;
  result: string;
  trainingTimeHours: number;
  gpuType: string;
  reuseCondition: string;
}

interface ReviewState {
  round: number;
  status: "in_progress" | "completed";
  lastScore: number;
  lastVerdict: "ready" | "almost" | "not ready";
  pendingActions: string[];
  timestamp: string;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string {
  return process.env.OPENCLAW_WORKSPACE ?? process.cwd();
}

function getProjectRoot(): string | null {
  const p = process.env.OPENCLAW_PROJECT;
  if (!p) return null;
  return p;
}

function memoryPath(filename: string): string {
  const proj = getProjectRoot();
  if (proj) return path.join(proj, "memory", filename);
  return path.join(getWorkspaceRoot(), "memory", filename);
}

function researchPath(filename: string): string {
  const proj = getProjectRoot();
  if (proj) return path.join(proj, "researcher", filename);
  return path.join(getWorkspaceRoot(), "research", filename);
}

async function readFileSafe(filepath: string): Promise<string> {
  try {
    return await fs.readFile(filepath, "utf-8");
  } catch {
    return "";
  }
}

async function appendToFile(filepath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.appendFile(filepath, content, "utf-8");
}

// ─── Ideation Memory ──────────────────────────────────────────────────────────

/**
 * Append an idea entry to ideation-memory.md.
 * Called after idea-phase completes (success or abandon).
 */
export async function recordIdeaEntry(entry: IdeaEntry): Promise<string> {
  const date = new Date().toISOString().split("T")[0];
  const statusLabel = entry.outcome === "abandoned" ? " (ABANDONED)" : "";

  let block: string;
  if (entry.outcome === "success") {
    block = `
### ${entry.title} — ${date}
- **Domain**: ${entry.domain}
- **Core hypothesis**: ${entry.hypothesis}
- **Why novel**: ${entry.whyNovel ?? "—"}
- **Pilot result**: ${entry.pilotResult ?? "—"}
- **Generalizable pattern**: ${entry.generalizablePattern ?? "—"}
`;
  } else {
    block = `
### ${entry.title} — ${date}${statusLabel}
- **Domain**: ${entry.domain}
- **Failure mode**: ${entry.failureMode ?? "—"}
- **Do not retry unless**: ${entry.retryCondition ?? "—"}
`;
  }

  const section =
    entry.outcome === "success"
      ? "## Successful Idea Patterns"
      : "## Failed Idea Catalog";

  const filepath = memoryPath("ideation-memory.md");
  const existing = await readFileSafe(filepath);

  if (existing.includes(section)) {
    // Insert after section header
    const updated = existing.replace(section, `${section}\n${block}`);
    await fs.writeFile(filepath, updated, "utf-8");
  } else {
    await appendToFile(filepath, `\n${section}\n${block}`);
  }

  return `Ideation memory updated: ${entry.title} (${entry.outcome})`;
}

// ─── Experiment Memory ────────────────────────────────────────────────────────

/**
 * Append an experiment strategy entry to experiment-memory.md.
 * Called after experiment-phase completes with results.
 */
export async function recordExperimentEntry(
  entry: ExperimentEntry
): Promise<string> {
  const date = new Date().toISOString().split("T")[0];

  const hyperparamStr = Object.entries(entry.hyperparams)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  const block = `
### ${entry.name} — ${date}
- **Task**: ${entry.taskType}
- **Dataset**: ${entry.dataset}
- **Key hyperparameters**:
${hyperparamStr}
- **Result**: ${entry.result}
- **Training time**: ~${entry.trainingTimeHours}h on ${entry.gpuType}
- **Reuse condition**: ${entry.reuseCondition}
`;

  const section = "## Proven Experiment Strategies";
  const filepath = memoryPath("experiment-memory.md");
  const existing = await readFileSafe(filepath);

  if (existing.includes(section)) {
    const updated = existing.replace(section, `${section}\n${block}`);
    await fs.writeFile(filepath, updated, "utf-8");
  } else {
    await appendToFile(filepath, `\n${section}\n${block}`);
  }

  // Also update compute budget log
  const budgetEntry = `| ${entry.name} | — | ${entry.gpuType} | ${entry.trainingTimeHours} | ${date} |\n`;
  const budgetSection = "## Compute Budget Log";
  const budgetFilepath = memoryPath("experiment-memory.md");
  const afterUpdate = await readFileSafe(budgetFilepath);
  if (afterUpdate.includes("| *(add entries)*")) {
    await fs.writeFile(
      budgetFilepath,
      afterUpdate.replace("| *(add entries)* | | | | |\n", budgetEntry),
      "utf-8"
    );
  } else if (afterUpdate.includes(budgetSection)) {
    // append row after table header (simple approach)
    const updated2 = afterUpdate.replace(
      "| *(add entries)* |",
      `${budgetEntry}| *(add entries)* |`
    );
    await fs.writeFile(budgetFilepath, updated2, "utf-8");
  }

  return `Experiment memory updated: ${entry.name}`;
}

// ─── Review State ─────────────────────────────────────────────────────────────

/**
 * Read current review state. Returns null if no state file exists.
 */
export async function getReviewState(): Promise<ReviewState | null> {
  const filepath = researchPath("REVIEW_STATE.json");
  const content = await readFileSafe(filepath);
  if (!content) return null;
  try {
    return JSON.parse(content) as ReviewState;
  } catch {
    return null;
  }
}

/**
 * Write review state. Called at the end of each review round.
 */
export async function setReviewState(state: ReviewState): Promise<string> {
  const filepath = researchPath("REVIEW_STATE.json");
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(state, null, 2), "utf-8");
  return `Review state saved: round=${state.round}, status=${state.status}, score=${state.lastScore}`;
}

/**
 * Check whether a review loop should be resumed or restarted.
 * Returns: "resume" | "restart" | "none"
 */
export async function checkReviewResumability(): Promise<{
  action: "resume" | "restart" | "none";
  state: ReviewState | null;
  reason: string;
}> {
  const state = await getReviewState();

  if (!state) {
    return { action: "none", state: null, reason: "No review state found." };
  }

  if (state.status === "completed") {
    return {
      action: "none",
      state,
      reason: `Review completed at round ${state.round} (score: ${state.lastScore}).`,
    };
  }

  const stateAge =
    Date.now() - new Date(state.timestamp).getTime();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  if (stateAge > twentyFourHours) {
    return {
      action: "restart",
      state,
      reason: `Review state expired (last updated ${Math.floor(stateAge / 3600000)}h ago). Restarting.`,
    };
  }

  return {
    action: "resume",
    state,
    reason: `Resuming review loop from round ${state.round + 1} (last score: ${state.lastScore}/10, verdict: ${state.lastVerdict}).`,
  };
}

// ─── Daily Log ────────────────────────────────────────────────────────────────

/**
 * Append a session summary to the daily memory log.
 * Called by the before-compaction hook.
 */
export async function appendDailyLog(params: {
  phase: string;
  whatWasDone: string[];
  keyDecisions: string[];
  results?: string[];
  nextSteps: string[];
}): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().slice(0, 5);

  const formatList = (items: string[]) =>
    items.map((i) => `- ${i}`).join("\n");

  const block = `
## ${timeStr} — Session Summary
**Phase**: ${params.phase}
**What was done**:
${formatList(params.whatWasDone)}
**Key decisions**:
${formatList(params.keyDecisions)}
${
  params.results && params.results.length > 0
    ? `**Results**:\n${formatList(params.results)}\n`
    : ""
}**Next steps**:
${formatList(params.nextSteps)}
`;

  const filepath = memoryPath(`${dateStr}.md`);
  const existing = await readFileSafe(filepath);
  if (!existing) {
    await fs.writeFile(
      filepath,
      `# Research Log — ${dateStr}\n${block}`,
      "utf-8"
    );
  } else {
    await appendToFile(filepath, block);
  }

  return `Daily log appended: memory/${dateStr}.md`;
}
