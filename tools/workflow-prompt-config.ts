import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export type WorkflowPromptConfig = Record<string, unknown>;

export const DEFAULT_WORKFLOW_PROMPT_CONFIG_FILE = "workflow-prompts.config.json";
export const WORKFLOW_PROMPT_CONFIG_ENV = "CLAW_AUTO_RESEARCH_PROMPT_CONFIG";

type PromptConfigCacheEntry = {
  filePath: string;
  mtimeMs: number;
  config: WorkflowPromptConfig;
};

let promptConfigCache: PromptConfigCacheEntry | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveConfiguredPath(configPath: string | null | undefined, cwd: string): string | null {
  const raw = readString(configPath);
  if (!raw) {
    return null;
  }
  const expanded = raw.startsWith("~/")
    ? path.join(process.env.HOME ?? "", raw.slice(2))
    : raw;
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findDefaultPromptConfigPath(cwd: string): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(cwd, DEFAULT_WORKFLOW_PROMPT_CONFIG_FILE),
    path.join(moduleDir, "..", DEFAULT_WORKFLOW_PROMPT_CONFIG_FILE),
    path.join(moduleDir, "..", "..", DEFAULT_WORKFLOW_PROMPT_CONFIG_FILE),
    path.join(moduleDir, DEFAULT_WORKFLOW_PROMPT_CONFIG_FILE),
  ];
  return candidates.find(fileExists) ?? null;
}

export function readWorkflowPromptConfigPath(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return (
    readString(record.workflowPromptConfigPath) ??
    readString(record.promptConfigPath) ??
    readString(record.promptsConfigPath)
  );
}

export function loadWorkflowPromptConfig(params: {
  configPath?: string | null;
  cwd?: string | null;
} = {}): WorkflowPromptConfig {
  const cwd = readString(params.cwd) ?? process.cwd();
  const filePath =
    resolveConfiguredPath(params.configPath, cwd) ??
    resolveConfiguredPath(process.env[WORKFLOW_PROMPT_CONFIG_ENV], cwd) ??
    findDefaultPromptConfigPath(cwd);
  if (!filePath) {
    return {};
  }

  try {
    const stat = fs.statSync(filePath);
    if (
      promptConfigCache &&
      promptConfigCache.filePath === filePath &&
      promptConfigCache.mtimeMs === stat.mtimeMs
    ) {
      return promptConfigCache.config;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const config = asRecord(parsed) ?? {};
    promptConfigCache = {
      filePath,
      mtimeMs: stat.mtimeMs,
      config,
    };
    return config;
  } catch {
    return {};
  }
}

function readPath(root: unknown, pathParts: string[]): unknown {
  let cursor: unknown = root;
  for (const part of pathParts) {
    const record = asRecord(cursor);
    if (!record || !(part in record)) {
      return undefined;
    }
    cursor = record[part];
  }
  return cursor;
}

export function getPromptLines(
  config: WorkflowPromptConfig | null | undefined,
  pathParts: string[],
  fallback: string[]
): string[] {
  const value = readPath(config, pathParts);
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const lines = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return lines.length > 0 ? lines : [...fallback];
}

export function getPromptText(
  config: WorkflowPromptConfig | null | undefined,
  pathParts: string[],
  fallback: string
): string {
  return readString(readPath(config, pathParts)) ?? fallback;
}

function readTemplateValue(values: Record<string, unknown>, key: string): string {
  const value = readPath(values, key.split("."));
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) =>
    readTemplateValue(values, key)
  );
}

export function renderPromptLines(
  lines: string[],
  values: Record<string, unknown>
): string[] {
  return lines.map((line) => renderPromptTemplate(line, values));
}
