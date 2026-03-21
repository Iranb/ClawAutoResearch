# 🚀 OpenClaw Research 斜杠命令快速开始

> 通过斜杠命令快速启动自动化科研工作流

---

## 📚 核心斜杠命令

### 主要工作流命令

| 命令 | 说明 | 适用场景 |
|------|------|----------|
| `/research-pipeline` | **完整科研流程自动化** | 从想法到论文的完整研究 |
| `/research-queue` | **多项目管理** | 同时管理多个研究项目 |
| `/resume-pipeline` | **恢复中断的流程** | 继续之前的研究 |

---

## 🎯 快速开始

### 启动完整研究流程

```bash
# 启动 Researcher Agent
openclaw agents researcher

# 使用斜杠命令
/research-pipeline "我想研究基于注意力机制的目标检测改进方法，
希望能提升 COCO 数据集上的 mAP，特别是小目标检测。
请帮我从文献调研开始，生成创新想法，设计并执行实验验证。"
```

**自动执行的流程**：
```
/research-pipeline
  ↓
/research-lit        (文献调研 - 20 分钟)
  ↓
/graph-build         (构建文献图谱 - 30 分钟)
  ↓
/frontier-mapping    (前沿分析 - 20 分钟)
  ↓
/idea-phase          (想法生成 - 30 分钟)
  ↓
/novelty-check       (新颖性验证 - 15 分钟)
  ↓
[自动调用 Orchestrator 设计实验 - 15 分钟]
  ↓
[自动调用 Coder 实现代码 - 60 分钟]
  ↓
/experiment-phase    (实验运行 - 2-24 小时)
  ↓
[自动调用 Analyzer 分析 - 30 分钟]
  ↓
[自动调用 Reviewer 评审 - 30 分钟]
  ↓
[自动调用 Writer 撰写论文 - 60 分钟]
  ↓
完成！
```

---

## 📋 分阶段斜杠命令

### 🔍 文献调研阶段

```bash
# 持续文献调研
/research-lit "请调研基于 Transformer 的目标检测最新进展"

# 粗粒度文献搜索
/papers-cool "查找注意力机制在目标检测中的应用"

# 获取论文全文 Markdown
/hugging-face-paper-pages "下载 Focal Loss 论文"

# 构建文献图谱
/graph-build "为当前项目构建 PaperNexus 图谱"

# 提取研究前沿
/frontier-mapping "分析目标检测领域的研究前沿"
```

---

### 💡 想法生成阶段

```bash
# 想法发现与筛选
/idea-phase "基于文献调研，生成 3-5 个创新想法"

# 生成候选想法
/idea-generator "生成 8-16 个候选研究想法"

# 想法淘汰赛
/idea-tournament "从候选想法中筛选最佳方案"

# 新颖性验证
/novelty-check "验证想法的新颖性"
```

---

### 🧪 实验阶段

```bash
# 执行实验
/experiment-phase "运行实验 exp-001，训练 100 epochs"

# 并行多个实验
/parallel-experiments "同时运行 4 个对比实验"

# 监控实验进度
/monitor-experiment "查看实验 exp-001 的进度"
```

---

### 📊 分析阶段

```bash
# 分析实验结果
/analyze-results "分析实验结果，生成对比图表"

# 生成论文图表
/scientific-figures "生成出版级图表"

# 失败分析
/papernexus-reflection "实验失败，请分析可能原因"
```

---

### 📝 论文撰写阶段

```bash
# 创建论文大纲
/paper-plan "创建论文大纲"

# 撰写论文章节
/paper-write "撰写 Method 章节"

# 编译 LaTeX 为 PDF
/paper-compile "编译论文为 PDF"

# 完整论文撰写
/paper-phase "从大纲到完整论文"
```

---

### 🔎 评审阶段

```bash
# 内部评审循环
/review-phase "对论文初稿进行评审"

# 证据强度评估
/evidence-grading "评估实验结果对 claim 的支持强度"

# 提交外部评审
/paperreview-submit "提交到 paperreview.ai"

# 起草反驳信
/review-response "起草对评审意见的反驳"
```

---

### 🤔 反思与决策

```bash
# 研究反思
/research-reflect "评估当前进展，建议下一步方向"

# 恢复流程
/resume-pipeline "从 EXPERIMENT 阶段继续"
```

---

## 🎯 多项目管理

### 添加项目

```bash
openclaw agents researcher

# 添加新项目
/research-queue add "第一个项目：基于注意力的目标检测"
/research-queue add "第二个项目：自监督医学图像分析"
/research-queue add "第三个项目：视频时序建模"
```

### 查看状态

```bash
# 查看所有项目状态
/research-queue status
```

### 推进项目

```bash
# 推进特定项目
/research-queue advance proj_001

# overnight 批量运行
/research-queue overnight
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

## 🔧 高级用法

### 自定义参数

```bash
# 自动推进模式
/research-pipeline "快速验证" -- AUTO_PROCEED: true

# 手动确认模式
/research-pipeline "深入探索" -- AUTO_PROCEED: false

# 多项目并行
/research-pipeline "多方向探索" -- MULTI: true
```

### 命令组合

```bash
openclaw agents researcher

# 依次执行多个命令
"请依次执行：
1. /research-lit 调研最新文献
2. /graph-build 更新文献图谱
3. /frontier-mapping 分析前沿
4. /idea-phase 生成创新想法

每个阶段完成后暂停，等我确认后再继续。"
```

---

## 🚨 常见问题

### Q: 命令执行失败怎么办？

```bash
# 使用 resume-pipeline 恢复
/resume-pipeline "从失败的阶段继续，使用调整后的配置"
```

### Q: 如何查看执行进度？

```bash
# 查看项目状态
cat ~/.openclaw/projects/{PROJ}/PROJECT_MANIFEST.json | jq '.current_stage'
```

### Q: 如何查看所有可用命令？

```bash
openclaw agents researcher

"请列出所有可用的斜杠命令及其用途"
```

---

## 📚 完整文档

- [斜杠命令完整指南](./docs/SLASH_COMMANDS_GUIDE.md) - 所有命令详解
- [工作流说明](./WORKFLOW.md) - 完整科研流程
- [插件配置](./docs/PLUGIN_CONFIG_GUIDE.md) - 配置说明

---

**最后更新**: 2026-03-21
