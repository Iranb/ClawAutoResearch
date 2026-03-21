# 📋 手动复制配置文件指南

## 🎯 目标路径

所有配置和模板文件需要复制到：
```
~/.openclaw/workspace-researcher/
```

这个路径在 `research-pipeline` skill 中定义为 `{WS}` 变量。

---

## 🚀 快速复制（3 条命令）

```bash
# 进入插件目录
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"

# 1. 复制核心配置文件
cp CONFIG.md WORKFLOW.md WORKSPACE.md ~/.openclaw/workspace-researcher/

# 2. 复制模板文件
cp templates/*.json templates/*.md ~/.openclaw/workspace-researcher/templates

# 3. 复制 memory 模板
mkdir -p ~/.openclaw/workspace-researcher/memory
cp templates/memory/*.md ~/.openclaw/workspace-researcher/memory/
```

---

## ✅ 验证复制结果

```bash
# 检查核心文件
ls -la ~/.openclaw/workspace-researcher/{CONFIG,WORKFLOW,WORKSPACE}.md

# 检查模板文件
ls -la ~/.openclaw/workspace-researcher/*.json

# 检查 memory 模板
ls -la ~/.openclaw/workspace-researcher/memory/
```

**预期输出**：
```
-rw-r--r--  1 user  staff  CONFIG.md
-rw-r--r--  1 user  staff  WORKFLOW.md
-rw-r--r--  1 user  staff  WORKSPACE.md
-rw-r--r--  1 user  staff  PROJECT_MANIFEST.json
-rw-r--r--  1 user  staff  TRACK_REGISTRY.json
...
```

---

## 📁 完整文件清单

### 核心配置文件（3 个）
- [ ] `CONFIG.md` → `~/.openclaw/workspace-researcher/CONFIG.md`
- [ ] `WORKFLOW.md` → `~/.openclaw/workspace-researcher/WORKFLOW.md`
- [ ] `WORKSPACE.md` → `~/.openclaw/workspace-researcher/WORKSPACE.md`

### 模板文件（6 个 JSON）
- [ ] `PROJECT_MANIFEST.json`
- [ ] `TRACK_REGISTRY.json`
- [ ] `CLAIM_POLICY.md`
- [ ] `EXPERIMENT_REGISTRY.md`
- [ ] `IDEA_TOURNAMENT_STATE.json`
- [ ] `PROJECTS_STATE.json`

### Memory 模板（2 个）
- [ ] `memory/ideation-memory.md`
- [ ] `memory/experiment-memory.md`

### Hooks 模板（可选）
- [ ] `workspace-researcher/BOOTSTRAP.md`
- [ ] `workspace-researcher/HEARTBEAT.md`
- [ ] `workspace-reviewer/BOOTSTRAP.md`
- [ ] `workspace-cross-reviewer/BOOTSTRAP.md`

---

## 🔧 使用自动化脚本

或者运行提供的脚本：

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
bash copy-configs.sh
```

如果遇到权限错误，请使用上面的手动复制方法。

---

## 📊 路径解析说明

### `{WS}` 变量
```
{WS} = ~/.openclaw/workspace-researcher/
```

所有配置文件都从这里解析：
- `{WS}/CONFIG.md` - 配置路径定义
- `{WS}/WORKFLOW.md` - 工作流定义
- `{WS}/PROJECT_MANIFEST.json` - 项目状态模板

### `{PROJECTS_ROOT}` 变量
```
{PROJECTS_ROOT} = ~/.openclaw/projects/  (在 CONFIG.md 中定义)
```

项目创建在这里：
- `{PROJECTS_ROOT}/{proj-id}/` - 具体项目目录
- 例如：`~/.openclaw/projects/my-first-detection/`

---

## 🎯 使用 /research-pipeline

复制完成后，就可以使用了：

```bash
openclaw agents researcher

/research-pipeline "基于注意力机制的目标检测改进"
```

**执行流程**：
1. Researcher 读取 `{WS}/CONFIG.md` 获取 `{PROJECTS_ROOT}`
2. Researcher 读取 `{WS}/WORKFLOW.md` 获取工作流定义
3. 创建新项目目录 `{PROJECTS_ROOT}/{proj-id}/`
4. 从 `{WS}/` 复制模板文件到项目目录
5. 开始自动化研究流程

---

## 🚨 常见问题

### Q: 提示 "Operation not permitted"

**A**: 权限问题，尝试：
```bash
# 检查目录所有权
ls -la ~/.openclaw/

# 修改所有权
sudo chown -R $USER ~/.openclaw/
```

### Q: 文件已存在怎么办？

**A**: 先备份再覆盖：
```bash
# 备份
cp ~/.openclaw/workspace-researcher/CONFIG.md ~/.openclaw/workspace-researcher/CONFIG.md.backup

# 覆盖
cp CONFIG.md ~/.openclaw/workspace-researcher/ -f
```

### Q: 如何确认文件已正确复制？

**A**: 运行验证命令：
```bash
# 验证核心文件
test -f ~/.openclaw/workspace-researcher/CONFIG.md && echo "✓ CONFIG.md" || echo "✗ CONFIG.md"
test -f ~/.openclaw/workspace-researcher/WORKFLOW.md && echo "✓ WORKFLOW.md" || echo "✗ WORKFLOW.md"
test -f ~/.openclaw/workspace-researcher/PROJECT_MANIFEST.json && echo "✓ PROJECT_MANIFEST.json" || echo "✗"
```

---

**最后更新**: 2026-03-21
