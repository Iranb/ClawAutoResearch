# Agent 角色与目录配置

## 1. 总览

当前 `agents/` 下包含 7 个主要角色：

| Role | 主要职责 |
| --- | --- |
| `researcher` | 项目 owner、阶段协调、文献、图谱、创新、实验总账、恢复与自动迭代 |
| `orchestrator` | 研究计划、实验排期、风险、预算和 TODO 编排 |
| `coder` | 实验代码实现、运行脚本、复现实验、工程侧 smoke test |
| `analyzer` | 结果解释、图表、claim-evidence、PaperNexus 反思 |
| `academic_writer` | 论文大纲、模版映射、段落逻辑、正文写作与编译 |
| `reviewer` | review phase、evidence grading、submission packet、review response |
| `cross-reviewer` | 隔离式外部视角审阅，不持有主动项目写权限 |

## 2. 每个 Agent 目录中的配置文件

当前每个角色目录下都保留了官方风格的配置分层：

- `AGENTS.md`  
  角色总说明，连接 lifecycle、workflow、通信和主要技能。

- `IDENTITY.md`  
  角色身份、人格、风格、名字等。

- `SOUL.md`  
  角色长期价值观和行为底色。

- `TOOLS.md`  
  角色常用工具、工具使用边界和环境说明。

- `BOOT.md`  
  每次唤醒时的即时行为规则。

- `BOOTSTRAP.md`  
  首次启动或恢复时必须先做什么。

- `HEARTBEAT.md`  
  心跳轮次下的默认行为，尤其是自动迭代与空闲任务。

其中：

- `researcher/` 额外包含 `SERVER.md`

## 3. workflow guard 中的角色权限

插件层并不是把所有 Agent 都当成平级实体，而是有显式角色策略。

### `researcher`

- 可联系：所有主 Agent
- 可派生：所有主 Agent
- 允许写：
  - `{PROJ}/PROJECT_MANIFEST.json`
  - `{PROJ}/TRACK_REGISTRY.json`
  - `{PROJ}/CLAIM_POLICY.md`
  - `{PROJ}/README.md`
  - `{PROJ}/researcher/`
  - `{PROJ}/graph/`
  - `{PROJ}/memory/`
  - `{PROJ}/reviewer/`
  - `{PROJ}/cross-reviewer/`
  - `{PROJECTS_ROOT}/PROJECTS_STATE.json`

### `orchestrator`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/orchestrator/`

### `coder`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/coder/`
- 例外：可 append `orchestrator/TODOS.md`
- 数据集边界：只读，不能对共享 `datasets/` 根目录做原地修改

### `analyzer`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/analyzer/`
- 例外：可 append `orchestrator/TODOS.md`

### `academic_writer`

- 可联系：`researcher`、`cross-reviewer`
- 可派生：无
- 主要写入：`{PROJ}/academic_writer/`
- 例外：可 append `orchestrator/TODOS.md`

### `reviewer`

- 可联系：`researcher`
- 可派生：无
- 主要写入：`{PROJ}/reviewer/`

### `cross-reviewer`

- 可联系：无
- 可派生：无
- 项目写权限：无

## 4. Agent 间通信规则

当前系统明确不鼓励在 Discord 或普通 chat 文本里随意使用原始 `@agent` mention。

推荐路径是：

- `sessions_send`
- `sessions_spawn`
- `research_workflow.send_mailbox`

插件会做这些额外约束：

- 清洗原始 `@agent` mention
- 检查目标 Agent 是否在角色白名单中
- 对同一 source -> target 的通信应用 cooldown

## 5. Agent 的空闲行为

不同 Agent 的 heartbeat / idle 轮次不是“自由发挥”，而是 bounded background tasks。

例如：

- `researcher`  
  文献跟踪、PaperNexus 刷新、reasoning packet 对齐、实验账本对齐

- `orchestrator`  
  风险、预算、计划清理，不改 active track

- `coder`  
  强化复现说明、smoke test、脚本维护，不擅自发起新实验

- `analyzer`  
  figure/table skeleton、claim-evidence 提取准备

- `academic_writer`  
  大纲与 paragraph logic 检查，维持保守措辞和模版一致性

- `reviewer`  
  review rubric 和评审结构维护

## 6. 角色配置为什么这么拆

把 Agent 拆成多份 md 文件，而不是只保留一份 `AGENTS.md`，主要是为了：

- 更接近 OpenClaw 官方约定
- 让 boot / bootstrap / heartbeat 三类时机有不同规则
- 让角色身份、工具边界、流程规范分离
- 降低单一超长 prompt 的耦合度
