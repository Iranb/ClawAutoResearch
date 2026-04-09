# 测试与调试

维护这套系统时，最容易犯的错是“只改了代码，没有验证行为约束是否还在”。

## 1. 日常最常用的验证命令

```bash
npm run build
node --test tests/workflow-web-doc.test.mjs
node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs
node --test tests/writer-reviewer-runtime-state.test.mjs tests/workflow-writing-lines-e2e.test.mjs
```

## 2. 为什么这些测试最重要

- `npm run build`
  - 保证 TypeScript 层没有明显断裂。
- `tests/auto-iterator.test.mjs`
  - 保证阶段推进、回退和 setup/submit 等关键门控没有退化。
- `tests/workflow-runtime-tools.test.mjs`
  - 保证 `research_workflow` 的主要工具动作仍然对齐当前状态合同。
- `tests/workflow-web-doc.test.mjs`
  - 保证文档站、兼容入口和 GitHub Pages 相关约束没有漂移。
- `tests/writer-reviewer-runtime-state.test.mjs`
  - 保证普通论文主线的 write-stage gate、writer/reviewer runtime 状态与 submit handoff 约束仍然成立。
- `tests/workflow-writing-lines-e2e.test.mjs`
  - 保证科研综述主线能从 `survey_review` 进入 `paper_mode=survey` 的 write 阶段，而且不会误吃实验论文专属 blocker。

## 3. 常见问题应该先查哪里

### graph 一直不 ready

先查：

- `graph/GRAPH_PRESENCE_CHECK.json`
- `graph/PAPERNEXUS_STATUS.json`
- `papernexusSharedCorpus` 配置
- remote access / progress 相关动作返回值

### 阶段一直卡住不前进

先查：

- `PROJECT_MANIFEST.json.current_stage`
- `PROJECT_MANIFEST.json.blocking_reason`
- `missingSignals`
- `researcher/GATE_STATE.json`
- mailbox 是否有未处理 blocker

### Writer / Reviewer 行为不符合预期

先查：

- `paper_story_state`
- `review_pressure_packet`
- `writing_contract`
- 对应 materializer 是否已运行

## 4. 修 bug 时最稳妥的顺序

1. 先定位是 tool state、contract 缺失还是角色越界。
2. 给对应行为补或改回归测试。
3. 看是否需要同时改 template、docs 和 runtime helper。
4. 重新跑构建与相关测试。

## 5. 关于手工修状态文件

尽量不要在活跃项目里直接手改：

- `PROJECT_MANIFEST.json`
- `EXPERIMENT_LEDGER.json`
- runtime queue / sessions / mailbox

如果你直接改了这些文件，就必须额外确认 recovery 逻辑和 trace 是否还能解释当前现场。
