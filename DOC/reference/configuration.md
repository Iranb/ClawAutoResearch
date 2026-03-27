# 配置项参考

## 1. 主要配置文件

当前项目最重要的配置文件有：

- `~/.openclaw/openclaw.json`
- `openclaw.plugin.json`
- `skills/index.json`
- `templates/PROJECT_MANIFEST.json`

## 2. `openclaw.plugin.json`

这个文件定义插件元信息、配置 schema 和 skill 暴露方式。

### 当前重要配置项

- `allowWorkspaceFallback`  
  允许 research memory 在没有 `OPENCLAW_PROJECT` 时回退到 workspace 级别。

- `requireProjectIsolation`  
  是否强制要求项目隔离。

- `requireProjectIdInEntries`  
  结构化记忆写入时是否要求项目 ID。

- `requireTrackId`  
  idea / experiment 记忆写入时是否要求 track id。

- `requireEvidencePointers`  
  结构化条目写入时是否要求 evidence pointers。

- `reviewStateMaxAgeHours`  
  review state 超过多久会被判定为不适合直接恢复。

- `projectsRoot`  
  项目总根目录。应配置在 `plugins.entries.openclaw-research.config.projectsRoot`，不要放在顶层 `openclaw.json`，否则会触发 `unrecognizedKeys`。

- `injectWorkflowContext`  
  是否在每轮 prompt 中注入 workflow snapshot。

- `enforceWorkflowBoundaries`  
  是否启用越界写入、非法 spawn/send 等运行时拦截。

- `blockDiscordAgentMentions`  
  是否清洗原始 `@agent` mention。

- `enableWorkflowMailbox`  
  是否启用 mailbox 工具。

- `heartbeatBackgroundChecks`  
  heartbeat turn 中是否注入 bounded background task 指导。

- `maxWorkflowInboxMessages`  
  默认最多向 prompt 或 mailbox 读取中暴露多少未处理消息。

- `agentContactCooldownSeconds`  
  同一个 source -> target 的最小通信冷却时间。

- `enableChannelProjectBindings`  
  是否启用“频道/session -> 项目目录”绑定能力。

- `channelProjectBindingsPath`  
  可选的绑定存储文件路径。留空时，默认写入 `{PROJ}/.openclaw-research/channel-project-bindings.json`；只有当前 turn 还没解析出项目时，才回退到 workspace 下。多 workspace 场景下如果你需要统一共享一份绑定文件，再显式指定它。

- `defaultConferenceTemplatePath`  
  可选的 conference 默认模板路径。启用 `paper_mode = conference` 时，插件会优先使用这个路径，并先复制到项目目录下再写。

- `defaultJournalTemplatePath`  
  可选的 journal 默认模板路径。启用 `paper_mode = journal` 时，插件会优先使用这个路径，并先复制到项目目录下再写。

- `papernexusApiBaseUrl`  
  可选的 PaperNexus 远程 Web/API 地址。配置后，workflow prompt 会优先引导 Researcher / PaperNexus-heavy 流程使用这个远程入口，而不是默认假设只能本地访问。

- `papernexusApiTokenEnv`  
  存放 PaperNexus API Bearer token 的环境变量名。推荐只在环境变量里放 secret，不把明文 token 写进 `openclaw.json` 或项目文件。

- `papernexusApiTokenSource`  
  PaperNexus token 的解析方式。支持：
  - `env`
  - `os_keychain`
  - `auto`

- `papernexusApiTokenService`  
  系统原生 keychain / secret store 中的服务名或 resource 名。

- `papernexusApiTokenAccount`  
  系统原生 keychain / secret store 中的账号名或 user 名。

- `papernexusApiTokenLookupTimeoutMs`  
  系统 keychain 查询超时，单位毫秒。用于避免因为 keychain 异常导致前台或 auto mode 长时间卡住。

- `papernexusMineruHttpUrl`  
  可选的 remote MinerU HTTP 地址。配置后，涉及 PDF materialization 的 PaperNexus 流程会优先走 remote mineru，再考虑本地 docling / marker fallback。

## 3. `~/.openclaw/openclaw.json`

这是你真实运行时使用的 OpenClaw 主配置文件，不是仓库内文件。

### 当前值得关注的点

- 各角色的工具许可已经接入 `research_memory` 与 `research_workflow`
- 插件相关默认值已经打开：
  - `blockDiscordAgentMentions: true`
  - `enableWorkflowMailbox: true`
  - `heartbeatBackgroundChecks: true`
  - `agentContactCooldownSeconds: 300`
- 如果你希望不同 Discord channel 跑不同项目，可以额外开启：
  - `enableChannelProjectBindings: true`
- 推荐把 heartbeat 显式写到每个 agent 上，而不是只写全局默认：
  - `researcher: 30m`
  - `orchestrator: 2h`
  - `coder: 2h`
  - `analyzer: 2h`
  - `academic_writer: 2h`
  - `reviewer: 3h`
  - `cross-reviewer: 4h`
- QMD memory 已开启，且采用项目隔离导向的限制策略

## 4. `skills/index.json`

这个文件负责注册可供各 Agent 使用的 skill 分组。  
新增 skill 后，需要确保这里也同步注册。

## 5. `templates/PROJECT_MANIFEST.json`

这是新项目初始化的关键模板。  
当前最重要的新状态块有：

- `idle_research`
- `experiment_memory`
- `innovation_reflection`
- `theory_state`
- `writing_contract`

其中 `writing_contract` 现在额外承载：

- `project_template_path`
- `template_copy_status`
- `main_text_proof_style`
- `proof_appendix_required`
- `proof_appendix_path`
- `proof_appendix_status`
- `theory_note_path`
- `proof_checklist`

## 6. 配置时的推荐顺序

1. 先确认 OpenClaw 主配置能加载插件
2. 再确认各角色允许的工具中包含 `research_workflow`
3. 再确认每个关键 agent 的 heartbeat 已开启
4. 再根据项目需要设置：
   - `idle_research`
   - `writing_contract`
   - `paper_source_dir`
   - `papernexus_root`
   - `papernexusApiBaseUrl`
   - `papernexusApiTokenEnv`
   - `papernexusApiTokenSource`
   - `papernexusApiTokenService`
   - `papernexusApiTokenAccount`
   - `papernexusApiTokenLookupTimeoutMs`
   - `papernexusMineruHttpUrl`
5. 如果你要在同一个 Discord 服务里并行跑多个项目：
   - 打开 `enableChannelProjectBindings`
   - 显式设置共享 `channelProjectBindingsPath`

## 7. 常见调参建议

### 想减少 Agent 之间的重复唤醒

调大：

- `agentContactCooldownSeconds`

### 想减少 prompt 噪音

调小：

- `maxWorkflowInboxMessages`

### 想让心跳更积极

优先单独调小对应 agent 的 heartbeat 间隔，但要注意成本和噪音。

### 想更严格地防越界

确保以下开关保持开启：

- `injectWorkflowContext`
- `enforceWorkflowBoundaries`
- `blockDiscordAgentMentions`
- `enableWorkflowMailbox`

### 想让不同 Discord 频道稳定对应不同科研项目

确保以下配置已经开启：

- `enableChannelProjectBindings`
- `channelProjectBindingsPath`

### 想让 Researcher 优先走远程 PaperNexus

确保以下配置已经设置：

- `papernexusApiBaseUrl`
- `papernexusApiTokenSource`

如果你用环境变量，再配置：

- `papernexusApiTokenEnv`

如果你用系统原生 keychain，再配置：

- `papernexusApiTokenService`
- `papernexusApiTokenAccount`

如果你的 PaperNexus 也暴露了远程 MinerU，再补上：

- `papernexusMineruHttpUrl`

并在运行 OpenClaw 的环境里提供对应 token env，例如：

- `PAPERNEXUS_API_TOKEN`

### 想让 PaperNexus token 走系统原生 keychain

推荐配置：

- `papernexusApiTokenSource = "auto"` 或 `papernexusApiTokenSource = "os_keychain"`
- `papernexusApiTokenService = "papernexus-api-token"`
- `papernexusApiTokenAccount = "default"`

平台映射：

- macOS：Keychain generic password
- Linux：Secret Service / `secret-tool`
- Windows：PasswordVault

可直接使用的命令模板：

macOS 存储：

```bash
security add-generic-password -U -s papernexus-api-token -a default -w "YOUR_TOKEN"
```

macOS 读取验证：

```bash
security find-generic-password -s papernexus-api-token -a default -w
```

macOS 临时导出到当前 shell：

```bash
export PAPERNEXUS_API_TOKEN="$(security find-generic-password -s papernexus-api-token -a default -w)"
```

Linux 存储：

```bash
secret-tool store --label="PaperNexus API token" service papernexus-api-token account default
```

Linux 读取验证：

```bash
secret-tool lookup service papernexus-api-token account default
```

Linux 临时导出到当前 shell：

```bash
export PAPERNEXUS_API_TOKEN="$(secret-tool lookup service papernexus-api-token account default)"
```

Windows PowerShell 存储：

```powershell
[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null
$vault = New-Object Windows.Security.Credentials.PasswordVault
$cred = New-Object Windows.Security.Credentials.PasswordCredential("papernexus-api-token","default","YOUR_TOKEN")
$vault.Add($cred)
```

Windows PowerShell 读取验证：

```powershell
[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null
$vault = New-Object Windows.Security.Credentials.PasswordVault
$cred = $vault.Retrieve("papernexus-api-token","default")
$cred.RetrievePassword()
$cred.Password
```

Windows PowerShell 临时导出到当前会话：

```powershell
[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null
$vault = New-Object Windows.Security.Credentials.PasswordVault
$cred = $vault.Retrieve("papernexus-api-token","default")
$cred.RetrievePassword()
$env:PAPERNEXUS_API_TOKEN = $cred.Password
```

推荐插件配置：

```json
{
  "papernexusApiTokenSource": "auto",
  "papernexusApiTokenEnv": "PAPERNEXUS_API_TOKEN",
  "papernexusApiTokenService": "papernexus-api-token",
  "papernexusApiTokenAccount": "default",
  "papernexusApiTokenLookupTimeoutMs": 2000
}
```
