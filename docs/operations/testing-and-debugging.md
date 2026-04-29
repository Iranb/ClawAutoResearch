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

如果你在 Discord 里发现流水线卡住，优先直接运行：

```text
/handoff-status
```

如果它显示 handoff 已经停在 `prepared / dispatched / acknowledged` 一类状态，再继续运行：

```text
/capture-diagnostics --reason discord_pipeline_failure
```

`/handoff-status` 适合先快速确认：

- 当前真正 owner 是谁
- `pending_handoff_id` 是不是还挂着
- queue / mailbox / binding gate 谁在卡

`/capture-diagnostics` 则会在当前项目下生成一份 bounded 诊断包，包含 snapshot、runtime health、handoff、queue、mailbox、graph/papernexus 状态和关键日志 tail。

### graph 一直不 ready

先查：

- `graph/GRAPH_PRESENCE_CHECK.json`
- `graph/PAPERNEXUS_STATUS.json`
- `papernexusSharedCorpus` 配置
- remote access / progress 相关动作返回值

远端 PaperNexus no-Discord E2E 要额外确认：

- `PROJECT_MANIFEST.json.paper_ingestion.queued_requests[].args` 是否包含 `--ssh-target` 和 `--remote-staging-root`
- `.openclaw-research/workflow-runtime-queue.json` 里 PaperNexus wrapper 任务是否从 `queued/running` 进入 terminal 状态
- `researcher/paper-staging/queued-imports/*/batch-import.json` 是否指向真实 staged PDF/Markdown
- 401 通常是 token source/keychain 问题；本机 `~/.papernexus/config.json` 的 loopback serve token 不会用于远端 HTTP MCP
- 如果部分论文终止失败，检查 `REQUISITION_SATISFACTION_REPORT.json`、`graph/GRAPH_PRESENCE_CHECK.json` 和 manifest 里的 degraded repair evidence，不要要求所有补充论文都必须先入图

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

## 6. Gateway `chat.send` 真实 slash-command 测试

这条路径比 `openclaw agent --message "/..."` 更接近官方 slash command 语义，因为 OpenClaw 官方文档和测试都明确表明：slash commands 由 Gateway 处理，`chat.send` 有直接的 command-dispatch 路径。

### 6.1 测试脚本

仓库里提供了一个 repo-local live test script：

```bash
node scripts/run_gateway_chat_send_live_test.mjs --message "/show-commands"
```

它会：

1. 读取本机 OpenClaw gateway 配置和 token
2. 通过 WebSocket 连接 live gateway
3. 发送真实 `chat.send`
4. 等待 `chat final event`
5. 输出 connect / ack / final event 的结构化结果

如果要模拟更接近 Discord channel 的命令上下文，可以加：

```bash
--session-key 'agent:researcher:discord:channel:<channel-id>'
--originating-channel discord
--originating-to 'discord:channel:<channel-id>'
--originating-account-id researcher
```

### 6.2 已记录的真实结果（2026-04-12）

主题：`Generalized Category Discovery`

#### A. `/show-commands`

使用 `chat.send` + signed device identity 后：

- live gateway `connect` 成功
- `chat.send` ack 成功
- 收到 `chat final event`
- 命令返回了完整 slash command 列表

这说明：

- Gateway `chat.send` 路径本身是通的
- plugin slash command dispatch 是可工作的

#### B. `/auto-research "Generalized Category Discovery"`

使用：

```bash
node scripts/run_gateway_chat_send_live_test.mjs \
  --message '/auto-research "Generalized Category Discovery"' \
  --session-key 'agent:researcher:discord:channel:<channel-id>' \
  --originating-channel discord \
  --originating-to 'discord:channel:<channel-id>' \
  --originating-account-id researcher
```

真实结果：

- `connect` 成功
- `chat.send` ack 成功
- 命令确实进入了 command handler
- 但 `final event` 返回的是：
  - `❌ /auto-research requires a resolved workflow session for this conversation.`

#### C. `/auto-review "Generalized Category Discovery"`

同样走 `chat.send` 真路径后：

- `connect` 成功
- `chat.send` ack 成功
- 命令确实进入了 command handler
- 但 `final event` 返回的是：
  - `❌ /auto-review requires a resolved workflow session for this conversation.`

### 6.3 这些结果说明了什么

当前我们已经把真实问题缩小到这几层：

1. **不是 transport 层完全坏掉**
   - `chat.send` 已经能真实到达 Gateway 并触发 slash command dispatch
2. **不是 plugin command 没注册**
   - `/show-commands` 已经在 live gateway 路径上成功返回
3. **不是 `/auto-research` / `/auto-review` handler 本身报内部异常**
   - 两个命令都明确返回了 workflow session gate 错误，而不是 silent hang
4. **当前 blocker 是 session/context resolution**
   - 命令执行时拿到的上下文，仍不被 workflow command 视为“resolved workflow session for this conversation”

### 6.4 真实测试中碰到的问题

这次 live `chat.send` 测试实际踩到过三类问题：

1. **无 device identity 时 scopes 被清空**
   - 现象：`missing scope: operator.write`
   - 解决：测试脚本必须带 signed device identity，而不只是 token

2. **错误的 client id / protocol version 会直接在握手阶段失败**
   - 现象：
     - `invalid connect params`
     - `protocol mismatch`
   - 解决：脚本必须复用 OpenClaw 测试里同样的 `client.id = "test"` 和当前协议版本

3. **即便 transport 和 command dispatch 已通，workflow command 仍可能因为 conversation/session context 不完整而拒绝执行**
   - 当前 `/auto-research`、`/auto-review` 就停在这里

### 6.5 当前最准确的结论

如果问题是：

- “Gateway `chat.send` 能不能真正执行 plugin slash command？”

答案是：

- **能**，`/show-commands` 已经真实证明了这一点

如果问题是：

- “`/auto-research` 和 `/auto-review` 能不能在当前 internal `chat.send` 测试路径里一路跑到最后？”

答案是：

- **还不能**
- 当前不是 transport 故障
- 当前是 **workflow session / conversation context resolution** 还没对齐到 command handler 的预期

## 7. Native slash replay 本地真测

如果目标是验证 `openclaw-research` 里的 workflow slash commands，而不是验证 Discord 外部投递链路，那么**更推荐**走 native slash replay。

原因是 OpenClaw 官方对 Discord native slash command 的核心语义是：

- slash 命令本身运行在独立 command session
  - `agent:<agentId>:discord:slash:<userId>`
- 真正要操作的会话通过 `CommandTargetSessionKey` 指向目标频道会话
  - `agent:<agentId>:discord:channel:<channelId>`

也就是说，对 workflow commands 来说，最关键的不是 webhook body，而是：

- `SessionKey`
- `CommandTargetSessionKey`
- `CommandAuthorized`
- `From`
- `To`
- `OriginatingTo`

### 7.1 推荐脚本

仓库里提供了一个本地 replay harness：

```bash
node scripts/run_discord_native_slash_replay_test.mjs \
  --command auto-research \
  --args '"Generalized Category Discovery"' \
  --projects-root "/tmp/openclaw-native-slash-tests"
```

这个脚本会构造与 OpenClaw 官方 Discord native slash 测试一致的上下文：

- `SessionKey = agent:researcher:discord:slash:<user-id>`
- `CommandTargetSessionKey = agent:researcher:discord:channel:<channel-id>`
- `CommandAuthorized = true`
- `From = discord:channel:<channel-id>`
- `To = slash:<user-id>`
- `OriginatingTo = channel:<channel-id>`

然后直接走 plugin command dispatch，而不是绕回普通 chat turn。

### 7.2 `/auto-research` 本地真测示例

```bash
node scripts/run_discord_native_slash_replay_test.mjs \
  --command auto-research \
  --args '"Generalized Category Discovery"' \
  --projects-root "/tmp/openclaw-native-slash-tests" \
  --channel-id gcd-research-lab \
  --user-id owner
```

预期结果：

- 成功创建本地测试项目
- 返回 `Full-auto research pipeline started ...`
- 输出里包含 `nativeSlashContext`
- background receipt 被写到项目或临时 `.openclaw-research/`

### 7.3 `/auto-review` 本地真测示例

```bash
node scripts/run_discord_native_slash_replay_test.mjs \
  --command auto-review \
  --args '"Generalized Category Discovery"' \
  --projects-root "/tmp/openclaw-native-slash-tests" \
  --channel-id gcd-survey-lab \
  --user-id owner
```

预期结果：

- 成功创建 `survey-...` 项目
- 返回 `Full-auto survey pipeline started ...`
- durable state 以 survey route 初始化

### 7.4 什么时候用 replay，什么时候用 `chat.send`

- 如果你要验证：
  - workflow command 是否能消费 native slash 的 target session
  - `/auto-research`、`/auto-review` 这种 project/session-sensitive command
  
  优先用 **native slash replay**

- 如果你要验证：
  - Gateway operator 路径
  - `chat.send` 本身的 command dispatch
  - synthetic route 注入是否可用
  
  用 **Gateway `chat.send` live test**

### 7.5 当前建议

对 `openclaw-research` 这类强依赖 workflow session 的命令，默认把：

- **native slash replay** 视为本地最可靠的 command-level 真测
- **Discord 真实点击 slash command** 视为外部集成真测
- **Gateway `chat.send`** 视为中间层 transport / route 注入验证

### 7.6 no-Discord 本地启动

如果目标是脱离 Discord 使用 `/auto-research` 或 `/auto-review`，直接用本地 harness。这个路径不会连接 Discord，也不会把 Discord channel 写成项目绑定。

```bash
node scripts/run_local_workflow_command.mjs \
  --command auto-research \
  --args '"Generalized Category Discovery"' \
  --projects-root "/tmp/openclaw-local-command-tests" \
  --channel local \
  --conversation-id gcd-research-local
```

```bash
node scripts/run_local_workflow_command.mjs \
  --command auto-review \
  --args '"Generalized Category Discovery"' \
  --projects-root "/tmp/openclaw-local-command-tests" \
  --channel local \
  --conversation-id gcd-survey-local
```

检查点：

- stdout 是 JSON，包含 command result 和 background run receipt。
- 项目目录出现在 `--projects-root` 下。
- `.openclaw-research/LOCAL_WORKFLOW_COMMAND_BACKGROUND_RUN.json` 存在。
- 如果使用 `--channel discord` 做兼容测试，Discord 只会被记录到 `.openclaw-research/workflow-notification-channels.json`，不会被自动写入 `channel-project-bindings.json`。
- topic-only 项目进入 `graph_build` 时，如果还没有 `researcher/PAPER_SOURCE_INDEX.json`，workflow 会从 manifest / `research_program.goal` 中解析 arXiv ID 或论文题名，先补 workflow-owned source seed，再抓取 Markdown/PDF 并排 PaperNexus batch import。

## 8. `/auto-research` 和 `/auto-review` 的 deterministic E2E

如果你要验证的不只是“命令能不能启动”，而是：

- `/auto-research` 是否真的能把 experiment 线带到 review-closed 的终态
- `/auto-review` 是否真的能把 survey 线带到 review-closed 的终态

优先使用统一 E2E runner。它会自动创建 run root、保存 payload/stdout/stderr、抽取每条 lane 的项目路径和最终 verdict。

真实 agent runtime：

```bash
npm run test:autoresearch:real -- --topic "Generalized Category Discovery"
npm run test:autoreview:real -- --topic "Generalized Category Discovery"
```

一次跑 experiment 和 survey 两条线：

```bash
npm run test:auto:real -- --topic "Generalized Category Discovery"
```

回归型 deterministic fixture：

```bash
npm run test:auto:fixture -- --topic "Generalized Category Discovery"
```

这些入口底层调用：

```bash
node scripts/run_auto_workflow_e2e_test.mjs \
  --command /autoresearch \
  --topic "Generalized Category Discovery" \
  --mode live
```

`--command` 可以写 `/autoresearch`、`/auto-research`、`/autoreview`、`/auto-review` 或 `full`。真实模式默认使用 `--bootstrap-transport local`，所以不会连接 Discord，也不会把 Discord channel 写成项目绑定。

真实模式默认按时间戳生成隔离 project id，避免旧项目的 runtime queue、session 或 hook retry budget 污染新测试。只有在要复盘同一项目时才使用 `--reuse-project` 或手工指定 `--project-id`。

如果要强制使用本机部署的 PaperNexus HTTP MCP，而不是 OpenClaw 全局配置里的远端地址，使用：

```bash
npm run test:autoresearch:real -- \
  --topic "Generalized Category Discovery" \
  --use-local-papernexus \
  --papernexus-shared-corpus GCD \
  --agent-model-primary codex/gpt-5.4
```

`--use-local-papernexus` 会读取 `~/.papernexus/config.json` 的 `serve.host`、`serve.port`、`serve.mcp.path` 和 `serve.apiToken`，把 workflow PaperNexus 访问临时覆盖成 `remote_mcp`，并只通过测试进程环境变量注入 token。runner 的 summary 只记录 endpoint、token 来源和 access mode，不会把 token 写入命令文件、项目状态或报告。因为 PaperNexus wrapper 默认拒绝 loopback MCP URL，该开关会同时注入 `PAPERNEXUS_ALLOW_LOCAL_MCP=1` 和 `papernexusAllowLocalMcp=true`；生产配置仍默认禁止本地 MCP。需要显式覆盖时可加 `--papernexus-mcp-url`、`--papernexus-api-base-url`、`--papernexus-token-env` 或 `--papernexus-local-config-path`。如果本机有多个 corpus，务必传 `--papernexus-shared-corpus <name>`；runner 会同步设置 `papernexusSharedCorpus` 和 `PAPERNEXUS_CORPUS`，这样 graph-build worker、直接 batch executor 和兼容 wrapper 会使用同一个 corpus。

`--agent-model-primary <provider/model>` 只作用于这次 live E2E 的 isolated gateway。runner 会在本机 OpenClaw home 下生成一个临时 config，把 `agents.defaults.model.primary` 覆盖为指定模型，并从现有 agent `models.json` 回填缺失的 provider catalog；运行结束后会删除这个临时 config。这样可以测试本地 CPA/Codex 模型，例如 `codex/gpt-5.4`，而不需要修改全局 `~/.openclaw/openclaw.json`。

常用的 live 调试超时参数：

```bash
npm run test:autoresearch:real -- \
  --topic "Generalized Category Discovery" \
  --bootstrap-timeout-ms 180000 \
  --project-root-timeout-ms 60000 \
  --workflow-local-fallback-after-ms 30000 \
  --max-no-progress-turns 1
```

`--bootstrap-timeout-ms` 限制 `/auto-research` / `/auto-review` 启动阶段等待时间；`--project-root-timeout-ms` 限制 bootstrap 返回后等待项目目录写出的时间；`--max-no-progress-turns` 控制真实阶段连续无进展后是否快速失败。live + local bootstrap 的 no-Discord runner 默认会把 `OPENCLAW_CODE_REVIEW_LOCAL_FALLBACK_AFTER_MS` 和 `OPENCLAW_AUTO_MODE_DISCUSSION_LOCAL_FALLBACK_AFTER_MS` 注入为 `30000`，使本地真实测试能在 discussion/code-review runtime 超时后快速走 deterministic local fallback。需要模拟生产默认等待时传 `--workflow-local-fallback-after-ms 180000`；需要分别覆盖时传 `--code-review-local-fallback-after-ms` 或 `--auto-mode-discussion-local-fallback-after-ms`。provider quota、rate limit、gateway bootstrap 失败会被记录为 summary failure，而不是让测试进程一直挂起。

### 8.1 provider 429 与本地接管 relay

真实 E2E 依赖本机 OpenClaw agent provider。遇到 provider quota / 429 时，embedded runtime 会先使用 OpenClaw 配置中的 `agents.<id>.model.fallbacks` 或 `agents.defaults.model.fallbacks` 重新启动同一个 embedded run。例如本机配置可以把 `bailian/qwen3.5-plus` 放在 `bailian/qwen3.6-plus` 后面作为 fallback。

如果所有 configured fallback 仍然失败，runtime maintenance 会：

- 将关联 runtime session 标为 `needs_repair`。
- 将关联 queue 标为 `needs_repair` 并写入 `nextRetryAt`，默认冷却 1 小时。
- 写入 `.openclaw-research/workflow-local-operator-relay.jsonl`，给本地 Codex/operator 一个明确接管任务。
- 在冷却到期前跳过 replay，避免 background pool 反复消耗 quota。

查看最新接管任务：

```bash
node scripts/workflow_local_operator_relay.mjs \
  --project-root "/path/to/AutoResearchProjects/<project-id>" \
  --latest
```

机器可读输出：

```bash
node scripts/workflow_local_operator_relay.mjs \
  --project-root "/path/to/AutoResearchProjects/<project-id>" \
  --latest \
  --json
```

PaperNexus 相关检查点：

- `PROJECT_MANIFEST.json.paper_ingestion.queued_requests[*].command_text` 应该指向 `skills/researcher/papernexus/scripts/pn_batch_import.py`。
- topic-only 启动时，`graph/GRAPH_BUILD_SOURCE_CATCHUP.json.bootstrap_source_index_entry_count` 大于 0 说明 source index 是由 no-Discord bootstrap 自动补齐的。
- `submit` 完成后请求不应直接变成 `completed`；如果远端任务还没完成，应看到下一轮 `wait --timeout 60 --interval 5`。
- `PAPERNEXUS_PROGRESS.json`、`active_batches`、`batch_items` 和 `completed_papers` 应该随着每次 wait/status 更新。
- `graph_build -> frontier_mapping` 的优先依据是 `graph_presence_status=ready`，不是 batch wrapper 进程退出。
- 如果 `graph_presence_status=missing_papers`，检查是否存在终止失败/修复证据以及图覆盖率；满足降级门槛时 workflow 可以继续推进，未入图论文会留作后续修复债务。
- 普通 `not-submitted` 不是终止失败；它应该回到 submit 路径，而不是让 graph build 冷却或停滞。

如果要直接调用底层脚本，也可以运行：

```bash
node scripts/run_auto_command_end_to_end.mjs \
  --topic "Generalized Category Discovery" \
  --lane full
```

如果你要跑回归型、确定性的本地测试而不是 live agent orchestration，可以显式切到：

```bash
node scripts/run_auto_command_end_to_end.mjs \
  --topic "Generalized Category Discovery" \
  --lane full \
  --mode fixture
```

这个脚本会：

1. `live` 模式下：
   - 通过 native slash replay 启动 `/auto-research` / `/auto-review`
   - 把后续阶段交给真实 workflow agent session 驱动
   - 通过真实 handoff intent / mailbox / dispatch 链推进 owner 切换
   - 在 review 稳定后再做 citation calibration 和最终 closeout
2. `fixture` 模式下：
   - 用 deterministic fixture 工件做受控回归
   - 仍然生成 PDF 并验证终态，但不代表真实 agent 写作质量

### 8.2 E2E runner 输出

每次运行都会写入：

- `.openclaw-research/e2e-runs/<timestamp>-.../AUTO_WORKFLOW_E2E_SUMMARY.md`
- `.openclaw-research/e2e-runs/<timestamp>-.../AUTO_WORKFLOW_E2E_SUMMARY.json`
- `.openclaw-research/e2e-runs/<timestamp>-.../payload.json`
- `.openclaw-research/e2e-runs/<timestamp>-.../stdout.log`
- `.openclaw-research/e2e-runs/<timestamp>-.../stderr.log`
- `<projectsRoot>/.openclaw-research/E2E_PROJECTS_DASHBOARD.json`
- `<projectsRoot>/.openclaw-research/E2E_PROJECTS_DASHBOARD.html`

如果最终 `E2E_RUN_REPORT.md` 不是 `final_verdict: pass`，runner 会以失败退出；这让它适合直接放进本地验证或 CI-like smoke check。

projectsRoot 级别的 `E2E_PROJECTS_DASHBOARD.*` 会汇总所有已经有 `PROJECT_MANIFEST.json` 或 `E2E_RUN_SCORECARD.json` 的本地项目，按 missing scorecard、regression、fail、partial、failed checks 排序，并暴露 final verdict、claim cap、quality score、run trend、stage/owner、PaperNexus certification、domain evaluator、failed checks 和单项目 dashboard 链接。它由 `run_auto_workflow_e2e_test.mjs` 自动生成，也可以手动刷新：

```bash
node scripts/build-e2e-project-dashboard.mjs \
  --projects-root "/path/to/AutoResearchProjects"
```

每个被测项目的 `.openclaw-research/` 目录还会生成本地可审计产物：

- `E2E_RUN_REPORT.md`：面向人的最终 verdict、artifact coverage、review closeout、runtime safety。
- `E2E_RUN_SCORECARD.json`：面向测试/脚本的结构化 scorecard，包含 `quality_score_100`、`claim_strength_cap`、文献覆盖、实验结果图表来源、reviewer 分数、reproducibility 和 runtime safety。
- `E2E_PROGRESS_NARRATIVE.md`：面向调试的短叙事，直接列出当前 stage/owner、证据快照、失败 required checks 和下一步动作。
- `progress_chart.json` / `progress_chart.html`：从 scorecard、runtime timeline 和 handoff events 派生的进度图表；JSON 供自动测试消费，HTML 供人工快速查看质量组件、timeline 和 breakthrough annotations。
- `E2E_RUN_LEDGER.jsonl`：每次 harness 运行追加一行 run summary，用来比较多次 no-Discord 测试的 verdict、claim cap、score、domain pack 和失败检查数量。
- `E2E_RUN_TRENDS.json`：从 run ledger 派生同一 lane 的趋势摘要，记录 previous/latest score、score delta、failed-check delta、verdict transition、pass streak 和 regression flag，避免多次真实测试后只能人工对比 dashboard。
- `E2E_DASHBOARD.html`：只读本地 dashboard，直接链接 scorecard、narrative、timeline、progress chart、ledger、PaperNexus certification 和平台画像，不需要 Discord thread 才能判断运行状态。
- `E2E_BENCHMARK_ADAPTER_SCORECARD.json`：统一 benchmark adapter fixture 与本地实验结果，固定 `baseline_score`、`candidate_score`、`holdout_score`、`iterations`、`cost_usd` 和 guardrail，避免裸 benchmark 分数绕过 claim/evidence gate。
- `E2E_DOMAIN_EVALUATOR_CONTRACT.json`：记录当前运行使用的 domain evaluator pack，例如 `gcd_ml_experiment`、`systematic_review`、`proof_checker` 或 `kernel_optimization`，并列出 metric、holdout、artifact expectations 和 failure semantics。
- `E2E_REVIEWER_CALIBRATION.json`：把 reviewer score 对齐到明确 rubric、venue profile 和 issue schema；当缺少 rubric 或 venue 时，scorecard 会把 reviewer score 标成 partial/uncalibrated，而不是当作可比较审稿分。
- `E2E_COPYEDIT_STYLE_AUDIT.json`：检查 placeholder、过长句、marketing language、强 claim 是否有边界语言；用于避免 no-Discord 论文在 artifact complete 后仍带有不可投稿的表达问题。
- `E2E_EXPERIMENT_LEASE_CONTRACT.json`：审计实验搜索的 shared incumbent/CAS 合同，记录 incumbent commit、candidate base/head、活跃实验写锁冲突和裸结果是否能绕过 shared incumbent；用于发现多 worker 并行实验覆盖风险。
- `researcher/literature-research-controller/*`：no-Discord E2E 会自动物化文献调研闭环合同，包括 `literature_need_assessment.json`、`retrieval_keyword_bank.json`、`literature_query_plan.json`、`candidate_screening_report.json`、`literature_coverage_report.json` 和 `LITERATURE_RESEARCH_CONTROLLER_STATUS.md`。当显式运行 `research_workflow.run_literature_research_controller` 时，还会写入 `provider_result_index.json`、`papernexus_import_batch_manifest.json`、`papernexus_refresh_report.json`、`citation_expansion_report.json`、`snippet_evidence_report.json`、`literature_controller_run_receipt.json`、`literature_controller_trace.jsonl` 和 `literature_repair_log.jsonl`。`research_workflow.run_literature_provider_evidence` 会把现有 `search_raw/*_provider_results.json`、`provider_result_index.json` 和 `PAPER_SOURCE_INDEX.json` 转成 `provider_evidence_run_manifest.json`、`provider_evidence_candidates.json`、`provider_evidence_error_report.json` 和 `provider_evidence_trace.jsonl`；这些候选只能作为发现/修复证据，不能替代 PaperNexus source span 做 claim proof。
- `researcher/capability-completion/*`：no-Discord E2E 会自动物化 Capability Completion Controller 产物，包括 `capability_gap_inventory.json`、`capability_execution_plan.json`、`capability_run_receipt.json`、`capability_claim_cap_report.json`、`provider_cache_manifest.json`、`rerun_gate_plan.json`、`capability_repair_queue.jsonl` 和 `CAPABILITY_COMPLETION_STATUS.md`。它把文献 provider、PaperNexus evidence-chain、Storyline v2、真实 evaluator、rewrite/repair、PaperNexus writeback 的缺口统一成可执行计划；现有安全本地 action 会自动执行，尚未实现的外部能力会明确标成 `planned`、`deferred` 或 `blocked`，并进入 claim cap 降级建议。
- `PLATFORM_PROFILE.json`：记录本次 E2E 的 runtime/platform profile 和 CPU/MLX/CUDA/WebGPU capability matrix；未知硬件只标记为 `unknown_not_probed`，不会伪造可复现实验能力。
- `E2E_ARTIFACT_CHECKLIST.json`：required artifact 的机器可读 presence gate。
- `E2E_STATE_TIMELINE.jsonl`：runtime/handoff 事件时间线。

Graph build 结束后还会写入 `graph/PAPERNEXUS_TASK_CERTIFICATION.json`，并在 scorecard、narrative 和 progress chart 中摘要展示。这个文件区分三类常见状态：

- `remote_corpus_summary`：远端 corpus 计数健康，但缺少逐篇论文 source span；只能作为 partial claim。
- `paper_index_confirmed`：逐篇 paper index 已确认，但 source span 不完整；不能声称 source-backed graph。
- `source_backed_graph`：逐篇论文具备 source-backed graph evidence；这是 no-Discord E2E 里允许继续强化论文 claim 的 PaperNexus 状态。

`literature-research-controller` 的 status/decision 会同时进入 `E2E_RUN_SCORECARD.json`、`progress_chart.json` 和 `E2E_DASHBOARD.html`。如果它是 `blocked` 或 `needs_research`，优先看 `literature_coverage_report.json.next_actions`：常见动作是继续跑 `run_literature_research_controller`、补 PaperNexus import/graph refresh，或先补明确的 project topic/source index。这个 controller 不把 metadata-only 搜索结果当作 source-backed evidence；没有 PaperNexus source-backed graph claim 时，只允许 guarded claim。

`capability-completion` 的 status/claim cap 建议也会进入 `E2E_RUN_SCORECARD.json`、`progress_chart.json` 和 `E2E_DASHBOARD.html`。它不是只读报告：`research_workflow.run_capability_completion_controller` 会生成 gap inventory、execution plan 和 repair queue，并自动执行安全的本地 materializer，包括本地 literature controller 和 provider evidence runner；429 会写 `deferred_until`，401/auth 会写 `blocked_auth`，PaperNexus 或 evaluator 缺口不会被当成通过，而是降级 claim cap。

手动运行时，通过 `research_workflow` tool 调用：

```json
{
  "action": "run_capability_completion_controller",
  "projectRoot": "<projectRoot>",
  "capabilityCompletion": {
    "mode": "autoresearch",
    "trigger": "manual_debug",
    "executeRunnableActions": true
  }
}
```

`run_literature_research_controller` 会先物化 controller，然后把 `literature_query_plan.json` 中的可执行 research30 queries 传给 provider discovery，最后复用 broad paper search 的 PaperNexus auto-import queue。它不会把 PaperNexus corpus lookup 当成外部 provider；lookup 只保留在 controller plan/receipt 中作为证据路线。运行完成后查看：

- `literature_controller_run_receipt.json`：本轮是否执行、query/provider 数、候选/已解析来源数、source index update、PaperNexus import queue 状态和下一路由。
- `provider_result_index.json`：把 provider query 状态、hit 数、合并候选、source-backed/import 决策和 risk flags 固定到 controller 目录；不要只看 `researcher/search_raw/*` 的时间戳文件。
- `papernexus_import_batch_manifest.json`：记录本轮是否创建 PaperNexus batch import、request id、wrapper、manifest path、source index path 和可导入论文数。
- `papernexus_refresh_report.json`：把下一跳明确为 `queued_graph_build`、`waiting_for_active_import`、`pending_no_importable_sources`、`needs_rerun_failed_gate` 或 `skipped`，用于判断 graph build 是否真的应该继续。
- `citation_expansion_report.json`：记录 bounded citation expansion packet 的 seed/query 数和 query types，并从 `PAPER_SOURCE_INDEX.json` 原始 metadata 中保守提取 backward references、forward citations、co-citation 和 bibliographic-coupling 候选。这个报告只产生 discovery/import 线索；真正 source-backed proof 仍必须来自 PaperNexus source span/evidence chain。如果 source index 没有显式 citation metadata，会写成 `snowballing.status=empty`，不会把 keyword fallback 冒充为 citation evidence。
- `snippet_evidence_report.json`：从 `PAPER_SOURCE_INDEX.json` 原始 snippet/source-span/abstract 字段和本地 `source_path` markdown 中抽取证据快照，区分 `source_backed_quote`、`explicit_snippet`、`evidence_summary`、`abstract_fallback` 和 `unavailable`。只有 `source_backed_quote` 可作为 claim proof；provider snippet 只能用于 discovery/challenge prompt，abstract fallback 会带 `abstract_fallback_not_source_backed` 风险标记。
- `literature_controller_trace.jsonl`：每次 controller run 追加一行，可对照多轮 literature repair 是否真的推进。
- `literature_repair_log.jsonl`：每次 controller run 追加紧凑摘要，适合排查多轮搜索/导入/构图是否被同一个原因卡住。

同一个 certification 文件还会记录 `upload.import_tasks`，用于判断 PaperNexus 上传和构图是否真的逐项完成：

- `task_count` / `completed_task_count`：batch manifest、runtime batch items、paper operations 和 completed papers 合并后的 import task 完成情况。
- `stage_completed_task_count`：远端 task stage 是否明确到达 `completed`，用来区别“论文已提交/同步”与“远端构图阶段完成”。
- `missing_task_id_count`：batch manifest 中还没有拿到远端 task id 的论文数量。
- `items[]`：逐篇论文的 `task_id`、`canonical_id`、`status`、`stage`、`submitted`、`synced`、`graph_index_confirmed`、`source_span_confirmed` 和 `evidence_sources`。

如果这些字段显示未完成，`limitations` 会包含 `incomplete_import_task_completion_evidence`、`incomplete_import_task_stage_completion_evidence` 或 `missing_import_task_ids`，避免 graph build 看起来 ready 但远端 import 证据不完整时被误判为 source-backed 完成。

真实模式的前置条件：

- 本机有 `openclaw` CLI
- 默认配置 `$HOME/.openclaw/openclaw.json` 可读，或通过 `--profile dev` / `--source-config-path <path>` 指定
- 对应 agent auth 已配置，否则真实 agent 阶段会在运行中失败

### 8.3 已验证结果

主题：`Generalized Category Discovery`

本地真实运行结果：

- experiment lane:
  - `/auto-research` bootstrap 成功
  - recorded handoffs: `researcher -> orchestrator -> coder -> analyzer -> academic_writer -> reviewer`
  - `reconcileAuthoringCloseout` 收口成功
  - `academic_writer/paper/main.pdf` 存在
  - `E2E_RUN_REPORT.md` 最终为 `final_verdict: pass`
- survey lane:
  - `/auto-review` bootstrap 成功
  - recorded handoffs: `researcher -> academic_writer -> reviewer`
  - `materializeSurveyReviewState` 达到 `status=completed`
  - `reconcileAuthoringCloseout` 收口成功
  - `academic_writer/paper/main.pdf` 存在
  - `E2E_RUN_REPORT.md` 最终为 `final_verdict: pass`

### 8.4 对应测试

仓库里还有一条可重复执行的回归测试：

```bash
node --test tests/auto-command-end-to-end.test.mjs
```

这条测试会要求：

- `/auto-research` 终态 E2E verdict = `pass`
- `/auto-review` 终态 E2E verdict = `pass`
- experiment handoffs 非空
- survey handoffs 非空
- 两条线最终 `main.pdf` 都存在
