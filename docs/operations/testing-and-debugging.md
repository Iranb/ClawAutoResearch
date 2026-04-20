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
--session-key '<workflow-channel-session>'
--originating-channel discord
--originating-to '<workflow-channel>'
--originating-account-id '<workflow-operator>'
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
  --session-key '<workflow-channel-session>' \
  --originating-channel discord \
  --originating-to '<workflow-channel>' \
  --originating-account-id '<workflow-operator>'
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

- slash 命令本身运行在独立的 command session
- 真正要操作的 workflow 会话通过 target session 字段指向目标频道/线程会话

也就是说，对 workflow commands 来说，最关键的不是 webhook body，而是：

- command session
- target workflow session
- authorization flag
- source / destination conversation context

### 7.1 推荐脚本

仓库里提供了一个本地 replay harness：

```bash
node scripts/run_discord_native_slash_replay_test.mjs \
  --command auto-research \
  --args '"Generalized Category Discovery"' \
  --projects-root "<temp-projects-root>"
```

这个脚本会构造与 OpenClaw 官方 Discord native slash 测试一致的上下文：

- 一个 command session
- 一个 target workflow session
- 授权过的 slash command 上下文
- 与目标频道/线程一致的来源信息

然后直接走 plugin command dispatch，而不是绕回普通 chat turn。

### 7.2 `/auto-research` 本地真测示例

```bash
node scripts/run_discord_native_slash_replay_test.mjs \
  --command auto-research \
  --args '"Generalized Category Discovery"' \
  --projects-root "<temp-projects-root>" \
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
  --projects-root "<temp-projects-root>" \
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

## 8. `/auto-research` 和 `/auto-review` 的 deterministic E2E

如果你要验证的不只是“命令能不能启动”，而是：

- `/auto-research` 是否真的能把 experiment 线带到 review-closed 的终态
- `/auto-review` 是否真的能把 survey 线带到 review-closed 的终态

可以直接运行：

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

### 8.1 已验证结果

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

### 8.2 对应测试

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
