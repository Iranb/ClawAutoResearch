import type {
  BuildDynamicTasksDeps,
  BuildDynamicTasksParams,
  GuidanceContribution,
} from "./types";

export function buildPapernexusGuidance(
  params: BuildDynamicTasksParams,
  deps: BuildDynamicTasksDeps
): GuidanceContribution {
  const prepend: string[] = [];
  const append: string[] = [];
  const paperIngestion = deps.asRecord(params.manifest?.paper_ingestion);
  const paperIngestionState = deps.normalizePaperIngestionState(paperIngestion);

  if (
    params.role === "researcher" &&
    (paperIngestion?.refresh_required === true ||
      (typeof paperIngestion?.new_files_since_graph === "number" &&
        paperIngestion.new_files_since_graph > 0))
  ) {
    prepend.push(
      "PaperNexus automatic graph catch-up is pending; run /graph-build or /papernexus to refresh readiness status and the brainstorm bundle before the next novelty or planning decision."
    );
  }

  if (params.role === "researcher" && paperIngestionState.runtimeStatus === "waiting_import") {
    prepend.push(
      `Paper ingestion is waiting on remote import completion${paperIngestionState.waitingReason ? `: ${paperIngestionState.waitingReason}` : "."} Continue only bounded non-novelty work until the import tasks finish.`
    );
    prepend.push(
      "Upload-progress rule: never guess PaperNexus status from elapsed time. Poll `import_workflow` status/wait (or `pn_import_queue.py status` / `pn_batch_import.py status` in compatibility mode), then persist the returned `progress` and `queue_progress` fields through `research_workflow.set_paper_ingestion` so `PAPERNEXUS_PROGRESS.json` stays truthful."
    );
  }
  if (params.role === "researcher" && paperIngestionState.runtimeStatus === "waiting_graph") {
    prepend.push(
      `Paper ingestion is waiting on automatic graph catch-up${paperIngestionState.waitingReason ? `: ${paperIngestionState.waitingReason}` : "."} Do not finalize novelty-sensitive reasoning until the shared graph reflects the new papers and the brainstorm bundle is refreshed.`
    );
  }
  if (params.role === "researcher" && paperIngestionState.runtimeStatus === "reconciling") {
    prepend.push(
      `Paper ingestion is catching up to a newer shared graph version${paperIngestionState.waitingReason ? `: ${paperIngestionState.waitingReason}` : "."} Refresh the affected brainstorm/topic packets before advancing novelty-sensitive work.`
    );
  }

  const graphPresenceStatus = deps.normalizeGraphPresenceStatus(
    paperIngestion?.graph_presence_status ?? paperIngestion?.graphPresenceStatus
  );
  if (
    params.role === "researcher" &&
    ["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "") &&
    graphPresenceStatus !== null &&
    graphPresenceStatus !== "ready"
  ) {
    const missingSummary = deps.summarizeGraphPresenceMissing(paperIngestion);
    prepend.push(
      `Graph presence is not ready (${graphPresenceStatus}); run research_workflow.check_graph_presence and refresh graph readiness plus the brainstorm bundle via /graph-build before novelty-sensitive work${missingSummary ? ` (${missingSummary})` : ""}.`
    );
  }
  if (
    params.role === "researcher" &&
    paperIngestionState.repairRequired &&
    ["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "")
  ) {
    prepend.push(
      `Graph sync repair is required${paperIngestionState.repairReason ? `: ${paperIngestionState.repairReason}` : "."} ${deps.buildGraphImportRepairGuidance(paperIngestionState.repairTargetCorpus)}`
    );
  }

  const resolvedAccessMode =
    typeof params.papernexusAccessMode === "string" &&
    ["remote_api", "remote_mcp", "local_mcp"].includes(params.papernexusAccessMode)
      ? params.papernexusAccessMode
      : params.papernexusMcpUrl
        ? "remote_mcp"
        : params.papernexusApiBaseUrl
          ? "remote_api"
        : null; // "auto" or unresolved — guidance will cover both paths

  if (
    params.role === "researcher" &&
    (["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "") ||
      paperIngestion?.refresh_required === true) &&
    (params.papernexusApiBaseUrl ||
      params.papernexusMcpUrl ||
      params.papernexusApiTokenEnv ||
      params.papernexusMineruHttpUrl)
  ) {
    if (resolvedAccessMode === "local_mcp") {
      prepend.push(
        "PaperNexus access mode is local_mcp. Use the PaperNexus MCP server tools (`query`, `context`, `impact`, `ideas`, `brainstorm`, `domain_distance`, `extract_takeaways`, `interdisciplinary_potential`, `mutate_graph`) for all graph operations. Do not use Python wrapper scripts in this mode."
      );
    } else if (resolvedAccessMode === "remote_mcp") {
      prepend.push(
        `PaperNexus access mode is remote_mcp. Use the configured remote PaperNexus HTTP MCP endpoint at ${params.papernexusMcpUrl ?? "unset"} (${params.papernexusMcpTransport ?? "streamable-http"}) for live graph operations. Authenticate with the configured bearer token source at runtime and do not print or persist the raw token.`
      );
      prepend.push(
        "Remote MCP rule: the MCP-first tool mapping is `research_lookup` for query/context/impact/ideas/brainstorm, `research_briefing` for research-brief/brainstorm-brief/path-trace/evidence-chain/reflection-chain/theory-brief/storyline-brief, `idea_catalyst` for cross-domain ideation packets, and `import_workflow` for queued import/status/wait flows. Prefer those remote HTTP MCP tools or their thin wrappers, and do not treat `pn_graph_query.py` / `pn_research_chains.py` as a separate non-MCP control plane."
      );
      prepend.push(
        "Remote-only storage rule: do not depend on local PaperNexus storage under `~/.papernexus/papers` or `~/.papernexus/index-store`. Use project-local staging files plus the configured remote MCP endpoint instead."
      );
    } else {
      prepend.push(
        `PaperNexus access mode is remote_api compatibility mode. Use the configured remote access for shared-graph work: api=${params.papernexusApiBaseUrl ?? "unset"}, token_source=${params.papernexusApiTokenSource ?? "unset"}, token_env=${params.papernexusApiTokenEnv ?? "unset"}, keychain_service=${params.papernexusApiTokenService ?? "unset"}, keychain_account=${params.papernexusApiTokenAccount ?? "unset"}, mineru_http=${params.papernexusMineruHttpUrl ?? "unset"}. Drive compatibility work through the queued wrappers (\`pn_stage_sync.py\`, \`pn_import_submit.py\`, \`pn_import_queue.py\`, \`pn_batch_import.py\`, \`pn_graph_query.py\`, \`pn_research_chains.py\`), and resolve the token at runtime only; do not paste secrets into chat, prompts, or project files.`
      );
      prepend.push(
        "Compatibility-mode rule: remote_api is a fallback for environments without remote MCP. If a remote MCP endpoint becomes available, prefer `research_lookup`, `research_briefing`, `idea_catalyst`, and `import_workflow` over direct wrapper-first graph work."
      );
      prepend.push(
        "Remote-only storage rule: do not depend on local PaperNexus storage under `~/.papernexus/papers` or `~/.papernexus/index-store`. Use project-local staging files plus the compatibility wrappers instead."
      );
      prepend.push(
        "Do not read the live shared graph through local PaperNexus live-graph CLI reads or hand-written curl calls. In compatibility mode, live-graph reads must still use the authenticated wrappers rather than raw `/api/*`."
      );
    }
  }

  if (
    params.role === "researcher" &&
    ["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "")
  ) {
    if (resolvedAccessMode === "remote_mcp") {
      prepend.push(
        "For each novelty-sensitive topic, summarize the topic, use the configured remote HTTP MCP tool family (`research_lookup`, `research_briefing`, and `idea_catalyst` as needed) for graph-grounded reasoning, and persist a reconciled chain bundle with research_workflow.run_brainstorm_cycle so logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet stay durable."
      );
    } else {
      prepend.push(
        "For each novelty-sensitive topic, summarize the topic, launch the authenticated compatibility wrappers (`pn_graph_query.py` / `pn_research_chains.py`) only when remote MCP is unavailable, and persist a reconciled chain bundle with research_workflow.run_brainstorm_cycle so logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet stay durable."
      );
    }
    prepend.push(
      "Brainstorm cycle rule: you may run multiple brainstorm rounds with competing options, but in aggressive auto mode you must persist every candidate and let the highest-scoring option become the selected durable bundle."
    );
    prepend.push(
      "If new PDFs or Markdown arrive through a UI/API upload, queue the PaperNexus import wrappers from project-local staging through `research_workflow.queue_paper_ingestion`: one paper may use `pn_stage_sync.py` -> `pn_import_submit.py` -> `pn_import_queue.py`, while 2+ papers should use `pn_batch_import.py` with one manifest. The workflow PaperNexus upload worker owns launching and retrying queued requests; agents should not run upload wrappers inline or clear queued_requests by hand."
    );
    if (resolvedAccessMode === "remote_mcp") {
      prepend.push(
        "For ideation and frontier work, prefer the configured remote MCP graph tools over raw full-graph inspection. Use `research_lookup`, `research_briefing`, and `idea_catalyst` before trusting raw prominence, and reserve wrapper-based import staging only for queued upload flows backed by `import_workflow`."
      );
    } else {
      prepend.push(
        "For ideation and frontier work, prefer the brainstorm-quality PaperNexus node view and authenticated compatibility wrappers over raw full-graph inspection. Use `pn_graph_query.py` / `pn_research_chains.py` only when remote MCP is unavailable, and otherwise migrate this workflow to `research_lookup` / `research_briefing`."
      );
    }
  }

  return { prepend, append };
}
