import fs from "node:fs/promises";
import path from "node:path";

import {
  pathExists,
  readJsonIfExists,
  writeJsonEnsured,
} from "../workflow-guard-core/fs";

type WritingSessionSnapshot = Record<string, unknown>;

export type AuthoringArtifactReceipt = {
  relativePath: string;
  category:
    | "paper_plan"
    | "storyline_sketch"
    | "writing_signals"
    | "paper_main"
    | "paper_refs"
    | "paper_pdf"
    | "paper_section";
  sectionId: string | null;
  size: number;
  mtimeMs: number;
};

export type AuthoringArtifactRecoveryStore = {
  schemaVersion: 1;
  updatedAt: string;
  artifacts: AuthoringArtifactReceipt[];
  writingSession: WritingSessionSnapshot | null;
};

export type AuthoringArtifactRecoveryResult = {
  store: AuthoringArtifactRecoveryStore | null;
  restoredFiles: string[];
  missingMirrorFiles: string[];
  liveArtifacts: AuthoringArtifactReceipt[];
};

const RECOVERY_STORE_PATH =
  ".openclaw-research/authoring-artifact-receipts.json";
const RECOVERY_MIRROR_ROOT =
  ".openclaw-research/authoring-recovery-mirror";

const FIXED_ARTIFACTS: Array<{
  relativePath: string;
  category: AuthoringArtifactReceipt["category"];
}> = [
  {
    relativePath: "academic_writer/PAPER_PLAN.md",
    category: "paper_plan",
  },
  {
    relativePath: "academic_writer/STORYLINE_SKETCH.md",
    category: "storyline_sketch",
  },
  {
    relativePath: "academic_writer/WRITING_SIGNALS.md",
    category: "writing_signals",
  },
  {
    relativePath: "academic_writer/paper/main.tex",
    category: "paper_main",
  },
  {
    relativePath: "academic_writer/paper/refs.bib",
    category: "paper_refs",
  },
  {
    relativePath: "academic_writer/paper/main.pdf",
    category: "paper_pdf",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function storePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), RECOVERY_STORE_PATH);
}

function mirrorRoot(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), RECOVERY_MIRROR_ROOT);
}

function toMirrorPath(projectRoot: string, relativePath: string): string {
  return path.join(mirrorRoot(projectRoot), normalizeRelativePath(relativePath));
}

function sectionIdFromPath(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  const match = normalized.match(/^academic_writer\/paper\/sections\/(.+)\.tex$/i);
  return match?.[1] ?? null;
}

async function statArtifact(projectRoot: string, relativePath: string) {
  const absolutePath = path.join(path.resolve(projectRoot), relativePath);
  if (!(await pathExists(absolutePath))) {
    return null;
  }
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    return null;
  }
  return stat;
}

async function listSectionArtifacts(projectRoot: string) {
  const sectionsDir = path.join(
    path.resolve(projectRoot),
    "academic_writer",
    "paper",
    "sections"
  );
  if (!(await pathExists(sectionsDir))) {
    return [] as AuthoringArtifactReceipt[];
  }
  const entries = await fs.readdir(sectionsDir, { withFileTypes: true });
  const receipts: AuthoringArtifactReceipt[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tex")) {
      continue;
    }
    const absolutePath = path.join(sectionsDir, entry.name);
    const stat = await fs.stat(absolutePath);
    const relativePath = normalizeRelativePath(
      path.relative(path.resolve(projectRoot), absolutePath)
    );
    receipts.push({
      relativePath,
      category: "paper_section",
      sectionId: sectionIdFromPath(relativePath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  return receipts.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

export async function collectAuthoringArtifactReceipts(
  projectRoot: string
): Promise<AuthoringArtifactReceipt[]> {
  const receipts: AuthoringArtifactReceipt[] = [];
  for (const artifact of FIXED_ARTIFACTS) {
    const stat = await statArtifact(projectRoot, artifact.relativePath);
    if (!stat) {
      continue;
    }
    receipts.push({
      relativePath: normalizeRelativePath(artifact.relativePath),
      category: artifact.category,
      sectionId: null,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  receipts.push(...(await listSectionArtifacts(projectRoot)));
  return receipts;
}

export async function readAuthoringArtifactRecoveryStore(
  projectRoot: string
): Promise<AuthoringArtifactRecoveryStore | null> {
  return (
    (await readJsonIfExists<AuthoringArtifactRecoveryStore>(storePath(projectRoot))) ??
    null
  );
}

async function copyArtifactToMirror(params: {
  projectRoot: string;
  relativePath: string;
}) {
  const sourcePath = path.join(path.resolve(params.projectRoot), params.relativePath);
  const destinationPath = toMirrorPath(params.projectRoot, params.relativePath);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

export async function syncAuthoringArtifactRecovery(params: {
  projectRoot: string;
  writingSession?: Record<string, unknown> | null;
}): Promise<AuthoringArtifactRecoveryStore> {
  const receipts = await collectAuthoringArtifactReceipts(params.projectRoot);
  for (const receipt of receipts) {
    await copyArtifactToMirror({
      projectRoot: params.projectRoot,
      relativePath: receipt.relativePath,
    });
  }
  const existing = await readAuthoringArtifactRecoveryStore(params.projectRoot);
  const next: AuthoringArtifactRecoveryStore = {
    schemaVersion: 1,
    updatedAt: nowIso(),
    artifacts: receipts,
    writingSession:
      params.writingSession === undefined
        ? existing?.writingSession ?? null
        : params.writingSession ?? null,
  };
  await writeJsonEnsured(storePath(params.projectRoot), next);
  return next;
}

export async function restoreAuthoringArtifactsFromRecovery(params: {
  projectRoot: string;
}): Promise<AuthoringArtifactRecoveryResult> {
  const store = await readAuthoringArtifactRecoveryStore(params.projectRoot);
  if (!store) {
    return {
      store: null,
      restoredFiles: [],
      missingMirrorFiles: [],
      liveArtifacts: await collectAuthoringArtifactReceipts(params.projectRoot),
    };
  }

  const restoredFiles: string[] = [];
  const missingMirrorFiles: string[] = [];
  for (const artifact of store.artifacts) {
    const livePath = path.join(path.resolve(params.projectRoot), artifact.relativePath);
    if (await pathExists(livePath)) {
      continue;
    }
    const mirrorPath = toMirrorPath(params.projectRoot, artifact.relativePath);
    if (!(await pathExists(mirrorPath))) {
      missingMirrorFiles.push(artifact.relativePath);
      continue;
    }
    await fs.mkdir(path.dirname(livePath), { recursive: true });
    await fs.copyFile(mirrorPath, livePath);
    restoredFiles.push(artifact.relativePath);
  }

  return {
    store,
    restoredFiles,
    missingMirrorFiles,
    liveArtifacts: await collectAuthoringArtifactReceipts(params.projectRoot),
  };
}

export function writingSessionLooksRecoverableEmpty(
  writingSession: Record<string, unknown> | null | undefined
): boolean {
  const value =
    writingSession && typeof writingSession === "object" && !Array.isArray(writingSession)
      ? writingSession
      : {};
  const currentSection =
    typeof value.current_section === "string"
      ? value.current_section
      : typeof value.currentSection === "string"
        ? value.currentSection
        : null;
  const draftOrder = Array.isArray(value.draft_order)
    ? value.draft_order
    : Array.isArray(value.draftOrder)
      ? value.draftOrder
      : [];
  const sectionPackets =
    value.section_packets && typeof value.section_packets === "object"
      ? value.section_packets
      : value.sectionPackets && typeof value.sectionPackets === "object"
        ? value.sectionPackets
        : {};
  const finalizedSections = Array.isArray(value.finalized_sections)
    ? value.finalized_sections
    : Array.isArray(value.finalizedSections)
      ? value.finalizedSections
      : [];
  const compileSafeSections = Array.isArray(value.compile_safe_sections)
    ? value.compile_safe_sections
    : Array.isArray(value.compileSafeSections)
      ? value.compileSafeSections
      : [];
  return (
    !currentSection &&
    draftOrder.length === 0 &&
    Object.keys(sectionPackets ?? {}).length === 0 &&
    finalizedSections.length === 0 &&
    compileSafeSections.length === 0
  );
}
