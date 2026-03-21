#!/bin/bash
# 复制配置和模板文件到 OpenClaw 工作区

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OC_DIR="${OPENCLAW_HOME:-$HOME/.openclaw}"
WS_ROOT="$OC_DIR/workspace-researcher"

echo "======================================================"
echo "   复制配置和模板文件到工作区"
echo "======================================================"
echo ""
echo "  源目录：$SCRIPT_DIR"
echo "  目标工作区：$WS_ROOT"
echo ""

# 创建工作区目录
mkdir -p "$WS_ROOT"

# 1. 复制核心配置文件
echo "[1/4] 复制核心配置文件..."
for file in CONFIG.md WORKFLOW.md WORKSPACE.md; do
  src="$SCRIPT_DIR/$file"
  dst="$WS_ROOT/$file"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    echo "  ✓ COPY $file"
  else
    echo "  ⚠ SKIP $file (源文件不存在)"
  fi
done

# 2. 复制模板文件
echo ""
echo "[2/4] 复制模板文件..."
TEMPLATE_FILES=(
  "PROJECT_MANIFEST.json"
  "TRACK_REGISTRY.json"
  "CLAIM_POLICY.md"
  "EXPERIMENT_REGISTRY.md"
  "IDEA_TOURNAMENT_STATE.json"
  "PROJECTS_STATE.json"
)
for f in "${TEMPLATE_FILES[@]}"; do
  src="$SCRIPT_DIR/templates/$f"
  dst="$WS_ROOT/$f"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    echo "  ✓ COPY $f"
  else
    echo "  ⚠ SKIP $f (源文件不存在)"
  fi
done

# 3. 复制 memory 模板
echo ""
echo "[3/4] 复制 memory 模板..."
mkdir -p "$WS_ROOT/memory"
for f in ideation-memory.md experiment-memory.md; do
  src="$SCRIPT_DIR/templates/memory/$f"
  dst="$WS_ROOT/memory/$f"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    echo "  ✓ COPY memory/$f"
  else
    echo "  ⚠ SKIP memory/$f (源文件不存在)"
  fi
done

# 4. 复制 hooks 模板
echo ""
echo "[4/4] 复制 hooks 模板..."
HOOK_WORKSPACES=( "workspace-researcher" "workspace-reviewer" "workspace-cross-reviewer" )
for ws_rel in "${HOOK_WORKSPACES[@]}"; do
  ws_root="$OC_DIR/$ws_rel"
  if [[ -d "$ws_root" ]]; then
    for hook in BOOTSTRAP.md HEARTBEAT.md; do
      src="$SCRIPT_DIR/templates/hooks/$hook"
      if [[ -f "$src" ]]; then
        dst="$ws_root/$hook"
        cp "$src" "$dst"
        echo "  ✓ COPY $ws_rel/$hook"
      fi
    done
  fi
done

echo ""
echo "======================================================"
echo "   复制完成 ✓"
echo "======================================================"
echo ""
echo "  已复制文件列表："
echo "  核心配置："
echo "    - CONFIG.md"
echo "    - WORKFLOW.md"
echo "    - WORKSPACE.md"
echo "  模板文件："
echo "    - PROJECT_MANIFEST.json"
echo "    - TRACK_REGISTRY.json"
echo "    - CLAIM_POLICY.md"
echo "    - EXPERIMENT_REGISTRY.md"
echo "    - IDEA_TOURNAMENT_STATE.json"
echo "    - PROJECTS_STATE.json"
echo "  Memory 模板："
echo "    - memory/ideation-memory.md"
echo "    - memory/experiment-memory.md"
echo "  Hooks 模板："
echo "    - workspace-researcher/BOOTSTRAP.md"
echo "    - workspace-researcher/HEARTBEAT.md"
echo "    - workspace-reviewer/BOOTSTRAP.md"
echo "    - workspace-cross-reviewer/BOOTSTRAP.md"
echo ""
echo "  现在可以使用 /research-pipeline 命令了！"
echo ""

# 验证
echo "验证文件是否存在..."
echo ""
missing=0
for file in CONFIG.md WORKFLOW.md WORKSPACE.md; do
  if [[ -f "$WS_ROOT/$file" ]]; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file (缺失)"
    missing=1
  fi
done

for f in PROJECT_MANIFEST.json TRACK_REGISTRY.json; do
  if [[ -f "$WS_ROOT/$f" ]]; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f (缺失)"
    missing=1
  fi
done

if [[ $missing -eq 0 ]]; then
  echo ""
  echo "  ✓ 所有必要文件已就绪！"
else
  echo ""
  echo "  ⚠ 部分文件缺失，请检查上面的输出"
fi
echo ""
