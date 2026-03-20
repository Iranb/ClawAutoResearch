#!/bin/bash
# OpenClaw Research Plugin Installer
# Usage: bash install.sh [--dry-run]
#
# 功能：
#   1. 检查插件中是否存在对应 agent 定义；若本机尚未配置该 agent，则使用 openclaw agents add 添加
#   2. 将技能复制到各 Agent 默认工作区的 skills 目录；若发现重复 skill，则仅保留 self-improving-agent，其他删除前会确认
#   3. 从 templates/memory 与 templates/hooks 复制模板到工作区（已存在则跳过）
#   4. 不修改现有 openclaw.json，仅输出建议配置到 openclaw-research-suggested-changes.txt
#   5. 同步 Researcher/Analyzer 的 PaperNexus graph skills 到共享工作区，供 Researcher/Orchestrator/Analyzer 使用
set -euo pipefail

PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$(dirname "$0")" && pwd)}"
OC_DIR="${OPENCLAW_HOME:-$HOME/.openclaw}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

expand_path() {
  echo "${1//\~/$HOME}"
}

OC_DIR_EXPANDED=$(expand_path "$OC_DIR")
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OC_DIR_EXPANDED/openclaw.json}"
SUGGESTED_CHANGES_FILE="$OC_DIR_EXPANDED/openclaw-research-suggested-changes.txt"

run() {
  if $DRY_RUN; then
    printf '  [dry-run]'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

highlight() {
  printf '\033[1;33m%s\033[0m\n' "$1"
}

die() {
  echo ""
  echo "✗ ERROR: $1" >&2
  exit 1
}

get_existing_agent_ids() {
  local json
  json=$(openclaw agents list --json 2>/dev/null) || true
  if [[ -z "$json" ]]; then
    return 0
  fi
  if command -v jq &>/dev/null; then
    echo "$json" | jq -r '.[].id'
  else
    echo "$json" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/"id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
  fi
}

agent_exists() {
  local id="$1"
  local existing
  existing=$(get_existing_agent_ids)
  echo "$existing" | grep -Fxq "$id" 2>/dev/null || false
}

workspace_for_agent() {
  case "$1" in
    researcher) echo "workspace-researcher" ;;
    reviewer) echo "workspace-reviewer" ;;
    orchestrator) echo "workspace-researcher" ;;
    coder) echo "workspace-researcher" ;;
    analyzer) echo "workspace-researcher" ;;
    academic_writer) echo "workspace-researcher" ;;
    cross-reviewer) echo "workspace-cross-reviewer" ;;
    *) echo "workspace-$1" ;;
  esac
}

path_seen() {
  local needle="$1"
  local haystack="${2:-}"
  printf '%s\n' "$haystack" | grep -Fxq "$needle" 2>/dev/null || false
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   OpenClaw Research Plugin — Installer              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Plugin:  $PLUGIN_DIR"
echo "  Target:  $OC_DIR_EXPANDED"
echo "  Mode:    $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes)' || echo 'LIVE')"
echo ""

echo "[ Pre-flight ]"

if ! command -v openclaw &>/dev/null; then
  die "未找到 openclaw 命令，请先安装 OpenClaw CLI 并确保在 PATH 中。"
fi

if [[ ! -d "$PLUGIN_DIR" ]]; then
  die "插件目录不存在: $PLUGIN_DIR"
fi

if [[ ! -d "$OC_DIR_EXPANDED" ]]; then
  if $DRY_RUN; then
    echo "  [dry-run] 将创建目录: $OC_DIR_EXPANDED"
  else
    mkdir -p "$OC_DIR_EXPANDED"
    echo "  → 已创建 $OC_DIR_EXPANDED"
  fi
fi

if [[ ! -f "$OPENCLAW_CONFIG_PATH" ]]; then
  echo "  ⚠ 未找到 $OPENCLAW_CONFIG_PATH"
  echo "    脚本仍会继续安装 agents / skills / templates，但不会修改或创建你的 openclaw.json。"
fi

echo "  ✓ openclaw 可用，配置目录就绪"
echo ""

echo "[1/4] 添加 Agents（openclaw agents add）..."

AGENTS=(
  "researcher|Researcher|workspace-researcher"
  "reviewer|Reviewer|workspace-reviewer"
  "orchestrator|Orchestrator|workspace-researcher"
  "coder|Coder|workspace-researcher"
  "analyzer|Analyzer|workspace-researcher"
  "academic_writer|Writer|workspace-researcher"
  "cross-reviewer|Cross-Reviewer|workspace-cross-reviewer"
)

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r id name workspace_rel <<< "$entry"
  workspace_abs="$OC_DIR_EXPANDED/$workspace_rel"

  if [[ ! -d "$PLUGIN_DIR/agents/$id" ]]; then
    echo "  → SKIP $id (插件内缺少 agents/$id)"
    continue
  fi

  if agent_exists "$id"; then
    echo "  → SKIP $id (已存在)"
    continue
  fi

  if ! $DRY_RUN && [[ ! -d "$workspace_abs" ]]; then
    mkdir -p "$workspace_abs"
  fi

  if run openclaw agents add "$id" --workspace "$workspace_abs" --model "modelstudio/glm-5" --non-interactive 2>/dev/null; then
    echo "  → ADD $id"
    if ! $DRY_RUN; then
      run openclaw agents set-identity --agent "$id" --name "$name" --workspace "$workspace_abs" 2>/dev/null || true
    fi
  else
    if ! $DRY_RUN && ! agent_exists "$id"; then
      echo "  ⚠ $id 添加失败，请检查 openclaw 与当前配置后重试"
    fi
  fi
done

echo ""

echo "[2/4] 检查重复技能..."

DUPLICATES=()

for agent in researcher reviewer orchestrator coder analyzer academic_writer cross-reviewer; do
  skill_src="$PLUGIN_DIR/skills/$agent"
  ws_rel="$(workspace_for_agent "$agent")"
  ws_skills="$OC_DIR_EXPANDED/$ws_rel/skills"

  [[ -d "$skill_src" ]] || continue
  [[ -d "$ws_skills" ]] || continue

  for skill_dir in "$skill_src"/*/; do
    [[ -d "$skill_dir" ]] || continue
    skill_name=$(basename "$skill_dir")
    dst="$ws_skills/$skill_name"
    if [[ -d "$dst" && "$skill_name" != "self-improving-agent" ]]; then
      DUPLICATES+=("$agent|$skill_name|$dst")
    fi
  done
done

DELETE_DUPLICATES=false
if [[ ${#DUPLICATES[@]} -gt 0 ]]; then
  echo "  发现重复 skills："
  for entry in "${DUPLICATES[@]}"; do
    IFS='|' read -r agent skill_name dst <<< "$entry"
    echo "    - $agent/$skill_name -> $dst"
  done
  echo "  规则：若为重复 skill，仅保留 self-improving-agent；其余重复项删除后再复制插件版本。"
  if $DRY_RUN; then
    echo "  [dry-run] 实际执行时会先询问你是否删除这些重复 skills。"
  else
    read -r -p "  确认删除上述重复 skills 并用插件版本覆盖吗？[y/N] " confirm_delete
    if [[ "$confirm_delete" =~ ^[Yy]$ ]]; then
      DELETE_DUPLICATES=true
    fi
  fi
else
  echo "  → 未发现需要确认删除的重复 skills"
fi

echo ""

echo "[3/4] 复制技能到 Agent 工作区 skills..."

PLANNED_DESTS=""

for agent in researcher reviewer orchestrator coder analyzer academic_writer cross-reviewer; do
  skill_src="$PLUGIN_DIR/skills/$agent"
  ws_rel="$(workspace_for_agent "$agent")"
  ws_skills="$OC_DIR_EXPANDED/$ws_rel/skills"

  [[ -d "$skill_src" ]] || continue

  if ! $DRY_RUN; then
    mkdir -p "$ws_skills"
  fi

  for skill_dir in "$skill_src"/*/; do
    [[ -d "$skill_dir" ]] || continue
    skill_name=$(basename "$skill_dir")
    dst="$ws_skills/$skill_name"

    if [[ "$skill_name" != "self-improving-agent" ]] && path_seen "$dst" "$PLANNED_DESTS"; then
      echo "  → SKIP $agent/$skill_name (本次安装中已有同名目标路径，避免重复覆盖)"
      continue
    fi

    PLANNED_DESTS="${PLANNED_DESTS}"$'\n'"$dst"

    if [[ -d "$dst" ]]; then
      if [[ "$skill_name" == "self-improving-agent" ]]; then
        echo "  → KEEP $agent/$skill_name (按规则保留现有 self-improving-agent)"
      elif $DELETE_DUPLICATES; then
        run rm -rf "$dst"
        run cp -r "$skill_dir" "$dst"
        echo "  → REPLACE $agent/$skill_name (已确认删除重复 skill)"
      else
        echo "  → SKIP $agent/$skill_name (已存在；未确认删除重复项)"
      fi
    else
      run cp -r "$skill_dir" "$dst"
      echo "  → COPY $agent/$skill_name"
    fi
  done
done

echo ""

echo "[4/4] 复制模板（templates/memory、templates/hooks）到工作区（已存在则跳过）..."

if [[ -d "$PLUGIN_DIR/templates/memory" ]]; then
  ws_memory="$OC_DIR_EXPANDED/workspace-researcher/memory"
  if ! $DRY_RUN; then mkdir -p "$ws_memory"; fi
  for f in ideation-memory.md experiment-memory.md; do
    [[ -f "$PLUGIN_DIR/templates/memory/$f" ]] || continue
    dst="$ws_memory/$f"
    if [[ -f "$dst" ]]; then
      echo "  → SKIP memory/$f (已存在)"
    else
      run cp "$PLUGIN_DIR/templates/memory/$f" "$dst"
      echo "  → COPY memory/$f"
    fi
  done
fi

HOOK_WORKSPACES=( "workspace-researcher" "workspace-reviewer" "workspace-cross-reviewer" )
for ws_rel in "${HOOK_WORKSPACES[@]}"; do
  ws_root="$OC_DIR_EXPANDED/$ws_rel"
  [[ -d "$ws_root" ]] || continue
  for hook in BOOTSTRAP.md HEARTBEAT.md; do
    src="$PLUGIN_DIR/templates/hooks/$hook"
    [[ -f "$src" ]] || continue
    dst="$ws_root/$hook"
    if [[ -f "$dst" ]]; then
      echo "  → SKIP $ws_rel/$hook (已存在)"
    else
      run cp "$src" "$dst"
      echo "  → COPY $ws_rel/$hook"
    fi
  done
done

if $DRY_RUN; then
  echo ""
  echo "  [dry-run] 将生成建议配置文件: $SUGGESTED_CHANGES_FILE"
else
  cat > "$SUGGESTED_CHANGES_FILE" <<EOF
OpenClaw Research suggested manual config changes
===============================================

This installer does NOT modify your existing openclaw.json.
Please manually ensure your active OpenClaw config includes the following:

1. Agents that should exist
   - researcher
   - reviewer
   - orchestrator
   - coder
   - analyzer
   - academic_writer
   - cross-reviewer

2. Suggested workspaces
   - researcher: $OC_DIR_EXPANDED/workspace-researcher
   - reviewer: $OC_DIR_EXPANDED/workspace-reviewer
   - orchestrator: $OC_DIR_EXPANDED/workspace-researcher
   - coder: $OC_DIR_EXPANDED/workspace-researcher
   - analyzer: $OC_DIR_EXPANDED/workspace-researcher
   - academic_writer: $OC_DIR_EXPANDED/workspace-researcher
   - cross-reviewer: $OC_DIR_EXPANDED/workspace-cross-reviewer

3. Suggested skills roots
   - researcher: ["~/.openclaw/skills", "./skills/researcher"]
   - reviewer: ["~/.openclaw/skills", "./skills/reviewer"]
   - orchestrator: ["~/.openclaw/skills", "./skills/orchestrator"]
   - coder: ["~/.openclaw/skills", "./skills/coder"]
   - analyzer: ["~/.openclaw/skills", "./skills/analyzer"]
   - academic_writer: ["~/.openclaw/skills", "./skills/academic_writer"]
   - cross-reviewer: ["~/.openclaw/skills", "./skills/cross-reviewer"]

4. Suggested researcher subagents.allowAgents
   - orchestrator
   - coder
   - analyzer
   - academic_writer
   - reviewer
   - cross-reviewer

5. Suggested top-level projectsRoot
   - ~/.openclaw/projects

6. Suggested tools / sandbox highlights
   - researcher sandbox off, allow ["*"]
   - coder allow bash
   - analyzer allow bash
   - reviewer allow bash if you use paperreview-submit / reviewloop
   - allow the plugin tool `research_memory` for agents that write structured project memory

7. Suggested default agent
   - researcher

8. Suggested plugin settings
   - enable plugin: openclaw-research
   - load path should include this plugin root or install/link the plugin directory
   - plugin config:
     * allowWorkspaceFallback: false
     * requireProjectIsolation: true
     * requireProjectIdInEntries: true
     * requireTrackId: true
     * requireEvidencePointers: true
     * reviewStateMaxAgeHours: 24

9. Shared graph-skill highlights
   - keep `papernexus` and `papernexus-agentic-reasoning` installed in the shared researcher workspace
   - keep `papernexus-reflection` installed for analyzer-side reflection and verdict writing

Reference file in plugin:
  $PLUGIN_DIR/openclaw.json
EOF
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Installation $([ "$DRY_RUN" = true ] && echo 'Preview Complete            ' || echo 'Complete ✓                  ')║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  1. Agents: 已按插件内 agent 定义添加/跳过（researcher, reviewer, orchestrator, coder, analyzer, academic_writer, cross-reviewer）"
echo "  2. Skills: 已复制到各 Agent 工作区 skills；重复项仅在你确认后删除并覆盖，self-improving-agent 保留"
echo "  3. Template: templates/memory、templates/hooks 已复制到工作区，已存在项已跳过"
echo "  4. Config: 未修改你的 openclaw.json，只生成了建议配置清单"
echo ""
highlight "  请手动检查以下配置项：agents、workspaces、skills roots、researcher subagents.allowAgents、projectsRoot、reviewer bash"
echo "  建议清单：$SUGGESTED_CHANGES_FILE"
echo ""
if $DRY_RUN; then
  echo "  使用不带 --dry-run 的方式运行以应用更改。"
fi
echo ""
