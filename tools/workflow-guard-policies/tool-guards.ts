import * as path from "node:path";
import { asString } from "../workflow-guard-core/coercion";
import {
  ROLE_POLICIES,
  type WorkflowRole,
} from "./role-policy";
import {
  isWorkflowSubagentSessionKey,
  looksLikePapernexusHeavyCommand,
  looksLikePapernexusLiveGraphCliReadCommand,
} from "../workflow-subagent-sessions";

export type WorkflowGuardBlockResult = { block: boolean; reason?: string };

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathContainsDatasetSegment(targetPath: string): boolean {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/").toLowerCase();
  return normalized === "datasets" || normalized.includes("/datasets/");
}

function getToolCommandText(toolParams: Record<string, unknown>): string | null {
  return (
    asString(toolParams.command) ??
    asString(toolParams.cmd) ??
    asString(toolParams.script) ??
    asString(toolParams.shellCommand)
  );
}

function getToolPayloadText(toolParams: Record<string, unknown>): string | null {
  const values = uniqueStringList(
    [
      getToolCommandText(toolParams),
      asString(toolParams.message),
      asString(toolParams.text),
      asString(toolParams.content),
      asString(toolParams.body),
      asString(toolParams.prompt),
    ].filter((value): value is string => Boolean(value))
  );
  if (values.length === 0) {
    return null;
  }
  return values.join("\n");
}

function normalizeProjectScopedPath(rawPath: string, projectRoot: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "PROJECTS_STATE.json") {
    return path.join(path.dirname(projectRoot), "PROJECTS_STATE.json");
  }
  if (
    PROJECT_ROOT_FILE_SET.has(normalized) ||
    PROJECT_DIR_HINTS.some((prefix) => normalized.startsWith(prefix))
  ) {
    return path.normalize(path.join(projectRoot, normalized));
  }
  return null;
}

function isLocalPapernexusStoragePath(value: string | null | undefined): boolean {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }
  if (/\bPAPERNEXUS_ROOT\b/i.test(raw)) {
    return true;
  }
  const normalized = raw.replace(/\\/g, "/");
  return /(?:^|[=\s"'`])(?:~|\$HOME|\$\{HOME\}|\/[^\s"'`|;&]*)\/\.papernexus\/(?:papers|index-store)(?:\/|$)/i.test(
    normalized
  );
}

function isRemoteOnlyPapernexusWorkflow(params: {
  apiBaseUrl: string | null | undefined;
  mcpUrl?: string | null | undefined;
}): boolean {
  return Boolean(
    (params.apiBaseUrl && params.apiBaseUrl.trim()) ||
      (params.mcpUrl && params.mcpUrl.trim())
  );
}

const PAPERNEXUS_RAW_HTTP_COMMAND_RE =
  /\b(?:curl|wget|fetch)\b[\s\S]*\/api\/(?:imports|query|context|impact|ideas|brainstorm|path-trace|evidence-chain|reflection-chain|research-brief|brainstorm-brief|theory-brief|storyline-brief|corpus(?:-meta)?|corpora|enhancements|paper-enhancement)(?:\b|\/|\?)/i;

function getExperimentLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, "researcher", "EXPERIMENT_LEDGER.json");
}

function getAllowedAbsolutePaths(params: {
  projectRoot: string;
  role: WorkflowRole;
}): { dirs: string[]; files: string[] } {
  const policy = ROLE_POLICIES[params.role];
  const dirs = policy.allowedProjectDirs.map((dir) => path.join(params.projectRoot, dir));
  const files = policy.allowedProjectFiles.map((file) => path.join(params.projectRoot, file));
  if (policy.allowProjectsStateWrite) {
    files.push(path.join(path.dirname(params.projectRoot), "PROJECTS_STATE.json"));
  }
  return { dirs, files };
}

function commandLikelyMutatesDataset(command: string): boolean {
  const datasetPathAtEnd =
    /(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?(?:["'])?\s*$/i;
  const inPlaceMutation =
    /\b(?:rm|mkdir|touch|chmod|chown)\b[\s\S]*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const inPlacePatch =
    /\b(?:sed\s+-i|perl\s+-pi)\b[\s\S]*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const redirectIntoDataset =
    /(?:^|[\s])>>?\s*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const extractIntoDataset =
    /\b(?:tar|unzip|zip)\b[\s\S]*(?:-C|-d)\s*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?/i;
  const copyLikeIntoDataset =
    /\b(?:cp|mv|rsync|scp|ln|install)\b[\s\S]*(?:[A-Za-z0-9._-]+:)?\/[^\s"'`|;&]*\/datasets(?:\/[^\s"'`|;&]*)?(?:["'])?\s*$/i;

  return (
    inPlaceMutation.test(command) ||
    inPlacePatch.test(command) ||
    redirectIntoDataset.test(command) ||
    extractIntoDataset.test(command) ||
    (copyLikeIntoDataset.test(command) && datasetPathAtEnd.test(command))
  );
}

function uniqueStringList(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

const PROJECT_ROOT_FILE_SET = new Set([
  "PROJECT_MANIFEST.json",
  "TRACK_REGISTRY.json",
  "CLAIM_POLICY.md",
  "README.md",
]);

const PROJECT_DIR_HINTS = [
  "researcher/",
  "orchestrator/",
  "coder/",
  "analyzer/",
  "academic_writer/",
  "reviewer/",
  "cross-reviewer/",
  "graph/",
  "memory/",
  ".openclaw-research/",
];

export function shouldBlockProjectWrite(params: {
  role: WorkflowRole | null;
  projectRoot: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (!params.role || !params.projectRoot) {
    return { block: false };
  }
  if (!["write", "edit"].includes(params.toolName)) {
    return { block: false };
  }

  const rawPath =
    asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
  if (!rawPath) {
    return { block: false };
  }

  const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
  if (!absolutePath) {
    return { block: false };
  }

  const workflowSystemRoot = path.join(params.projectRoot, ".openclaw-research");
  if (isInside(workflowSystemRoot, absolutePath)) {
    return {
      block: true,
      reason:
        "Do not edit workflow mailbox/state files directly. Use the research_workflow plugin tool instead.",
    };
  }

  if (path.normalize(getExperimentLedgerPath(params.projectRoot)) === absolutePath) {
    return {
      block: true,
      reason:
        "Do not hand-edit researcher/EXPERIMENT_LEDGER.json. Use research_workflow.upsert_experiment instead.",
    };
  }

  if (params.role === "cross-reviewer") {
    return {
      block: true,
      reason: "Cross-reviewer is read-only. Return review text instead of writing project files.",
    };
  }

  const allowed = getAllowedAbsolutePaths({
    projectRoot: params.projectRoot,
    role: params.role,
  });
  const allowedByDir = allowed.dirs.some((dir) => isInside(dir, absolutePath));
  const allowedByFile = allowed.files.some(
    (filePath) => path.normalize(filePath) === absolutePath
  );
  if (allowedByDir || allowedByFile) {
    return { block: false };
  }

  return {
    block: true,
    reason: `${params.role} cannot write ${absolutePath}. Stay inside your owned project scope.`,
  };
}

export function shouldBlockCoderDatasetMutation(params: {
  role: WorkflowRole | null;
  projectRoot: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (params.role !== "coder") {
    return { block: false };
  }

  if (["write", "edit"].includes(params.toolName) && params.projectRoot) {
    const rawPath =
      asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
    if (rawPath) {
      const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
      const coderRoot = path.join(params.projectRoot, "coder");
      if (
        absolutePath &&
        pathContainsDatasetSegment(absolutePath) &&
        !isInside(coderRoot, absolutePath)
      ) {
        return {
          block: true,
          reason:
            "Coder must treat dataset directories as read-only. Do not edit files under datasets/; write derived artifacts under {PROJ}/coder/ or remote scratch/results instead.",
        };
      }
    }
  }

  if (params.toolName !== "bash") {
    return { block: false };
  }

  const command = getToolCommandText(params.toolParams);
  if (!command || !pathContainsDatasetSegment(command)) {
    return { block: false };
  }

  if (!commandLikelyMutatesDataset(command)) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "Coder must treat dataset directories as read-only. Do not create, delete, patch, chmod, extract, or sync files into datasets/ from bash; use {PROJ}/coder/, logs/, results/, or remote scratch instead.",
  };
}

export function shouldBlockResearchGraphForce(params: {
  role: WorkflowRole | null;
  currentStage: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (params.role !== "researcher") {
    return { block: false };
  }
  if (!["graph_build", "frontier_mapping", "idea"].includes(params.currentStage ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }

  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText) {
    return { block: false };
  }

  const usesGraphBuildForce = /\/graph-build\b[\s\S]*--force\b/i.test(payloadText);
  const usesPapernexusForce =
    /\bpapernexus\b[\s\S]*\b(?:analyze|materialize|build-graph|optimize|watch|stage1|stage2|stage3|stage4)\b[\s\S]*--force\b/i.test(
      payloadText
    ) ||
    /src\/cli\/index\.js\b[\s\S]*\b(?:analyze|materialize|build-graph|optimize|watch|stage1|stage2|stage3|stage4)\b[\s\S]*--force\b/i.test(
      payloadText
    ) ||
    /--rebuild-pdf-markdown\b/i.test(payloadText);

  if (!usesGraphBuildForce && !usesPapernexusForce) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "During literature graph refresh, do not use --force or --rebuild-pdf-markdown. Keep PaperNexus cache-first and run /graph-build or papernexus analyze without --force; if the graph build still fails, hand the exact cache-first command to the user instead of forcing a rebuild.",
  };
}

export function shouldBlockPapernexusInlineExecution(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  sessionKey: string | null | undefined;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (isWorkflowSubagentSessionKey(params.sessionKey)) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!looksLikePapernexusHeavyCommand(payloadText)) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "PaperNexus-heavy live-graph work must run in a dedicated subagent session to avoid stalling the foreground agent. Prefer the remote HTTP MCP control plane there: `research_lookup`, `research_briefing`, and `idea_catalyst` for graph work, with `import_workflow` or the queued wrappers only for staged import/status flows.",
  };
}

export function shouldBlockPapernexusRawHttpUsage(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText || !PAPERNEXUS_RAW_HTTP_COMMAND_RE.test(payloadText)) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "Workflow-owned PaperNexus live-graph work must use the remote HTTP MCP control plane instead of hand-written curl/fetch REST calls. Prefer `research_lookup`, `research_briefing`, and `idea_catalyst` for graph reads/writes; use `import_workflow` or the queued wrappers (`pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, `pn_batch_import.py`) only for staged import/status flows. This avoids route-shape drift and keeps token handling consistent.",
  };
}

export function shouldBlockPapernexusLiveGraphCliRead(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!looksLikePapernexusLiveGraphCliReadCommand(payloadText)) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "Local papernexus CLI reads against the live shared graph are not allowed in workflow mode. Use the remote HTTP MCP control plane instead (`research_lookup`, `research_briefing`, and `idea_catalyst`), or the authenticated thin wrappers when the workflow is in remote_api compatibility mode.",
  };
}

export function shouldBlockPapernexusLocalGraphProcessing(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  remoteApiBaseUrl?: string | null;
  remoteMcpUrl?: string | null;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (
    !isRemoteOnlyPapernexusWorkflow({
      apiBaseUrl: params.remoteApiBaseUrl,
      mcpUrl: params.remoteMcpUrl,
    })
  ) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText) {
    return { block: false };
  }
  const usesLocalGraphProcessing =
    /\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:analyze|materialize|build-graph|merge-graph|write-index|llm-optimize|optimize|watch|stage1|stage2|stage3|stage4)\b/i.test(
      payloadText
    );
  if (!usesLocalGraphProcessing) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      `Local PaperNexus graph processing is disabled when remote PaperNexus access is configured (${params.remoteApiBaseUrl ?? params.remoteMcpUrl ?? "configured remote endpoint"}). ` +
      "Use the configured remote API or remote MCP endpoint instead of local `papernexus` / `src/cli/index.js` graph-processing commands.",
  };
}

export function shouldBlockPapernexusLocalStorageUsage(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
  remoteApiBaseUrl?: string | null;
  remoteMcpUrl?: string | null;
}): WorkflowGuardBlockResult {
  if (
    !params.role ||
    !isRemoteOnlyPapernexusWorkflow({
      apiBaseUrl: params.remoteApiBaseUrl,
      mcpUrl: params.remoteMcpUrl,
    })
  ) {
    return { block: false };
  }

  if (["read", "write", "edit", "grep", "glob"].includes(params.toolName)) {
    const pathCandidates = [
      asString(params.toolParams.path),
      asString(params.toolParams.file_path),
      asString(params.toolParams.cwd),
      asString(params.toolParams.glob),
    ].filter((value): value is string => Boolean(value));
    if (pathCandidates.some((value) => isLocalPapernexusStoragePath(value))) {
      return {
        block: true,
        reason:
          `Workflow-owned automation is remote-only for PaperNexus at ${params.remoteApiBaseUrl ?? params.remoteMcpUrl ?? "the configured remote endpoint"}. Do not read or write local shared storage under ~/.papernexus/papers or ~/.papernexus/index-store; use project-local staging files and the configured remote API/MCP path instead.`,
      };
    }
    return { block: false };
  }

  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText || !isLocalPapernexusStoragePath(payloadText)) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      `Workflow-owned automation is remote-only for PaperNexus at ${params.remoteApiBaseUrl ?? params.remoteMcpUrl ?? "the configured remote endpoint"}. Do not inspect or depend on ~/.papernexus/papers, ~/.papernexus/index-store, or PAPERNEXUS_ROOT; use project-local staging files plus the configured remote API/MCP path instead.`,
  };
}

export function shouldBlockPapernexusMultiPaperImport(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText || !/\/api\/imports(?:[/?\s"'`]|$)/i.test(payloadText)) {
    return { block: false };
  }
  const uploadsMultipleFiles =
    /"files"\s*:\s*\[[\s\S]*?\}\s*,\s*\{/i.test(payloadText) ||
    /'files'\s*:\s*\[[\s\S]*?\}\s*,\s*\{/i.test(payloadText);
  if (!uploadsMultipleFiles) {
    return { block: false };
  }
  return {
    block: true,
    reason:
      "Raw `/api/imports` multi-file bodies are not allowed in workflow mode. Submit one paper per raw import task, or switch to `pn_batch_import.py` with one manifest for multi-paper sync so progress stays durable and visible.",
  };
}

export function shouldBlockPapernexusLongWaitImportCommand(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  const usesRawImportApi = /\/api\/imports(?:[/?\s"'`]|$)/i.test(payloadText ?? "");
  const usesImportQueueWrapper =
    /\bpython\d?\b[\s\S]*\bscripts\/pn_import_queue\.py\b[\s\S]*\bwait\b/i.test(
      payloadText ?? ""
    );
  const usesBatchImportWrapper =
    /\bpython\d?\b[\s\S]*\bscripts\/pn_batch_import\.py\b[\s\S]*\bwait\b/i.test(
      payloadText ?? ""
    );
  if (!payloadText || (!usesRawImportApi && !usesImportQueueWrapper && !usesBatchImportWrapper)) {
    return { block: false };
  }
  const usesLoopWithSleep =
    (/\bwhile\b/i.test(payloadText) ||
      /\buntil\b/i.test(payloadText) ||
      /\bfor\b[\s\S]*\bdo\b/i.test(payloadText)) &&
    /\bsleep\b/i.test(payloadText);
  if (usesLoopWithSleep) {
    return {
      block: true,
      reason:
        "Do not long-poll PaperNexus import tasks in a shell loop. Bound each paper to at most 60s total wait, record timeout state, report it, and move on to the next paper instead of waiting indefinitely.",
    };
  }
  if (usesImportQueueWrapper) {
    const timeoutMatch = payloadText.match(/--timeout(?:=|\s+)(\d+)/i);
    const timeoutSeconds = timeoutMatch
      ? Number.parseInt(timeoutMatch[1] ?? "", 10)
      : Number.NaN;
    if (!Number.isFinite(timeoutSeconds)) {
      return {
        block: true,
        reason:
          "PaperNexus queue waits must set `pn_import_queue.py wait --timeout` and keep each paper within a 60s budget.",
      };
    }
    if (timeoutSeconds > 60) {
      return {
        block: true,
        reason:
          "PaperNexus queue waits must cap each paper at 60s or less. Record timeout state and continue with the next paper instead of waiting longer.",
      };
    }
  }
  if (usesBatchImportWrapper) {
    const timeoutMatch = payloadText.match(/--timeout(?:=|\s+)(\d+)/i);
    const timeoutSeconds = timeoutMatch
      ? Number.parseInt(timeoutMatch[1] ?? "", 10)
      : Number.NaN;
    if (!Number.isFinite(timeoutSeconds)) {
      return {
        block: true,
        reason:
          "PaperNexus batch waits must set `pn_batch_import.py wait --timeout`, keep each workflow wait pass within 60s, and persist batch summary/items before the next pass.",
      };
    }
    if (timeoutSeconds > 60) {
      return {
        block: true,
        reason:
          "PaperNexus batch waits must cap each workflow pass at 60s or less. Persist batch summary/items, report progress, and continue on the next status pass instead of waiting longer.",
      };
    }
  }
  if (usesRawImportApi && /\bcurl\b/i.test(payloadText)) {
    const maxTimeMatch = payloadText.match(/--max-time(?:=|\s+)(\d+)/i);
    const maxTimeSeconds = maxTimeMatch
      ? Number.parseInt(maxTimeMatch[1] ?? "", 10)
      : Number.NaN;
    if (!Number.isFinite(maxTimeSeconds)) {
      return {
        block: true,
        reason:
          "PaperNexus import and import-status requests must set `curl --max-time` and keep each paper within a 60s budget.",
      };
    }
    if (maxTimeSeconds > 60) {
      return {
        block: true,
        reason:
          "PaperNexus import and import-status requests must cap each paper at 60s or less. Record timeout state and continue with the next paper instead of waiting longer.",
      };
    }
  }
  return { block: false };
}

export function shouldBlockPapernexusDestructiveOperation(params: {
  role: WorkflowRole | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (!["researcher", "analyzer"].includes(params.role ?? "")) {
    return { block: false };
  }
  if (!["bash", "sessions_send"].includes(params.toolName)) {
    return { block: false };
  }
  const payloadText = getToolPayloadText(params.toolParams);
  if (!payloadText) {
    return { block: false };
  }

  const usesBackupCommand =
    /\b(?:papernexus|src\/cli\/index\.js)\b[\s\S]*\b(?:backup-export|backup-unpack|backup-load)\b/i.test(
      payloadText
    );
  const deletesSharedStorage =
    /\brm\b[\s\S]*-(?:[A-Za-z]*r[A-Za-z]*f|[A-Za-z]*f[A-Za-z]*r|[A-Za-z]*r|[A-Za-z]*f)\b[\s\S]*(?:~\/|\/)[^\n]*\.papernexus(?:\/[^\s"'`|;&]*)?/i.test(
      payloadText
    ) ||
    /\bfind\b[\s\S]*\.papernexus[\s\S]*\b-delete\b/i.test(payloadText);

  if (!usesBackupCommand && !deletesSharedStorage) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "Do not delete shared PaperNexus graph storage or run backup-export, backup-unpack, or backup-load during normal agent operation. Report the need and wait for an explicit human request before destructive or whole-database archive actions.",
  };
}

export function shouldBlockInnovationWrite(params: {
  projectRoot: string | null;
  role: WorkflowRole | null;
  currentStage: string | null;
  innovationReflectionDue: boolean;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (
    !params.projectRoot ||
    params.role !== "researcher" ||
    params.currentStage !== "idea" ||
    !params.innovationReflectionDue ||
    !["write", "edit"].includes(params.toolName)
  ) {
    return { block: false };
  }

  const rawPath =
    asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
  if (!rawPath) {
    return { block: false };
  }

  const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
  if (!absolutePath) {
    return { block: false };
  }

  const blockedTargets = new Set([
    path.join(params.projectRoot, "researcher", "IDEA_REPORT.md"),
    path.join(params.projectRoot, "researcher", "IDEA_AUDIT.md"),
    path.join(params.projectRoot, "TRACK_REGISTRY.json"),
  ]);

  if (!blockedTargets.has(path.normalize(absolutePath))) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "New experiment evidence has not yet been reflected into PaperNexus-backed innovation reflection. Run /innovation-reflection and refresh researcher/INNOVATION_REFLECTION.md before writing idea outputs.",
  };
}

export function shouldBlockWriterTemplateWrite(params: {
  projectRoot: string | null;
  role: WorkflowRole | null;
  currentStage: string | null;
  writingTemplateRequired: boolean;
  writingTemplateStatus: string | null;
  toolName: string;
  toolParams: Record<string, unknown>;
}): WorkflowGuardBlockResult {
  if (
    !params.projectRoot ||
    params.role !== "academic_writer" ||
    params.currentStage !== "write" ||
    !params.writingTemplateRequired ||
    params.writingTemplateStatus !== "missing" ||
    !["write", "edit"].includes(params.toolName)
  ) {
    return { block: false };
  }

  const rawPath =
    asString(params.toolParams.path) ?? asString(params.toolParams.file_path);
  if (!rawPath) {
    return { block: false };
  }

  const absolutePath = normalizeProjectScopedPath(rawPath, params.projectRoot);
  if (!absolutePath) {
    return { block: false };
  }

  const academicWriterRoot = path.join(params.projectRoot, "academic_writer");
  if (!isInside(academicWriterRoot, path.normalize(absolutePath))) {
    return { block: false };
  }

  return {
    block: true,
    reason:
      "Writer is required to follow a user-provided template, but the configured template is missing. Restore it with research_workflow.set_writing_contract before editing PAPER_PLAN.md or paper sections.",
  };
}
