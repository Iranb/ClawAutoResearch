# 2026-05-12 Live Workflow 控制面与实际运行态不对齐总结

## 范围

- Repo:
  `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research`
- Live project under investigation:
  `/Users/iranb/Downloads/AutoResearchProjects-karpathy-loop-20260508t122035/research-2026-05-12t1450z-sql-pn41`
- 目标运行配置:
  - primary model: `qwen/qwen3.6-plus`
  - PaperNexus server: `10.126.56.41`

## 控制面表面上看起来哪里不对

这次 live 测试里，控制面可见状态和项目真实状态反复在三个层面上出现偏差:

1. 即使图谱已经可用，控制面上看起来仍然像是 `graph_build` 和远程文献发现卡住了。
2. 即使真实 plan 制品已经完整，控制面上看起来仍然像是 `plan` 阶段缺少 `research_program` 结构。
3. 项目已经前进后，queue、session 和 broadcast 残留还在不断把旧的 `plan` / `code` / mitigation 状态重新暴露出来。

直接后果是，操作者很容易得出“PaperNexus 还在坏”或“项目还卡在 plan”的错误结论，但真实项目其实已经越过了这些阶段。

## 具体不对齐点

### 1. `graph_build` 看起来像失败，但真实图谱状态已经 ready

历史症状:

- 早期 `graph_build` / 远程文献发现请求打到 `10.126.56.30:4821` 时确实失败过
- 失败模式是连接被拒绝，不是缺论文

切到 `10.126.56.41` 之后的真实状态:

- `~/.openclaw/openclaw.json` 里已经解析到:
  - `papernexusMcpUrl = http://10.126.56.41:4821/mcp`
  - `papernexusApiBaseUrl = http://10.126.56.41:4821`
- live `PROJECT_MANIFEST.json.paper_ingestion` 显示:
  - `graph_presence_status = ready`
  - `graph_build_workflow_status = ready`
  - `graph_build_requires_import = false`
  - `papernexus_certification_status = ready`
  - `papernexus_sync_runtime_status = ready`
- live `graph/GRAPH_PRESENCE_CHECK.json` 显示:
  - `status = ready`
  - `ready_proof_level = source_span`
  - `present_paper_count = 15`
  - `missing_paper_count = 0`
- live `graph/PAPERNEXUS_SYNC_STATE.json` 显示:
  - `workflow_projection.runtime_status = ready`
  - `workflow_projection.can_continue = true`
  - `proof.source_backed_graph_claim = true`

为什么控制面上还像是坏的:

- 那条 bounded literature discovery requisition 最终是带 warning 完成的:
  "No-Discord literature discovery grace window elapsed after graph presence was ready; current graph accepted with a durable warning report."
- 这个 warning 的意思是“这次 requisition 没有新增 durable import 证据”，不是“远端 PaperNexus 还在坏”
- stale queue residue 和旧 trace 让旧的 `graph_build` 叙事比新的 ready 状态更显眼

结论:

- 当前 live 项目并没有被 PaperNexus 连通性阻塞
- 旧的 `10.126.56.30` 失败是真实的，但切到 `10.126.56.41` 之后，它已经不是当前活跃阻塞点

### 2. `plan` 看起来不完整，但真实 plan 文本已经完整

控制面症状:

- workflow 回退到 `plan / orchestrator`
- blocking reason 指向缺失或畸形的 `research_program` 数据
- manifest 里出现了不完整的 `plan_alternatives` 和空的 track `write_scope`

实际项目状态:

- `orchestrator/PLAN.md` 是完整的
- `orchestrator/PLAN_AUDIT.md` 是完整的
- `A / B / C` 三个选项都已经在 plan 制品里定义好了

真实原因:

- `PROJECT_MANIFEST.json.research_program` 被一个 sparse patch 破坏性覆盖了
- 缺的是 durable contract 里的结构，不是人写的 plan 文档缺内容

这个问题已经在本地复现，并在 repo 代码里修掉:

- file:
  `tools/workflow-guard-setters/research-state-setters.ts`
- 修复点:
  `setResearchProgramState(...)` 现在会在 sparse patch 试图清空字段时保留 canonical 的非空 plan 字段
- regression test:
  `tests/workflow/guard/workflow-guard-setters-split.test.mjs`

结论:

- plan 阶段阻塞的本质是控制面合同损坏
- 这不是 orchestrator 没产出真实 plan 的证据

### 3. queue / session / broadcast 状态落后于真实阶段

观测到的残留:

- 旧 queue entry 仍然在引用:
  - `workflow_auto_discussion`
  - `workflow_mitigation_dispatch`
  - `research_queue`
  - older `plan` / `code` stage waits
- broadcast replay 日志持续在重放更早的状态包，但投递失败
- 一些顶层 summary 读取会暴露 null 或 stale 的 owner 字段，而真实有效 owner 仍然能从 live iterator state 和 manifest snapshot 里恢复出来

这种不对齐的典型表现:

- raw queue status 还在显示历史 `failed` 和 `running` 工作
- broadcast replay 还在重试旧的 `plan` / `code` 状态通知
- live auto-iterator snapshot 实际已经走到 `experiment`
- live sessions 已经不再显示这些旧状态对应的 bound active session

为什么这点重要:

- runtime residue 会让项目看起来比真实情况更卡
- stale control-plane 记录已经不能代表当前真正的 blocker
- 正确诊断源应当是 live manifest 加一次 fresh auto-iterator tick，而不是更老的 queue residue

## 验证后的当前真实状态

截至最新一次 live smoke:

- model config 已对齐到 `qwen/qwen3.6-plus`
- PaperNexus config 已对齐到 `10.126.56.41`
- plugin runtime `dist/` 已同步到:
  `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/ClawAutoResearch/dist/`
- live 项目当前状态:
  - stage: `experiment`
  - effective owner: `researcher`
  - graph presence: `ready`
  - missing stage signals: `[]`
  - next action: `/monitor-experiment`
- live experiment search state 显示:
  - `last_decision = continue_tuning`
  - `multi_seed_status = pending`
  - `pending_reason = "A candidate looks promising, but multi-seed validation is still required before trusting the gain."`

这说明当前活跃阻塞点已经不在 `graph_build`。
当前项目真正等待的是 experiment reconciliation / monitoring 和更强的 multi-seed validation，不是远程文献发现。

## 根因分层

这次不对齐来自多层原因，不是单点 bug:

1. 外部连通性失败
   - 旧 PaperNexus endpoint `10.126.56.30:4821` 在这个 workflow path 上确实不可用
2. Durable contract 损坏
   - sparse `set_research_program` 更新会清掉合法的 canonical plan 数据
3. Runtime residue
   - queue、broadcast 和 mitigation trace 持续把已经 superseded 的 `plan` / `code` / graph-build 叙事重新暴露出来
4. 操作层可见性缺口
   - 历史控制面制品比新的 live-ready graph 和 experiment 状态更容易先被看到

## 已做修复与检查

### Repo 级硬化

- updated `tools/workflow-guard-setters/research-state-setters.ts`
- added regression coverage in `tests/workflow/guard/workflow-guard-setters-split.test.mjs`

### Runtime 对齐

- confirmed OpenClaw main model is `qwen/qwen3.6-plus`
- confirmed PaperNexus live endpoint is `10.126.56.41`
- synced current repo `dist/` to plugin runtime directory

### Live 项目安全处理

- backed up mutable live workflow state before the live smoke run:
  `/Users/iranb/Downloads/AutoResearchProjects-karpathy-loop-20260508t122035/research-2026-05-12t1450z-sql-pn41/.debug-backups/20260512T071122Z-live-smoke-precheck`

### 验证

- targeted regression:
  `node --test tests/workflow/guard/workflow-guard-setters-split.test.mjs`
- build:
  `npm run build`
- lint:
  `npm run lint`
- full suite:
  `npm test`
  - result: `1214 passed / 0 failed`
- whitespace / patch hygiene:
  `git diff --check`
- live smoke:
  one real `runWorkflowAutoIterator(...)` tick against the live project using the live workflow policy

## 后续排障时的实用规则

以后 live 项目看起来卡住时，不要先信最老、最显眼的 queue 或 broadcast residue。
建议按这个顺序检查:

1. `PROJECT_MANIFEST.json`
2. `.openclaw-research/auto-iterator-state.json`
3. `.openclaw-research/workflow-runtime-sessions.json`
4. `.openclaw-research/workflow-runtime-queue.json`
5. `graph/GRAPH_PRESENCE_CHECK.json`
6. `graph/PAPERNEXUS_SYNC_STATE.json`
7. 最后再把旧 queue / broadcast / diagnostics 文件当作历史上下文使用

在这次事故里，这个检查顺序把下面几件事清楚分开了:

- 旧 `.30` 网络故障
- plan contract 损坏
- stale runtime residue
- 当前真实 blocker 在 `experiment`

## 当前 workflow 中其他“多文件共控一个面”的高风险区域

下面这些不一定都是设计错误。
其中相当一部分本来就是“一个权威细节文件 + 一个 manifest 摘要 + 一组人类可读报告”的设计。
真正的风险点在于: materializer / reconciliation 没有及时收敛，或者旧 runtime 残留把过期状态重新暴露成当前控制面。

### 1. 图谱 ready / paper ingestion 面

这一面不是只由一个 `graph_build` 标志控制，而是共同受下面这些文件影响:

- `PROJECT_MANIFEST.json.paper_ingestion`
- `graph/GRAPH_PRESENCE_CHECK.json`
- `graph/PAPERNEXUS_SYNC_STATE.json`
- `graph/PAPERNEXUS_STATUS.json`
- `researcher/PAPER_SOURCE_INDEX.json`

主要漂移风险:

- manifest 上的 `paper_ingestion` 摘要可能落后于图谱侧 proof 文件
- `graph presence ready`、`remote sync ready`、`source index ready` 可能分别已经成立，但控制面只暴露出其中一层
- 结果就是“图已经够了，但界面仍像卡在 graph_build / discovery”

### 2. experiment search / reconciliation 面

“experiment 是否完成、是否可以进入 analysis” 也不是单文件判定，而是由下列状态共同决定:

- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/EXPERIMENT_REGISTRY.md`
- `researcher/EXPERIMENT_SEARCH.json`
- `PROJECT_MANIFEST.json.experiment_search`
- bundle-local runtime 产物:
  `REMOTE_RUN.json`、`RUN_HEARTBEAT.json`、`RUN_TERMINAL.json`、`RESULT_SUMMARY.json`、`FAILURE_SIGNATURE.json`
- `researcher/EXECUTION_PROOF.json`

主要漂移风险:

- 候选运行已经结束，但 manifest 里的 `experiment_search` 还没被 reconciliation 推到 terminal / ready 状态
- watcher 侧知道 run 已结束，control-plane 仍然只看到 `continue_tuning`
- 这类漂移会把真实 blocker 从“结果解释 / 多 seed 验证”误诊成“实验还没跑完”

### 3. `survey_review` 面

综述 workflow 虽然刻意把权威状态集中到 `PROJECT_MANIFEST.json.survey_review`，但真正支撑它的仍然是一组 packet 文件:

- `PROJECT_MANIFEST.json.survey_review`
- `researcher/SURVEY_QUERY_REGISTRY.json`
- `researcher/LITERATURE.md`
- `researcher/LITERATURE_REVIEW.md`
- `researcher/REVIEW_PROTOCOL.md`
- `researcher/INCLUDED_PAPERS.json`
- `researcher/EXCLUDED_PAPERS.json`
- `researcher/CANDIDATE_PAPERS.json`
- `researcher/SCREENING_DECISIONS.json`
- `researcher/SOTA_MATRIX.md`
- `researcher/GAP_SYNTHESIS.md`
- `researcher/COVERAGE_SUMMARY.md`
- `researcher/SURVEY_BRIEF.md`
- `researcher/SURVEY_GATE_DIAGNOSTICS.json`

主要漂移风险:

- 综述文件已经写出来，但 gate diagnostics 还没回填到 manifest
- included / excluded / candidate 统计彼此不一致时，顶层阶段会显得忽前忽后
- 结果是“人眼看 survey 已经齐了，workflow 仍不肯 handoff 到 write”

### 4. write package / submit 前置包 面

“write 是否已经具备可写输入包” 其实是一个很大的组装面，不是某个单独状态位:

- `PROJECT_MANIFEST.json.write_package`
- `PROJECT_MANIFEST.json.research_program`
- `TRACK_REGISTRY.json`
- analyzer 侧产物:
  `analyzer/CLAIM_EVIDENCE_MATRIX.md`、`analyzer/NARRATIVE_REPORT.md`、`analyzer/TRACK_VERDICTS.md`、`analyzer/UNSUPPORTED_CLAIMS.md`
- researcher 侧摘要:
  `researcher/baseline_summary.json`、`researcher/research_summary.json`、`researcher/ablation_summary.json`、`researcher/evaluation_summary.json`
- proof packet / figure pack / writing session packet

主要漂移风险:

- 文稿所需的证据包已经存在，但 `write_package` 摘要还没反映完整
- track verdict、claim-evidence、summary packet 之间可能局部齐了、全局未齐
- 结果是 write 看起来像“还没准备好”，但实际只是装配摘要没有收敛

### 5. results storyline / title-abstract-intro workbench 面

前言和故事线这块也不是一个文件说了算，而是多个写作控制面一起决定:

- `PROJECT_MANIFEST.json.results_storyline`
- `PROJECT_MANIFEST.json.title_abstract_intro_workbench`
- `PROJECT_MANIFEST.json.paper_story_state`
- `PROJECT_MANIFEST.json.innovation_synthesis_state`
- `PROJECT_MANIFEST.json.review_pressure_packet`
- `PROJECT_MANIFEST.json.writing_contract`
- `academic_writer/paper/main.tex`

主要漂移风险:

- story state、front-matter workbench、主稿 front section 可能各自都被更新过，但没有统一 materialize
- title / abstract / intro 的 ready 判断容易滞后于实际文稿修改
- 结果是写作面看起来像“故事线还没齐”，但真实问题可能只是几个摘要 state 没对齐

### 6. workflow hooks / audit 面

“某个 hook 是否通过、是否要求 revise、是否 escalated” 也存在典型的多面共控:

- `PROJECT_MANIFEST.json.workflow_hooks`
- 兼容镜像 `PROJECT_MANIFEST.json.workflow_audit.checkpoints`
- `.openclaw-research/workflow-hooks-state.json`
- `reviewer/file-audits/<hook>/round-*/...`
- `reviewer/file-audits/_aggregate/...`

主要漂移风险:

- policy、runtime state、审计输出包三者可能不同步
- 顶层 checkpoint 已经被 summary 成通过，但轮次审计里仍有开放问题
- 或者反过来，审计产物已经完成，但 hooks state 没 materialize 回 control-plane

### 7. handoff / runtime ownership 面

“当前到底是谁持有这个 stage、handoff 是否真的送达、runtime 是否还活着” 本身就是一个多文件共控面:

- `PROJECT_MANIFEST.json`
- `.openclaw-research/workflow-mailbox.json`
- `.openclaw-research/workflow-handoff-intents.json`
- `.openclaw-research/workflow-runtime-queue.json`
- `.openclaw-research/workflow-runtime-sessions.json`
- `.openclaw-research/workflow-announce-outbox.json`
- `.openclaw-research/workflow-broadcast-outbox.json`
- `.openclaw-research/workflow-events.jsonl`
- `.openclaw-research/workflow-trace.jsonl`

主要漂移风险:

- manifest owner、mailbox blocker、runtime bound session、queue item 可能各自停在不同时间点
- 旧 outbox / replay residue 会让已经 superseded 的 handoff 再次显眼
- 这正是这次 live 事故里已经看到的同类问题: 历史控制面叙事覆盖了当前真实 owner 和 next action

## 剩余工作

剩余 live 工作已经不是 `graph_build`。
下一个真正该查的目标是:

- 为什么 `/monitor-experiment` 还没有把当前 bounded search loop 从 `continue_tuning` 推进到更明确的 `ready_for_analysis`，或者另一个显式 experiment terminal decision

这个问题应该按 `experiment` 阶段的 control-plane / reconciliation 问题来分析，而不是继续当作另一个 PaperNexus discovery failure。
