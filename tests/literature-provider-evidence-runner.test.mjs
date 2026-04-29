import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  runLiteratureProviderEvidence,
} from "../tools/literature-discovery/provider-evidence-runner.ts";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("provider evidence runner extracts snippets and citation relations from cached provider raw data", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-provider-evidence-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "provider-evidence-demo",
  });
  const providerResultsPath = path.join(
    projectRoot,
    "researcher",
    "search_raw",
    "2026-04-29T00-00-00_provider_results.json"
  );
  await writeJson(providerResultsPath, {
    generated_at: "2026-04-29T00:00:00.000Z",
    query_results: [
      {
        provider: "openalex",
        queryId: "q-openalex",
        status: "ok",
        hits: [
          {
            provider: "openalex",
            providerId: "https://openalex.org/W1",
            queryId: "q-openalex",
            title: "FixMatch Consistency for Generalized Category Discovery",
            raw: {
              id: "https://openalex.org/W1",
              display_name: "FixMatch Consistency for Generalized Category Discovery",
              doi: "https://doi.org/10.1234/gcd.fixmatch",
              abstract_inverted_index: {
                FixMatch: [0],
                consistency: [1],
                improves: [2],
                generalized: [3],
                category: [4],
                discovery: [5],
              },
              referenced_works: [
                "https://openalex.org/W-ref-1",
                "https://openalex.org/W-ref-2",
              ],
            },
          },
        ],
      },
      {
        provider: "semanticscholar",
        queryId: "q-ss",
        status: "ok",
        hits: [
          {
            provider: "semanticscholar",
            providerId: "S2-1",
            queryId: "q-ss",
            title: "Semi-Supervised Signals for Novel Class Discovery",
            raw: {
              paperId: "S2-1",
              title: "Semi-Supervised Signals for Novel Class Discovery",
              tldr: {
                text: "Consistency regularization can improve pseudo-label stability for novel classes.",
              },
              references: [
                {
                  paperId: "S2-ref",
                  title: "A Survey on Novel Class Discovery",
                  year: 2024,
                  venue: "ICLR",
                },
              ],
              citations: [
                {
                  paperId: "S2-cite",
                  title: "Recent Generalized Category Discovery Methods",
                  year: 2025,
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "literature-research-controller",
      "provider_result_index.json"
    ),
    {
      status: "executed",
      provider_query_count: 2,
      search_artifacts: {
        providerResultsPath,
      },
      provider_query_results: [
        {
          provider: "openalex",
          query_id: "q-openalex",
          status: "ok",
          error: null,
        },
        {
          provider: "semanticscholar",
          query_id: "q-ss",
          status: "ok",
          error: null,
        },
      ],
    }
  );

  const result = await runLiteratureProviderEvidence({
    projectRoot,
    generatedAt: "2026-04-29T01:00:00.000Z",
    trigger: "unit_test",
  });

  assert.equal(result.manifest.status, "completed");
  assert.equal(result.manifest.provider_raw_record_count, 2);
  assert.equal(result.manifest.snippet_candidate_count, 2);
  assert.equal(result.manifest.citation_candidate_count, 4);
  assert.equal(result.manifest.claim_proof_eligible_count, 0);
  assert.match(
    result.candidates.snippets[0].risk_flags.join(" "),
    /provider_snippet_not_claim_proof/
  );
  assert.equal(
    (await readJson(result.artifact_paths.manifest_path)).snippet_candidate_count,
    2
  );
  assert.equal(
    (await readJson(result.artifact_paths.error_report_path)).error_count,
    0
  );
});

test("provider evidence runner classifies provider auth and rate-limit errors", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-provider-evidence-errors-"));
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "provider-evidence-error-demo",
  });
  const providerResultsPath = path.join(
    projectRoot,
    "researcher",
    "search_raw",
    "2026-04-29T02-00-00_provider_results.json"
  );
  await writeJson(providerResultsPath, {
    query_results: [
      {
        provider: "semanticscholar",
        queryId: "q-auth",
        status: "error",
        error: "401 Unauthorized: API key missing",
        hits: [],
      },
      {
        provider: "openalex",
        queryId: "q-rate",
        status: "error",
        error: "429 Too Many Requests",
        hits: [],
      },
    ],
  });
  await writeJson(
    path.join(
      projectRoot,
      "researcher",
      "literature-research-controller",
      "provider_result_index.json"
    ),
    {
      status: "executed",
      provider_query_count: 2,
      search_artifacts: {
        providerResultsPath,
      },
      provider_query_results: [
        {
          provider: "semanticscholar",
          query_id: "q-auth",
          status: "error",
          error: "401 Unauthorized: API key missing",
        },
        {
          provider: "openalex",
          query_id: "q-rate",
          status: "error",
          error: "429 Too Many Requests",
        },
      ],
    }
  );

  const result = await runLiteratureProviderEvidence({
    projectRoot,
    generatedAt: "2026-04-29T02:30:00.000Z",
    provider429WaitSeconds: 3600,
  });

  assert.equal(result.manifest.status, "blocked_auth");
  assert.equal(result.error_report.auth_error_count, 1);
  assert.equal(result.error_report.rate_limit_count, 1);
  assert.equal(result.error_report.deferred_until, "2026-04-29T03:30:00.000Z");
});
