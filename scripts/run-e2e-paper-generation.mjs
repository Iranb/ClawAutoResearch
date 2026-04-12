#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

function countBy(entries, key) {
  const counts = {};
  for (const entry of entries ?? []) {
    const value = String(entry?.[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function statusFromChecks(checks) {
  const required = checks.filter((entry) => entry.required);
  if (required.every((entry) => entry.exists)) {
    return "pass";
  }
  if (required.some((entry) => entry.exists)) {
    return "partial";
  }
  return "fail";
}

const projectRoot = path.resolve(argValue("--project-root", process.env.OPENCLAW_PROJECT ?? ""));
const lane = argValue("--lane", "survey");
if (!projectRoot || projectRoot === process.cwd()) {
  console.error("Usage: node scripts/run-e2e-paper-generation.mjs --project-root <path> --lane <survey|experiment|full>");
  process.exit(2);
}

const openclawDir = path.join(projectRoot, ".openclaw-research");
await fs.mkdir(openclawDir, { recursive: true });

const manifest = (await readJson(path.join(projectRoot, "PROJECT_MANIFEST.json"))) ?? {};
const handoffStore =
  (await readJson(path.join(openclawDir, "workflow-handoff-intents.json"))) ?? { intents: [] };
const repairStore =
  (await readJson(path.join(openclawDir, "workflow-repair-queue.json"))) ?? { items: [] };
const capabilityStore =
  (await readJson(path.join(openclawDir, "workflow-agent-capabilities.json"))) ?? { records: [] };
const writeScopeStore =
  (await readJson(path.join(openclawDir, "workflow-write-scopes.json"))) ?? { claims: [] };
const incidentsStore =
  (await readJson(path.join(openclawDir, "workflow-runtime-incidents.json"))) ?? { entries: [] };
const events = await listJsonl(path.join(openclawDir, "workflow-events.jsonl"));
const handoffEvents = await listJsonl(path.join(openclawDir, "workflow-handoff-events.jsonl"));

const surveyChecks = [
  "researcher/SURVEY_QUERY_REGISTRY.json",
  "researcher/INCLUDED_PAPERS.json",
  "researcher/EXCLUDED_PAPERS.json",
  "researcher/LITERATURE_REVIEW.md",
  "researcher/SOTA_MATRIX.md",
  "researcher/GAP_SYNTHESIS.md",
  "researcher/COVERAGE_SUMMARY.md",
  "researcher/SURVEY_BRIEF.md",
];
const experimentChecks = [
  "researcher/IDEA_REPORT.md",
  "researcher/IDEA_AUDIT.md",
  "orchestrator/PLAN.md",
  "orchestrator/TODOS.md",
  "orchestrator/PLAN_AUDIT.md",
  "coder/EXPERIMENT_INDEX.md",
  "researcher/EXPERIMENT_LEDGER.json",
  "researcher/artifacts/results",
];
const writingChecks = [
  "academic_writer/PAPER_PLAN.md",
  "academic_writer/story/STORY_SPINE.md",
  "academic_writer/story/CROSS_DOMAIN_STORY_BRIDGE.md",
  "academic_writer/paper/main.tex",
  "academic_writer/paper/refs.bib",
  "reviewer/CITATION_VERIFICATION.md",
];
const crossDomainChecks = [
  "researcher/ideation/CROSS_DOMAIN_BRIDGE_EVIDENCE.json",
  "researcher/ideation/NEURO_COGNITIVE_CONCEPT_MAP.md",
  "researcher/ideation/CROSS_DOMAIN_RECONTEXTUALIZATION.md",
];

const requiredPaths =
  lane === "survey"
    ? [...surveyChecks, ...writingChecks, ...crossDomainChecks]
    : lane === "experiment"
      ? [...experimentChecks, ...writingChecks, ...crossDomainChecks]
      : [...surveyChecks, ...experimentChecks, ...writingChecks, ...crossDomainChecks];

const artifactChecklist = [];
for (const relativePath of requiredPaths) {
  artifactChecklist.push({
    path: relativePath,
    required: true,
    exists: await exists(path.join(projectRoot, relativePath)),
  });
}

const now = new Date().toISOString();
const openIncidents = (incidentsStore.entries ?? []).filter((entry) => entry.status !== "resolved");
const activeHandoffs = (handoffStore.intents ?? []).filter((entry) =>
  ["pending", "queued", "dispatching", "delivered", "acknowledged", "claimed", "failed", "stale_claim"].includes(
    entry.status
  )
);
const activeRepairs = (repairStore.items ?? []).filter((entry) =>
  ["queued", "claimed", "failed"].includes(entry.status)
);
const activeWriteScopes = (writeScopeStore.claims ?? []).filter(
  (entry) => !entry.releasedAt && Date.parse(entry.leaseExpiresAt ?? 0) > Date.now()
);

const artifactStatus = statusFromChecks(artifactChecklist);
const finalVerdict =
  artifactStatus === "pass" &&
  openIncidents.length === 0 &&
  activeRepairs.length === 0
    ? "pass"
    : artifactStatus === "fail"
      ? "fail"
      : "partial";

const timeline = [
  ...events.map((entry) => ({
    source: "runtime",
    at: entry.recordedAt ?? entry.createdAt ?? null,
    kind: entry.kind ?? null,
    summary: entry.summary ?? null,
    stage: entry.stage ?? null,
  })),
  ...handoffEvents.map((entry) => ({
    source: "handoff",
    at: entry.recordedAt ?? null,
    kind: entry.kind ?? null,
    summary: entry.summary ?? null,
    status: entry.toStatus ?? null,
  })),
].sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));

const report = `# E2E Run Report

- lane: ${lane}
- project_id: ${manifest.project_id ?? path.basename(projectRoot)}
- project_root: ${projectRoot}
- generated_at: ${now}
- current_stage: ${manifest.current_stage ?? "unknown"}
- owner_agent: ${manifest.owner_agent ?? "unknown"}
- paper_mode: ${manifest.writing_contract?.paper_mode ?? manifest.writing_contract?.paperMode ?? "unknown"}
- PaperNexus mode: ${manifest.papernexus_access?.mode ?? manifest.paper_ingestion?.papernexus_access_mode ?? "unknown"}
- final_verdict: ${finalVerdict}

## Artifact Coverage

- required: ${artifactChecklist.filter((entry) => entry.required).length}
- present: ${artifactChecklist.filter((entry) => entry.exists).length}
- status: ${artifactStatus}

## Handoff Summary

\`\`\`json
${JSON.stringify(countBy(handoffStore.intents ?? [], "status"), null, 2)}
\`\`\`

## Repair Queue Summary

\`\`\`json
${JSON.stringify(countBy(repairStore.items ?? [], "status"), null, 2)}
\`\`\`

## Runtime Safety

- open incidents: ${openIncidents.length}
- active handoffs: ${activeHandoffs.length}
- active repairs: ${activeRepairs.length}
- capability warnings: ${(capabilityStore.records ?? []).filter((entry) => entry.confidence === "low" || Date.parse(entry.expiresAt ?? 0) <= Date.now()).length}
- active write scopes: ${activeWriteScopes.length}

## Generated Paper Files

${artifactChecklist
  .filter((entry) => /academic_writer\/paper|academic_writer\/story|PAPER_PLAN/.test(entry.path))
  .map((entry) => `- [${entry.exists ? "x" : " "}] ${entry.path}`)
  .join("\n")}

## Missing Required Artifacts

${artifactChecklist
  .filter((entry) => entry.required && !entry.exists)
  .map((entry) => `- ${entry.path}`)
  .join("\n") || "- none"}
`;

await fs.writeFile(path.join(openclawDir, "E2E_RUN_REPORT.md"), report, "utf8");
await fs.writeFile(
  path.join(openclawDir, "E2E_ARTIFACT_CHECKLIST.json"),
  `${JSON.stringify({ generated_at: now, lane, final_verdict: finalVerdict, artifacts: artifactChecklist }, null, 2)}\n`,
  "utf8"
);
await fs.writeFile(
  path.join(openclawDir, "E2E_STATE_TIMELINE.jsonl"),
  `${timeline.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      projectRoot,
      lane,
      finalVerdict,
      reportPath: path.join(openclawDir, "E2E_RUN_REPORT.md"),
      checklistPath: path.join(openclawDir, "E2E_ARTIFACT_CHECKLIST.json"),
      timelinePath: path.join(openclawDir, "E2E_STATE_TIMELINE.jsonl"),
    },
    null,
    2
  )
);
