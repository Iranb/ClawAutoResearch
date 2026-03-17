#!/bin/bash
# OpenClaw Research Plugin Installer
# Usage: bash install.sh [--dry-run]
#
# Safety guarantees:
#   1. Pre-flight: all source files verified before any writes begin
#   2. SOUL/AGENTS: replaced from plugin in each agent workspace (timestamped backup)
#   3. Memory protection: templates only installed if no existing file
#   4. openclaw.json: never modified; script prints modification suggestions only
#   5. Rollback list printed on failure (for workspaces only)
#   6. dry-run: no writes, suggestions still printed
set -euo pipefail

PLUGIN_DIR="/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
OC_DIR="$HOME/.openclaw"
DATE=$(date +%Y%m%d_%H%M%S)
DRY_RUN=false
ROLLBACK_FILES=()   # track (backup_path original_path) pairs for rollback

# ── CLI ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# ── Helpers ────────────────────────────────────────────────────────────────

# run CMD [ARGS...]  — execute or print depending on DRY_RUN
# Uses "$@" instead of eval to safely handle paths with spaces
run() {
  if $DRY_RUN; then
    # Show the command with human-readable arg quoting
    printf '  [dry-run]'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

# backup_and_copy SRC DST  — backup DST (if exists), then cp SRC→DST
backup_and_copy() {
  local src="$1" dst="$2"
  if $DRY_RUN; then
    [ -f "$dst" ] && echo "  [dry-run] backup $(basename "$dst") → $(basename "$dst").bak.$DATE"
    printf '  [dry-run] cp %q → %q\n' "$src" "$dst"
    return
  fi
  if [ -f "$dst" ]; then
    cp "$dst" "${dst}.bak.${DATE}"
    ROLLBACK_FILES+=("${dst}.bak.${DATE}" "$dst")
  fi
  cp "$src" "$dst"
}

# copy_if_absent SRC DST  — only copy if DST does not exist (protects live data)
# In dry-run mode, checks the REAL file system (to show what would actually happen)
copy_if_absent() {
  local src="$1" dst="$2" label="${3:-$(basename "$dst")}"
  if [ -f "$dst" ]; then
    local lines
    lines=$(wc -l < "$dst" 2>/dev/null || echo "?")
    echo "  → SKIP $label (already exists, ${lines} lines — not overwriting live data)"
  else
    run cp "$src" "$dst"
    echo "  → $label installed (was absent)"
  fi
}

# die MSG  — print error and rollback
die() {
  echo ""
  echo "✗ ERROR: $1" >&2
  if [ ${#ROLLBACK_FILES[@]} -gt 0 ]; then
    echo ""
    echo "Rollback instructions:" >&2
    for ((i=0; i<${#ROLLBACK_FILES[@]}; i+=2)); do
      echo "  cp '${ROLLBACK_FILES[$i]}' '${ROLLBACK_FILES[$((i+1))]}'" >&2
    done
  fi
  exit 1
}

# ── Banner ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   OpenClaw Research Plugin — Installer               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Plugin:  $PLUGIN_DIR"
echo "  Target:  $OC_DIR"
echo "  Mode:    $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes)' || echo 'LIVE')"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PRE-FLIGHT: verify all source files exist BEFORE touching anything
# ═══════════════════════════════════════════════════════════════════════════
echo "[ Pre-flight checks ]"

MISSING=0
check_file() {
  if [ ! -f "$1" ]; then
    echo "  ✗ MISSING: $1"
    MISSING=$((MISSING+1))
  fi
}
check_dir() {
  if [ ! -d "$1" ]; then
    echo "  ✗ MISSING DIR: $1"
    MISSING=$((MISSING+1))
  fi
}

# Agent identity files
for agent in researcher reviewer orchestrator coder analyzer academic_writer cross-reviewer; do
  check_file "$PLUGIN_DIR/agents/$agent/SOUL.md"
  check_file "$PLUGIN_DIR/agents/$agent/AGENTS.md"
done

# Workflow definition
check_file "$PLUGIN_DIR/WORKFLOW.md"

# Hook files
check_file "$PLUGIN_DIR/hooks/BOOTSTRAP.md"
check_file "$PLUGIN_DIR/hooks/HEARTBEAT.md"

# Memory templates
check_file "$PLUGIN_DIR/memory/ideation-memory.md"
check_file "$PLUGIN_DIR/memory/experiment-memory.md"

# Target dir must exist (openclaw.json may be missing — we only print suggestions)
check_dir  "$OC_DIR"
check_dir  "$OC_DIR/workspace-researcher"

# Skill dirs
check_dir "$PLUGIN_DIR/skills/researcher"
check_dir "$PLUGIN_DIR/skills/reviewer"

# Python3 optional (used only to validate existing openclaw.json)
if ! command -v python3 &>/dev/null; then
  echo "  ⚠ python3 not found; will skip openclaw.json validation (suggestions still printed)"
fi

if [ "$MISSING" -gt 0 ]; then
  die "Pre-flight failed: $MISSING missing file(s). Nothing was changed."
fi
echo "  ✓ All source files present"

# Validate existing openclaw.json if present (we do not modify it; suggestions printed either way)
if [ -f "$OC_DIR/openclaw.json" ]; then
  if command -v python3 &>/dev/null; then
    python3 -c "import json; json.load(open('$OC_DIR/openclaw.json'))" 2>/dev/null \
      && echo "  ✓ openclaw.json is valid JSON" \
      || echo "  ⚠ openclaw.json exists but is not valid JSON (may use // comments); suggestions still printed."
  else
    echo "  ✓ openclaw.json found (validation skipped, no python3)"
  fi
else
  echo "  ⚠ openclaw.json not found; step 6 will print suggested content."
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: Researcher workspace files (SOUL/AGENTS replaced from plugin)
# ═══════════════════════════════════════════════════════════════════════════
echo "[1/6] Updating researcher workspace (SOUL.md + AGENTS.md replaced from plugin)..."
backup_and_copy "$PLUGIN_DIR/agents/researcher/SOUL.md"   "$OC_DIR/workspace-researcher/SOUL.md"
backup_and_copy "$PLUGIN_DIR/agents/researcher/AGENTS.md" "$OC_DIR/workspace-researcher/AGENTS.md"

# WORKFLOW.md: global pipeline definition (overwrite — always keep current)
backup_and_copy "$PLUGIN_DIR/WORKFLOW.md" "$OC_DIR/workspace-researcher/WORKFLOW.md"

# BOOTSTRAP.md: overwrite (it is the hook, should always be current)
backup_and_copy "$PLUGIN_DIR/hooks/BOOTSTRAP.md"  "$OC_DIR/workspace-researcher/BOOTSTRAP.md"

# HEARTBEAT.md: overwrite
backup_and_copy "$PLUGIN_DIR/hooks/HEARTBEAT.md"  "$OC_DIR/workspace-researcher/HEARTBEAT.md"

echo "  → SOUL.md, AGENTS.md, WORKFLOW.md, BOOTSTRAP.md, HEARTBEAT.md updated"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: Reviewer workspace files (SOUL/AGENTS replaced from plugin)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "[2/6] Updating reviewer workspace (SOUL.md + AGENTS.md replaced from plugin)..."
run mkdir -p "$OC_DIR/workspace-reviewer"
backup_and_copy "$PLUGIN_DIR/agents/reviewer/SOUL.md"   "$OC_DIR/workspace-reviewer/SOUL.md"
backup_and_copy "$PLUGIN_DIR/agents/reviewer/AGENTS.md" "$OC_DIR/workspace-reviewer/AGENTS.md"
echo "  → SOUL.md, AGENTS.md updated"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 3: Install skills (always overwrite — skills are versioned by the plugin)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "[3/6] Installing skills..."

install_skills() {
  local agent="$1"
  local ws="$2"
  local skill_src="$PLUGIN_DIR/skills/$agent"
  [ -d "$skill_src" ] || return 0
  run mkdir -p "$ws/skills"
  for skill_dir in "$skill_src"/*/; do
    [ -d "$skill_dir" ] || continue
    local skill_name
    skill_name=$(basename "$skill_dir")
    run cp -r "$skill_dir" "$ws/skills/$skill_name"
    echo "    → $agent/$skill_name"
  done
}

install_skills researcher "$OC_DIR/workspace-researcher"
install_skills reviewer   "$OC_DIR/workspace-reviewer"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 4: Create sub-agent workspaces (SOUL/AGENTS replaced from plugin)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "[4/6] Creating sub-agent workspaces (SOUL.md + AGENTS.md replaced from plugin)..."

for agent in orchestrator coder analyzer academic_writer cross-reviewer; do
  WS="$OC_DIR/workspace-$agent"
  run mkdir -p "$WS/skills"
  run mkdir -p "$OC_DIR/agents/$agent/agent"

  backup_and_copy "$PLUGIN_DIR/agents/$agent/SOUL.md"   "$WS/SOUL.md"
  backup_and_copy "$PLUGIN_DIR/agents/$agent/AGENTS.md" "$WS/AGENTS.md"
  # BOOTSTRAP: shared hook (overwrite always)
  run cp "$PLUGIN_DIR/hooks/BOOTSTRAP.md" "$WS/BOOTSTRAP.md"
  # Sub-agents don't need heartbeat tasks
  if ! $DRY_RUN; then
    printf '# HEARTBEAT.md\n# Sub-agent: no periodic tasks needed.\n' > "$WS/HEARTBEAT.md"
  else
    echo "  [dry-run] write empty HEARTBEAT.md → $WS/HEARTBEAT.md"
  fi

  install_skills "$agent" "$WS"
  echo "  → workspace-$agent ready"
done

# ═══════════════════════════════════════════════════════════════════════════
# STEP 5: Memory templates  ← PROTECTED: only install if absent
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "[5/6] Installing memory templates (protected — skip if data exists)..."
run mkdir -p "$OC_DIR/workspace-researcher/memory"
copy_if_absent \
  "$PLUGIN_DIR/memory/ideation-memory.md" \
  "$OC_DIR/workspace-researcher/memory/ideation-memory.md" \
  "ideation-memory.md"
copy_if_absent \
  "$PLUGIN_DIR/memory/experiment-memory.md" \
  "$OC_DIR/workspace-researcher/memory/experiment-memory.md" \
  "experiment-memory.md"

# ═══════════════════════════════════════════════════════════════════════════
# STEP 5b: Projects root directory + openclaw-research.json（供 agent 解析 PROJECTS_ROOT）
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "[5b/6] Ensuring projects root and openclaw-research.json..."
PROJECTS_ROOT_DEFAULT="$OC_DIR/projects"
if [ -f "$OC_DIR/openclaw.json" ]; then
  # Try to read projectsRoot from user's openclaw.json (strip // comments, then grep)
  _pr=$(grep -E '"projectsRoot"' "$OC_DIR/openclaw.json" 2>/dev/null | sed -E 's/.*"projectsRoot"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' | head -1)
  [ -n "$_pr" ] && PROJECTS_ROOT_DEFAULT="$_pr"
fi
# Expand ~ to $HOME for mkdir
PROJECTS_ROOT_EXPANDED="${PROJECTS_ROOT_DEFAULT/#\~/$HOME}"
run mkdir -p "$PROJECTS_ROOT_EXPANDED"
echo "  → Projects root: $PROJECTS_ROOT_DEFAULT (created if absent)"
RESEARCH_JSON="$OC_DIR/openclaw-research.json"
if ! $DRY_RUN; then
  if [ ! -f "$RESEARCH_JSON" ]; then
    printf '%s\n' "{\"projectsRoot\": \"$PROJECTS_ROOT_DEFAULT\", \"servers\": {\"default\": \"\", \"list\": []}}" > "$RESEARCH_JSON"
    echo "  → Created $RESEARCH_JSON (agents read projectsRoot/servers from here)"
  else
    echo "  → $RESEARCH_JSON already exists (not overwritten)"
  fi
else
  echo "  [dry-run] would ensure $RESEARCH_JSON with projectsRoot: $PROJECTS_ROOT_DEFAULT"
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 6: openclaw.json — 不修改系统配置，仅输出修改建议
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "[6/6] openclaw.json: 不修改系统文件，仅输出修改建议..."
SUGGEST_FILE="$OC_DIR/openclaw-research-suggested-changes.txt"
print_openclaw_suggestions() {
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  ~/.openclaw/openclaw.json — 修改建议（本安装脚本不会自动修改该文件）"
  echo "═══════════════════════════════════════════════════════════════════════"
  echo ""
  echo "请手动编辑 ~/.openclaw/openclaw.json，确保包含以下内容："
  echo ""
  echo "1) agents.list 中应包含以下 id，且 workspace 路径一致："
  echo "   - researcher    workspace: \"~/.openclaw/workspace-researcher\""
  echo "   - orchestrator   workspace: \"~/.openclaw/workspace-researcher\"  (与 researcher 共享)"
  echo "   - coder         workspace: \"~/.openclaw/workspace-researcher\""
  echo "   - analyzer      workspace: \"~/.openclaw/workspace-researcher\""
  echo "   - academic_writer workspace: \"~/.openclaw/workspace-researcher\""
  echo "   - reviewer      workspace: \"~/.openclaw/workspace-reviewer\"   (独立)"
  echo "   - cross-reviewer workspace: \"~/.openclaw/workspace-cross-reviewer\""
  echo ""
  echo "2) researcher 的 subagents.allowAgents 应包含："
  echo "   [ \"orchestrator\", \"coder\", \"analyzer\", \"academic_writer\", \"reviewer\" ]"
  echo ""
  echo "3) 各 agent 的 skills 需指向插件安装的目录，例如："
  echo "   researcher: [ \"~/.openclaw/skills\", \"<插件目录>/skills/researcher\" ]"
  echo "   或使用已部署到 ~/.openclaw/workspace-<agent>/skills 的路径。"
  echo ""
  echo "4) 项目根目录（可选）：在 openclaw.json 顶层增加 projectsRoot，例如："
  echo "   projectsRoot: \"~/.openclaw/projects\""
  echo "   可改为任意路径（如 ~/ResearchProjects），所有 agent 将从此目录读写项目；"
  echo "   安装脚本会同步/创建 ~/.openclaw/openclaw-research.json 供 agent 解析。"
  echo ""
  echo "5) 服务器配置（推荐不放在 openclaw.json）：请编辑 ~/.openclaw/openclaw-research.json 的 servers:"
  echo "   { \"servers\": { \"default\": \"gpu-host\", \"list\": [\"gpu-host\", \"gpu-host-2\"] } }"
  echo "   或在具体项目下创建 {PROJ}/servers.json 覆盖。"
  echo ""
  echo "6) 完整参考配置（可含 // 注释，合并时请按需去除注释）："
  echo "   $PLUGIN_DIR/openclaw.json"
  echo ""
  echo "7) 若尚未配置 openclaw.json，可直接复制参考后按需修改："
  echo "   cp \"$PLUGIN_DIR/openclaw.json\" \"$OC_DIR/openclaw.json\""
  echo "   （注意：参考文件可能含 // 注释，若工具要求纯 JSON，请手动去掉注释）"
  echo ""
}
if $DRY_RUN; then
  print_openclaw_suggestions
  echo "  [dry-run] 未写入 $SUGGEST_FILE"
else
  print_openclaw_suggestions | tee "$SUGGEST_FILE"
  echo "  → 建议已保存到: $SUGGEST_FILE"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Installation $([ "$DRY_RUN" = true ] && echo 'Preview Complete            ' || echo 'Complete ✓                  ')║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Updated workspaces:   researcher, reviewer"
echo "  New workspaces:       orchestrator, coder, analyzer, academic_writer, cross-reviewer"
echo "  SOUL/AGENTS:          各 workspace 的 SOUL.md、AGENTS.md 已由插件版本替换（旧版已备份）"
echo "  Model (sub-agents):   modelstudio/glm-5"
echo "  Memory templates:     installed only if absent"
echo "  Projects root:        ~/.openclaw/projects (or from openclaw.json projectsRoot)"
echo "  openclaw-research.json: created/kept for agent path resolution (projectsRoot)"
echo "  openclaw.json:        未修改；修改建议已输出并保存到 openclaw-research-suggested-changes.txt"
echo "  Hooks:"
echo "    BOOTSTRAP.md  → all agent workspaces (session startup)"
echo "    HEARTBEAT.md  → workspace-researcher/ (every 2h state save)"
echo ""
echo "  Skills installed per agent:"
echo "    researcher   papers-cool, brainstorming-research-ideas, creative-thinking-for-research,"
echo "                 rss-papers, crawl4ai-search, scrapling, paper2md, github-download,"
echo "                 idea-generator, idea-phase, idea-tournament, novelty-check, research-lit,"
echo "                 research-pipeline, research-queue, research-reflect, experiment-phase,"
echo "                 parallel-experiments, run-experiment, monitor-experiment,"
echo "                 consensus-mapping, gap-detection, cross-paper-synthesis"
echo "    coder        implement-experiment, github-download"
echo "    analyzer     analyze-results, scientific-figures"
echo "    academic_writer paper-plan, paper-write, paper-phase, paper-compile,"
echo "                 ai-research-prompt, research-paper-writing"
echo "    orchestrator plan-research"
echo "    reviewer     review-phase, evidence-grading, review-response, paperreview-submit"
echo ""
if $DRY_RUN; then
  echo "  Run without --dry-run to apply changes."
else
  echo "  openclaw.json 未被修改；修改建议见: $OC_DIR/openclaw-research-suggested-changes.txt"
  echo ""
  echo "  To rollback researcher workspace SOUL/AGENTS:"
  echo "    cp '$OC_DIR/workspace-researcher/SOUL.md.bak.$DATE' '$OC_DIR/workspace-researcher/SOUL.md'"
fi
echo ""
