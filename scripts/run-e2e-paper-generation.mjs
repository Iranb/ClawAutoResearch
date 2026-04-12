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

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
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

function parseCountsFromText(rawText, labels) {
  for (const label of labels) {
    const match = rawText.match(new RegExp(`${label}\\s*[:：]\\s*(\\d+)`, "i"));
    if (match) {
      return Number(match[1]);
    }
  }
  return 0;
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
const mainTexPath = path.join(projectRoot, "academic_writer", "paper", "main.tex");
const refsBibPath = path.join(projectRoot, "academic_writer", "paper", "refs.bib");
const citationVerificationPath = path.join(projectRoot, "reviewer", "CITATION_VERIFICATION.md");
const reviewIssuesPath = path.join(projectRoot, "reviewer", "REVIEW_ISSUES.json");
const mainPdfPath = path.join(projectRoot, "academic_writer", "paper", "main.pdf");
const writingSignalsPath = path.join(projectRoot, "academic_writer", "WRITING_SIGNALS.md");
const reviewPacketPath = path.join(projectRoot, "reviewer", "REVIEW_PACKET.json");

const [mainTex, refsBib, citationVerificationText, reviewIssues] = await Promise.all([
  readTextIfExists(mainTexPath),
  readTextIfExists(refsBibPath),
  readTextIfExists(citationVerificationPath),
  readJson(reviewIssuesPath),
]);

const citeCount = (mainTex?.match(/\\cite[ptba]?\*?\{/g) ?? []).length;
const sectionCount = (mainTex?.match(/\\section\*?\{/g) ?? []).length;
const bibliographyCount = (refsBib?.match(/@\w+\s*\{/g) ?? []).length;
const citationSuspicious = parseCountsFromText(citationVerificationText ?? "", ["suspicious"]);
const citationHallucinated = parseCountsFromText(citationVerificationText ?? "", ["hallucinated"]);
const reviewIssuesRaw = Array.isArray(reviewIssues?.issues) ? reviewIssues.issues : [];
const openMediumOrHigherIssues = reviewIssuesRaw.filter((issue) => {
  const status = String(issue?.status ?? "").toLowerCase();
  const severity = String(issue?.severity ?? "").toLowerCase();
  return status === "open" && ["critical", "high", "medium"].includes(severity);
}).length;
const currentStage = manifest.current_stage ?? "unknown";
const paperMode =
  manifest.writing_contract?.paper_mode ??
  manifest.writing_contract?.paperMode ??
  "unknown";
const reviewCloseoutChecks = [
  { name: "stage_not_setup", ok: currentStage !== "setup" },
  {
    name: "paper_mode_matches_lane",
    ok:
      (lane === "survey" && paperMode === "survey") ||
      (lane === "experiment" && paperMode === "conference") ||
      lane === "full",
  },
  { name: "main_tex_has_citations", ok: citeCount > 0 },
  { name: "bibliography_nonempty", ok: bibliographyCount > 0 },
  { name: "writing_signals_present", ok: await exists(writingSignalsPath) },
  { name: "review_packet_present", ok: await exists(reviewPacketPath) },
  { name: "review_issues_present", ok: await exists(reviewIssuesPath) },
  { name: "main_pdf_present", ok: await exists(mainPdfPath) },
  { name: "citation_suspicious_zero", ok: citationSuspicious === 0 },
  { name: "citation_hallucinated_zero", ok: citationHallucinated === 0 },
  { name: "no_open_medium_or_higher_review_issues", ok: openMediumOrHigherIssues === 0 },
];

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
const reviewCloseoutStatus = reviewCloseoutChecks.every((entry) => entry.ok)
  ? "pass"
  : reviewCloseoutChecks.some((entry) => entry.ok)
    ? "partial"
    : "fail";
const finalVerdict =
  artifactStatus === "pass" &&
  reviewCloseoutStatus === "pass" &&
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
- cite_count: ${citeCount}
- section_count: ${sectionCount}
- bibliography_count: ${bibliographyCount}
- final_verdict: ${finalVerdict}

## Artifact Coverage

- required: ${artifactChecklist.filter((entry) => entry.required).length}
- present: ${artifactChecklist.filter((entry) => entry.exists).length}
- status: ${artifactStatus}

## Review Closeout

- status: ${reviewCloseoutStatus}
- open_medium_or_higher_review_issues: ${openMediumOrHigherIssues}
- citation_suspicious: ${citationSuspicious}
- citation_hallucinated: ${citationHallucinated}

${reviewCloseoutChecks.map((entry) => `- [${entry.ok ? "x" : " "}] ${entry.name}`).join("\n")}

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
