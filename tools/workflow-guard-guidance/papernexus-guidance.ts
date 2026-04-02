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

  if (
    params.role === "researcher" &&
    (["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "") ||
      paperIngestion?.refresh_required === true) &&
    (params.papernexusApiBaseUrl ||
      params.papernexusApiTokenEnv ||
      params.papernexusMineruHttpUrl)
  ) {
    prepend.push(
      `Use the configured PaperNexus remote access for shared-graph work: api=${params.papernexusApiBaseUrl ?? "unset"}, token_source=${params.papernexusApiTokenSource ?? "unset"}, token_env=${params.papernexusApiTokenEnv ?? "unset"}, keychain_service=${params.papernexusApiTokenService ?? "unset"}, keychain_account=${params.papernexusApiTokenAccount ?? "unset"}, mineru_http=${params.papernexusMineruHttpUrl ?? "unset"}. Drive it through the Python wrappers (\`pn_stage_sync.py\`, \`pn_import_submit.py\`, \`pn_import_queue.py\`, \`pn_batch_import.py\`, \`pn_graph_query.py\`, \`pn_research_chains.py\`); queue upload work through \`research_workflow.queue_paper_ingestion\`, and prefer \`research_workflow.run_papernexus_wrapper\` for live graph / brainstorm reads; resolve the token at runtime only and do not paste secrets into chat, prompts, or project files.`
    );
    prepend.push(
      "Remote-only storage rule: do not depend on local PaperNexus storage under `~/.papernexus/papers` or `~/.papernexus/index-store`. Use project-local staging files plus the PaperNexus Python wrappers instead."
    );
    prepend.push(
      "Do not read the live shared graph through local PaperNexus live-graph CLI reads or hand-written curl calls. In workflow mode, live-graph reads must use `pn_graph_query.py` or `pn_research_chains.py`."
    );
  }

  if (
    params.role === "researcher" &&
    ["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "")
  ) {
    prepend.push(
      "For each novelty-sensitive topic, summarize the topic, launch the typed PaperNexus wrapper commands through `research_workflow.run_papernexus_wrapper` (`pn_graph_query.py` / `pn_research_chains.py`), and persist a reconciled chain bundle with research_workflow.run_brainstorm_cycle so logic_chain, evidence_chain, structured reasoning_trace, question_packet, working_memory, and synthesis_packet stay durable."
    );
    prepend.push(
      "Brainstorm cycle rule: you may run multiple brainstorm rounds with competing options, but in aggressive auto mode you must persist every candidate and let the highest-scoring option become the selected durable bundle."
    );
    prepend.push(
      "If new PDFs or Markdown arrive through a UI/API upload, queue the PaperNexus import wrappers from project-local staging through `research_workflow.queue_paper_ingestion`: one paper may use `pn_stage_sync.py` -> `pn_import_submit.py` -> `pn_import_queue.py`, while 2+ papers should use `pn_batch_import.py` with one manifest. `/graph-build` and `/resume-pipeline` will launch the queued request for you."
    );
    prepend.push(
      "For ideation and frontier work, prefer the brainstorm-quality PaperNexus node view and typed wrapper calls over raw full-graph inspection. Use `research_workflow.run_papernexus_wrapper` with `pn_graph_query.py` and `pn_research_chains.py` for `research-brief`, `brainstorm-brief`, `ideas`, `brainstorm`, and `path-trace` before trusting raw prominence."
    );
  }

  return { prepend, append };
}
