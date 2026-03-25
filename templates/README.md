# 模板目录说明（`templates/`）

这个目录存放 `openclaw-research` 在项目初始化、恢复和长期运行时会用到的模板文件。

它有两个主要用途：

1. 安装时复制一部分模板到 workspace。
2. 新建科研项目时，把状态文件初始化到 `{PROJ}/`。

如果你想知道：

- 一个项目默认会生成哪些状态文件
- `/research-pipeline` 后面到底能带哪些参数
- 其他科研相关 slash command 怎么用

这份文档就是模板目录下的中文速查手册。

## 1. 目录结构

```text
templates/
├── memory/                         # 项目级记忆模板
│   ├── ideation-memory.md
│   └── experiment-memory.md
├── hooks/                          # session hook 模板
│   ├── BOOTSTRAP.md
│   ├── HEARTBEAT.md
│   ├── agent-bootstrap.md
│   └── before-compaction.md
├── CLAIM_POLICY.md                 # claim 约束与写作证据标签
├── EXPERIMENT_LEDGER.json          # 结构化实验记忆账本
├── EXPERIMENT_REGISTRY.md          # 实验注册表
├── IDEA_TOURNAMENT_STATE.json      # idea tournament 恢复状态
├── IDLE_RESEARCH.example.json      # idle_research 示例配置
├── PROJECT_MANIFEST.json           # 项目主状态机模板
├── PROJECTS_STATE.json             # 多项目队列状态模板
├── THEORY_STATE.json               # theory/proof object 模板
├── TRACK_REGISTRY.json             # 创新 track 注册表
└── README.md                       # 本说明
```

## 2. 这些模板什么时候会被使用

### 安装阶段

- `memory/` 会被同步到对应 workspace 的 `memory/`
- `hooks/` 会被同步到角色工作区根目录，供 OpenClaw 读取

### 项目初始化阶段

典型情况下，新项目目录 `{PROJ}/` 会初始化这些核心文件：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `EXPERIMENT_LEDGER.json`
- `THEORY_STATE.json`
- `memory/ideation-memory.md`
- `memory/experiment-memory.md`

### 项目恢复阶段

当你运行 `/resume-pipeline` 或自动迭代器做状态对齐时，系统会用这些模板补齐旧项目缺失的字段块，例如：

- `idle_research`
- `writing_contract`
- `innovation_reflection`
- `theory_state`

## 3. 一个项目默认会有哪些关键状态文件

最重要的是下面这些：

- `PROJECT_MANIFEST.json`
  - 项目的主状态机
  - 记录当前阶段、owner、graph 状态、idle_research、writing_contract、innovation_reflection、theory_state 等
- `TRACK_REGISTRY.json`
  - 记录候选创新点、active track、parked track、killed track
- `CLAIM_POLICY.md`
  - 记录哪些 claim 允许写，哪些必须有证据，哪些只能弱表达
- `EXPERIMENT_LEDGER.json`
  - 记录实验做过什么、效果如何、是否需要创新反思
- `THEORY_STATE.json`
  - 记录 theorem / lemma / proof packet 的结构化理论状态

## 4. `/research-pipeline` 参数详解

`/research-pipeline` 是完整科研流程的主入口。

### 基本语法

```text
/research-pipeline "研究主题"
```

### 当前明确支持的参数

根据当前技能定义，`/research-pipeline` 支持以下参数：

#### `AUTO_PROCEED: true/false`

是否自动推进 workflow。

- `true`
  - 自动选择下一步
  - 自动进入后续阶段
  - 更适合完整自动化科研
- `false`
  - 在关键节点停下来
  - 更适合人工介入和调试

示例：

```text
/research-pipeline "part-level generalized category discovery" -- AUTO_PROCEED: true
```

#### `MULTI: true/false`

是否把这个主题交给多项目队列模式。

- `false`
  - 默认值
  - 单项目模式
- `true`
  - 交给 `/research-queue`
  - 适合同时跑多个研究主题

示例：

```text
/research-pipeline "semantic shift robustness in GCD" -- MULTI: true
```

#### `TOP_K_IDEAS: N`

从 idea 阶段进入后续实验的候选创新点数量。

- 常见值：`2` 或 `3`
- 值越大，后续实验分支越多
- 值越大，计算资源和管理复杂度也越高

示例：

```text
/research-pipeline "fine-grained GCD with part-level features" -- AUTO_PROCEED: true, TOP_K_IDEAS: 3
```

#### `__BACKGROUND_CONTINUATION__: true`

这是系统内部使用的参数。

- 用于 Discord slash fast path
- 不建议你手动传
- 正常情况下由插件自动追加

### 推荐写法

#### 最常用

```text
/research-pipeline "你的研究主题" -- AUTO_PROCEED: true
```

#### 想多保留一些创新方向

```text
/research-pipeline "你的研究主题" -- AUTO_PROCEED: true, TOP_K_IDEAS: 3
```

#### 想人工控一下关键节点

```text
/research-pipeline "你的研究主题" -- AUTO_PROCEED: false
```

#### 想交给队列模式

```text
/research-pipeline "你的研究主题" -- MULTI: true, AUTO_PROCEED: true
```

## 5. 其他科研相关 slash command 与参数说明

下面只列当前框架里最常用、最值得记住的科研命令。

### 5.1 项目主流程

#### `/research-pipeline`

用途：

- 从一个主题启动完整科研项目

参数：

- `"topic"`：必填，研究主题
- `AUTO_PROCEED: true/false`
- `MULTI: true/false`
- `TOP_K_IDEAS: N`

#### `/resume-pipeline`

用途：

- 恢复中断项目
- 对齐 manifest、track registry、experiment ledger、idle_research、theory state

参数：

- `"[project id]"`：可选
- 不传时，系统会尝试根据当前频道绑定或当前活动项目推断

示例：

```text
/resume-pipeline gcd-part-manifold-2026
```

#### `/research-queue`

用途：

- 多项目并行科研队列

当前支持的主命令形式：

- `add <topic>`
- `status`
- `advance <project-id>`
- `overnight`
- `next`

示例：

```text
/research-queue add "manifold capacity for fine-grained clustering"
/research-queue status
/research-queue advance gcd-part-manifold-2026
/research-queue overnight
```

### 5.2 文献与图谱

#### `/research-lit`

用途：

- 主题调研
- 持续文献跟踪
- 在调研阶段就生成 `RESEARCH_BRAINSTORM.md`

参数：

- `"[research topic or question]"`

示例：

```text
/research-lit "part-level features for generalized category discovery"
```

#### `/papers-cool`

用途：

- 论文检索入口
- 可与 PASA 检索结果合并

参数：

- 具体参数以检索 query 为主
- 当前在流程里通常由 `research-lit` 驱动，不建议单独频繁手调

#### `/pasa-paper-search`

用途：

- 作为 `papers-cool` 的可选补充检索源

说明：

- 如果可用，系统会把 PASA 与 `papers-cool` 结果合并
- 如果不可用，自动退回 `papers-cool`

#### `/hugging-face-paper-pages`

用途：

- 优先抓取论文 Markdown

参数：

- `[arXiv ID / Hugging Face paper URL / arXiv URL]`

#### `/arxiv2md`

用途：

- 当 Hugging Face 没有有效 Markdown 时，继续获取 Markdown

参数：

- `[arXiv ID / arXiv URL]`

#### `/graph-build`

用途：

- 构建或刷新 PaperNexus 图谱
- 在 novelty-sensitive 阶段前更新图谱状态

参数：

- `"[topic or optional source dir]"`

示例：

```text
/graph-build "fine-grained GCD"
/graph-build "/absolute/path/to/paper_source"
```

#### `/frontier-mapping`

用途：

- 基于图谱做 frontier extraction
- 找 limitation / contradiction / transfer / composition

参数：

- `"[topic or project direction]"`

### 5.3 创新与反思

#### `/idea-phase`

用途：

- 生成、筛选、收敛创新方向

参数：

- `"[research-direction]"`

说明：

- 当前它会读取 graph、frontier report、research brainstorm、innovation reflection

#### `/innovation-reflection`

用途：

- 把实验结果反向约束下一轮创新

参数：

- `"[topic, track id, or next-idea question]"`

#### `/idle-research`

用途：

- 在主流程等待时做 bounded background research

参数：

- `"[optional topic override or setup request]"`

说明：

- 通常优先读取 `PROJECT_MANIFEST.json.idle_research`
- 不传参数时，会按项目里的默认 topic 跑
- 传了参数时，会临时覆盖本轮 topic

示例：

```text
/idle-research
/idle-research "part-level visual primitives for fine-grained clustering"
```

### 5.4 计划、实现、实验

#### `/plan-research`

用途：

- 由 Orchestrator 生成 `PLAN.md`、`TODOS.md`、资源计划和执行结构

参数：

- 通常不需要显式参数
- 默认按当前项目状态和 active track 工作

#### `/implement-experiment`

用途：

- 由 Coder 实现代码、训练脚本、评估逻辑、运行包

参数：

- 通常按当前 `PLAN.md` 和 `TODOS.md` 工作

#### `/run-experiment`

用途：

- 启动和管理实验执行

参数：

- 通常按当前实验计划与 registry 工作

#### `/parallel-experiments`

用途：

- 并行实验批次调度

参数：

- `"[experiment group name]"`
- 或 `"all"`

#### `/monitor-experiment`

用途：

- 监控远程实验、screen 状态、结果目录

参数：

- `"[server or experiment name]"`

#### `/experiment-phase`

用途：

- 由 Researcher 组织实验执行、ledger、registry、monitoring

参数：

- `"[experiment plan or empty to read from PLAN.md]"`

### 5.5 分析、理论、评审、写作

#### `/analyze-results`

用途：

- 结果解释
- 证据整理
- claim-evidence 对齐

参数：

- 通常按当前项目结果目录与 active track 工作

#### `/theory-phase`

用途：

- 从结果分析中提炼 theorem / lemma / proof packet

参数：

- `"[optional focus or claim id]"`

#### `/review-phase`

用途：

- Reviewer 做内部评审与证据分级

参数：

- 通常按当前项目状态工作

#### `/paper-plan`

用途：

- Writer 建立论文结构、模板映射、appendix 计划

参数：

- 通常按当前 writing contract 工作

#### `/paper-write`

用途：

- Writer 按 writing contract 写作

参数：

- 通常按当前 section / plan / template bundle 工作

#### `/paper-phase`

用途：

- Writer 的写作主流程

参数：

- 通常无需手动传参数
- 按当前项目、模板、proof packet、appendix plan 自动推进

## 6. 推荐使用方式

### 绝大多数情况

```text
/research-pipeline "你的研究主题" -- AUTO_PROCEED: true
```

### 项目中断后

```text
/resume-pipeline
```

### 只在你明确要干预某一阶段时，再单独调用

例如：

- `/graph-build`
- `/frontier-mapping`
- `/idea-phase`
- `/innovation-reflection`
- `/idle-research`
- `/paper-phase`

## 7. 相关模板文件建议优先查看

如果你正在配置或调试项目，建议一起看：

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `EXPERIMENT_LEDGER.json`
- `THEORY_STATE.json`
- `IDLE_RESEARCH.example.json`

这些文件共同决定：

- workflow 走到哪一阶段
- 哪些创新点在推进
- 实验做到了哪里
- 理论附录要不要生成
- 空闲调研该怎么跑

## 8. 一句话总结

如果你只记住一条：

**先用 `/research-pipeline` 启动，平时用 `/resume-pipeline` 恢复，只有在你明确要手动介入某个阶段时，再单独调用阶段性 slash command。**
