# 🎯 OpenClaw Research 斜杠命令完整指南

> 通过斜杠命令快速启动自动化科研工作流

---

## 📚 斜杠命令列表

### 主要工作流命令

| 命令 | 说明 | 适用场景 | 示例 |
|------|------|----------|------|
| `/research-pipeline` | **完整科研流程自动化** | 从想法到论文的完整研究 | `/research-pipeline "基于注意力的目标检测"` |
| `/research-queue` | **多项目管理** | 同时管理多个研究项目 | `/research-queue add "新研究主题"` |
| `/resume-pipeline` | **恢复中断的流程** | 继续之前的研究 | `/resume-pipeline` |

---

### 分阶段命令

#### 🔍 **文献调研阶段**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/research-lit` | 持续文献调研 | 30 分钟 | 文献列表 |
| `/papers-cool` | 粗粒度文献搜索 | 20 分钟 | 相关论文摘要 |
| `/hugging-face-paper-pages` | 获取论文全文 Markdown | 10 分钟 | 论文全文 |
| `/papernexus` | PaperNexus 图谱操作 | 15 分钟 | 图谱状态 |
| `/graph-build` | 构建文献图谱 | 30 分钟 | PaperNexus 图谱 |
| `/frontier-mapping` | 提取研究前沿 | 20 分钟 | 前沿分析报告 |

#### 💡 **想法生成阶段**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/idea-phase` | 想法发现与筛选 | 30 分钟 | 3-5 个创新想法 |
| `/idea-generator` | 生成候选想法 | 20 分钟 | 8-16 个候选 |
| `/idea-tournament` | 想法淘汰赛 | 25 分钟 | 获胜想法 |
| `/novelty-check` | 新颖性验证 | 15 分钟 | 新颖性报告 |

#### 🧪 **实验阶段**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/experiment-phase` | 执行实验 | 2-24 小时 | 实验结果 |
| `/parallel-experiments` | 并行多个实验 | 2-24 小时 | 对比结果 |
| `/monitor-experiment` | 监控实验进度 | 实时 | 进度报告 |

#### 📊 **分析阶段**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/analyze-results` | 分析实验结果 | 30 分钟 | 分析报告 |
| `/scientific-figures` | 生成论文图表 | 20 分钟 | 出版级图表 |
| `/papernexus-reflection` | 基于图谱的失败分析 | 25 分钟 | 失败原因分析 |

#### 📝 **论文撰写阶段**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/paper-plan` | 创建论文大纲 | 15 分钟 | 论文结构 |
| `/paper-write` | 撰写论文章节 | 60 分钟 | LaTeX 初稿 |
| `/paper-compile` | 编译 LaTeX 为 PDF | 5 分钟 | PDF 文件 |
| `/paper-phase` | 完整论文撰写流程 | 90 分钟 | 完整论文 |
| `/ai-research-prompt` | AI 辅助写作提示 | 10 分钟 | 写作建议 |
| `/research-paper-writing` | 结构化论文写作 | 60 分钟 | 结构化草稿 |

#### 🔎 **评审阶段**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/review-phase` | 内部评审循环 | 30 分钟 | 评审意见 |
| `/evidence-grading` | 证据强度评估 | 20 分钟 | 证据等级 |
| `/paperreview-submit` | 提交到 paperreview.ai | 10 分钟 | 外部评审 |
| `/review-response` | 起草反驳信 | 25 分钟 | 反驳信草稿 |

#### 🤔 **反思与决策**

| 命令 | 说明 | 耗时 | 输出 |
|------|------|------|------|
| `/research-reflect` | 研究反思与决策 | 20 分钟 | 下一步建议 |
| `/research-queue` | 多项目管理 | 10 分钟 | 项目状态 |

---

## 🚀 快速开始示例

### 示例 1：启动完整研究流程

```bash
openclaw agents researcher

/research-pipeline "我想研究基于注意力机制的目标检测改进方法，
希望能提升 COCO 数据集上的小目标检测性能。
请帮我从文献调研开始，生成创新想法，设计并执行实验验证。"
```

**自动执行的流程**：
```
/research-pipeline
  ↓
/research-lit (文献调研)
  ↓
/graph-build (构建图谱)
  ↓
/frontier-mapping (前沿分析)
  ↓
/idea-phase (想法生成)
  ↓
/novelty-check (新颖性验证)
  ↓
/plan-research (实验设计 - Orchestrator)
  ↓
/implement-experiment (代码实现 - Coder)
  ↓
/experiment-phase (实验运行)
  ↓
/analyze-results (结果分析 - Analyzer)
  ↓
/review-phase (内部评审 - Reviewer)
  ↓
/paper-write (论文撰写 - Writer)
  ↓
/cross-reviewer (外部评审)
  ↓
完成！
```

---

### 示例 2：仅执行特定阶段

#### 只进行文献调研

```bash
openclaw agents researcher

/research-lit "请帮我调研基于 Transformer 的目标检测最新进展，
重点关注 2024-2025 年的工作。"
```

#### 只生成想法

```bash
openclaw agents researcher

/idea-phase "基于已有的文献调研，请生成 3-5 个创新想法，
重点关注注意力机制与特征金字塔的结合。"
```

#### 只运行实验

```bash
openclaw agents researcher

/experiment-phase "请运行实验 exp-001-attention，
使用 COCO train2017 数据集，batch size=16，训练 100 epochs。"
```

---

### 示例 3：管理多个研究项目

```bash
openclaw agents researcher

/research-queue add "第一个项目：基于注意力的目标检测"
/research-queue add "第二个项目：自监督学习在医学图像上的应用"
/research-queue add "第三个项目：视频理解中的时序建模"

# 查看所有项目状态
/research-queue status

# 推进特定项目
/research-queue advance proj_001

#  overnight 批量运行
/research-queue overnight
```

---

### 示例 4：恢复中断的流程

```bash
openclaw agents researcher

# 查看当前状态
cat ~/.openclaw/projects/my-project/PROJECT_MANIFEST.json | jq '.current_stage'

# 恢复流程
/resume-pipeline "请继续之前的研究流程，当前阶段是 EXPERIMENT。
使用之前的配置继续执行。"
```

---

## 📋 命令参数详解

### `/research-pipeline [topic] [-- OPTIONS]`

**参数**：
- `topic` (必需)：研究主题或方向
- `-- AUTO_PROCEED: true/false` (可选)：是否自动推进
- `-- MULTI: true/false` (可选)：是否多项目并行

**示例**：
```bash
/research-pipeline "目标检测中的注意力机制" -- AUTO_PROCEED: true
/research-pipeline "多模态学习" -- AUTO_PROCEED: false -- MULTI: true
```

---

### `/research-queue <action> [arguments]`

**动作**：
- `add <topic>`：添加新项目
- `status`：查看所有项目状态
- `advance <project-id>`：推进特定项目
- `overnight`：overnight 批量运行
- `next`：处理下一个项目

**示例**：
```bash
/research-queue add "新的研究想法"
/research-queue status
/research-queue advance proj_001
/research-queue overnight
```

---

### `/resume-pipeline [options]`

**选项**：
- 可以从任意阶段恢复
- 自动读取 PROJECT_MANIFEST.json 中的状态

**示例**：
```bash
/resume-pipeline
/resume-pipeline "从 ANALYZE 阶段继续"
```

---

## 🎯 实际使用场景

### 场景 1：快速验证想法（2 小时）

```bash
openclaw agents researcher

# 1. 快速文献调研 (20 分钟)
/papers-cool "查找注意力机制在目标检测中的应用"

# 2. 生成想法 (20 分钟)
/idea-generator "基于文献，生成 3 个快速验证的想法"

# 3. 新颖性检查 (15 分钟)
/novelty-check "验证想法 2 的新颖性"

# 4. 小规模实验 (1 小时)
/experiment-phase "运行小规模 pilot experiment，训练 10 epochs"

# 5. 快速分析 (15 分钟)
/analyze-results "分析初步结果，判断是否值得继续"
```

---

### 场景 2：完整研究流程（1-2 天）

```bash
openclaw agents researcher

# 完整自动化流程
/research-pipeline "视频目标分割中的时序一致性建模" -- AUTO_PROCEED: true
```

---

### 场景 3：并行多个项目（overnight）

```bash
openclaw agents researcher

# 添加 3 个项目
/research-queue add "项目 1：注意力机制"
/research-queue add "项目 2：数据增强"
/research-queue add "项目 3：模型压缩"

# overnight 运行
/research-queue overnight -- MAX_CONCURRENT: 4
```

---

### 场景 4：失败分析与重试

```bash
openclaw agents researcher

# 分析失败原因
/papernexus-reflection "实验 exp-001 训练发散，请分析可能原因"

# 根据分析调整
/research-reflect "基于失败分析，建议调整学习率或 batch size"

# 重新运行
/experiment-phase "使用调整后的配置重新运行实验"
```

---

## 🔧 高级技巧

### 技巧 1：自定义命令组合

创建你自己的命令组合：

```bash
# 在 openclaw agents researcher 中
"请依次执行：
1. /research-lit 调研最新文献
2. /graph-build 更新文献图谱
3. /frontier-mapping 分析研究前沿
4. /idea-phase 生成创新想法

每个阶段完成后暂停，等我确认后再继续。"
```

---

### 技巧 2：使用 AUTO_PROCEED 控制节奏

```bash
# 快速模式 - 自动推进
/research-pipeline "快速验证" -- AUTO_PROCEED: true

# 谨慎模式 - 每阶段手动确认
/research-pipeline "深入探索" -- AUTO_PROCEED: false
```

---

### 技巧 3：多 GPU 资源调度

```bash
# 查看 GPU 使用情况
ssh gpu-server "nvidia-smi --query-gpu=index,memory.used --format=csv"

# 并行多个实验
/parallel-experiments "同时运行 4 个实验，每个占用 1 个 GPU"
```

---

## 📊 命令执行时间参考

| 命令类型 | 平均耗时 | GPU 使用 |
|----------|----------|----------|
| 文献调研 | 20-30 分钟 | ❌ |
| 图谱构建 | 30 分钟 | ❌ |
| 想法生成 | 20-30 分钟 | ❌ |
| 实验设计 | 15 分钟 | ❌ |
| 代码实现 | 60 分钟 | ❌ |
| 实验运行 | 2-24 小时 | ✅ |
| 结果分析 | 30 分钟 | ❌ |
| 论文撰写 | 60-90 分钟 | ❌ |
| 评审循环 | 30 分钟 | ❌ |

---

## 🚨 常见问题

### Q: 命令执行失败怎么办？

**A**: 使用 `/resume-pipeline` 恢复：
```bash
/resume-pipeline "从失败的阶段继续，使用调整后的配置"
```

---

### Q: 如何查看命令执行进度？

**A**: 查看项目状态：
```bash
cat ~/.openclaw/projects/{PROJ}/PROJECT_MANIFEST.json | jq '.current_stage'
```

---

### Q: 可以中途修改配置吗？

**A**: 可以，使用 `/research-reflect`：
```bash
/research-reflect "请重新评估当前实验配置，建议调整学习率为 0.001"
```

---

### Q: 如何查看可用的所有命令？

**A**: 询问 Researcher：
```bash
openclaw agents researcher

"请列出所有可用的斜杠命令及其用途"
```

---

## 📞 相关文档

- [完整技能列表](./skills/researcher/)
- [工作流说明](./WORKFLOW.md)
- [快速开始](./QUICKSTART.md)

---

**最后更新**: 2026-03-21
