#!/bin/bash
# 创建 PaperNexus Skills 的符号链接
# 用法：bash link-papernexus-skills.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAPERNEXUS_DIR="${PAPERNEXUS_DIR:-/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/PaperNexus}"
RESEARCH_DIR="$SCRIPT_DIR"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

echo "======================================================"
echo "   PaperNexus Skills — Symbolic Link Creator"
echo "======================================================"
echo ""
echo "  Source: $PAPERNEXUS_DIR/SKILL"
echo "  Target: $RESEARCH_DIR/skills/researcher/"
echo "  Mode:   $([ "$DRY_RUN" = true ] && echo 'DRY RUN' || echo 'LIVE')"
echo ""

# Create links for researcher skills
create_link() {
  local src_name="$1"
  local dst_name="$2"
  local src_dir="$PAPERNEXUS_DIR/SKILL/$src_name"
  local dst_dir="$RESEARCH_DIR/skills/researcher/$dst_name"
  
  if [[ ! -d "$src_dir" ]]; then
    echo "  ⚠ SKIP $src_name (源目录不存在：$src_dir)"
    return 0
  fi
  
  if [[ -L "$dst_dir" ]]; then
    echo "  → UPDATE $dst_name (符号链接已存在，将更新)"
    if ! $DRY_RUN; then
      rm -rf "$dst_dir"
      ln -s "$src_dir" "$dst_dir"
    fi
  elif [[ -d "$dst_dir" ]]; then
    echo "  ⚠ REPLACE $dst_name (存在普通目录，将替换为符号链接)"
    if ! $DRY_RUN; then
      rm -rf "$dst_dir"
      ln -s "$src_dir" "$dst_dir"
    fi
  else
    echo "  → CREATE $dst_name (创建新符号链接)"
    if ! $DRY_RUN; then
      ln -s "$src_dir" "$dst_dir"
    fi
  fi
  
  if $DRY_RUN; then
    echo "    [dry-run] $dst_dir -> $src_dir"
  else
    echo "    $dst_dir -> $src_dir"
  fi
}

# Link researcher skills
create_link "PaperNexus" "papernexus"
create_link "PaperNexusAgenticReasoning" "papernexus-agentic-reasoning"

# Link analyzer skill
src_reflection="$PAPERNEXUS_DIR/SKILL/PaperNexusReflection"
dst_reflection="$RESEARCH_DIR/skills/analyzer/papernexus-reflection"

if [[ -d "$src_reflection" ]]; then
  if [[ -L "$dst_reflection" ]]; then
    echo "  → UPDATE papernexus-reflection (analyzer)"
    if ! $DRY_RUN; then
      rm -rf "$dst_reflection"
      ln -s "$src_reflection" "$dst_reflection"
    fi
  elif [[ -d "$dst_reflection" ]]; then
    echo "  ⚠ REPLACE papernexus-reflection (analyzer)"
    if ! $DRY_RUN; then
      rm -rf "$dst_reflection"
      ln -s "$src_reflection" "$dst_reflection"
    fi
  else
    echo "  → CREATE papernexus-reflection (analyzer)"
    if ! $DRY_RUN; then
      ln -s "$src_reflection" "$dst_reflection"
    fi
  fi
fi

echo ""
echo "======================================================"
echo "   Complete"
echo "======================================================"
echo ""
echo "  所有 PaperNexus skills 已链接到 openclaw-research"
echo "  修改 PaperNexus/SKILL 后会自动同步"
echo ""
