import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ExperimentGitActionType =
  | "create_candidate_worktree"
  | "promote_candidate"
  | "discard_candidate";

export type ExperimentGitActionResult = {
  actionType: ExperimentGitActionType;
  incumbentBranch: string | null;
  incumbentCommit: string | null;
  candidateBranch: string | null;
  candidateBaseCommit: string | null;
  candidateHeadCommit: string | null;
  candidateWorktreePath: string | null;
  branchDeleted: boolean;
  worktreeRemoved: boolean;
  summary: string;
};

type GitExecOptions = {
  cwd?: string;
};

async function runGit(
  projectRoot: string,
  args: string[],
  options: GitExecOptions = {}
): Promise<string> {
  const cwd = options.cwd ?? projectRoot;
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function refExists(projectRoot: string, ref: string): Promise<boolean> {
  try {
    await runGit(projectRoot, ["rev-parse", "--verify", ref]);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommit(
  projectRoot: string,
  ref: string | null | undefined
): Promise<string | null> {
  if (!ref?.trim()) {
    return null;
  }
  try {
    return await runGit(projectRoot, ["rev-parse", "--verify", ref.trim()]);
  } catch {
    if (!ref.startsWith("refs/heads/")) {
      try {
        return await runGit(projectRoot, [
          "rev-parse",
          "--verify",
          `refs/heads/${ref.trim()}`,
        ]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

type GitWorktreeRecord = {
  worktree: string;
  branch: string | null;
  head: string | null;
};

async function listWorktrees(projectRoot: string): Promise<GitWorktreeRecord[]> {
  const raw = await runGit(projectRoot, ["worktree", "list", "--porcelain"]);
  const blocks = raw.split("\n\n").filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").filter(Boolean);
    const record: GitWorktreeRecord = {
      worktree: "",
      branch: null,
      head: null,
    };
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        record.worktree = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        const branchRef = line.slice("branch ".length).trim();
        record.branch = branchRef.replace(/^refs\/heads\//, "");
      } else if (line.startsWith("HEAD ")) {
        record.head = line.slice("HEAD ".length).trim();
      }
    }
    return record;
  });
}

async function ensureBranchNotCheckedOut(
  projectRoot: string,
  branch: string | null
): Promise<void> {
  if (!branch) {
    return;
  }
  const worktrees = await listWorktrees(projectRoot);
  const active = worktrees.find((entry) => entry.branch === branch);
  if (active) {
    throw new Error(
      `Branch ${branch} is currently checked out in worktree ${active.worktree}; workflow-owned ref promotion requires the incumbent branch to be detached from active worktrees.`
    );
  }
}

async function ensureAncestor(
  projectRoot: string,
  ancestor: string | null,
  descendant: string | null
): Promise<void> {
  if (!ancestor || !descendant) {
    return;
  }
  const resolvedAncestor = await resolveCommit(projectRoot, ancestor);
  const resolvedDescendant = await resolveCommit(projectRoot, descendant);
  if (!resolvedAncestor || !resolvedDescendant) {
    return;
  }
  await execFileAsync("git", ["merge-base", "--is-ancestor", resolvedAncestor, resolvedDescendant], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

export async function executeExperimentGitAction(params: {
  projectRoot: string;
  actionType: ExperimentGitActionType;
  incumbentBranch: string | null;
  incumbentCommit?: string | null;
  candidateBranch: string | null;
  candidateWorktreePath: string | null;
  candidateBaseRef?: string | null;
  candidateHeadCommit?: string | null;
  requireCleanCandidateHistory?: boolean;
  discardCandidateBranchAfterPromote?: boolean;
}): Promise<ExperimentGitActionResult> {
  await runGit(params.projectRoot, ["rev-parse", "--show-toplevel"]);
  if (!params.candidateBranch?.trim()) {
    throw new Error("candidateBranch is required for experiment git actions.");
  }
  const candidateBranch = params.candidateBranch.trim();
  const candidateWorktreePath = params.candidateWorktreePath?.trim() ?? null;
  const incumbentBranch = params.incumbentBranch?.trim() ?? null;

  if (params.actionType === "create_candidate_worktree") {
    const baseRef = params.candidateBaseRef?.trim() || incumbentBranch;
    if (!baseRef) {
      throw new Error("incumbentBranch or candidateBaseRef is required to create a candidate worktree.");
    }
    const baseCommit =
      (await resolveCommit(params.projectRoot, baseRef)) ??
      params.incumbentCommit?.trim() ??
      null;
    if (!baseCommit) {
      throw new Error(`Unable to resolve candidate base ref ${baseRef}.`);
    }
    if (!candidateWorktreePath) {
      throw new Error("candidateWorktreePath is required to create a candidate worktree.");
    }
    const branchExists = await refExists(
      params.projectRoot,
      `refs/heads/${candidateBranch}`
    );
    const worktrees = await listWorktrees(params.projectRoot);
    const existingWorktree = worktrees.find(
      (entry) => entry.worktree === candidateWorktreePath
    );
    if (existingWorktree?.branch === candidateBranch) {
      return {
        actionType: params.actionType,
        incumbentBranch,
        incumbentCommit: await resolveCommit(params.projectRoot, incumbentBranch),
        candidateBranch,
        candidateBaseCommit: baseCommit,
        candidateHeadCommit:
          existingWorktree.head ??
          (await resolveCommit(params.projectRoot, candidateBranch)),
        candidateWorktreePath,
        branchDeleted: false,
        worktreeRemoved: false,
        summary: `Candidate worktree already exists for ${candidateBranch}.`,
      };
    }
    await fs.mkdir(path.dirname(candidateWorktreePath), { recursive: true });
    let branchBaseRef = baseCommit;
    if (!branchExists) {
      try {
        await runGit(params.projectRoot, [
          "cat-file",
          "-e",
          `${branchBaseRef}^{commit}`,
        ]);
      } catch {
        branchBaseRef =
          (await resolveCommit(params.projectRoot, "HEAD")) ?? branchBaseRef;
      }
      try {
        await runGit(params.projectRoot, [
          "branch",
          candidateBranch,
          branchBaseRef,
        ]);
      } catch (error) {
        const fallbackHead = await resolveCommit(params.projectRoot, "HEAD");
        if (!fallbackHead || fallbackHead === branchBaseRef) {
          throw error;
        }
        await runGit(params.projectRoot, [
          "branch",
          candidateBranch,
          fallbackHead,
        ]);
        branchBaseRef = fallbackHead;
      }
    } else {
      branchBaseRef =
        (await resolveCommit(params.projectRoot, candidateBranch)) ?? branchBaseRef;
    }
    await runGit(params.projectRoot, [
      "worktree",
      "add",
      candidateWorktreePath,
      candidateBranch,
    ]);
    return {
      actionType: params.actionType,
        incumbentBranch,
        incumbentCommit: await resolveCommit(params.projectRoot, incumbentBranch),
        candidateBranch,
        candidateBaseCommit: branchBaseRef,
        candidateHeadCommit: await resolveCommit(candidateWorktreePath, "HEAD"),
      candidateWorktreePath,
      branchDeleted: false,
      worktreeRemoved: false,
      summary: `Created candidate worktree ${candidateWorktreePath} from ${baseCommit}.`,
    };
  }

  const candidateCommit =
    params.candidateHeadCommit?.trim() ||
    (await resolveCommit(params.projectRoot, candidateBranch));
  if (!candidateCommit) {
    throw new Error(`Unable to resolve candidate branch ${candidateBranch}.`);
  }

  if (params.actionType === "promote_candidate") {
    const incumbentCommit =
      (await resolveCommit(params.projectRoot, incumbentBranch)) ??
      (await resolveCommit(params.projectRoot, params.incumbentCommit?.trim())) ??
      null;
    if (params.requireCleanCandidateHistory !== false) {
      await ensureAncestor(params.projectRoot, incumbentCommit, candidateCommit);
    }
    await ensureBranchNotCheckedOut(params.projectRoot, incumbentBranch);
    if (incumbentBranch) {
      if (await refExists(params.projectRoot, `refs/heads/${incumbentBranch}`)) {
        if (incumbentCommit) {
          await runGit(params.projectRoot, [
            "update-ref",
            `refs/heads/${incumbentBranch}`,
            candidateCommit,
            incumbentCommit,
          ]);
        } else {
          await runGit(params.projectRoot, [
            "update-ref",
            `refs/heads/${incumbentBranch}`,
            candidateCommit,
          ]);
        }
      } else {
        await runGit(params.projectRoot, ["branch", incumbentBranch, candidateCommit]);
      }
    }
    let worktreeRemoved = false;
    if (candidateWorktreePath) {
      try {
        await runGit(params.projectRoot, [
          "worktree",
          "remove",
          "--force",
          candidateWorktreePath,
        ]);
        worktreeRemoved = true;
      } catch {
        worktreeRemoved = false;
      }
    }
    let branchDeleted = false;
    if (
      params.discardCandidateBranchAfterPromote !== false &&
      incumbentBranch !== candidateBranch &&
      (await refExists(params.projectRoot, `refs/heads/${candidateBranch}`))
    ) {
      await runGit(params.projectRoot, ["branch", "-D", candidateBranch]);
      branchDeleted = true;
    }
    return {
      actionType: params.actionType,
      incumbentBranch,
      incumbentCommit: await resolveCommit(params.projectRoot, incumbentBranch),
      candidateBranch,
      candidateBaseCommit:
        params.incumbentCommit?.trim() ??
        (await resolveCommit(params.projectRoot, incumbentBranch)),
      candidateHeadCommit: candidateCommit,
      candidateWorktreePath,
      branchDeleted,
      worktreeRemoved,
      summary: `Promoted ${candidateBranch} into ${incumbentBranch ?? "incumbent ref"}.`,
    };
  }

  let worktreeRemoved = false;
  if (candidateWorktreePath) {
    try {
      await runGit(params.projectRoot, [
        "worktree",
        "remove",
        "--force",
        candidateWorktreePath,
      ]);
      worktreeRemoved = true;
    } catch {
      worktreeRemoved = false;
    }
  }
  let branchDeleted = false;
  if (await refExists(params.projectRoot, `refs/heads/${candidateBranch}`)) {
    await runGit(params.projectRoot, ["branch", "-D", candidateBranch]);
    branchDeleted = true;
  }
  return {
    actionType: params.actionType,
    incumbentBranch,
    incumbentCommit: await resolveCommit(params.projectRoot, incumbentBranch),
    candidateBranch,
    candidateBaseCommit:
      params.incumbentCommit?.trim() ??
      (await resolveCommit(params.projectRoot, incumbentBranch)),
    candidateHeadCommit: candidateCommit,
    candidateWorktreePath,
    branchDeleted,
    worktreeRemoved,
    summary: `Discarded candidate ${candidateBranch}.`,
  };
}
