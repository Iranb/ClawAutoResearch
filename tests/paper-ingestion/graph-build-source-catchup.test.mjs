import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  maybeMaterializeGraphBuildPaperSources,
} from "../../tools/graph-build-source-catchup.ts";
import { checkGraphPresenceForWorkflow } from "../../tools/graph-presence.ts";

async function makeProjectRoot() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graph-build-source-catchup-"));
  await fs.mkdir(path.join(projectRoot, "researcher"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "PROJECT_MANIFEST.json"),
    `${JSON.stringify(
      {
        project_id: "source-catchup-demo",
        current_stage: "graph_build",
        owner_agent: "researcher",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return projectRoot;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeFetch(markdown) {
  return async (url) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "text/markdown" : null;
      },
    },
    async text() {
      return markdown;
    },
    async arrayBuffer() {
      return new TextEncoder().encode(markdown).buffer;
    },
    url,
  });
}

function makeBootstrapFetch(markdown) {
  return async (url) => {
    const urlText = String(url);
    const body = urlText.includes("export.arxiv.org/api/query")
      ? `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://arxiv.org/abs/2410.11206v1</id>
    <title>Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning</title>
    <summary>FixMatch generalization analysis for semi-supervised learning.</summary>
  </entry>
</feed>`
      : markdown;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type"
            ? urlText.includes("export.arxiv.org/api/query")
              ? "application/atom+xml"
              : "text/markdown"
            : null;
        },
      },
      async text() {
        return body;
      },
      async arrayBuffer() {
        return new TextEncoder().encode(body).buffer;
      },
      url,
    };
  };
}

async function startFakeRemoteDiscoveryMcpServer(options = {}) {
  const requests = [];
  const importWorkflowPayloads = [...(options.importWorkflowPayloads ?? [])];
  const server = http.createServer(async (request, response) => {
    const bodyChunks = [];
    for await (const chunk of request) {
      bodyChunks.push(chunk);
    }
    const raw = Buffer.concat(bodyChunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      body,
    });

    const toolName = body?.params?.name;
    const args = body?.params?.arguments ?? {};
    let textPayload;
    if (toolName === "literature_discovery") {
      if (options.literatureDiscoveryDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.literatureDiscoveryDelayMs)
        );
      }
      if (options.literatureDiscoveryError) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body?.id ?? 1,
          error: {
            code: -32011,
            message: options.literatureDiscoveryError,
          },
        }));
        return;
      }
      textPayload = {
        contractVersion: "literature-discovery-v1",
        runId: "disc-remote-001",
        generatedAt: "2026-04-24T10:00:00.000Z",
        rootPath: "/srv/papernexus/corpora/GCD",
        topic: args.topic,
        candidates: [
          {
            canonicalId: "arxiv:2501.00001",
            title: "Remote PaperNexus Discovery Paper",
            year: 2025,
            identifiers: {
              arxivId: "2501.00001",
            },
            providers: ["arxiv", "semantic_scholar"],
            source: {
              sourceKind: "pdf",
              sourcePath: "/srv/papernexus/corpora/GCD/.papernexus/discovery/staging/pdf/2501.00001.pdf",
              sourceProvider: "arxiv",
              resolutionStatus: "fulltext_ready",
              fullTextStatus: "open_pdf",
              downloadStatus: "downloaded",
              pdfUrl: "https://arxiv.org/pdf/2501.00001.pdf",
            },
            import: {
              status: "submitted",
              taskId: "task-remote-1",
            },
          },
          {
            canonicalId: "arxiv:2501.99999",
            title: "Remote Metadata Only Discovery Paper",
            year: 2025,
            identifiers: {
              arxivId: "2501.99999",
            },
            providers: ["arxiv"],
            source: {
              sourceKind: "metadata_only",
              sourcePath: "",
              sourceProvider: "",
              resolutionStatus: "metadata_only",
              fullTextStatus: "open_pdf",
              downloadStatus: "eligible",
              pdfUrl: "https://arxiv.org/pdf/2501.99999.pdf",
              supplementation: {
                status: "needed",
                reservedOperation: "supplement",
                acceptedSourceKinds: ["markdown", "pdf"],
                preferredSourceKind: "markdown",
              },
            },
            import: {
              status: "not_submitted",
            },
          },
        ],
        metadataGraph: {
          contractVersion: "literature-discovery-metadata-graph-v1",
          partialPaperCount: 1,
          nodes: [
            {
              id: "paper:arxiv:2501.99999",
              type: "Paper",
              properties: {
                canonicalId: "arxiv:2501.99999",
                partial: true,
              },
            },
          ],
        },
        coverage: {
          verdict: "usable",
          mergedPaperCount: 2,
          resolvedFullTextCount: 1,
          metadataOnlyCount: 1,
          importedCount: 1,
        },
        importSummary: {
          submitted: 1,
          deduped: 0,
          failed: 0,
          results: [
            {
              canonicalId: "arxiv:2501.00001",
              sourcePath: "/srv/papernexus/corpora/GCD/.papernexus/discovery/staging/pdf/2501.00001.pdf",
              status: "submitted",
              taskId: "task-remote-1",
            },
          ],
        },
      };
    } else if (toolName === "import_workflow") {
      textPayload = importWorkflowPayloads.shift() ?? {
        rootPath: "/srv/papernexus/corpora/GCD",
        summary: {
          total: 1,
          pending: 1,
          running: 0,
          completed: 0,
          failed: 0,
          remaining: 1,
          overallPercent: 12,
        },
        tasks: [
          {
            id: "task-remote-1",
            status: "pending",
            progress: { percent: 12 },
          },
        ],
      };
    } else {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: `unexpected tool ${toolName}` }));
      return;
    }

    const payload = {
      jsonrpc: "2.0",
      id: body?.id ?? 1,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(textPayload),
          },
        ],
      },
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert.notEqual(port, null);
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("graph-build source catch-up blocks instead of local fallback when remote discovery fails", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const server = await startFakeRemoteDiscoveryMcpServer({
    literatureDiscoveryError: "Remote MCP request failed: fetch failed",
  });
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal:
        "TOWARDS UNDERSTANDING WHY FIXMATCH GENERALIZES BETTER THAN SUPERVISED LEARNING 这篇论文里提到的方法改进GCD",
    },
    paper_ingestion: {
      runtime_status: "waiting_import",
      queued_requests: [
        {
          request_id: "idea-catalyst-req-computer-science-8-4",
          request_kind: "requisition",
          status: "queued",
          wrapper: "pn_batch_import.py",
          manifest_path: "researcher/idea-catalyst/requisition/req-computer-science-8-4/CATALYST_REQUISITION.json",
          trigger_kind: "idea_catalyst_requisition",
          summary: "IDEA-CATALYST requisition for remote coverage.",
          detail: "Workflow-owned literature requisition must surface remote PaperNexus failures without local fallback.",
          created_at: "2026-04-24T10:20:00.000Z",
          updated_at: "2026-04-24T10:20:00.000Z",
          attempt_count: 0,
        },
      ],
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:30:00.000Z",
    fetchImpl: async () => assert.fail("remote_mcp failure must not fetch literature locally"),
  });

  assert.equal(result.queued, false);
  assert.equal(result.skippedReason, "remote_literature_discovery_failed");
  assert.equal(result.materializedPaperCount, 0);
  assert.match(result.errors.join("\n"), /Remote MCP request failed/);
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "literature_discovery").length,
    1
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.runtime_status, "blocked");
  assert.equal(manifest.paper_ingestion.repair_required, true);
  assert.match(manifest.paper_ingestion.repair_reason, /Remote MCP request failed/);
  const remoteRequest = manifest.paper_ingestion.queued_requests.find(
    (request) => request.request_id === "idea-catalyst-req-computer-science-8-4"
  );
  assert.equal(remoteRequest.status, "needs_repair");
  assert.match(remoteRequest.last_error, /Remote MCP request failed/);
  await assert.rejects(
    fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8"),
    /ENOENT/
  );

  const catchupReport = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json"), "utf8")
  );
  assert.equal(catchupReport.status, "failed");
  assert.equal(catchupReport.skippedReason, "remote_literature_discovery_failed");
  assert.equal(catchupReport.remote_literature_discovery.request_id, result.requestId);

  const receipt = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_GRAPH_BUILD_RECEIPT.json"), "utf8")
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.graph_visibility, "unavailable");
  assert.equal(receipt.source_backed_graph_claim, false);
});

test("graph-build source catch-up classifies remote literature_discovery launch timeouts", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const server = await startFakeRemoteDiscoveryMcpServer({
    literatureDiscoveryError:
      "Remote MCP request failed: The operation was aborted due to timeout",
  });
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal: "Use PaperNexus to find request-specific SQLite index design papers.",
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:35:00.000Z",
    fetchImpl: async () => assert.fail("remote_mcp timeout must not fetch literature locally"),
  });

  assert.equal(result.queued, false);
  assert.equal(result.skippedReason, "remote_literature_discovery_launch_timeout");
  assert.match(result.errors.join("\n"), /launch timed out after 300000ms/);

  const catchupReport = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json"), "utf8")
  );
  assert.equal(catchupReport.status, "failed");
  assert.equal(catchupReport.skippedReason, "remote_literature_discovery_launch_timeout");
  assert.equal(
    catchupReport.remote_literature_discovery.failure_kind,
    "remote_literature_discovery_launch_timeout"
  );
  assert.equal(catchupReport.remote_literature_discovery.configured_timeout_ms, 300000);
});

test("graph-build source catch-up uses a discovery-specific MCP timeout for remote launch", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const previousDiscoveryTimeout = process.env.PAPERNEXUS_DISCOVERY_MCP_TIMEOUT_MS;
  const server = await startFakeRemoteDiscoveryMcpServer({
    literatureDiscoveryDelayMs: 1100,
  });
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    if (previousDiscoveryTimeout === undefined) {
      delete process.env.PAPERNEXUS_DISCOVERY_MCP_TIMEOUT_MS;
    } else {
      process.env.PAPERNEXUS_DISCOVERY_MCP_TIMEOUT_MS = previousDiscoveryTimeout;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";
  process.env.PAPERNEXUS_DISCOVERY_MCP_TIMEOUT_MS = "3000";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal: "Use PaperNexus to find request-specific SQLite index design papers.",
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusMcpTimeoutMs: 1000,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:40:00.000Z",
    fetchImpl: async () => assert.fail("remote_mcp discovery must not fetch literature locally"),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 2);
  assert.equal(result.skippedReason, null);

  const catchupReport = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json"), "utf8")
  );
  assert.equal(catchupReport.remote_literature_discovery.configured_timeout_ms, 3000);
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "literature_discovery").length,
    1
  );
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "import_workflow").length,
    1
  );
});

test("graph-build source catch-up delegates missing research and import to remote PaperNexus literature_discovery", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const server = await startFakeRemoteDiscoveryMcpServer();
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal: "Use PaperNexus to find source-backed papers about robust memory in autoresearch agents.",
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 2);
  assert.equal(result.requestId, "remote-literature-discovery-source-catchup-demo");
  assert.match(result.batchManifestPath, /PAPERNEXUS_LITERATURE_DISCOVERY\.json$/);

  assert.equal(server.requests.length, 2);
  assert.equal(server.requests[0].authorization, "Bearer remote-test-token");
  assert.equal(server.requests[0].body.params.name, "literature_discovery");
  assert.equal(server.requests[0].body.params.arguments.operation, "ingest");
  assert.equal(server.requests[0].body.params.arguments.corpus, "GCD");
  assert.equal(server.requests[0].body.params.arguments.preferMarkdown, true);
  assert.equal(server.requests[0].body.params.arguments.generateArxivMarkdownSources, true);
  assert.equal(server.requests[0].body.params.arguments.processImports, true);
  assert.equal(server.requests[0].body.params.arguments.providerRequestMaxConcurrent, 2);
  assert.equal(server.requests[0].body.params.arguments.discoveryRequestCache, true);
  assert.match(server.requests[0].body.params.arguments.topic, /robust memory/i);
  assert.equal(server.requests[1].body.params.name, "import_workflow");
  assert.deepEqual(server.requests[1].body.params.arguments.taskIds, ["task-remote-1"]);

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.length, 2);
  assert.equal(sourceIndex.papers[0].canonical_id, "arxiv:2501.00001");
  assert.equal(sourceIndex.papers[0].source_provider, "arxiv");
  assert.equal(sourceIndex.papers[0].resolution_status, "resolved_pdf");
  assert.equal(sourceIndex.papers[1].canonical_id, "arxiv:2501.99999");
  assert.equal(sourceIndex.papers[1].source_kind, "metadata_only");
  assert.equal(sourceIndex.papers[1].resolution_status, "metadata_only_unresolved");
  assert.equal(sourceIndex.papers[1].metadata_graph_status, "partial");
  assert.equal(sourceIndex.papers[1].supplementation.reservedOperation, "supplement");
  assert.equal(
    sourceIndex.papers[1].candidate_pdf_url,
    "https://arxiv.org/pdf/2501.99999.pdf"
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.runtime_status, "waiting_import");
  assert.deepEqual(manifest.paper_ingestion.import_task_ids, ["task-remote-1"]);
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "running");
  assert.equal(manifest.paper_ingestion.queued_requests[0].wrapper, "papernexus_remote_mcp");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].last_session_key,
    "papernexus:remote_mcp:literature_discovery"
  );
  assert.match(
    manifest.paper_ingestion.queued_requests[0].validation_report_path,
    /PAPERNEXUS_LITERATURE_DISCOVERY\.json$/
  );
  const discoveryArtifact = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        manifest.paper_ingestion.queued_requests[0].validation_report_path
      ),
      "utf8"
    )
  );
  assert.equal(discoveryArtifact.candidates.length, 2);
  assert.deepEqual(discoveryArtifact.remote_task_ids, ["task-remote-1"]);
  assert.equal(discoveryArtifact.metadataGraph.partialPaperCount, 1);
  assert.equal(discoveryArtifact.local_metadata_graph_summary.partialPaperCount, 1);

  const catchupReport = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json"), "utf8")
  );
  assert.equal(catchupReport.status, "queued");
  assert.equal(catchupReport.remote_literature_discovery.run_id, "disc-remote-001");
  assert.deepEqual(catchupReport.remote_literature_discovery.import_task_ids, [
    "task-remote-1",
  ]);
  assert.equal(catchupReport.remote_literature_discovery.metadata_graph.partialPaperCount, 1);

  const receipt = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_GRAPH_BUILD_RECEIPT.json"), "utf8")
  );
  assert.equal(receipt.status, "waiting_import");
  assert.equal(receipt.graph_visibility, "unverified");
  assert.equal(receipt.source_backed_count, 1);
  assert.equal(receipt.metadata_only_count, 1);
  assert.equal(receipt.task_summary.remaining, 1);
});

test("graph-build source catch-up honors manifest remote_mcp config without local fallback", async (t) => {
  const projectRoot = await makeProjectRoot();
  const server = await startFakeRemoteDiscoveryMcpServer();
  t.after(async () => {
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "manifest-remote-source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal: "Use PaperNexus to find source-backed papers for remote-only graph build.",
    },
    paper_ingestion: {
      papernexus_access_mode: "remote_mcp",
      papernexus_mcp_url: server.url,
      papernexus_shared_corpus: "GCD",
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "manifest-remote-source-catchup-demo",
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: async () => assert.fail("manifest remote_mcp config must not use local fetch fallback"),
  });

  assert.equal(result.queued, true);
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "literature_discovery").length,
    1
  );
  assert.equal(server.requests[0].body.params.arguments.corpus, "GCD");

  const receipt = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_GRAPH_BUILD_RECEIPT.json"), "utf8")
  );
  assert.equal(receipt.status, "waiting_import");
  assert.equal(receipt.corpus, "GCD");
});

test("graph-build source catch-up treats queued remote_mcp requests as remote-only", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
      project_id: "queued-remote-source-catchup-demo",
      current_stage: "graph_build",
      owner_agent: "researcher",
      paper_ingestion: {
        runtime_status: "blocked",
        repair_required: true,
        repair_reason: "socket.timeout",
        queued_requests: [
          {
            request_id: "req-remote-upload",
            request_kind: "upload_manifest",
            status: "needs_repair",
            wrapper: "papernexus_remote_mcp",
            command_text:
              "papernexus:remote_mcp:graph_build",
            created_at: "2026-04-24T10:00:00.000Z",
            updated_at: "2026-04-24T10:01:00.000Z",
            last_error: "socket.timeout",
            validation_status: "valid",
          },
      ],
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "queued-remote-source-catchup-demo",
    now: "2026-04-24T10:05:00.000Z",
    fetchImpl: async () =>
      assert.fail("queued remote PaperNexus requests must not use local fetch fallback"),
  });

  assert.equal(result.attempted, true);
  assert.equal(result.queued, false);
  assert.equal(result.skippedReason, "remote_papernexus_mcp_unconfigured");
  assert.match(result.errors.join("\n"), /Remote PaperNexus MCP URL is not configured/);

  const receipt = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_GRAPH_BUILD_RECEIPT.json"), "utf8")
  );
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.graph_visibility, "unavailable");
});

test("graph-build source catch-up sends source-index papers as remote discovery seeds", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const server = await startFakeRemoteDiscoveryMcpServer();
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal: "Map confirmation bias mitigation papers for generalized category discovery.",
    },
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "doi:10.1234/seed.paper",
        doi: "10.1234/seed.paper",
        title: "Seed Paper with DOI Only",
        venue: "SeedConf",
        year: 2025,
        resolution_status: "metadata_only_unresolved",
      },
      {
        canonical_id: "arxiv:2502.00002",
        arxiv_id: "2502.00002",
        title: "Seed Paper with arXiv Identifier",
        pdf_url: "https://arxiv.org/pdf/2502.00002.pdf",
        resolution_status: "metadata_only_unresolved",
      },
    ],
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: async () => assert.fail("remote_mcp discovery must not fetch literature locally"),
  });

  assert.equal(result.queued, true);
  const request = server.requests.find((entry) => entry.body.params.name === "literature_discovery");
  assert.ok(request);
  const args = request.body.params.arguments;
  assert.equal(args.operation, "ingest");
  assert.equal(args.corpus, "GCD");
  assert.equal(args.preferMarkdown, true);
  assert.equal(args.generateArxivMarkdownSources, true);
  assert.equal(args.processImports, true);
  assert.equal(args.seedPapers.length, 2);
  assert.deepEqual(
    args.seedPapers.map((entry) => entry.title),
    ["Seed Paper with DOI Only", "Seed Paper with arXiv Identifier"]
  );
  assert.equal(args.seedPapers[0].doi, "10.1234/seed.paper");
  assert.equal(args.seedPapers[1].arxivId, "2502.00002");
  assert.deepEqual(args.seedPapers[1].sourceHints, [
    "https://arxiv.org/pdf/2502.00002.pdf",
  ]);
  assert.equal(args.maxCandidates, 12);
  assert.equal(args.maxDownloads, 6);
});

test("graph-build source catch-up polls existing remote discovery imports without resubmitting discovery", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const server = await startFakeRemoteDiscoveryMcpServer({
    importWorkflowPayloads: [
      {
        rootPath: "/srv/papernexus/corpora/GCD",
        summary: {
          total: 1,
          pending: 1,
          running: 0,
          completed: 0,
          failed: 0,
          remaining: 1,
          overallPercent: 12,
        },
        tasks: [
          {
            id: "task-remote-1",
            status: "pending",
            progress: { percent: 12 },
          },
        ],
      },
      {
        rootPath: "/srv/papernexus/corpora/GCD",
        summary: {
          total: 1,
          pending: 0,
          running: 0,
          completed: 1,
          failed: 0,
          remaining: 0,
          overallPercent: 100,
        },
        tasks: [
          {
            id: "task-remote-1",
            status: "completed",
            progress: { percent: 100 },
          },
        ],
      },
      {
        rootPath: "/srv/papernexus/corpora/GCD",
        summary: {
          total: 1,
          pending: 0,
          running: 0,
          completed: 1,
          failed: 0,
          remaining: 0,
          overallPercent: 100,
        },
        tasks: [
          {
            id: "task-remote-1",
            status: "completed",
            progress: { percent: 100 },
          },
        ],
      },
    ],
  });
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal: "Use PaperNexus to find source-backed papers about robust memory in autoresearch agents.",
    },
  });

  await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  const sourceIndexPath = path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
  const staleSourceIndex = JSON.parse(await fs.readFile(sourceIndexPath, "utf8"));
  staleSourceIndex.papers.push({
    canonical_id: "arxiv:2501.99999",
    arxiv_id: "2501.99999",
    title: "Remote Metadata Only Discovery Paper",
    source_provider: "arxiv",
    pdf_url: "https://arxiv.org/pdf/2501.99999.pdf",
    retrieval_providers: ["arxiv", "papernexus-literature-discovery"],
    resolution_status: "unknown",
  });
  await writeJson(sourceIndexPath, staleSourceIndex);

  const second = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:02:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "literature_discovery").length,
    1
  );
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "import_workflow").length,
    2
  );
  assert.equal(second.queued, false);
  assert.equal(second.skippedReason, "remote_literature_discovery_imports_terminal");

  const refreshedSourceIndex = JSON.parse(await fs.readFile(sourceIndexPath, "utf8"));
  assert.deepEqual(
    refreshedSourceIndex.papers.map((entry) => entry.canonical_id),
    ["arxiv:2501.00001", "arxiv:2501.99999"]
  );
  assert.equal(
    refreshedSourceIndex.papers.find((entry) => entry.canonical_id === "arxiv:2501.99999")
      .supplementation.reservedOperation,
    "supplement"
  );

  refreshedSourceIndex.papers.push({
    canonical_id: "arxiv:2501.99999",
    arxiv_id: "2501.99999",
    title: "Remote Metadata Only Discovery Paper",
    source_provider: "arxiv",
    pdf_url: "https://arxiv.org/pdf/2501.99999.pdf",
    retrieval_providers: ["arxiv", "papernexus-literature-discovery"],
    resolution_status: "unknown",
  });
  await writeJson(sourceIndexPath, refreshedSourceIndex);

  const third = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:04:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(third.queued, false);
  assert.equal(third.skippedReason, "remote_literature_discovery_imports_terminal");
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "literature_discovery").length,
    1
  );
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "import_workflow").length,
    3
  );
  const finalSourceIndex = JSON.parse(await fs.readFile(sourceIndexPath, "utf8"));
  assert.deepEqual(
    finalSourceIndex.papers.map((entry) => entry.canonical_id),
    ["arxiv:2501.00001", "arxiv:2501.99999"]
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.runtime_status, "waiting_graph");
  assert.equal(manifest.paper_ingestion.queued_requests[0].status, "completed");

  const artifact = JSON.parse(
    await fs.readFile(
      path.join(
        projectRoot,
        manifest.paper_ingestion.queued_requests[0].validation_report_path
      ),
      "utf8"
    )
  );
  assert.equal(artifact.last_polled_at, "2026-04-24T10:04:00.000Z");
  assert.equal(artifact.remote_queue_progress.summary.completed, 1);
});

test("graph-build source catch-up refreshes remote artifacts linked from active requisitions", async (t) => {
  const projectRoot = await makeProjectRoot();
  const previousToken = process.env.PAPERNEXUS_TEST_TOKEN;
  const server = await startFakeRemoteDiscoveryMcpServer({
    importWorkflowPayloads: [
      {
        rootPath: "/srv/papernexus/corpora/GCD",
        summary: {
          total: 1,
          pending: 0,
          running: 0,
          completed: 1,
          failed: 0,
          remaining: 0,
          overallPercent: 100,
          sequence: 7,
          last_event_at: "2026-04-24T10:04:30.000Z",
        },
        tasks: [
          {
            id: "task-existing-1",
            status: "completed",
            progress: { percent: 100 },
          },
        ],
      },
    ],
  });
  t.after(async () => {
    if (previousToken === undefined) {
      delete process.env.PAPERNEXUS_TEST_TOKEN;
    } else {
      process.env.PAPERNEXUS_TEST_TOKEN = previousToken;
    }
    await server.close();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  process.env.PAPERNEXUS_TEST_TOKEN = "remote-test-token";

  const catalystRequisitionPath =
    "researcher/idea-catalyst/requisition/req-active/CATALYST_REQUISITION.json";
  const failedSatisfactionPath =
    "researcher/idea-catalyst/requisition/req-active/REQUISITION_SATISFACTION_REPORT.json";
  const remoteArtifactPath =
    "researcher/literature-discovery/remote/disc-existing/PAPERNEXUS_LITERATURE_DISCOVERY.json";
  await writeJson(path.join(projectRoot, catalystRequisitionPath), {
    catalyst_requisition: {
      search_queries: [
        {
          domain: "computer science",
          query: "CPU-only graph labeling with source-backed evidence",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, failedSatisfactionPath), {
    status: "failed",
    decision: "needs_repair_missing_requisition_import_evidence",
    request_id: "req-active",
    remote_literature_discovery: {
      artifact_path: remoteArtifactPath,
    },
  });
  await writeJson(path.join(projectRoot, remoteArtifactPath), {
    contractVersion: "literature-discovery-v1",
    runId: "disc-existing",
    local_request_id: "req-active",
    topic: "CPU-only graph labeling with source-backed evidence",
    candidates: [
      {
        canonicalId: "arxiv:2601.00001",
        title: "Existing Remote Discovery Paper",
        year: 2026,
        identifiers: {
          arxivId: "2601.00001",
        },
        providers: ["arxiv"],
        source: {
          sourceKind: "pdf",
          sourcePath:
            "/srv/papernexus/corpora/GCD/.papernexus/discovery/staging/pdf/2601.00001.pdf",
          sourceProvider: "arxiv",
          resolutionStatus: "fulltext_ready",
          fullTextStatus: "open_pdf",
          downloadStatus: "downloaded",
          pdfUrl: "https://arxiv.org/pdf/2601.00001.pdf",
        },
        import: {
          status: "submitted",
          taskId: "task-existing-1",
        },
      },
    ],
    coverage: {
      verdict: "usable",
      mergedPaperCount: 1,
      resolvedFullTextCount: 1,
      metadataOnlyCount: 0,
      importedCount: 1,
    },
    importSummary: {
      submitted: 1,
      deduped: 0,
      failed: 0,
      results: [
        {
          canonicalId: "arxiv:2601.00001",
          status: "submitted",
          taskId: "task-existing-1",
        },
      ],
    },
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      runtime_status: "waiting_import",
      last_batch_manifest_path: remoteArtifactPath,
      queued_requests: [
        {
          request_id: "req-active",
          request_kind: "requisition",
          status: "running",
          wrapper: "papernexus_remote_mcp",
          manifest_path: catalystRequisitionPath,
          validation_report_path: failedSatisfactionPath,
          trigger_kind: "idea_catalyst_requisition",
          summary: "Active requisition with already-returned remote discovery artifact.",
          created_at: "2026-04-24T10:00:00.000Z",
          updated_at: "2026-04-24T10:02:00.000Z",
          started_at: "2026-04-24T10:00:00.000Z",
          last_run_id: "disc-existing",
          attempt_count: 1,
        },
      ],
    },
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusAccessMode: "remote_mcp",
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: server.url,
      papernexusApiTokenSource: "env",
      papernexusApiTokenEnv: "PAPERNEXUS_TEST_TOKEN",
    },
    now: "2026-04-24T10:05:00.000Z",
    fetchImpl: async () =>
      assert.fail("remote_mcp requisition refresh must not use local fetch fallback"),
  });

  assert.equal(result.queued, false);
  assert.equal(result.skippedReason, "remote_literature_discovery_imports_terminal");
  assert.equal(result.batchManifestPath, remoteArtifactPath);
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "literature_discovery").length,
    0
  );
  assert.equal(
    server.requests.filter((entry) => entry.body.params.name === "import_workflow").length,
    1
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const request = manifest.paper_ingestion.queued_requests[0];
  assert.equal(request.status, "completed");
  assert.equal(request.manifest_path, catalystRequisitionPath);
  assert.equal(request.validation_report_path, remoteArtifactPath);
  assert.equal(request.queue_progress.sequence, 7);
  assert.equal(request.queue_progress.last_event_at, "2026-04-24T10:04:30.000Z");
  assert.equal(request.queue_progress.completed, 1);
  assert.equal(manifest.paper_ingestion.last_batch_manifest_path, remoteArtifactPath);

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.deepEqual(
    sourceIndex.papers.map((entry) => entry.canonical_id),
    ["arxiv:2601.00001"]
  );
  const artifact = JSON.parse(
    await fs.readFile(path.join(projectRoot, remoteArtifactPath), "utf8")
  );
  assert.equal(artifact.last_polled_at, "2026-04-24T10:05:00.000Z");
  assert.equal(artifact.remote_queue_progress.summary.completed, 1);
});

test("graph-build source catch-up materializes planned arXiv markdown and queues PaperNexus import", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2410.11206.md",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture represents a substantive full-text paper source for graph ingestion.
It includes enough text to avoid stub detection and contains paper-like sections.

## Introduction

${"FixMatch generalization, semi-supervised learning, augmentation consistency, and generalized category discovery are discussed with enough methodological detail. ".repeat(20)}

## Method

${"The method analysis connects unlabeled-data regularization to improved category separation and decision-boundary stability. ".repeat(20)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T09:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 1);
  const stagedMarkdown = await fs.readFile(
    path.join(projectRoot, "researcher", "paper-staging", "md", "2410.11206.md"),
    "utf8"
  );
  assert.match(stagedMarkdown, /^# Towards Understanding Why FixMatch/);
  assert.match(stagedMarkdown, /## Method/);

  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.equal(batchManifest.defaults.corpus, "GCD");
  assert.equal(batchManifest.papers.length, 1);
  assert.equal(
    batchManifest.papers[0].source,
    path.join(projectRoot, "researcher", "paper-staging", "md", "2410.11206.md")
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.runtime_status, "waiting_import");
  assert.equal(manifest.paper_ingestion.queued_requests.length, 1);
  assert.equal(manifest.paper_ingestion.queued_requests[0].wrapper, "pn_batch_import.py");
  assert.equal(
    manifest.paper_ingestion.queued_requests[0].trigger_kind,
    "graph_build_source_catchup"
  );
  assert.match(
    manifest.paper_ingestion.queued_requests[0].command_text,
    /skills\/researcher\/papernexus\/scripts\/pn_batch_import\.py/
  );

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");
  assert.equal(sourceIndex.papers[0].source_provider, "hugging-face-paper-pages");
  assert.equal(sourceIndex.papers[0].resolution_status, "resolved_markdown");
});

test("graph-build source catch-up lets remote PaperNexus discover corpus when no shared corpus is configured", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2410.11206.md",
        import_status: "pending",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      repair_target_corpus: "shared-global-graph",
    },
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture is long enough for import validation and includes real paper sections.

## Method

${"The staged source discusses semi-supervised consistency, pseudo-label stability, and GCD method transfer. ".repeat(35)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T09:30:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.defaults, {});

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const queued = manifest.paper_ingestion.queued_requests[0];
  assert.equal(queued.shared_corpus, null);
  assert.equal(manifest.paper_ingestion.repair_target_corpus, null);
  assert.equal(queued.args.includes("--corpus"), false);
  assert.deepEqual(
    queued.args.slice(0, 2),
    ["--mcp-url", "http://127.0.0.1:9123/mcp"]
  );
});

test("graph-build source catch-up preserves manifest locked shared corpus for remote imports", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2603.21852",
        arxiv_id: "2603.21852",
        title: "All elementary functions from a single binary operator",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2603.21852.md",
        import_status: "pending",
      },
    ],
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    paper_ingestion: {
      locked_shared_corpus: "EML",
      graph_presence_status: "missing_papers",
    },
  });

  const markdown = `# All elementary functions from a single binary operator

## Abstract

This fixture stands in for the EML operator paper and contains enough full-text
material for source validation.

## Method

${"The EML operator is discussed with safe-domain constraints, residual integration, and small-model validation details. ".repeat(35)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
      papernexusSshTarget: "hyq@10.126.56.30",
      papernexusRemoteStagingRoot: "/tmp/papernexus-import-staging",
    },
    now: "2026-04-24T09:45:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.equal(batchManifest.defaults.corpus, "EML");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  const queued = manifest.paper_ingestion.queued_requests[0];
  assert.equal(queued.shared_corpus, "EML");
  assert.match(queued.command_text, /--corpus EML/);
  assert.match(queued.command_text, /--ssh-target hyq@10\.126\.56\.30/);
  assert.match(queued.command_text, /--remote-staging-root \/tmp\/papernexus-import-staging/);
});

test("graph-build source catch-up resolves researcher md_path through paper-staging", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "2201.02609.md"
  );
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Generalized Category Discovery\n\n## Abstract\n\nThis fixture has substantive staged markdown. ".repeat(40),
    "utf8"
  );
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        arxiv_id: "2201.02609",
        title: "Generalized Category Discovery",
        source_provider: "arxiv2md-api",
        md_path: "md/2201.02609.md",
        import_status: "staged",
      },
    ],
  });

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
    },
    now: "2026-04-24T09:00:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 1);
  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.papers.map((entry) => entry.source), [
    stagedMarkdownPath,
  ]);
});

test("graph-build source catch-up rebuilds a missing source index from staged markdown", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "2410.11206.md"
  );
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    `## Abstract

Abstract Semi-supervised learning, FixMatch, and semantic-aware feature learning motivate this staged paper source.

## Introduction

${"FixMatch generalization and generalized category discovery are connected through semantic coverage, pseudo-label confidence, and novel-class clustering. ".repeat(28)}

## Method

${"The staged source is already substantive, so graph-build should reconstruct PAPER_SOURCE_INDEX.json instead of waiting for an agent-authored index. ".repeat(24)}
`,
    "utf8"
  );

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
    },
    now: "2026-04-24T09:00:00.000Z",
    fetchImpl: makeFetch("# Unused\n\n## Abstract\n\n" + "unused ".repeat(200)),
  });

  assert.equal(result.queued, true);
  assert.equal(result.sourceIndexPath, path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"));
  assert.equal(result.materializedPaperCount, 1);

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.length, 1);
  assert.equal(sourceIndex.papers[0].arxiv_id, "2410.11206");
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");

  const batchManifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, result.batchManifestPath), "utf8")
  );
  assert.deepEqual(batchManifest.papers.map((entry) => entry.source), [
    stagedMarkdownPath,
  ]);
});

test("graph-build source catch-up bootstraps a missing source index from the project topic", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    research_program: {
      goal:
        "TOWARDS UNDERSTANDING WHY FIXMATCH GENERALIZES BETTER THAN SUPERVISED LEARNING 这篇论文里提到的方法改进GCD",
    },
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture represents a substantive full-text paper source recovered from a topic-only no-Discord project.

## Introduction

${"The no-Discord graph build bootstrap should resolve the topic paper, fetch a source, and queue PaperNexus import without waiting for a Discord-bound researcher handoff. ".repeat(24)}

## Method

${"FixMatch analysis, pseudo-label confidence, semantic regularization, and generalized category discovery adaptation provide enough content for graph ingestion. ".repeat(24)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T09:30:00.000Z",
    fetchImpl: makeBootstrapFetch(markdown),
  });

  assert.equal(result.queued, true);
  assert.equal(result.materializedPaperCount, 1);
  assert.equal(result.sourceIndexPath, path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"));

  const sourceIndex = JSON.parse(
    await fs.readFile(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), "utf8")
  );
  assert.equal(sourceIndex.papers.length, 1);
  assert.equal(sourceIndex.papers[0].arxiv_id, "2410.11206");
  assert.equal(sourceIndex.papers[0].source_path, "researcher/paper-staging/md/2410.11206.md");
  assert.equal(sourceIndex.papers[0].resolution_status, "resolved_markdown");
  assert.equal(sourceIndex.papers[0].retrieval_providers.includes("bootstrap-topic"), true);

  const catchupReport = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "GRAPH_BUILD_SOURCE_CATCHUP.json"), "utf8")
  );
  assert.equal(catchupReport.bootstrap_source_index_entry_count, 1);
  assert.equal(catchupReport.materialized_sources[0].arxiv_id, "2410.11206");
});

test("graph presence treats missing planned staging paths as missing sources", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "arxiv_api",
        retrieval_providers: ["arxiv_api"],
        staging_path: "researcher/paper-staging/md/2410.11206.md",
        import_status: "pending",
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });
  assert.equal(result.status, "missing_sources");
  assert.equal(result.repairRequired, false);
  assert.equal(result.graphBuildWorkflowStatus, "blocked");
  assert.equal(result.graphBuildCanContinue, false);
  assert.equal(result.graphBuildRequiresSourceRepair, true);
  assert.match(result.refreshReason ?? "", /PDF\/Markdown source/i);

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "PROJECT_MANIFEST.json"), "utf8")
  );
  assert.equal(manifest.paper_ingestion.graph_build_workflow_status, "blocked");
  assert.equal(manifest.paper_ingestion.graph_build_can_continue, false);
  assert.equal(manifest.paper_ingestion.graph_build_requires_source_repair, true);

  const papernexusStatus = JSON.parse(
    await fs.readFile(path.join(projectRoot, "graph", "PAPERNEXUS_STATUS.json"), "utf8")
  );
  assert.equal(papernexusStatus.graph_build_workflow_status, "blocked");
  assert.equal(papernexusStatus.graph_build_can_continue, false);

  const graphBuildReport = await fs.readFile(
    path.join(projectRoot, "graph", "GRAPH_BUILD_REPORT.md"),
    "utf8"
  );
  assert.match(graphBuildReport, /Graph Build Workflow Status: blocked/);
});

test("graph presence ignores metadata-only source-index candidates when source-backed papers exist", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  const stagedMarkdownPath = path.join(
    projectRoot,
    "researcher",
    "paper-staging",
    "md",
    "2410.11206.md"
  );
  await fs.mkdir(path.dirname(stagedMarkdownPath), { recursive: true });
  await fs.writeFile(
    stagedMarkdownPath,
    "# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning\n\n## Abstract\n\n" +
      "Substantive staged source. ".repeat(80),
    "utf8"
  );

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        source_provider: "filesystem",
        source_path: "researcher/paper-staging/md/2410.11206.md",
        resolution_status: "resolved_markdown",
      },
      {
        canonical_id: "doi:10.1016/j.drudis.2018.05.036",
        doi: "10.1016/j.drudis.2018.05.036",
        title: "Why breast cancer signatures are no better than random signatures explained",
        source_provider: "crossref",
        resolution_status: "metadata_only_unresolved",
      },
    ],
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.expectedPaperCount, 1);
  assert.equal(result.missingPapers.length, 1);
  assert.equal(result.missingPapers[0].canonicalId, "arxiv:2410.11206");
});

test("graph presence matches PaperNexus corpus identifiers when source paths are canonicalized", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const sourceRoot = path.join(projectRoot, "papernexus-corpus", "GCD");
  await writeJson(path.join(projectRoot, "PROJECT_MANIFEST.json"), {
    project_id: "source-catchup-demo",
    current_stage: "graph_build",
    owner_agent: "researcher",
    papernexus_corpus: "GCD",
    papernexus_root: sourceRoot,
  });
  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2504.09343",
        arxiv_id: "2504.09343",
        title: "Expected Graph Paper",
        source_provider: "arxiv",
        source_path: "https://arxiv.org/pdf/2504.09343.pdf",
        resolution_status: "resolved_pdf",
      },
    ],
  });
  await writeJson(path.join(sourceRoot, ".papernexus", "sources.json"), {
    version: 3,
    corpusName: "GCD",
    rootPath: sourceRoot,
    sources: [
      {
        sourceKey: "/remote/corpora/GCD/pdf/imported-source-a.pdf",
        inputPath: "/remote/corpora/GCD/pdf/imported-source-a.pdf",
        sourcePath: "/remote/corpora/GCD/pdf/imported-source-a.pdf",
        paperId: "paper:b1f34837e5a0",
        paperTitle: "Imported PaperNexus Paper",
        activeInGraph: true,
        identifiers: {
          arxivId: "2504.09343v1",
        },
      },
    ],
  });
  await writeJson(path.join(sourceRoot, ".papernexus", "meta.json"), {
    name: "GCD",
    rootPath: sourceRoot,
    paperCount: 1,
    sourceCount: 1,
  });

  const result = await checkGraphPresenceForWorkflow({ projectRoot });

  assert.equal(result.status, "ready");
  assert.equal(result.presentPaperCount, 1);
  assert.equal(result.missingPaperCount, 0);
  assert.equal(result.presentPapers[0].matchedBy, "arxiv");
  assert.equal(result.presentPapers[0].corpusPaperId, "paper:b1f34837e5a0");
});

test("graph-build source catch-up materializes metadata-only canonical_papers without duplicate queue requests", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    canonical_papers: [
      {
        canonical_id: "arxiv:2604.14762",
        arxiv_id: "2604.14762",
        title: "OmniGCD: Abstracting Generalized Category Discovery for Modality Agnosticism",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# OmniGCD: Abstracting Generalized Category Discovery for Modality Agnosticism

## Abstract

This fixture represents a substantive full-text source for a metadata-only canonical paper.

## Introduction

${"Generalized category discovery needs stable pseudo-label transfer, unlabeled calibration, and cross-modal evidence grounded in full paper sources. ".repeat(24)}

## Method

${"The method section contains enough source content for staged import validation and graph-build catch-up. ".repeat(24)}
`;

  const first = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(first.queued, true);
  assert.equal(first.materializedPaperCount, 1);
  assert.equal(first.requestId.startsWith("graph-build-source-catchup-"), true);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion.queued_requests[0].status = "completed";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const sourceIndexPath = path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
  const sourceIndex = JSON.parse(await fs.readFile(sourceIndexPath, "utf8"));
  sourceIndex.papers[0].import_status = "pending";
  sourceIndex.papers[0].staging_path = sourceIndex.papers[0].source_path;
  await writeJson(sourceIndexPath, sourceIndex);

  const second = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T10:05:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(second.queued, false);
  assert.equal(second.skippedReason, "source_catchup_already_completed");
  assert.equal(second.requestId, first.requestId);

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length, 1);
});

test("graph-build source catch-up requeues a completed request when graph presence becomes missing again", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    canonical_papers: [
      {
        canonical_id: "arxiv:2604.14762",
        arxiv_id: "2604.14762",
        title: "OmniGCD: Abstracting Generalized Category Discovery for Modality Agnosticism",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# OmniGCD: Abstracting Generalized Category Discovery for Modality Agnosticism

## Abstract

This fixture represents a substantive full-text source for a metadata-only canonical paper.

## Introduction

${"Generalized category discovery needs stable pseudo-label transfer, unlabeled calibration, and cross-modal evidence grounded in full paper sources. ".repeat(24)}

## Method

${"The method section contains enough source content for staged import validation and graph-build catch-up. ".repeat(24)}
`;

  const first = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T10:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(first.queued, true);
  assert.equal(first.materializedPaperCount, 1);

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion.queued_requests[0].status = "completed";
  manifest.paper_ingestion.queued_requests[0].finished_at = "2026-04-24T10:03:00.000Z";
  manifest.paper_ingestion.queued_requests[0].last_error = "Previous import exhausted.";
  manifest.paper_ingestion.queued_requests[0].attempt_count = 3;
  manifest.paper_ingestion.queued_requests[0].dead_letter_at = "2026-04-24T10:03:00.000Z";
  manifest.paper_ingestion.queued_requests[0].dead_letter_reason = "Remote corpus missing.";
  manifest.paper_ingestion.queued_requests[0].validation_status = "warning";
  manifest.paper_ingestion.queued_requests[0].validation_report_path =
    "graph/paper-ingestion-validation/stale-report.json";
  manifest.paper_ingestion.graph_presence_status = "missing_corpus";
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const sourceIndexPath = path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json");
  const sourceIndex = JSON.parse(await fs.readFile(sourceIndexPath, "utf8"));
  sourceIndex.papers[0].import_status = "pending";
  sourceIndex.papers[0].staging_path = sourceIndex.papers[0].source_path;
  await writeJson(sourceIndexPath, sourceIndex);

  const second = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T10:05:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(second.queued, true);
  assert.equal(second.skippedReason, null);
  assert.equal(second.requestId, first.requestId);

  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const request = updatedManifest.paper_ingestion.queued_requests.find(
    (entry) => entry.request_id === first.requestId
  );
  assert.equal(request.status, "queued");
  assert.equal(request.created_at, "2026-04-24T10:05:00.000Z");
  assert.equal(request.finished_at, null);
  assert.equal(request.last_error, null);
  assert.equal(request.attempt_count, 0);
  assert.equal(request.dead_letter_at, null);
  assert.equal(request.dead_letter_reason, null);
  assert.equal(request.validation_status, "unknown");
  assert.equal(request.validation_report_path, null);

  request.status = "needs_repair";
  request.finished_at = "2026-04-24T10:05:30.000Z";
  request.last_error = "Local MCP URLs are disabled.";
  request.attempt_count = 1;
  request.validation_status = "valid";
  request.validation_report_path = "graph/paper-ingestion-validation/local-url.json";
  await fs.writeFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8");

  const third = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://papernexus.example/mcp",
    },
    now: "2026-04-24T10:06:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(third.queued, true);
  assert.equal(third.skippedReason, null);
  assert.equal(third.requestId, first.requestId);

  const repairedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const repairedRequest = repairedManifest.paper_ingestion.queued_requests.find(
    (entry) => entry.request_id === first.requestId
  );
  assert.equal(repairedRequest.status, "queued");
  assert.equal(repairedRequest.created_at, "2026-04-24T10:06:00.000Z");
  assert.equal(repairedRequest.finished_at, null);
  assert.equal(repairedRequest.last_error, null);
  assert.equal(repairedRequest.attempt_count, 0);
  assert.equal(repairedRequest.validation_status, "unknown");
  assert.equal(repairedRequest.validation_report_path, null);
});

test("graph-build source catch-up can recover past unrelated needs-repair import requests", async (t) => {
  const projectRoot = await makeProjectRoot();
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.paper_ingestion = {
    queued_requests: [
      {
        request_id: "agent-authored-broken-manifest",
        status: "needs_repair",
        wrapper: "pn_batch_import.py",
        manifest_path: "researcher/paper-staging/broken-batch-import.json",
      },
    ],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeJson(path.join(projectRoot, "researcher", "PAPER_SOURCE_INDEX.json"), {
    papers: [
      {
        canonical_id: "arxiv:2410.11206",
        arxiv_id: "2410.11206",
        title: "Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning",
        import_status: "pending",
      },
    ],
  });

  const markdown = `# Towards Understanding Why FixMatch Generalizes Better Than Supervised Learning

## Abstract

This fixture represents a substantive full-text source for repair recovery.

## Introduction

${"The staged repair path should queue a workflow-owned import even when an older agent-authored import request needs repair. ".repeat(24)}

## Method

${"The method discussion supplies enough body text for source validation and graph ingestion. ".repeat(24)}
`;

  const result = await maybeMaterializeGraphBuildPaperSources({
    projectRoot,
    projectId: "source-catchup-demo",
    workflowPolicy: {
      papernexusSharedCorpus: "GCD",
      papernexusMcpUrl: "http://127.0.0.1:9123/mcp",
    },
    now: "2026-04-24T11:00:00.000Z",
    fetchImpl: makeFetch(markdown),
  });

  assert.equal(result.queued, true);
  const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(updatedManifest.paper_ingestion.queued_requests.length, 2);
  assert.equal(
    updatedManifest.paper_ingestion.queued_requests[1].trigger_kind,
    "graph_build_source_catchup"
  );
});
