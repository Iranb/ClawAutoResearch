# 🔧 修复缺失配置文件问题

## 问题原因

`/research-pipeline` 技能需要以下文件才能初始化项目：

1. ✅ **CONFIG.md** - 定义 `{PROJECTS_ROOT}` 路径（**已创建**）
2. ✅ **WORKFLOW.md** - 定义阶段、门控和 AUTO_PROCEED 设置（**已存在**）
3. ✅ **templates/** 目录 - 包含项目模板文件（**已存在**）

这些文件需要复制到 OpenClaw 工作区：`~/.openclaw/workspace-researcher/`

---

## 🚀 快速修复（手动复制）

由于权限原因，请手动执行以下命令：

```bash
# 进入插件目录
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"

# 1. 复制核心配置文件
cp CONFIG.md ~/.openclaw/workspace-researcher/
cp WORKFLOW.md ~/.openclaw/workspace-researcher/
cp WORKSPACE.md ~/.openclaw/workspace-researcher/

# 2. 复制模板文件
cp templates/*.json ~/.openclaw/workspace-researcher/
cp templates/*.md ~/.openclaw/workspace-researcher/

# 3. 复制 memory 模板
mkdir -p ~/.openclaw/workspace-researcher/memory
cp templates/memory/*.md ~/.openclaw/workspace-researcher/memory/
```

---

## ✅ 验证修复

复制完成后，验证文件是否存在：

```bash
# 检查核心文件
ls -la ~/.openclaw/workspace-researcher/CONFIG.md
ls -la ~/.openclaw/workspace-researcher/WORKFLOW.md

# 检查模板文件
ls -la ~/.openclaw/workspace-researcher/PROJECT_MANIFEST.json
ls -la ~/.openclaw/workspace-researcher/TRACK_REGISTRY.json

# 检查 memory 模板
ls -la ~/.openclaw/workspace-researcher/memory/
```

---

## 🎯 使用自动化脚本修复

或者运行修复脚本（需要授予权限）：

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
bash fix-missing-configs.sh
```

如果提示权限错误，请使用上面的手动复制方法。

---

## 📋 文件清单

### 核心配置文件（必需）
- [ ] `CONFIG.md`
- [ ] `WORKFLOW.md`
- [ ] `WORKSPACE.md`

### 模板文件（必需）
- [ ] `PROJECT_MANIFEST.json`
- [ ] `TRACK_REGISTRY.json`
- [ ] `CLAIM_POLICY.md`
- [ ] `EXPERIMENT_REGISTRY.md`
- [ ] `IDEA_TOURNAMENT_STATE.json`
- [ ] `PROJECTS_STATE.json`

### Memory 模板（必需）
- [ ] `memory/ideation-memory.md`
- [ ] `memory/experiment-memory.md`

---

## 🚨 常见错误

### 错误 1：Operation not permitted

**原因**：工作区目录权限问题

**解决**：
```bash
# 检查目录所有权
ls -la ~/.openclaw/

# 如果需要，修改所有权
sudo chown -R $USER ~/.openclaw/
```

### 错误 2：文件已存在

**解决**：
```bash
# 先备份现有文件
cp ~/.openclaw/workspace-researcher/CONFIG.md ~/.openclaw/workspace-researcher/CONFIG.md.backup

# 然后覆盖
cp CONFIG.md ~/.openclaw/workspace-researcher/ -f
```

---

## 📞 验证成功

修复后，再次尝试使用 `/research-pipeline`：

```bash
openclaw agents researcher

/research-pipeline "测试研究主题"
```

应该不再提示缺少配置文件。

---

**最后更新**: 2026-03-21
