import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runBroadPaperSearch } from "../tools/research30/workflow-bridge.ts";

test("broad paper search persists merged candidates, staged pdfs, and source index entries", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "broad-paper-search-"));
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "demo-project",
        research_program: {
          baseline_reference: "graph retrieval baseline",
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const originalFetch = globalThis.fetch;
  process.env.UNPAYWALL_EMAIL = "codex@example.com";

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://api.openalex.org/works")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W123",
              display_name: "Graph Retrieval Beyond Preprints",
              publication_year: 2024,
              publication_date: "2024-06-01",
              doi: "https://doi.org/10.1145/1234567.1234568",
              primary_location: {
                landing_page_url: "https://example.org/paper",
                pdf_url: "https://example.org/paper.pdf",
                source: {
                  display_name: "Advances in Neural Information Processing Systems",
                  type: "conference",
                },
              },
              authorships: [{ author: { display_name: "Alice Example" } }],
              cited_by_count: 42,
              type_crossref: "proceedings-article",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target.startsWith("https://api.crossref.org/works")) {
      return new Response(
        JSON.stringify({
          message: {
            items: [
              {
                DOI: "10.1145/1234567.1234568",
                title: ["Graph Retrieval Beyond Preprints"],
                URL: "https://doi.org/10.1145/1234567.1234568",
                type: "proceedings-article",
                "container-title": ["Advances in Neural Information Processing Systems"],
                author: [{ given: "Alice", family: "Example" }],
                issued: { "date-parts": [[2024, 6, 1]] },
                "is-referenced-by-count": 50,
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target.startsWith("https://api.semanticscholar.org/graph/v1/paper/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              paperId: "s2:paper-1",
              title: "Graph Retrieval Beyond Preprints",
              venue: "NeurIPS",
              year: 2024,
              authors: [{ name: "Alice Example" }],
              externalIds: { DOI: "10.1145/1234567.1234568" },
              openAccessPdf: { url: "https://example.org/paper.pdf" },
              citationCount: 55,
              publicationTypes: ["Conference"],
              url: "https://semanticscholar.org/paper-1",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target.startsWith("https://dblp.org/search/publ/api")) {
      return new Response(
        JSON.stringify({
          result: {
            hits: {
              hit: [
                {
                  info: {
                    key: "dblp/conf/neurips/example2024",
                    title: "Graph Retrieval Beyond Preprints",
                    venue: "NeurIPS",
                    year: "2024",
                    url: "https://dblp.org/rec/conf/neurips/example2024",
                    doi: "10.1145/1234567.1234568",
                    authors: { author: ["Alice Example"] },
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target.startsWith("https://api.unpaywall.org/v2/")) {
      return new Response(
        JSON.stringify({
          best_oa_location: {
            url: "https://example.org/paper",
            url_for_pdf: "https://example.org/paper.pdf",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target === "https://example.org/paper.pdf") {
      return new Response(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, "A")]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    throw new Error(`Unhandled fetch URL in test: ${target}`);
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.UNPAYWALL_EMAIL;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await runBroadPaperSearch({
    projectRoot,
    topic: "graph retrieval beyond preprints",
    providers: ["openalex", "crossref", "semanticscholar", "dblp"],
    maxQueries: 4,
    maxResultsPerQuery: 5,
    maxResolutionAttempts: 3,
  });

  assert.ok(result.queryPlan.length >= 1);
  assert.equal(result.mergedCandidates.length, 1);
  assert.equal(result.mergedCandidates[0].resolutionStatus, "resolved_pdf");
  assert.equal(result.sourceIndexUpdate.updatedCanonicalIds.length, 1);

  const mergedArtifact = JSON.parse(
    await fs.readFile(result.artifacts.mergedCandidatesPath, "utf8")
  );
  assert.equal(mergedArtifact.candidates.length, 1);

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.length, 1);
  assert.equal(sourceIndex.papers[0].resolution_status, "resolved_pdf");

  const stagedPdfPath = sourceIndex.papers[0].source_path;
  const stagedPdf = await fs.readFile(stagedPdfPath);
  assert.ok(stagedPdf.subarray(0, 5).toString("ascii") === "%PDF-");
});

test("broad paper search keeps high-relevance papers and drops noisy high-citation matches from the source index", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "broad-paper-search-filter-"));
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    JSON.stringify(
      {
        project_id: "survey-gcd",
        survey_review: {
          topic: "Generalized Category Discovery v3",
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://api.openalex.org/works")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W123",
              display_name: "Generalized Category Discovery",
              publication_year: 2022,
              publication_date: "2022-06-01",
              doi: "https://doi.org/10.1109/cvpr52688.2022.00734",
              primary_location: {
                landing_page_url: "https://example.org/gcd",
                pdf_url: "https://example.org/gcd.pdf",
                source: {
                  display_name: "Computer Vision and Pattern Recognition",
                  type: "conference",
                },
              },
              authorships: [{ author: { display_name: "Kai Vaze" } }],
              cited_by_count: 150,
              type_crossref: "proceedings-article",
            },
            {
              id: "https://openalex.org/W999",
              display_name: "Anchors: High-Precision Model-Agnostic Explanations",
              publication_year: 2018,
              publication_date: "2018-02-01",
              doi: "https://doi.org/10.1609/aaai.v32i1.11491",
              primary_location: {
                landing_page_url: "https://example.org/anchors",
                pdf_url: "https://example.org/anchors.pdf",
                source: {
                  display_name: "Proceedings of the AAAI Conference on Artificial Intelligence",
                  type: "conference",
                },
              },
              authorships: [{ author: { display_name: "Marco Ribeiro" } }],
              cited_by_count: 2037,
              type_crossref: "proceedings-article",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (target === "https://example.org/gcd.pdf" || target === "https://example.org/anchors.pdf") {
      return new Response(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1024, "B")]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    if (
      target.startsWith("https://api.crossref.org/works") ||
      target.startsWith("https://api.semanticscholar.org/graph/v1/paper/search") ||
      target.startsWith("https://dblp.org/search/publ/api")
    ) {
      return new Response(JSON.stringify({ message: { items: [] }, data: [], result: { hits: { hit: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unhandled fetch URL in test: ${target}`);
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const result = await runBroadPaperSearch({
    projectRoot,
    topic: "Generalized Category Discovery v3",
    providers: ["openalex"],
    maxQueries: 3,
    maxResultsPerQuery: 5,
    maxResolutionAttempts: 3,
  });

  assert.equal(result.mergedCandidates.length >= 2, true);
  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.some((entry) => /Generalized Category Discovery/i.test(entry.title)), true);
  assert.equal(sourceIndex.papers.some((entry) => /Anchors:/i.test(entry.title)), false);
});
