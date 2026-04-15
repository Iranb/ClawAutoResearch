---
layout: home

title: ClawAutoResearch Docs
hero:
  name: ClawAutoResearch Docs
  text: OpenClaw 自动科研控制平面
  tagline: 用 VitePress 重建后的统一文档站。这里完整解释系统的工作流状态机、PaperNexus 图谱链路、workflow-guard 控制层、Agent/Skill 边界、durable state contracts 与 GitHub Pages 部署方式。
  actions:
    - theme: brand
      text: 从快速开始进入
      link: /get-started/
    - theme: alt
      text: 阅读工作流控制平面
      link: /architecture/workflow-control-plane
    - theme: alt
      text: 查看运行时接口
      link: /reference/commands-and-tools
features:
  - title: Overview / 系统总览
    details: 先理解系统边界、核心对象和为什么它不是“几个 prompt 叠在一起”。
    link: /architecture/
  - title: Get Started / 快速开始
    details: 从安装、启用、项目初始化、graph build 到恢复现场的最短路径。
    link: /get-started/
  - title: Workflow / 工作流控制平面
    details: 实验论文主线与综述主线、owner gate、auto_iterator_tick、回退与 repair 逻辑。
    link: /architecture/workflow-control-plane
  - title: Workflow Hooks / 节点级审核
    details: 关键产出节点、handoff 节点、task closeout 的 durable hook、file audit、revision dispatch 与 hook state。
    link: /architecture/workflow-hooks
  - title: Graph & Memory / 图谱与记忆
    details: PaperNexus、shared corpus、graph presence、实验账本与 innovation reflection。
    link: /architecture/graph-memory
  - title: Agents & Skills / 角色与技能
    details: 角色职责、目录边界、workflow mailbox 和 skills 如何配合 workflow guard。
    link: /architecture/agents-and-skills
  - title: Runtime & Reference / 运行时参考
    details: slash commands、research_workflow、research_memory、状态合同与模块地图。
    link: /reference/
---

# ClawAutoResearch Docs Portal

这套文档站现在是 `openclaw-research` 的权威介绍入口。它用 `VitePress` 取代了原来分散在 `DOC/` 和 `docs/` 里的多份静态说明，把系统真实存在的功能和设计重新按主题组织起来。

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
    <h3>读者 1：第一次接触这个系统</h3>
    <p>先读 <a href="/get-started/">快速开始</a>，再看 <a href="/architecture/workflow-control-plane">工作流控制平面</a>。这样最容易建立整体心智模型。</p>
  </div>
  <div class="portal-card">
    <h3>读者 2：要修系统的人</h3>
    <p>重点读 <a href="/reference/module-map">Module Map</a>、<a href="/reference/state-contracts">State Contracts</a>、<a href="/architecture/workflow-hooks">Workflow Hooks</a> 和 <a href="/operations/testing-and-debugging">测试与调试</a>。</p>
  </div>
  <div class="portal-card">
    <h3>读者 3：要跑科研项目的人</h3>
    <p>重点读 <a href="/get-started/project-lifecycle">项目生命周期</a>、<a href="/architecture/graph-memory">Graph 与 Memory</a> 和 <a href="/reference/commands-and-tools">Commands 与 Tools</a>。</p>
  </div>
  <div class="portal-card">
    <h3>读者 4：要部署公开文档的人</h3>
    <p>直接看 <a href="/operations/github-pages">GitHub Pages 部署</a>，文档站兼容仓库子路径部署。</p>
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

## 新文档站与旧文档的关系

现在的结构是：

- `docs/`：唯一权威文档根，也是 VitePress 站点源目录。
- `docs/superpowers/`：保留内部设计历史、specs 和 implementation plans。
- `DOC/`：保留兼容入口与历史说明，提醒读者迁移到新 portal。

如果你是从旧链接进来的，不需要担心跳不到内容。兼容入口会继续保留，但主导航、细化介绍和后续更新都应该集中在这里。
