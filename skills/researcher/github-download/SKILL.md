---
name: github-download
description: "Download or clone repository code from GitHub to the local machine. Use when the user asks to download/clone a repo from GitHub, pull a project down, or specifies owner/repo, branch, tag, shallow clone, or ZIP download. Do not use for: GitHub issues/PRs/CI (use github skill), or non-GitHub Git repos (instruct git clone directly)."
metadata:
  {
    "openclaw":
      {
        "emoji": "⬇️",
        "requires": { "bins": ["git"] },
        "homepage": "https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository"
      },
  }
---

# Download code from GitHub (github-download)

This skill describes how to download or clone a GitHub repository locally, with support for multiple methods and options.

## When to use

✅ **Use this skill when:**

- The user says "download a repo from GitHub", "clone this project", or "pull the code from GitHub"
- They need a specific branch, tag, or shallow clone (recent commits only)
- They want a release ZIP or source archive

❌ **Do not use this skill when:**

- Working with GitHub issues, PRs, or CI → use the **github** skill (gh CLI)
- Pull/commit/push on an existing local repo → use `git` commands directly

## Prerequisites

- **Required:** **git** must be installed (for clone).
- **Optional:** If **gh** (GitHub CLI) is installed, you can use `gh repo clone`, download releases, and work more easily with private repos.

## Method 1: git clone (recommended, no gh needed)

```bash
# Basic clone (default branch)
git clone https://github.com/owner/repo.git [target-dir]

# Specific branch
git clone -b main https://github.com/owner/repo.git [target-dir]

# Specific tag
git clone -b v1.0.0 https://github.com/owner/repo.git [target-dir]

# Shallow clone (only recent commits, faster)
git clone --depth 1 https://github.com/owner/repo.git [target-dir]

# Shallow clone + branch
git clone --depth 1 -b main https://github.com/owner/repo.git [target-dir]
```

If the target directory is omitted, a directory named after the repo (e.g. `repo`) is created.

## Method 2: gh repo clone (requires gh)

Prefer when the user has `gh` installed and may need private repo access:

```bash
# Clone (gh handles HTTPS/SSH and auth)
gh repo clone owner/repo [target-dir]

# Specific branch
gh repo clone owner/repo -- --branch main [target-dir]

# Shallow clone
gh repo clone owner/repo -- --depth 1 [target-dir]
```

Arguments after `--` are passed through to the underlying `git clone`.

## Method 3: ZIP download only (no git history)

Use when the user only needs a snapshot and not `.git`:

```bash
# Default branch ZIP via curl
curl -L -o repo.zip https://github.com/owner/repo/archive/refs/heads/main.zip
unzip repo.zip

# Specific branch (replace main with branch name)
curl -L -o repo.zip https://github.com/owner/repo/archive/refs/heads/BRANCH.zip

# Specific tag (replace v1.0.0 with tag name)
curl -L -o repo.zip https://github.com/owner/repo/archive/refs/tags/v1.0.0.zip
```

After extraction, the directory is typically named `repo-main` or `repo-v1.0.0`; use that to `cd` or rename.

With **gh** installed, you can also use the API (private repos require `gh auth login` first):

```bash
# Download source ZIP for a release (replace <tag> with the actual tag)
gh release download <tag> --repo owner/repo --archive zip
```

## Working directory

- If the user specifies a path, run clone or extract there.
- If not, use the current working directory; confirm the cwd before running to avoid writing to the wrong place.

## Private repositories

- **git clone:** Configure HTTPS credentials or SSH keys; for HTTPS you can use a personal access token as the password.
- **gh repo clone:** Run `gh auth login` once; then cloning private repos works the same as public ones.

## Workflow summary

1. Confirm the repo is given as **owner/repo** or full URL (e.g. `https://github.com/owner/repo`).
2. Confirm whether they need a **branch/tag**, **shallow clone**, or **ZIP only**.
3. Choose the appropriate method above and run the commands in the user-specified or sensible working directory.
4. Afterward, tell the user the path where the repo landed and suggest next steps (e.g. `cd repo && pnpm install`).
