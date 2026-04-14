---
name: long-text-write
description: "Safely persist long prose, LaTeX, Markdown, or JSON artifacts without stuffing bulk text into exec command strings."
allowed-tools:
  - research_workflow
  - Bash(*)
  - process
  - Write
  - Edit
---

# Long Text Write

Use this whenever a manuscript section, review note, bibliography, or other artifact is too large to fit comfortably inside a single `exec` command.

## Core Rule

Never paste multi-paragraph prose, long LaTeX sections, or bulk JSON into:

- Bash heredocs
- `python -c`
- `node -e`
- inline shell generators

Those patterns trigger OpenClaw exec safety and obfuscation guards, especially in Discord / gateway-backed sessions.

## Preferred Path: Workflow-Owned Artifact Writes

If the project is resolved and the target file is inside your owned project scope, write long text through `research_workflow`:

```json
{
  "action": "write_text_artifact",
  "artifactPath": "academic_writer/paper/sections/introduction.tex",
  "content": "full section text...",
  "mode": "replace"
}
```

Use this first for:

- `academic_writer/paper/sections/*.tex`
- `academic_writer/paper/main.tex`
- `academic_writer/paper/refs.bib`
- `academic_writer/PAPER_PLAN.md`
- `academic_writer/STORYLINE_SKETCH.md`
- `academic_writer/WRITING_SIGNALS.md`

Why this is preferred:

- the text never travels through shell quoting
- command-length limits do not matter
- the write stays inside workflow-owned project scope
- authoring recovery mirror can stay in sync

## If You Truly Need Shell Stdin: Use `exec` + `process paste`

If a shell command genuinely needs stdin and the `process` tool is available, follow the official OpenClaw background-session pattern instead of putting the text in the command string.

### Step 1: Start a background receiver

```json
{
  "tool": "exec",
  "command": "cat > academic_writer/paper/sections/introduction.tex",
  "background": true
}
```

### Step 2: Paste the long text into stdin

```json
{
  "tool": "process",
  "action": "paste",
  "sessionId": "<returned-session-id>",
  "text": "very long section text..."
}
```

### Step 3: Close stdin so `cat` exits cleanly

```json
{
  "tool": "process",
  "action": "write",
  "sessionId": "<returned-session-id>",
  "data": "",
  "eof": true
}
```

### Step 4: Verify completion

Use `process.poll`, `process.log`, or a short `exec` verification command to confirm the file landed correctly.

## Good Uses for `apply_patch`

If the file already exists and you only need a bounded edit:

- fix a paragraph
- change one theorem statement
- repair a citation key
- insert a small subsection

Then `apply_patch` is preferable to rewriting the whole file.

Do not use `apply_patch` to recreate an entire long manuscript section if a clean full rewrite is simpler through `write_text_artifact`.

## Last Resort: Chunked Append

If neither workflow writes nor `process paste` is available, split the content into several short appends:

- first chunk with `>`
- later chunks with `>>`

Keep each shell command short and readable.

## Safety Rules

- Preserve exact whitespace in manuscript text; do not trim or normalize away meaningful spaces.
- Prefer one owned artifact per write call instead of multi-file shell generators.
- After a long write, verify the target file before claiming the section is complete.
- If the session is unbound and `research_workflow` cannot resolve the project, pass an explicit project root or restore binding before attempting more long writes.
