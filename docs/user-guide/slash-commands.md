# Slash Commands 总览

这页专门介绍当前系统里已经注册的所有 slash commands。

目标是帮你快速判断：

- 这个命令是干什么的
- 什么时候该用它
- 它更偏“启动流程”、还是“恢复/诊断”、还是“专题工具”

> [!TIP]
> 如果你只是忘了命令名，也可以在实际会话里直接运行：
>
> ```text
> /show-commands
> ```

## 1. 启动与项目创建

| Command | 作用 | 什么时候用 |
| --- | --- | --- |
| `/project-init` | 初始化或刷新当前项目的 research program onboarding | 你已经有项目目录，但 onboarding 还没补齐 |
| `/auto-research "topic"` | 只给主题就启动全自动科研主线 | 想直接从主题创建实验项目并后台开跑 |
| `/auto-review "topic"` | 只给主题就启动全自动综述主线 | 想直接从主题创建 survey 项目并后台开跑 |
| `/clear-project-binding` | 清空当前频道的 workflow 项目绑定 | 当前频道绑错项目了，想在原频道里重来 |

## 2. 主流程推进

| Command | 作用 | 什么时候用 |
| --- | --- | --- |
| `/research-pipeline` | 启动或继续普通论文主研究流程 | 当前项目想继续往 experiment paper 主线推进 |
| `/survey-pipeline "topic"` | 启动综述主线 | 想围绕一个主题做综述、screening、coverage 和 survey 写作 |
| `/research-queue` | 批量排队推进多个项目 | 你不是只盯一个项目，而是要让多个项目轮转推进 |
| `/resume-pipeline` | 从 durable state 恢复当前项目，或显式恢复某个 project id | 会话重启、上下文丢失、换频道之后恢复现场 |

## 3. 图谱、文献与综述构建

| Command | 作用 | 什么时候用 |
| --- | --- | --- |
| `/graph-build` | 刷新 graph readiness，并补齐后续 brainstorm 所需输入 | 共享图缺论文、graph presence 不 ready、系统反复回退到 graph_build |
| `/literature-review` | 对当前项目发起一次 bounded literature review 后台调研 | 想做一轮受控文献补充，而不是整条主线推进 |
| `/survey-graph-build` | 后台执行 survey 图谱构建前置搜集 | 想优先找主题相关、去重强、图里还没有的论文 |
| `/broad-paper-search` | 运行 broad multi-provider literature search 并持久化合并候选 | 想从多 provider 做广覆盖文献检索，而不是只靠单一来源 |
| `/idea-catalyst-search` | 运行 IDEA-CATALYST 的跨域 research30 检索 | 想为 idea/scouting 阶段补跨域线索 |
| `/zotero-sync` | 把当前项目论文集合 best-effort 同步到 Zotero | 想把当前项目的文献集合整理进 Zotero |
| `/papernexus-stage-remote` | 把本地 staged PDF/Markdown 上传到远端 PaperNexus staging | 已经准备好本地 source，想推进远端 staging / manifest |

## 4. 状态查看与诊断

| Command | 作用 | 什么时候用 |
| --- | --- | --- |
| `/workflow-status` | 查看当前阶段、owner、blocking reason、auto mode 与 runtime health | 最常用的状态入口；先看它，再决定下一步 |
| `/handoff-status` | 查看 handoff 当前停在哪一步 | owner 似乎切了但没人接手，想查 prepared / dispatched / claimed / activated / binding gate |
| `/capture-diagnostics` | 抓取当前项目的诊断包 | 想把 snapshot、runtime、queue、mailbox、graph、日志一次性留存 |
| `/show-commands` | 列出可用 slash commands 与简介 | 刚接触系统，或不确定该用哪个入口 |

## 5. 写作、校验与收口

| Command | 作用 | 什么时候用 |
| --- | --- | --- |
| `/citation-calibrate` | 对当前项目运行 citation calibration | submit 前刷新引用真实性校验 |
| `/authoring-closeout` | 对当前论文项目执行 deterministic closeout | 稿件已经基本完成，但 citation / review / QC / PDF 还没收口 |

## 6. 最常见的选择方法

### 第一次从主题开始

- 实验项目：`/auto-research`
- 综述项目：`/auto-review`

### 当前项目已经存在，只想继续推进

- 实验主线：`/research-pipeline`
- 综述主线：`/survey-pipeline`

### 会话断了或换了地方

- `/resume-pipeline`
- 然后 `/workflow-status`

### 只是想看状态

- `/workflow-status`

### 只是想查 handoff 卡在哪

- `/handoff-status`

### 只是想补文献或补图谱

- `/graph-build`
- `/literature-review`
- `/survey-graph-build`
- `/broad-paper-search`

### 已经到写作末期

- `/citation-calibrate`
- `/authoring-closeout`

## 7. 和工具页的关系

这页只讲“命令该怎么选”。

如果你还想继续看底层工具层：

- [Commands 与 Tools](../reference/commands-and-tools.md)
- [技术文档入口](../technical/index.md)
