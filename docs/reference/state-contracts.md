# State Contracts

这页列的是系统真正依赖的 durable facts。只要这些合同还在，系统就能恢复；如果它们缺失，系统就应该阻塞或回退。

## 1. 顶层项目合同

| 文件 | 角色 | 作用 |
| --- | --- | --- |
| `PROJECT_MANIFEST.json` | 项目控制平面 | current stage、owner、blocking、contracts、graph/watch、writing state |
| `TRACK_REGISTRY.json` | hypothesis portfolio | active / parked / killed tracks 与其状态 |
| `CLAIM_POLICY.md` | claim discipline | 约束哪些 claim 可以进入论文叙事 |
| `PROJECTS_STATE.json` | 多项目总账 | queue mode 和全局恢复入口 |

## 2. Researcher 关键状态

- `researcher/GATE_STATE.json`
- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/EXPERIMENT_GPU_MONITOR.json`
- `researcher/EXPERIMENT_REGISTRY.md`
- `researcher/INNOVATION_REFLECTION.md`
- `researcher/IDEA_TOURNAMENT_STATE.json`

其中 `EXPERIMENT_LEDGER.json` 是最重要的执行记忆来源，`EXPERIMENT_GPU_MONITOR.json` 则把“远程 GPU 现在到底忙不忙、哪个分配的 GPU 已经空闲、哪些 run 很可能已经结束”写成 durable 状态，`INNOVATION_REFLECTION.md` 则把实验结果如何反过来影响下一轮 ideation 显式写下来。

## 3. Graph 与 memory 合同

- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/graph/GRAPH_PRESENCE_CHECK.json`
- `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`
- `{PROJ}/memory/ideation-memory.md`
- `{PROJ}/memory/experiment-memory.md`

这些文件共同决定系统是否相信“图谱已经 ready，且项目记忆足够完整”。

## 4. 运行时隐藏状态

这些状态通常位于 `{PROJ}/.openclaw-research/`：

- `workflow-mailbox.json`
- `workflow-contact-log.json`
- `workflow-runtime-queue.json`
- `workflow-runtime-sessions.json`
- `workflow-announce-outbox.json`
- `workflow-broadcast-outbox.json`
- `workflow-events.jsonl`
- `workflow-trace.jsonl`

它们不只是 debug 文件，而是 runtime recovery 的关键依据。

## 5. Plan / Analyze / Review / Write 的 durable packets

下面这些合同是后半段主线的核心：

- `PROJECT_MANIFEST.json.research_program`
- `PROJECT_MANIFEST.json.ideation_contract`
- `PROJECT_MANIFEST.json.paper_story_state`
- `PROJECT_MANIFEST.json.review_pressure_packet`
- `PROJECT_MANIFEST.json.writing_contract`

特别是 `paper_story_state`，它把 claim support、story spine、claim-to-experiment mapping 这些写作关键面从临时判断中抽离出来。

## 6. 不建议手工直接改的文件

活跃 workflow 中尤其不建议手工编辑：

- `PROJECT_MANIFEST.json`
- `researcher/EXPERIMENT_LEDGER.json`
- `workflow-mailbox.json`
- runtime queue / sessions / trace 文件

如果必须修复，优先通过对应工具动作、repair helper 或一次性迁移脚本完成。
