import path from "node:path";

import { readTextIfExists, writeTextEnsured } from "./workflow-guard-core/fs";
import { resolveProjectArtifactPath } from "./workflow-guard-core/paths";
import {
  ROLE_POLICIES,
  type WorkflowRole,
} from "./workflow-guard-policies/role-policy";
import { syncAuthoringArtifactRecovery } from "./research-writing/authoring-artifact-recovery";

export type WorkflowArtifactWriteMode = "replace" | "append";

export type WorkflowArtifactTextWriteResult = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
  mode: WorkflowArtifactWriteMode;
  syncedAuthoringRecovery: boolean;
  changed: boolean;
  changedPaths: string[];
  artifactKinds: string[];
};

function inferArtifactKinds(relativePath: string): string[] {
  const kinds = new Set<string>();
  if (relativePath.startsWith("academic_writer/")) {
    kinds.add("writing");
  }
  if (relativePath.includes("/paper/sections/")) {
    kinds.add("paper_section");
  }
  if (relativePath.endsWith("/paper/main.tex") || relativePath.endsWith("paper/main.tex")) {
    kinds.add("paper_main_tex");
  }
  if (relativePath.endsWith(".tex")) {
    kinds.add("latex");
  }
  if (relativePath.endsWith(".md")) {
    kinds.add("markdown");
  }
  if (relativePath.endsWith(".json")) {
    kinds.add("json");
  }
  if (/figure|caption/i.test(relativePath)) {
    kinds.add("figure_related");
  }
  return [...kinds];
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeArtifactTarget(params: {
  projectRoot: string;
  artifactPath: string;
}): {
  absolutePath: string;
  relativePath: string;
} {
  const projectRoot = path.resolve(params.projectRoot);
  const resolved = resolveProjectArtifactPath(projectRoot, params.artifactPath);
  if (!resolved) {
    throw new Error("artifactPath is required.");
  }
  const absolutePath = path.resolve(resolved);
  if (!isInside(projectRoot, absolutePath)) {
    throw new Error(
      `Artifact path must stay inside the project root. Received: ${params.artifactPath}`
    );
  }
  const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
  if (!relativePath || relativePath === ".") {
    throw new Error("Artifact path must resolve to a project-local file.");
  }
  if (relativePath.startsWith(".openclaw-research/")) {
    throw new Error(
      "Do not hand-edit workflow state files. Use workflow tools for mailbox/state changes."
    );
  }
  if (relativePath.toLowerCase().endsWith(".pdf")) {
    throw new Error("write_text_artifact is text-only and cannot write binary PDFs.");
  }
  return { absolutePath, relativePath };
}

function getAllowedAbsolutePaths(params: {
  projectRoot: string;
  role: WorkflowRole;
}): {
  dirs: string[];
  files: string[];
} {
  const policy = ROLE_POLICIES[params.role];
  const dirs = policy.allowedProjectDirs.map((dir) =>
    path.join(path.resolve(params.projectRoot), dir)
  );
  const files = policy.allowedProjectFiles.map((file) =>
    path.join(path.resolve(params.projectRoot), file)
  );
  if (policy.allowProjectsStateWrite) {
    files.push(path.join(path.dirname(path.resolve(params.projectRoot)), "PROJECTS_STATE.json"));
  }
  return { dirs, files };
}

function assertRoleCanWriteArtifact(params: {
  projectRoot: string;
  role: WorkflowRole;
  absolutePath: string;
}) {
  if (params.role === "cross-reviewer") {
    throw new Error(
      "cross-reviewer is read-only and cannot write project artifacts through write_text_artifact."
    );
  }
  const allowed = getAllowedAbsolutePaths({
    projectRoot: params.projectRoot,
    role: params.role,
  });
  const allowedByDir = allowed.dirs.some((dir) => isInside(dir, params.absolutePath));
  const allowedByFile = allowed.files.some(
    (filePath) => path.normalize(filePath) === path.normalize(params.absolutePath)
  );
  if (!allowedByDir && !allowedByFile) {
    throw new Error(
      `${params.role} cannot write ${params.absolutePath}. Stay inside your owned project scope.`
    );
  }
}

export async function writeWorkflowTextArtifact(params: {
  projectRoot: string;
  role: WorkflowRole;
  artifactPath: string;
  content: string;
  mode?: WorkflowArtifactWriteMode;
  ensureTrailingNewline?: boolean;
}): Promise<WorkflowArtifactTextWriteResult> {
  const mode = params.mode ?? "replace";
  const { absolutePath, relativePath } = normalizeArtifactTarget({
    projectRoot: params.projectRoot,
    artifactPath: params.artifactPath,
  });
  assertRoleCanWriteArtifact({
    projectRoot: params.projectRoot,
    role: params.role,
    absolutePath,
  });

  const existing = (await readTextIfExists(absolutePath)) ?? "";
  let nextValue = mode === "append" ? `${existing}${params.content}` : params.content;
  if (params.ensureTrailingNewline && nextValue && !nextValue.endsWith("\n")) {
    nextValue = `${nextValue}\n`;
  }
  const changed = existing !== nextValue;

  await writeTextEnsured(absolutePath, nextValue);

  let syncedAuthoringRecovery = false;
  if (relativePath.startsWith("academic_writer/")) {
    await syncAuthoringArtifactRecovery({ projectRoot: params.projectRoot });
    syncedAuthoringRecovery = true;
  }

  return {
    relativePath,
    absolutePath,
    bytes: Buffer.byteLength(nextValue, "utf8"),
    mode,
    syncedAuthoringRecovery,
    changed,
    changedPaths: changed ? [relativePath] : [],
    artifactKinds: inferArtifactKinds(relativePath),
  };
}
