import * as path from "node:path";
import { randomUUID } from "node:crypto";

type WorkflowRoleLike =
  | "researcher"
  | "planner"
  | "orchestrator"
  | "coder"
  | "analyzer"
  | "academic_writer"
  | "reviewer"
  | "cross-reviewer";

type WorkflowMailboxItemLike = {
  id: string;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  kind: "handoff" | "blocker" | "request" | "note";
  priority: "low" | "normal" | "high";
  status: "pending" | "acknowledged";
  createdAt: string;
  acknowledgedAt?: string;
};

type WorkflowMailboxStoreLike = {
  schemaVersion: 1;
  updatedAt: string;
  messages: WorkflowMailboxItemLike[];
};

type WorkflowContactEventLike = {
  fromAgent: string;
  toAgent: string;
  channel: "mailbox" | "sessions_send" | "sessions_spawn";
  createdAt: string;
};

type WorkflowContactStoreLike = {
  schemaVersion: 1;
  updatedAt: string;
  events: WorkflowContactEventLike[];
};

type PartialWorkflowSnapshotLike = {
  role?: WorkflowRoleLike | null;
  recommendedOwner?: WorkflowRoleLike | null;
  currentStage?: string | null;
  channelProjectBindingDepth?: number | null;
  channelProjectBindingWorkflowSessionKey?: string | null;
};

function normalizeMailboxText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function parseAutoIteratorMailboxStage(subject: string): string | null {
  const match = subject.match(/^auto-iterator:\s+(.+?)\s+owner handoff$/i);
  return match?.[1]?.trim() || null;
}

function parseAutoIteratorMailboxSignals(body: string): string[] {
  const line = body
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /^missing stage signals:/i.test(entry));
  if (!line) {
    return [];
  }
  return line
    .replace(/^missing stage signals:\s*/i, "")
    .split(/\s*;\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function equivalentSignalLists(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalizedLeft = [...left].map(normalizeMailboxText).sort();
  const normalizedRight = [...right].map(normalizeMailboxText).sort();
  return normalizedLeft.every((entry, index) => entry === normalizedRight[index]);
}

export function getMailboxPath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "workflow-mailbox.json");
}

export async function readMailbox(params: {
  projectRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<WorkflowMailboxStoreLike> {
  const mailboxPath = getMailboxPath(params.projectRoot);
  const existing = await params.readJsonIfExists<WorkflowMailboxStoreLike>(mailboxPath);
  if (existing && Array.isArray(existing.messages)) {
    return existing;
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    messages: [],
  };
}

export async function saveMailbox(params: {
  projectRoot: string;
  mailbox: WorkflowMailboxStoreLike;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<void> {
  params.mailbox.updatedAt = new Date().toISOString();
  await params.writeJsonEnsured(getMailboxPath(params.projectRoot), params.mailbox);
}

export function getContactStatePath(projectRoot: string): string {
  return path.join(projectRoot, ".openclaw-research", "workflow-contact-log.json");
}

export async function readContactStore(params: {
  projectRoot: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<WorkflowContactStoreLike> {
  const contactPath = getContactStatePath(params.projectRoot);
  const existing = await params.readJsonIfExists<WorkflowContactStoreLike>(contactPath);
  if (existing && Array.isArray(existing.events)) {
    return existing;
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
    events: [],
  };
}

export async function saveContactStore(params: {
  projectRoot: string;
  store: WorkflowContactStoreLike;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<void> {
  params.store.updatedAt = new Date().toISOString();
  params.store.events = params.store.events.slice(-500);
  await params.writeJsonEnsured(getContactStatePath(params.projectRoot), params.store);
}

export async function queueWorkflowMailboxMessageImpl(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  subject: string;
  body: string;
  kind?: string;
  priority?: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<WorkflowMailboxItemLike> {
  const mailbox = await readMailbox({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
  const normalizedSubject = params.subject.trim();
  const normalizedBody = params.body.trim();
  const existingPending = mailbox.messages.find(
    (message) =>
      message.status === "pending" &&
      message.fromAgent === params.fromAgent &&
      message.toAgent === params.toAgent &&
      message.kind ===
        (params.kind === "handoff" ||
        params.kind === "blocker" ||
        params.kind === "request" ||
        params.kind === "note"
          ? params.kind
          : "note") &&
      normalizeMailboxText(message.subject) === normalizeMailboxText(normalizedSubject) &&
      normalizeMailboxText(message.body) === normalizeMailboxText(normalizedBody)
  );
  if (existingPending) {
    return existingPending;
  }
  const item: WorkflowMailboxItemLike = {
    id: randomUUID(),
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    subject: normalizedSubject,
    body: normalizedBody,
    kind:
      params.kind === "handoff" ||
      params.kind === "blocker" ||
      params.kind === "request" ||
      params.kind === "note"
        ? params.kind
        : "note",
    priority:
      params.priority === "high" || params.priority === "low" || params.priority === "normal"
        ? params.priority
        : "normal",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  mailbox.messages.push(item);
  mailbox.messages = mailbox.messages.slice(-500);
  await saveMailbox({
    projectRoot: params.projectRoot,
    mailbox,
    writeJsonEnsured: params.writeJsonEnsured,
  });
  return item;
}

export async function getWorkflowContactCooldownImpl(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  cooldownSeconds: number;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
}): Promise<{
  blocked: boolean;
  remainingSeconds: number;
  lastEvent: WorkflowContactEventLike | null;
}> {
  if (params.cooldownSeconds <= 0) {
    return {
      blocked: false,
      remainingSeconds: 0,
      lastEvent: null,
    };
  }

  const store = await readContactStore({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
  const lastEvent =
    [...store.events]
      .reverse()
      .find(
        (event) =>
          event.fromAgent === params.fromAgent && event.toAgent === params.toAgent
      ) ?? null;

  if (!lastEvent) {
    return {
      blocked: false,
      remainingSeconds: 0,
      lastEvent: null,
    };
  }

  const elapsedMs = Date.now() - (Date.parse(lastEvent.createdAt) || 0);
  const remainingSeconds = Math.max(
    0,
    Math.ceil((params.cooldownSeconds * 1000 - elapsedMs) / 1000)
  );

  return {
    blocked: remainingSeconds > 0,
    remainingSeconds,
    lastEvent,
  };
}

export async function recordWorkflowContactEventImpl(params: {
  projectRoot: string;
  fromAgent: string;
  toAgent: string;
  channel: "mailbox" | "sessions_send" | "sessions_spawn";
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
}): Promise<void> {
  const store = await readContactStore({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
  store.events.push({
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    channel: params.channel,
    createdAt: new Date().toISOString(),
  });
  await saveContactStore({
    projectRoot: params.projectRoot,
    store,
    writeJsonEnsured: params.writeJsonEnsured,
  });
}

export async function acknowledgeWorkflowMailboxMessageImpl(params: {
  projectRoot: string;
  messageId: string;
  agentId?: string;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  writeJsonEnsured: (targetPath: string, value: unknown) => Promise<void>;
  normalizeRole: (value: unknown) => WorkflowRoleLike | null;
}): Promise<WorkflowMailboxItemLike | null> {
  const mailbox = await readMailbox({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
  const item = mailbox.messages.find((message) => message.id === params.messageId);
  if (!item) {
    return null;
  }
  const role = params.normalizeRole(params.agentId);
  if (role && item.toAgent !== role && item.toAgent !== "*") {
    throw new Error("Mailbox message is not addressed to this agent.");
  }
  item.status = "acknowledged";
  item.acknowledgedAt = new Date().toISOString();
  await saveMailbox({
    projectRoot: params.projectRoot,
    mailbox,
    writeJsonEnsured: params.writeJsonEnsured,
  });
  return item;
}

export async function readWorkflowMailboxForAgentImpl(params: {
  projectRoot: string;
  agentId?: string;
  limit?: number;
  includeAcknowledged?: boolean;
  readJsonIfExists: <T>(targetPath: string) => Promise<T | null>;
  normalizeRole: (value: unknown) => WorkflowRoleLike | null;
}): Promise<WorkflowMailboxItemLike[]> {
  const mailbox = await readMailbox({
    projectRoot: params.projectRoot,
    readJsonIfExists: params.readJsonIfExists,
  });
  const role = params.normalizeRole(params.agentId);
  if (!role) {
    return [];
  }
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 20;
  return mailbox.messages
    .filter((item) => item.toAgent === role || item.toAgent === "*")
    .filter((item) => params.includeAcknowledged === true || item.status === "pending")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function inboxForRole(params: {
  mailbox: WorkflowMailboxStoreLike | null;
  role: WorkflowRoleLike | null;
  limit: number;
}): WorkflowMailboxItemLike[] {
  if (!params.mailbox || !params.role) {
    return [];
  }
  return params.mailbox.messages
    .filter(
      (item) =>
        item.status === "pending" && (item.toAgent === params.role || item.toAgent === "*")
    )
    .sort((left, right) => {
      const leftPriority = left.priority === "high" ? 0 : left.priority === "normal" ? 1 : 2;
      const rightPriority = right.priority === "high" ? 0 : right.priority === "normal" ? 1 : 2;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.createdAt.localeCompare(right.createdAt);
    })
    .slice(0, params.limit);
}

export function filterStaleAutoIteratorMailboxItems(params: {
  items: WorkflowMailboxItemLike[];
  currentStage?: string | null;
  missingStageSignals?: string[];
}): WorkflowMailboxItemLike[] {
  const currentStage = params.currentStage?.trim() || null;
  const currentSignals = (params.missingStageSignals ?? []).map((entry) => entry.trim()).filter(Boolean);
  return params.items.filter((item) => {
    if (item.kind !== "handoff" || !/^auto-iterator:/i.test(item.subject)) {
      return true;
    }
    const mailboxStage = parseAutoIteratorMailboxStage(item.subject);
    if (currentStage && mailboxStage && mailboxStage !== currentStage) {
      return false;
    }
    const mailboxSignals = parseAutoIteratorMailboxSignals(item.body);
    if (mailboxSignals.length === 0) {
      return currentSignals.length === 0;
    }
    return equivalentSignalLists(mailboxSignals, currentSignals);
  });
}

export function buildNonOwnerRoutingAdvice(
  snapshot: PartialWorkflowSnapshotLike
): string[] {
  if (!snapshot.role || !snapshot.recommendedOwner || snapshot.role === snapshot.recommendedOwner) {
    return [];
  }
  const depthLabel =
    typeof snapshot.channelProjectBindingDepth === "number"
      ? ` (depth ${snapshot.channelProjectBindingDepth})`
      : "";
  const runtimePathHint = snapshot.channelProjectBindingWorkflowSessionKey
    ? `Persistent runtime session: ${snapshot.channelProjectBindingWorkflowSessionKey}${depthLabel}.`
    : "Persistent runtime session: not yet bound; establish or recover the workflow runtime session before continuing.";
  return [
    `Owner gate: you are not the stage owner. ${snapshot.recommendedOwner} must lead substantive ${snapshot.currentStage ?? "current-stage"} work.`,
    `Non-owner rule: if the user asks you to continue this stage, do not perform the stage work yourself. Give a brief status update, then route through the workflow runtime/orchestrator path first; use ${snapshot.recommendedOwner} handoff only as a compatibility fallback when runtime context is unavailable.`,
    runtimePathHint,
    `Stale handoff rule: if chat text or a previous agent says the stage was handed to you, but Workflow Guard still lists ${snapshot.recommendedOwner} as the owner, treat that handoff as pending/stale. Do not claim a stage transition, do not start owner-only work, and do not present yourself as the active owner yet.`,
    "Non-owner response rule: you may summarize completed work, report current status, or handle bounded background tasks explicitly listed below, but you must not claim that you are now executing the owner-only phase.",
  ];
}

export function getSharedWritingConstitutionLines(role: string | null): string[] {
  const lines = [
    "Shared writing constitution: final paper prose must read as a cohesive academic narrative, not as a pile of isolated facts or bullet dumps.",
    "Shared writing constitution: maintain formal academic tone, precise terminology, and consistent terminology across the manuscript.",
    "Shared writing constitution: use proper paragraphs in manuscript prose unless the task explicitly asks for an outline or checklist.",
    "Shared writing constitution: one paragraph = one message; the first sentence should state the paragraph role or topic sentence.",
    "Shared writing constitution: each paragraph should build on the previous one with smooth transitions and explicit sentence relations such as cause, contrast, consequence, refinement, or example.",
    "Shared writing constitution: define terms before reuse, preserve meaning and hedging during revision, and integrate evidence into the narrative instead of listing disconnected facts.",
  ];
  if (role === "reviewer" || role === "cross-reviewer") {
    lines.push(
      "Shared writing constitution review rule: review against the shared writing constitution. Flag broken topic sentences, weak paragraph-to-paragraph flow, terminology drift, unsupported transitions, and bullet-dump prose."
    );
  } else {
    lines.push(
      "Shared writing constitution execution rule: draft and revise until the prose satisfies the shared writing constitution, and bridge to the next paragraph or section whenever possible."
    );
  }
  return lines;
}

export async function maybeQueueAutoIteratorMailboxImpl(params: {
  projectRoot: string;
  fromRole: WorkflowRoleLike | null;
  toRole: WorkflowRoleLike | null;
  stage: string | null;
  nextAction: string | null;
  missingStageSignals: string[];
  cooldownSeconds: number;
}, deps: {
  canRoleContact: (fromRole: WorkflowRoleLike | null, toRole: WorkflowRoleLike | null) => boolean;
  getWorkflowContactCooldown: (params: {
    projectRoot: string;
    fromAgent: string;
    toAgent: string;
    cooldownSeconds: number;
  }) => Promise<{ blocked: boolean; remainingSeconds: number; lastEvent: WorkflowContactEventLike | null }>;
  queueWorkflowMailboxMessage: (params: {
    projectRoot: string;
    fromAgent: string;
    toAgent: string;
    subject: string;
    body: string;
    kind?: string;
    priority?: string;
  }) => Promise<WorkflowMailboxItemLike>;
  recordWorkflowContactEvent: (params: {
    projectRoot: string;
    fromAgent: string;
    toAgent: string;
    channel: "mailbox" | "sessions_send" | "sessions_spawn";
  }) => Promise<void>;
}): Promise<{
  queued: boolean;
  messageId: string | null;
  cooldownRemainingSeconds: number | null;
}> {
  if (!params.fromRole || !params.toRole || params.fromRole === params.toRole) {
    return { queued: false, messageId: null, cooldownRemainingSeconds: null };
  }
  if (!deps.canRoleContact(params.fromRole, params.toRole)) {
    return { queued: false, messageId: null, cooldownRemainingSeconds: null };
  }
  const cooldown = await deps.getWorkflowContactCooldown({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    cooldownSeconds: params.cooldownSeconds,
  });
  if (cooldown.blocked) {
    return {
      queued: false,
      messageId: null,
      cooldownRemainingSeconds: cooldown.remainingSeconds,
    };
  }
  const item = await deps.queueWorkflowMailboxMessage({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    subject: `auto-iterator: ${params.stage ?? "workflow"} owner handoff`,
    body: [
      `Please resume ${params.stage ?? "the workflow"} stage.`,
      params.nextAction ? `Next action: ${params.nextAction}` : null,
      params.missingStageSignals.length > 0
        ? `Missing stage signals: ${params.missingStageSignals.join("; ")}`
        : "Stage completion signals are satisfied; advance the stage work and update durable state.",
    ].filter(Boolean).join("\n"),
    kind: "handoff",
    priority: "high",
  });
  await deps.recordWorkflowContactEvent({
    projectRoot: params.projectRoot,
    fromAgent: params.fromRole,
    toAgent: params.toRole,
    channel: "mailbox",
  });
  return { queued: true, messageId: item.id, cooldownRemainingSeconds: null };
}
