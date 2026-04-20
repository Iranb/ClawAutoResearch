---
layout: home

title: ClawAutoResearch Docs
hero:
  name: ClawAutoResearch Docs
  text: OpenClaw 自动科研控制平面
  tagline: "文档站现在分成两条线: 用户文档负责快速上手，技术文档负责解释控制平面、运行时与状态合同。"
  actions:
    - theme: brand
      text: 先看安装指南
      link: /user-guide/installation
    - theme: alt
      text: 再看使用指南
      link: /user-guide/usage
    - theme: alt
      text: 进入技术文档
      link: /technical/
features:
  - title: 用户文档 / User Guide
    details: 给第一次使用系统的人。现在明确拆成“安装”和“使用”两条入口，不先讲底层实现。
    link: /user-guide/
  - title: 安装指南 / Installation
    details: 只讲怎么把插件和文档站装好，并确认 workflow 环境真的可用。
    link: /user-guide/installation
  - title: 使用指南 / Usage
    details: 只讲安装完成后怎么启动实验项目或综述项目、怎么查状态、怎么恢复。
    link: /user-guide/usage
  - title: 技术文档 / Technical Docs
    details: 给维护者和扩展开发者。集中解释 workflow control plane、runtime queue、状态合同和模块边界。
    link: /technical/
  - title: GitHub Pages
    details: 文档站已按子路径部署兼容方式组织，适合直接接上 GitHub Pages。
    link: /operations/github-pages
---

# ClawAutoResearch Docs Portal

这套文档站现在是 `openclaw-research` 的权威介绍入口。它用 `VitePress` 取代了原来分散在 `DOC/` 和 `docs/` 里的多份静态说明，并且把内容明确分成两类：

- 用户文档：面向“我要先把系统用起来”的人
- 技术文档：面向“我要理解和修改系统内部机制”的人

## 这套系统是什么

`ClawAutoResearch` 是一个挂在 OpenClaw 上的自动科研插件，但它真正提供的不是“会写论文的 Agent”，而是一个有控制平面、有 durable state、有知识图谱底座、有角色边界、有自动迭代器的科研执行系统。

它把下列事情系统化了：

- 用 `PROJECT_MANIFEST.json`、`TRACK_REGISTRY.json`、`EXPERIMENT_LEDGER.json` 和 runtime state 文件替代聊天历史记忆。
- 用 `workflow-guard`、stage owners、gate state、mailbox 和 cooldown 约束多 Agent 协作。
- 用 `PaperNexus` shared graph、graph presence 和 canonical paper ingestion 把创新、分析、写作都锚定在同一套证据上。
- 用 `auto_iterator_tick`、background queue、runtime recovery 把“推进、回退、等待人工、触发 repair”变成代码层行为。
- 用 `research_program`、`paper_story_state`、`review_pressure_packet`、`writing_contract` 让 plan、analyze、review、write 阶段都有 durable contracts。
- 用同一套 workflow 同时支撑实验论文主线和 `survey_review -> write (paper_mode=survey)` 的科研综述主线。

<div class="portal-grid">
  <div class="portal-card">
    <h3>用户入口：第一次接触这个系统</h3>
    <p>先读 <a href="./user-guide/installation">安装指南</a>，再继续看 <a href="./user-guide/usage">使用指南</a>。</p>
  </div>
  <div class="portal-card">
    <h3>技术入口：要修系统的人</h3>
    <p>从 <a href="./technical/">技术文档</a> 进入，再读 <a href="./reference/module-map">Module Map</a>、<a href="./reference/state-contracts">State Contracts</a> 和 <a href="./operations/testing-and-debugging">测试与调试</a>。</p>
  </div>
  <div class="portal-card">
    <h3>项目操作者：要跑科研项目的人</h3>
    <p>重点读 <a href="./user-guide/usage">使用指南</a> 和 <a href="./get-started/project-lifecycle">项目生命周期</a>。</p>
  </div>
  <div class="portal-card">
    <h3>部署者：要发布文档站的人</h3>
    <p>直接看 <a href="./operations/github-pages">GitHub Pages 部署</a>，文档站兼容仓库子路径部署。</p>
  </div>
</div>

## 系统的核心对象

| 对象 | 作用 | 为什么重要 |
| --- | --- | --- |
| `Project` | 一个科研项目的根容器 | 所有 durable state、图谱状态和跨角色产物都围绕项目目录组织 |
| `Track` | 研究假设或方案单元 | ideation、plan、experiment、analyze 都围绕 track 进行 |
| `Experiment` | 执行证据单元 | ledger 是系统记住“试过什么”的核心 |
| `Graph` | 共享知识底座 | novelty grounding、frontier mapping、reflection、writing 都要回到图谱 |
| `Contract` | 跨阶段 durable interface | 下游阶段消费的是 contract，而不是某次聊天的口头总结 |
| `Auto Iterator` | 决策推进器 | 决定停留、回退、推进、repair 与 handoff |

## 你会在文档里反复看到的关键词

- `workflow-guard`：插件里的控制中枢，负责 snapshot 注入、边界约束、runtime orchestration 和 state normalization。
- `research_workflow`：最核心的运行时工具，暴露 snapshot、graph、queue、contracts、mailbox、QC、review 等动作。
- `research_memory`：结构化研究记忆工具，用来写 idea/experiment entries、daily log 和 review state。
- `PaperNexus`：共享图谱和文献知识底座，影响 graph build、frontier mapping、novelty check、innovation reflection、citation grounding。
- `PROJECT_MANIFEST.json`：项目级控制平面文件，串起当前阶段、owner、blocking reason、contracts 和 runtime summary。

## 文档分层

| 类型 | 面向谁 | 从哪里进入 |
| --- | --- | --- |
| 用户文档 | 第一次使用系统的人 | [安装指南](./user-guide/installation.md) / [使用指南](./user-guide/usage.md) |
| 技术文档 | 维护者、调试者、扩展开发者 | [技术文档](./technical/index.md) |

## 新文档站与旧文档的关系

现在的结构是：

- `docs/`：唯一权威文档根，也是 VitePress 站点源目录。
- `docs/user-guide/`：用户教程与使用入口。
- `docs/technical/`：技术入口页。
- 内部设计历史与私有计划：不再进入公开 docs 站点。
- `DOC/`：保留兼容入口与历史说明，提醒读者迁移到新 portal。

如果你是从旧链接进来的，不需要担心跳不到内容。兼容入口会继续保留，但主导航、细化介绍和后续更新都应该集中在这里。
