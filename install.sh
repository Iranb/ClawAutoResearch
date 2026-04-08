#!/bin/bash
# ClawAutoResearch Plugin Installer
# Usage:
#   bash install.sh [--dry-run] [--force-role-files] [--skip-agent-create] [--yes]
#
# 功能：
#   1. 可选地添加或检查研究工作流所需的 agents
#   2. 同步各 agent skills（包括 vendored `pasa-paper-search`），并处理重复 skill
#   3. 若本机存在 PaperNexus 仓库，则自动发现并同步 SKILL/ 下全部 Skills 到本仓库后再安装
#   4. 创建/更新插件链接到 ~/.openclaw/plugins/ClawAutoResearch
#   5. 同步共享工作区核心配置、模板和 researcher/reviewer/cross-reviewer 根配置
#   6. 不修改用户 openclaw.json
#   7. 安装完成后提示 Auto mode、自动讨论和 /workflow-status 的使用方式
#   8. 保留仓库内 README / DOC / openclaw.RECOMMENDED.json 作为唯一说明来源

set -euo pipefail

PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$(dirname "$0")" && pwd)}"
OC_DIR="${OPENCLAW_HOME:-$HOME/.openclaw}"
PAPERNEXUS_DIR="${PAPERNEXUS_DIR:-/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/PaperNexus}"
DRY_RUN=false
FORCE_ROLE_FILES=false
SKIP_AGENT_CREATE=false
ASSUME_YES=false
INSTALL_MODE="full"
INSTALL_MODE_LABEL="FULL INSTALL"
RUN_AGENT_PHASE=true
RUN_PAPERNEXUS_PHASE=true
RUN_SKILL_PHASE=true
RUN_PLUGIN_LINK_PHASE=true
RUN_WORKSPACE_PHASE=true
FORCE_MENU_INPUT="${OPENCLAW_INSTALL_FORCE_MENU:-}"
ORIGINAL_ARG_COUNT=$#
PAPERNEXUS_SYNCED_SKILL_ENTRIES=()

usage() {
  cat <<'EOF'
Usage: bash install.sh [--dry-run] [--force-role-files] [--skip-agent-create] [--yes]

Options:
  --dry-run           只预览，不实际写入
  --force-role-files  覆盖 workspace root 中已存在的 researcher/reviewer/cross-reviewer 角色配置文件
  --skip-agent-create 跳过 `openclaw agents add` / `set-identity`，只同步插件、skills、模板和角色配置
  --yes               非交互模式下默认回答 yes，并采用完整安装流程
  -h, --help          显示帮助

Environment:
  OPENCLAW_HOME       默认是 ~/.openclaw
  OPENCLAW_CONFIG_PATH 默认是 $OPENCLAW_HOME/openclaw.json
  PAPERNEXUS_DIR      默认是 /Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/PaperNexus
  OPENCLAW_INSTALL_ASSUME_YES=1 可在非交互环境默认回答 yes
  OPENCLAW_INSTALL_FORCE_MENU=1 可在非 TTY 环境强制显示快捷菜单
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --force-role-files)
      FORCE_ROLE_FILES=true
      ;;
    --skip-agent-create)
      SKIP_AGENT_CREATE=true
      ;;
    --yes)
      ASSUME_YES=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

expand_path() {
  echo "${1//\~/$HOME}"
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|y|Y|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if is_truthy "${OPENCLAW_INSTALL_ASSUME_YES:-}"; then
  ASSUME_YES=true
fi

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
  echo "ERROR: $1" >&2
  exit 1
}

prompt_install_mode() {
  echo ""
  echo "[ Quick Mode ]"
  echo "  1. 完整安装"
  echo "  2. 仅同步 skills"
  echo "  3. 仅同步 workspace"
  echo "  4. 高级自定义"

  while true; do
    read -r -p "  请选择 [1-4，回车默认 1]: " selection || die "未读取到安装模式，请重试。"
    case "$selection" in
      ""|1)
        INSTALL_MODE="full"
        INSTALL_MODE_LABEL="FULL INSTALL"
        return 0
        ;;
      2)
        INSTALL_MODE="skills-only"
        INSTALL_MODE_LABEL="SKILLS ONLY"
        return 0
        ;;
      3)
        INSTALL_MODE="workspace-only"
        INSTALL_MODE_LABEL="WORKSPACE ONLY"
        return 0
        ;;
      4)
        INSTALL_MODE="advanced-custom"
        INSTALL_MODE_LABEL="ADVANCED CUSTOM"
        return 0
        ;;
      *)
        echo "  请输入 1 到 4。"
        ;;
    esac
  done
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local suffix
  local answer

  if [[ "$default" == "y" ]]; then
    suffix="[Y/n]"
  else
    suffix="[y/N]"
  fi

  if $ASSUME_YES; then
    return 0
  fi

  while true; do
    read -r -p "  $prompt $suffix " answer || die "未读取到确认输入，请重试。"
    if [[ -z "$answer" ]]; then
      [[ "$default" == "y" ]]
      return
    fi
    case "$answer" in
      y|Y|yes|YES)
        return 0
        ;;
      n|N|no|NO)
        return 1
        ;;
      *)
        echo "  请输入 y 或 n。"
        ;;
    esac
  done
}

configure_install_mode() {
  RUN_AGENT_PHASE=false
  RUN_PAPERNEXUS_PHASE=false
  RUN_SKILL_PHASE=false
  RUN_PLUGIN_LINK_PHASE=false
  RUN_WORKSPACE_PHASE=false

  case "$INSTALL_MODE" in
    full)
      RUN_AGENT_PHASE=true
      RUN_PAPERNEXUS_PHASE=true
      RUN_SKILL_PHASE=true
      RUN_PLUGIN_LINK_PHASE=true
      RUN_WORKSPACE_PHASE=true
      ;;
    skills-only)
      RUN_PAPERNEXUS_PHASE=true
      RUN_SKILL_PHASE=true
      ;;
    workspace-only)
      RUN_WORKSPACE_PHASE=true
      ;;
    advanced-custom)
      echo ""
      echo "[ Advanced Custom ]"
      if prompt_yes_no "创建或检查 Agents？" "y"; then
        RUN_AGENT_PHASE=true
      fi
      if prompt_yes_no "同步本机 PaperNexus skills？" "y"; then
        RUN_PAPERNEXUS_PHASE=true
      fi
      if prompt_yes_no "检查重复 skill 并同步 skills？" "y"; then
        RUN_SKILL_PHASE=true
      fi
      if prompt_yes_no "创建或更新插件链接？" "y"; then
        RUN_PLUGIN_LINK_PHASE=true
      fi
      if prompt_yes_no "同步 workspace 配置、模板和角色根文件？" "y"; then
        RUN_WORKSPACE_PHASE=true
      fi
      ;;
    *)
      die "未知安装模式: $INSTALL_MODE"
      ;;
  esac
}

ensure_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    return 0
  fi
  if $DRY_RUN; then
    echo "  [dry-run] 将创建目录: $dir"
  else
    mkdir -p "$dir"
    echo "  -> 已创建 $dir"
  fi
}

path_exists() {
  [[ -e "$1" || -L "$1" ]]
}

copy_file() {
  local src="$1"
  local dst="$2"
  local label="$3"
  local overwrite="${4:-false}"

  if [[ ! -f "$src" ]]; then
    echo "  WARN: SKIP $label (源文件不存在: $src)"
    return 0
  fi

  if [[ -e "$dst" || -L "$dst" ]]; then
    if [[ "$overwrite" == "true" ]]; then
      if ! $DRY_RUN; then
        mkdir -p "$(dirname "$dst")"
      fi
      run cp "$src" "$dst"
      echo "  -> UPDATE $label"
    else
      echo "  -> SKIP $label (已存在)"
    fi
  else
    if ! $DRY_RUN; then
      mkdir -p "$(dirname "$dst")"
    fi
    run cp "$src" "$dst"
    echo "  -> COPY $label"
  fi
}

remove_path() {
  local target="$1"
  if ! path_exists "$target"; then
    return 0
  fi
  if $DRY_RUN; then
    echo "  [dry-run] 将删除: $target"
  else
    rm -rf "$target"
  fi
}

sync_skill_dir() {
  local src="$1"
  local dst="$2"
  local label="$3"

  if [[ ! -d "$src" && ! -L "$src" ]]; then
    echo "  -> SKIP $label (源目录不存在)"
    return 0
  fi

  if [[ -L "$src" ]]; then
    local link_target
    link_target=$(readlink "$src")
    if [[ -L "$dst" ]]; then
      local existing_target
      existing_target=$(readlink "$dst")
      if [[ "$existing_target" == "$link_target" ]]; then
        echo "  -> KEEP $label"
        return 0
      fi
    fi
    remove_path "$dst"
    if $DRY_RUN; then
      echo "  [dry-run] 将创建符号链接: $dst -> $link_target"
    else
      ln -s "$link_target" "$dst"
    fi
    echo "  -> LINK $label"
    return 0
  fi

  if [[ -d "$dst" ]]; then
    remove_path "$dst"
  fi
  run cp -R "$src" "$dst"
  echo "  -> COPY $label"
}

papernexus_skill_name_from_frontmatter() {
  local skill_md="$1"
  local name

  [[ -f "$skill_md" ]] || return 0

  name=$(awk '
    NR == 1 && $0 == "---" { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" { exit }
    in_frontmatter && $0 ~ /^name:[[:space:]]*/ {
      sub(/^name:[[:space:]]*/, "", $0)
      print
      exit
    }
  ' "$skill_md")

  name="${name%\"}"
  name="${name#\"}"
  name="${name%\'}"
  name="${name#\'}"
  printf '%s\n' "$name"
}

papernexus_skill_slug_from_dirname() {
  local raw="$1"

  case "$raw" in
    PaperNexus)
      printf 'papernexus\n'
      return 0
      ;;
    PaperNexus*)
      raw="papernexus-${raw#PaperNexus}"
      ;;
  esac

  printf '%s\n' "$raw" | sed -E 's/([A-Z]+)([A-Z][a-z])/\1-\2/g; s/([a-z0-9])([A-Z])/\1-\2/g' | tr '[:upper:]' '[:lower:]'
}

papernexus_skill_slug() {
  local skill_dir="$1"
  local skill_md="$skill_dir/SKILL.md"
  local slug

  slug=$(papernexus_skill_name_from_frontmatter "$skill_md")
  if [[ -n "$slug" ]]; then
    printf '%s\n' "$slug"
    return 0
  fi

  papernexus_skill_slug_from_dirname "$(basename "$skill_dir")"
}

find_existing_skill_agent_for_slug() {
  local slug="$1"
  local agent

  for agent in researcher analyzer orchestrator coder reviewer academic_writer cross-reviewer; do
    if [[ -d "$PLUGIN_DIR/skills/$agent/$slug" || -L "$PLUGIN_DIR/skills/$agent/$slug" ]]; then
      printf '%s\n' "$agent"
      return 0
    fi
  done

  return 0
}

papernexus_skill_target_agent() {
  local slug="$1"
  local existing_agent

  existing_agent=$(find_existing_skill_agent_for_slug "$slug")
  if [[ -n "$existing_agent" ]]; then
    printf '%s\n' "$existing_agent"
    return 0
  fi

  case "$slug" in
    papernexus-reflection)
      printf 'analyzer\n'
      ;;
    *)
      printf 'researcher\n'
      ;;
  esac
}

update_skills_index_for_papernexus_skills() {
  local skills_index_path="$PLUGIN_DIR/skills/index.json"
  local entry

  [[ ${#PAPERNEXUS_SYNCED_SKILL_ENTRIES[@]} -gt 0 ]] || return 0

  if [[ ! -f "$skills_index_path" ]]; then
    echo "  WARN: 未找到 $skills_index_path，跳过 PaperNexus skill 注册更新"
    return 0
  fi

  if $DRY_RUN; then
    echo "  [dry-run] 将更新 skills/index.json 中的 PaperNexus skill 注册："
    for entry in "${PAPERNEXUS_SYNCED_SKILL_ENTRIES[@]}"; do
      IFS='|' read -r agent slug <<< "$entry"
      echo "    - ./$agent/$slug"
    done
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "  WARN: 未找到 node，跳过 skills/index.json 自动更新；请手动注册新增 PaperNexus skills"
    return 0
  fi

  local entries_tmp
  local next_index_tmp
  entries_tmp=$(mktemp)
  next_index_tmp=$(mktemp)
  printf '%s\n' "${PAPERNEXUS_SYNCED_SKILL_ENTRIES[@]}" > "$entries_tmp"

  if node - "$skills_index_path" "$entries_tmp" "$next_index_tmp" <<'NODE'
const fs = require("fs");

const [indexPath, entriesPath, outputPath] = process.argv.slice(2);
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const entries = fs
  .readFileSync(entriesPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

for (const entry of entries) {
  const [agent, slug] = entry.split("|");
  if (!agent || !slug) {
    continue;
  }
  const relPath = `./${agent}/${slug}`;
  if (!Array.isArray(index[agent])) {
    index[agent] = [];
  }
  if (!index[agent].includes(relPath)) {
    index[agent].push(relPath);
  }
}

fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`);
NODE
  then
    if cmp -s "$skills_index_path" "$next_index_tmp"; then
      echo "  -> KEEP skills/index.json (PaperNexus skill 注册已最新)"
    else
      cp "$next_index_tmp" "$skills_index_path"
      echo "  -> UPDATE skills/index.json (PaperNexus skill 注册)"
    fi
  else
    echo "  WARN: 自动更新 skills/index.json 失败；请手动检查 PaperNexus skill 注册"
  fi

  rm -f "$entries_tmp" "$next_index_tmp"
}

sync_papernexus_skills() {
  local papernexus_skill_root="$PAPERNEXUS_DIR/SKILL"
  local skill_md
  local found_any=false
  if [[ ! -d "$PAPERNEXUS_DIR" || ! -d "$papernexus_skill_root" ]]; then
    echo "  -> SKIP PaperNexus skills (未检测到 $papernexus_skill_root)"
    return 0
  fi

  echo "  -> 检测到 PaperNexus: $PAPERNEXUS_DIR"
  ensure_dir "$PLUGIN_DIR/skills/researcher"
  ensure_dir "$PLUGIN_DIR/skills/analyzer"

  PAPERNEXUS_SYNCED_SKILL_ENTRIES=()

  for skill_md in "$papernexus_skill_root"/*/SKILL.md; do
    local skill_dir
    local slug
    local target_agent
    local target_dir

    [[ -f "$skill_md" ]] || continue
    found_any=true
    skill_dir=$(dirname "$skill_md")
    slug=$(papernexus_skill_slug "$skill_dir")

    if [[ -z "$slug" ]]; then
      echo "  WARN: SKIP $(basename "$skill_dir") (未能解析 skill slug)"
      continue
    fi

    target_agent=$(papernexus_skill_target_agent "$slug")
    target_dir="$PLUGIN_DIR/skills/$target_agent/$slug"
    ensure_dir "$PLUGIN_DIR/skills/$target_agent"
    sync_skill_dir "$skill_dir" "$target_dir" "$target_agent/$slug"
    PAPERNEXUS_SYNCED_SKILL_ENTRIES+=("$target_agent|$slug")
  done

  if ! $found_any; then
    echo "  -> SKIP PaperNexus skills (未在 $papernexus_skill_root 下找到 SKILL.md)"
    return 0
  fi

  update_skills_index_for_papernexus_skills
}

get_existing_agent_ids() {
  local json
  json=$(get_openclaw_agents_json) || true
  if [[ -z "$json" ]]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1 && printf '%s\n' "$json" | jq -e . >/dev/null 2>&1; then
    printf '%s\n' "$json" | jq -r '.[].id'
  else
    printf '%s\n' "$json" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/"id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
  fi
}

get_existing_agent_workspace() {
  local id="$1"
  local json
  json=$(get_openclaw_agents_json) || true
  if [[ -z "$json" ]]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1 && printf '%s\n' "$json" | jq -e . >/dev/null 2>&1; then
    printf '%s\n' "$json" | jq -r --arg id "$id" '.[] | select(.id == $id) | .workspace // empty'
  else
    printf '%s\n' "$json" | awk -v id="$id" '
      BEGIN { RS="\\{" }
      $0 ~ "\"id\"[[:space:]]*:[[:space:]]*\"" id "\"" {
        if (match($0, /"workspace"[[:space:]]*:[[:space:]]*"[^"]+"/)) {
          value = substr($0, RSTART, RLENGTH)
          sub(/^.*"workspace"[[:space:]]*:[[:space:]]*"/, "", value)
          sub(/"$/, "", value)
          print value
        }
      }
    '
  fi
}

extract_first_json_array() {
  awk '
    BEGIN {
      capture = 0
      depth = 0
    }
    {
      line = $0
      if (!capture) {
        if (line ~ /^[[:space:]]*\[/) {
          capture = 1
        } else {
          next
        }
      }
      print line
      tmp = line
      open_count = gsub(/\[/, "[", tmp)
      tmp = line
      close_count = gsub(/\]/, "]", tmp)
      depth += open_count - close_count
      if (capture && depth == 0) {
        exit
      }
    }
  '
}

get_openclaw_agents_json() {
  local raw
  local sanitized
  raw=$(openclaw agents list --json 2>/dev/null) || true
  if [[ -z "$raw" ]]; then
    return 0
  fi
  sanitized=$(printf '%s\n' "$raw" | extract_first_json_array)
  if [[ -n "$sanitized" ]]; then
    if command -v jq >/dev/null 2>&1; then
      if printf '%s\n' "$sanitized" | jq -e . >/dev/null 2>&1; then
        printf '%s\n' "$sanitized"
        return 0
      fi
    else
      printf '%s\n' "$sanitized"
      return 0
    fi
  fi
  printf '%s\n' "$raw"
}

agent_exists() {
  local id="$1"
  local existing
  existing=$(get_existing_agent_ids || true)
  echo "$existing" | grep -Fxq "$id" 2>/dev/null || false
}

default_workspace_rel_for_agent() {
  case "$1" in
    researcher) echo "workspace-researcher" ;;
    reviewer) echo "workspace-reviewer" ;;
    orchestrator) echo "workspace-orchestrator" ;;
    coder) echo "workspace-coder" ;;
    analyzer) echo "workspace-analyzer" ;;
    academic_writer) echo "workspace-academic_writer" ;;
    cross-reviewer) echo "workspace-cross-reviewer" ;;
    *) echo "workspace-$1" ;;
  esac
}

workspace_for_agent() {
  local id="$1"
  local existing_workspace
  existing_workspace=$(get_existing_agent_workspace "$id" || true)
  if [[ -n "$existing_workspace" ]]; then
    echo "$existing_workspace"
  else
    echo "$OC_DIR_EXPANDED/$(default_workspace_rel_for_agent "$id")"
  fi
}

copy_role_bundle() {
  local role="$1"
  local ws_root="$2"
  local overwrite="$3"
  local ws_name
  ws_name=$(basename "$ws_root")
  local files=(AGENTS.md SOUL.md IDENTITY.md TOOLS.md BOOT.md BOOTSTRAP.md HEARTBEAT.md)

  if [[ "$role" == "researcher" ]]; then
    files+=(SERVER.md)
  fi

  for file in "${files[@]}"; do
    local src="$PLUGIN_DIR/agents/$role/$file"
    local dst="$ws_root/$file"
    if [[ "$overwrite" != "true" && ( -e "$dst" || -L "$dst" ) ]]; then
      echo "    -> SKIP $ws_name/$file (已存在；使用 --force-role-files 可覆盖)"
    else
      copy_file "$src" "$dst" "$ws_name/$file" "$overwrite"
    fi
  done
}

sync_plugin_link() {
  local plugin_link="$1"
  if [[ -L "$plugin_link" ]]; then
    local target
    target=$(readlink "$plugin_link")
    if [[ "$target" == "$PLUGIN_DIR" ]]; then
      echo "  -> KEEP 插件链接 $plugin_link"
    else
      run ln -sfn "$PLUGIN_DIR" "$plugin_link"
      echo "  -> RELINK 插件链接 $plugin_link -> $PLUGIN_DIR"
    fi
  elif [[ -e "$plugin_link" ]]; then
    echo "  WARN: $plugin_link 已存在且不是符号链接；不会覆盖，请手动处理"
  else
    run ln -s "$PLUGIN_DIR" "$plugin_link"
    echo "  -> LINK 插件链接 $plugin_link -> $PLUGIN_DIR"
  fi
}

if is_truthy "$FORCE_MENU_INPUT" && ! $ASSUME_YES; then
  prompt_install_mode
elif (( ORIGINAL_ARG_COUNT == 0 )) && [[ -t 0 ]] && ! $ASSUME_YES; then
  prompt_install_mode
fi

configure_install_mode

OC_DIR_EXPANDED=$(expand_path "$OC_DIR")
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OC_DIR_EXPANDED/openclaw.json}"
OC_PLUGINS_DIR="$OC_DIR_EXPANDED/plugins"
PLUGIN_LINK="$OC_PLUGINS_DIR/ClawAutoResearch"
PLUGIN_REFERENCE_PATH="$PLUGIN_LINK"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ClawAutoResearch Plugin — Installer               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Plugin:  $PLUGIN_DIR"
echo "  Target:  $OC_DIR_EXPANDED"
echo "  PaperNexus: $PAPERNEXUS_DIR"
echo "  Mode:    $INSTALL_MODE_LABEL"
echo "  Mode:    $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes)' || echo 'LIVE')"
echo "  Force:   $([ "$FORCE_ROLE_FILES" = true ] && echo 'overwrite role root files' || echo 'preserve existing role root files')"
if ! $RUN_AGENT_PHASE; then
  echo "  Agents:  skipped by selected mode"
elif [ "$SKIP_AGENT_CREATE" = true ]; then
  echo "  Agents:  skip openclaw agents add"
else
  echo "  Agents:  create/check via openclaw"
fi
echo ""

echo "[ Pre-flight ]"

if ! command -v openclaw >/dev/null 2>&1; then
  if ! $RUN_AGENT_PHASE || $SKIP_AGENT_CREATE; then
    echo "  WARN: 未找到 openclaw 命令，但当前不会执行 Agent 创建；将继续同步其余内容。"
  else
    die "未找到 openclaw 命令，请先安装 OpenClaw CLI 并确保在 PATH 中，或使用 --skip-agent-create 跳过 Agent 创建。"
  fi
fi

if [[ ! -d "$PLUGIN_DIR" ]]; then
  die "插件目录不存在: $PLUGIN_DIR"
fi

ensure_dir "$OC_DIR_EXPANDED"
ensure_dir "$OC_PLUGINS_DIR"

if [[ ! -f "$OPENCLAW_CONFIG_PATH" ]]; then
  echo "  WARN: 未找到 $OPENCLAW_CONFIG_PATH"
  echo "        脚本仍会继续安装 agents / skills / templates，但不会修改或创建你的 openclaw.json。"
fi

if [[ ! -f "$PLUGIN_DIR/dist/index.js" ]]; then
  echo "  WARN: 未检测到 $PLUGIN_DIR/dist/index.js"
  echo "        建议先执行 npm run build，再运行安装脚本。"
else
  echo "  -> 已检测到构建产物 dist/index.js"
fi

echo "  -> 配置目录就绪"
echo ""

echo "[1/7] 添加 Agents（openclaw agents add）..."

AGENTS=(
  "researcher|Researcher|workspace-researcher"
  "reviewer|Reviewer|workspace-reviewer"
  "orchestrator|Orchestrator|workspace-orchestrator"
  "coder|Coder|workspace-coder"
  "analyzer|Analyzer|workspace-analyzer"
  "academic_writer|Writer|workspace-academic_writer"
  "cross-reviewer|Cross-Reviewer|workspace-cross-reviewer"
)

if ! $RUN_AGENT_PHASE; then
  echo "  -> SKIP 添加 Agents（当前模式未包含）"
elif $SKIP_AGENT_CREATE; then
  echo "  -> SKIP 全部 Agent 创建（已启用 --skip-agent-create）"
else
  for entry in "${AGENTS[@]}"; do
    IFS='|' read -r id name workspace_rel <<< "$entry"
    workspace_abs="$OC_DIR_EXPANDED/$workspace_rel"

    if [[ ! -d "$PLUGIN_DIR/agents/$id" ]]; then
      echo "  -> SKIP $id (插件内缺少 agents/$id)"
      continue
    fi

    ensure_dir "$workspace_abs"

    if agent_exists "$id"; then
      echo "  -> KEEP $id (已存在)"
      continue
    fi

    if run openclaw agents add "$id" --workspace "$workspace_abs" --model "modelstudio/glm-5" --non-interactive 2>/dev/null; then
      echo "  -> ADD $id"
      if ! $DRY_RUN; then
        run openclaw agents set-identity --agent "$id" --name "$name" --workspace "$workspace_abs" 2>/dev/null || true
      fi
    else
      echo "  WARN: $id 添加失败，请检查 openclaw 与当前配置后重试"
    fi
  done
fi

echo ""
echo "[2/7] 同步本机 PaperNexus Skills（如果存在）..."

if $RUN_PAPERNEXUS_PHASE; then
  sync_papernexus_skills
else
  echo "  -> SKIP PaperNexus skills 同步（当前模式未包含）"
fi

echo ""
echo "[3/7] 检查重复技能..."

DELETE_DUPLICATES=false
if $RUN_SKILL_PHASE; then
  DUPLICATES=()

  for agent in researcher reviewer orchestrator coder analyzer academic_writer cross-reviewer; do
    skill_src="$PLUGIN_DIR/skills/$agent"
    ws_root="$(workspace_for_agent "$agent")"
    ws_skills="$ws_root/skills"

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
      if prompt_yes_no "确认删除上述重复 skills 并用插件版本覆盖吗？" "n"; then
        DELETE_DUPLICATES=true
      fi
    fi
  else
    echo "  -> 未发现需要确认删除的重复 skills"
  fi
else
  echo "  -> SKIP 检查重复技能（当前模式未包含）"
fi

echo ""
echo "[4/7] 复制技能到 Agent 工作区 skills（包括 vendored retrieval skills）..."

if $RUN_SKILL_PHASE; then
  for agent in researcher reviewer orchestrator coder analyzer academic_writer cross-reviewer; do
    skill_src="$PLUGIN_DIR/skills/$agent"
    ws_root="$(workspace_for_agent "$agent")"
    ws_skills="$ws_root/skills"

    [[ -d "$skill_src" ]] || continue
    ensure_dir "$ws_skills"

    for skill_dir in "$skill_src"/*/; do
      [[ -d "$skill_dir" ]] || continue
      skill_name=$(basename "$skill_dir")
      dst="$ws_skills/$skill_name"

      if [[ -L "$skill_dir" ]]; then
        if [[ -L "$dst" || -d "$dst" ]]; then
          if [[ "$skill_name" == "self-improving-agent" ]]; then
            echo "  -> KEEP $agent/$skill_name (按规则保留现有 self-improving-agent)"
          else
            if $DELETE_DUPLICATES || [[ ! -d "$dst" ]]; then
              remove_path "$dst"
              if $DRY_RUN; then
                echo "  [dry-run] 将创建符号链接：$dst -> $(readlink "$skill_dir")"
              else
                ln -s "$(readlink "$skill_dir")" "$dst"
                echo "  -> RELINK $agent/$skill_name"
              fi
            else
              echo "  -> SKIP $agent/$skill_name (保留现有版本)"
            fi
          fi
        else
          if $DRY_RUN; then
            echo "  [dry-run] 将创建符号链接：$dst -> $(readlink "$skill_dir")"
          else
            ln -s "$(readlink "$skill_dir")" "$dst"
            echo "  -> LINK $agent/$skill_name"
          fi
        fi
      else
        if [[ -d "$dst" ]]; then
          if [[ "$skill_name" == "self-improving-agent" ]]; then
            echo "  -> KEEP $agent/$skill_name (按规则保留现有 self-improving-agent)"
          elif $DELETE_DUPLICATES || [[ ! -d "$dst" ]]; then
            remove_path "$dst"
            run cp -R "$skill_dir" "$dst"
            echo "  -> REPLACE $agent/$skill_name"
          else
            echo "  -> SKIP $agent/$skill_name (保留现有版本)"
          fi
        else
          run cp -R "$skill_dir" "$dst"
          echo "  -> COPY $agent/$skill_name"
        fi
      fi
    done
  done
else
  echo "  -> SKIP 同步 skills（当前模式未包含）"
fi

echo ""
echo "[5/7] 创建插件链接..."

if $RUN_PLUGIN_LINK_PHASE; then
  sync_plugin_link "$PLUGIN_LINK"
  if [[ -e "$PLUGIN_LINK" && ! -L "$PLUGIN_LINK" ]]; then
    PLUGIN_REFERENCE_PATH="$PLUGIN_DIR"
  fi
else
  echo "  -> SKIP 创建插件链接（当前模式未包含）"
fi

echo ""
echo "[6/7] 同步工作区配置、模板和角色根配置..."

RESEARCHER_WS="$OC_DIR_EXPANDED/workspace-researcher"
REVIEWER_WS="$OC_DIR_EXPANDED/workspace-reviewer"
CROSS_REVIEWER_WS="$OC_DIR_EXPANDED/workspace-cross-reviewer"

if $RUN_WORKSPACE_PHASE; then
  for ws_root in "$RESEARCHER_WS" "$REVIEWER_WS" "$CROSS_REVIEWER_WS"; do
    ensure_dir "$ws_root"
  done

  echo "  -> 复制共享核心配置文件..."
  CORE_FILES=(CONFIG.md WORKFLOW.md WORKSPACE.md)
  for ws_root in "$RESEARCHER_WS" "$REVIEWER_WS" "$CROSS_REVIEWER_WS"; do
    ws_name=$(basename "$ws_root")
    for file in "${CORE_FILES[@]}"; do
      copy_file "$PLUGIN_DIR/$file" "$ws_root/$file" "$ws_name/$file"
    done
  done

  echo "  -> 复制研究工作区模板文件..."
  TEMPLATE_FILES=(
    PROJECT_MANIFEST.json
    TRACK_REGISTRY.json
    CLAIM_POLICY.md
    EXPERIMENT_LEDGER.json
    EXPERIMENT_REGISTRY.md
    IDEA_TOURNAMENT_STATE.json
    PROJECTS_STATE.json
  )
  for file in "${TEMPLATE_FILES[@]}"; do
    copy_file "$PLUGIN_DIR/templates/$file" "$RESEARCHER_WS/$file" "workspace-researcher/$file"
  done

  if [[ -d "$PLUGIN_DIR/templates/memory" ]]; then
    ensure_dir "$RESEARCHER_WS/memory"
    for file in ideation-memory.md experiment-memory.md; do
      copy_file "$PLUGIN_DIR/templates/memory/$file" "$RESEARCHER_WS/memory/$file" "workspace-researcher/memory/$file"
    done
  fi

  echo "  -> 同步 workspace root 角色配置..."
  copy_role_bundle "researcher" "$RESEARCHER_WS" "$FORCE_ROLE_FILES"
  copy_role_bundle "reviewer" "$REVIEWER_WS" "$FORCE_ROLE_FILES"
  copy_role_bundle "cross-reviewer" "$CROSS_REVIEWER_WS" "$FORCE_ROLE_FILES"
else
  echo "  -> SKIP 同步工作区配置（当前模式未包含）"
fi

echo ""
echo "[7/7] 完成安装收尾..."

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Installation $([ "$DRY_RUN" = true ] && echo 'Preview Complete            ' || echo 'Complete                    ')║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
if ! $RUN_AGENT_PHASE; then
  echo "  1. Agents: 当前模式未包含"
elif $SKIP_AGENT_CREATE; then
  echo "  1. Agents: 已跳过 openclaw Agent 创建；如需创建可移除 --skip-agent-create 后重跑"
else
  echo "  1. Agents: 已添加或检查研究工作流所需 agents"
fi
if $RUN_PAPERNEXUS_PHASE; then
  echo "  2. PaperNexus: 若本机存在 $PAPERNEXUS_DIR ，则会自动发现并同步全部 skills，并补齐 skills/index.json 注册"
else
  echo "  2. PaperNexus: 当前模式未包含"
fi
if $RUN_SKILL_PHASE; then
  echo "  3. Skills: 已同步到各 agent workspace（包括 researcher 的 pasa-paper-search），重复项仅在你确认后删除并覆盖"
else
  echo "  3. Skills: 当前模式未包含"
fi
if $RUN_PLUGIN_LINK_PHASE; then
  echo "  4. Plugin: 已创建或检查 $PLUGIN_LINK"
else
  echo "  4. Plugin: 当前模式未包含"
fi
if $RUN_WORKSPACE_PHASE; then
  echo "  5. Workspace: 已同步共享配置、研究模板和 researcher/reviewer/cross-reviewer 根配置"
else
  echo "  5. Workspace: 当前模式未包含"
fi
echo "  6. Config: 未修改你的 openclaw.json"
echo "  7. Docs: 介绍性文档已统一放到 DOC/，README 仅保留入口"
echo ""
highlight "  请重点检查：plugin load path、agentDir 绝对路径、skills roots、research_workflow 工具权限、projectsRoot、autoMode、autoGate"
echo "  新手入口：$PLUGIN_DIR/DOC/beginner_zh.md"
echo "  中文概览：$PLUGIN_DIR/DOC/overview_zh.md"
echo "  文档总入口：$PLUGIN_DIR/docs/README.md"
echo "  推荐配置：$PLUGIN_DIR/openclaw.RECOMMENDED.json"
echo ""
echo "  推荐安装后验证："
echo "    1. /research-pipeline \"你的研究主题\""
echo "    2. /workflow-status"
echo "    3. 检查输出里是否能看到 Auto mode、Auto discussion、Auto gate review"
echo "    4. 如果项目有风险，检查 /workflow-status 是否显示每个 Agent 的讨论摘要和 action items"
echo ""
echo "  如果你想先稳一点："
echo "    - openclaw.RECOMMENDED.json 里默认是 autoMode = conservative"
echo "    - 想更自动，可以改成 autoMode = aggressive"
echo "    - 高风险时系统会先自动讨论和补救，多轮仍不行才降档"
echo ""
if $DRY_RUN; then
  echo "  使用不带 --dry-run 的方式运行以应用更改。"
fi
if [[ "$SKIP_AGENT_CREATE" == "true" ]]; then
  echo "  如需让脚本通过 OpenClaw 自动创建 agents，请去掉 --skip-agent-create 后重跑。"
fi
if [[ "$FORCE_ROLE_FILES" != "true" ]]; then
  echo "  若要用插件中的 researcher/reviewer/cross-reviewer 根配置覆盖现有 workspace root 文件，请追加 --force-role-files。"
fi
echo ""
