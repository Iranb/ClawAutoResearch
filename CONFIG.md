# CONFIG.md — ClawAutoResearch Configuration

> This file is a path and configuration cheat sheet.
> For the full narrative configuration guide, see [DOC/reference/configuration.md](./DOC/reference/configuration.md).

## Path Variables

### Core Paths

- **`{PROJECTS_ROOT}`**: `/Users/iranb/Downloads/AutoResearchProjects`
  - Root directory for all research projects
  - Each project is isolated under `{PROJECTS_ROOT}/{proj-id}/`
  - Configure it in `openclaw.json` as `plugins.entries.ClawAutoResearch.config.projectsRoot`

- **`{PAPERNEXUS_PAPERS_ROOT}`**: `~/.papernexus/papers`
  - Local default PaperNexus paper source root
  - New projects should normally rely on this shared source root instead of pinning per-project `paper_source_dir` / `graph_source_dir`

- **`{PAPERNEXUS_INDEX_ROOT}`**: `~/.papernexus/index-store`
  - Local default PaperNexus index root
  - Authoritative graph files are written under this index root when `storage.indexDir` is set in PaperNexus

- **`{WS}`**: `~/.openclaw/workspace-researcher`
  - Researcher agent workspace
  - Contains skills, memory templates, and shared resources

- **`{PMEM}`**: `{PROJ}/memory`
  - Project-specific memory directory
  - Contains ideation-memory.md, experiment-memory.md, daily logs

### Per-Project Structure

For each project `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`:

Default shared PaperNexus source and graph paths:

```text
{PAPERNEXUS_PAPERS_ROOT}/
  md/
  pdf/

{PAPERNEXUS_INDEX_ROOT}/.papernexus/
  graph.kuzu
  graph.lite.json
  meta.json
```

Notes:
- projects should usually leave `paper_source_dir` and `graph_source_dir` unset unless they explicitly need to override the shared-global defaults
- all agents should read and write against the shared source tree instead of creating a second project-local graph corpus
- project-local state should record selected canonical papers via `researcher/PAPER_SOURCE_INDEX.json`, not by creating a project-specific corpus
- the graph files themselves are not stored inside `graph_source_dir`; they are stored in the PaperNexus index area

Project workspace structure:

```text
{PROJ}/
├── PROJECT_MANIFEST.json      # Project state and current stage
├── TRACK_REGISTRY.json        # Research track portfolio
├── CLAIM_POLICY.md            # Claim support criteria
├── WORKFLOW.md                # Workflow snapshot (copied from workspace)
├── README.md                  # Project overview
├── graph/                     # Workflow-facing graph readiness, frontier, and presence files
├── memory/                    # Project memory
├── researcher/                # Researcher outputs
├── orchestrator/              # Experiment plans
├── coder/                     # Experiment code
├── analyzer/                  # Analysis results
├── writer/                    # Paper drafts
└── reviewer/                  # Review feedback
```

## Configuration Source

The `{PROJECTS_ROOT}` path is determined by:

1. **Plugin config** (highest priority): `openclaw.json` → `plugins.entries.ClawAutoResearch.config.projectsRoot`
2. **Default**: `~/.openclaw/projects`

## Environment Variables

- **`OPENCLAW_PROJECT`**: Optional current project ID fallback
  - Useful in non-Discord or single-project local sessions
  - In Discord multi-project setups, channel-to-project binding is usually preferred
  - Example: `export OPENCLAW_PROJECT=my-first-detection`

- **`PAPERNEXUS_API_TOKEN`**: Recommended PaperNexus Web/API bearer token env var
  - Keep the raw token in environment only
  - Reference the env-var name from plugin config via `plugins.entries.ClawAutoResearch.config.papernexusApiTokenEnv`
  - The workflow only exposes the env-var name to agents; it should never persist the raw token into project files or prompts

- **`PAPERNEXUS_ROOT`**: Optional PaperNexus repository root
  - Can be used when PaperNexus is not discoverable as a sibling repository
  - Helps `graph-build` and related skills resolve the local PaperNexus installation

## Remote PaperNexus Access

Recommended plugin-level settings in `~/.openclaw/openclaw.json`:

- `plugins.entries.ClawAutoResearch.config.papernexusApiBaseUrl`
  - Remote PaperNexus Web/API base URL
- `plugins.entries.ClawAutoResearch.config.papernexusApiTokenEnv`
  - Env-var name that stores the PaperNexus API bearer token
- `plugins.entries.ClawAutoResearch.config.papernexusApiTokenSource`
  - `env | os_keychain | auto`
- `plugins.entries.ClawAutoResearch.config.papernexusApiTokenService`
  - Native keychain service/resource name
- `plugins.entries.ClawAutoResearch.config.papernexusApiTokenAccount`
  - Native keychain account/user name
- `plugins.entries.ClawAutoResearch.config.papernexusApiTokenLookupTimeoutMs`
  - Keychain lookup timeout in milliseconds
- `plugins.entries.ClawAutoResearch.config.papernexusMineruHttpUrl`
  - Optional remote MinerU HTTP endpoint for PDF materialization

Workflow behavior when these are configured:

- Researcher prompt injection will tell agents to prefer the configured remote PaperNexus Web/API endpoint for graph-heavy tasks
- PaperNexus API calls should use `Authorization: Bearer <token>` from the configured env var
- When `papernexusApiTokenSource = auto`, resolution order is: configured env var first, then native OS keychain
- When `papernexusApiTokenSource = os_keychain`, resolution uses:
  - macOS: Keychain generic password via `security`
  - Linux: Secret Service via `secret-tool`
  - Windows: PasswordVault via PowerShell / WinRT
- PDF materialization should prefer remote MinerU before local Docling or Marker
- Raw tokens should stay in env only and must not be copied into project artifacts, manifests, or chat logs

### Native keychain examples

macOS store:

```bash
security add-generic-password -U -s papernexus-api-token -a default -w "YOUR_TOKEN"
```

macOS read / verify:

```bash
security find-generic-password -s papernexus-api-token -a default -w
```

macOS export to env for the current shell:

```bash
export PAPERNEXUS_API_TOKEN="$(security find-generic-password -s papernexus-api-token -a default -w)"
```

Linux store:

```bash
secret-tool store --label="PaperNexus API token" service papernexus-api-token account default
```

Linux read / verify:

```bash
secret-tool lookup service papernexus-api-token account default
```

Linux export to env for the current shell:

```bash
export PAPERNEXUS_API_TOKEN="$(secret-tool lookup service papernexus-api-token account default)"
```

Windows PowerShell store:

```powershell
[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null
$vault = New-Object Windows.Security.Credentials.PasswordVault
$cred = New-Object Windows.Security.Credentials.PasswordCredential("papernexus-api-token","default","YOUR_TOKEN")
$vault.Add($cred)
```

Windows PowerShell read / verify:

```powershell
[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null
$vault = New-Object Windows.Security.Credentials.PasswordVault
$cred = $vault.Retrieve("papernexus-api-token","default")
$cred.RetrievePassword()
$cred.Password
```

Windows PowerShell export to env for the current shell:

```powershell
[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null
$vault = New-Object Windows.Security.Credentials.PasswordVault
$cred = $vault.Retrieve("papernexus-api-token","default")
$cred.RetrievePassword()
$env:PAPERNEXUS_API_TOKEN = $cred.Password
```

Recommended plugin config for native keychain support:

```json
{
  "papernexusApiTokenSource": "auto",
  "papernexusApiTokenEnv": "PAPERNEXUS_API_TOKEN",
  "papernexusApiTokenService": "papernexus-api-token",
  "papernexusApiTokenAccount": "default",
  "papernexusApiTokenLookupTimeoutMs": 2000
}
```

## Related Files

- **`WORKFLOW.md`**: Defines research stages, gates, and AUTO_PROCEED settings
- **`WORKSPACE.md`**: Defines agent file ownership and permissions
- **`templates/`**: Contains template files for new projects

## Quick Reference

```bash
# Optional local fallback when channel binding is not used
export OPENCLAW_PROJECT=my-project
export PAPERNEXUS_API_TOKEN=...

# Project path resolves to:
# {PROJECTS_ROOT}/my-project
# = <plugins.entries.ClawAutoResearch.config.projectsRoot>/my-project
```

---

**Last Updated**: 2026-03-21
