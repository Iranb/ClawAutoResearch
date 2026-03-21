#!/bin/bash
# 快速修复：复制缺失的配置文件到工作区

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OC_DIR="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE="$OC_DIR/workspace-researcher"

echo "======================================================"
echo "   修复缺失的配置文件"
echo "======================================================"
echo ""
echo "  目标工作区：$WORKSPACE"
echo ""

# 创建工作区目录
mkdir -p "$WORKSPACE"

# 复制核心配置文件
echo "[1/3] 复制核心配置文件..."
for file in CONFIG.md WORKFLOW.md WORKSPACE.md; do
  src="$SCRIPT_DIR/$file"
  dst="$WORKSPACE/$file"
  if [[ -f "$src" ]]; then
    if [[ -f "$dst" ]]; then
      echo "  → SKIP $file (已存在)"
    else
      cp "$src" "$dst"
      echo "  → COPY $file"
    fi
  else
    echo "  ⚠ SKIP $file (源文件不存在：$src)"
  fi
done

# 复制模板文件
echo ""
echo "[2/3] 复制模板文件..."
for file in PROJECT_MANIFEST.json TRACK_REGISTRY.json CLAIM_POLICY.md EXPERIMENT_REGISTRY.md IDEA_TOURNAMENT_STATE.json PROJECTS_STATE.json; do
  src="$SCRIPT_DIR/templates/$file"
  dst="$WORKSPACE/$file"
  if [[ -f "$src" ]]; then
    if [[ -f "$dst" ]]; then
      echo "  → SKIP $file (已存在)"
    else
      cp "$src" "$dst"
      echo "  → COPY $file"
    fi
  else
    echo "  ⚠ SKIP $file (源文件不存在：$src)"
  fi
done

# 复制 memory 模板
echo ""
echo "[3/3] 复制 memory 模板..."
mkdir -p "$WORKSPACE/memory"
for file in ideation-memory.md experiment-memory.md; do
  src="$SCRIPT_DIR/templates/memory/$file"
  dst="$WORKSPACE/memory/$file"
  if [[ -f "$src" ]]; then
    if [[ -f "$dst" ]]; then
      echo "  → SKIP memory/$file (已存在)"
    else
      cp "$src" "$dst"
      echo "  → COPY memory/$file"
    fi
  else
    echo "  ⚠ SKIP memory/$file (源文件不存在：$src)"
  fi
done

echo ""
echo "======================================================"
echo "   修复完成 ✓"
echo "======================================================"
echo ""
echo "  已复制以下文件到工作区："
echo "  - CONFIG.md"
echo "  - WORKFLOW.md"
echo "  - WORKSPACE.md"
echo "  - PROJECT_MANIFEST.json"
echo "  - TRACK_REGISTRY.json"
echo "  - CLAIM_POLICY.md"
echo "  - 其他模板文件"
echo ""
echo "  现在可以使用 /research-pipeline 命令了！"
echo ""
