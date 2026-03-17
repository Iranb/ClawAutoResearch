# reviewloop 安装与配置指南

## 安装

### macOS Homebrew（推荐）

```bash
brew tap acture/ac
brew install reviewloop

# 升级
reviewloop self-update --yes
```

### Cargo

```bash
cargo install reviewloop

# 需要 Rust 工具链，若未安装：
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 从源码编译

```bash
git clone https://github.com/Acture/reviewloop.git
cd reviewloop
cargo build --release
cp ./target/release/reviewloop /usr/local/bin/
```

---

## 初始化

### 全局配置（仅需一次）

```bash
reviewloop init
```

生成全局配置文件：`~/.config/reviewloop/config.toml`  
全局数据目录：`~/.review_loop/`

### 项目配置（每个论文项目一次）

```bash
cd /path/to/your-paper-project
reviewloop init project --project-id my-paper-2025
```

生成 `reviewloop.toml`（在当前目录）。

---

## 全局配置文件说明

路径：`~/.config/reviewloop/config.toml`

```toml
[core]
max_concurrency = 2
max_submissions_per_tick = 1
state_dir = "~/.review_loop"
review_timeout_hours = 48

[polling]
schedule_minutes = [10, 20, 40, 60]
jitter_percent = 10

[logging]
output = "file"   # stdout | stderr | file

[retention]
enabled = true
email_tokens_days = 30
seen_tags_days = 90
events_days = 30
```

---

## 项目配置文件说明

路径：`<论文项目根目录>/reviewloop.toml`

```toml
project_id = "my-paper-2025"

[[papers]]
paper_id = "main"
path = "paper/main.pdf"
backend = "stanford"
watch = false

[trigger.pdf]
auto_submit_on_change = false

[providers.stanford]
venue = "ICLR"   # ICLR | NeurIPS | ICML | CVPR | AAAI | ACL 等
```

---

## 邮箱配置（用于自动获取审稿 Token）

### IMAP 方式（支持 Gmail / 其他邮箱）

```toml
# ~/.config/reviewloop/config.toml
[imap]
server = "imap.gmail.com"
port = 993
username = "your@gmail.com"
# 密码通过环境变量或系统 keychain 提供
header_first = true
max_lookback_hours = 72
max_messages_per_poll = 50

[imap.backend_patterns]
stanford = "https?://paperreview\\.ai/review\\?token=([A-Za-z0-9_-]+)"
```

### Gmail OAuth 方式（推荐 Gmail 用户）

```toml
# ~/.config/reviewloop/config.toml
[gmail_oauth]
enabled = true
client_id = "your-google-oauth-client-id"
client_secret = "your-google-oauth-client-secret"
poll_seconds = 300
mark_seen = true
max_lookback_hours = 72
header_first = true

[gmail_oauth.backend_patterns]
stanford = "https?://paperreview\\.ai/review\\?token=([A-Za-z0-9_-]+)"
```

登录 Gmail OAuth：

```bash
reviewloop email login --provider google
# 会自动打开浏览器完成 OAuth 授权
```

查看邮箱状态：`reviewloop email status`

---

## 环境变量

| 变量名 | 用途 |
|--------|------|
| `REVIEWLOOP_STATE_DIR` | 覆盖默认数据目录 `~/.review_loop` |
| `REVIEWLOOP_GMAIL_CLIENT_ID` | Gmail OAuth Client ID |
| `REVIEWLOOP_GMAIL_CLIENT_SECRET` | Gmail OAuth Client Secret |

---

## 常见问题

**Q: `brew tap acture/ac` 报错？**  
A: 工具尚未公开发布时，请使用 `cargo install reviewloop` 或从源码编译。

**Q: Fallback（Node + Playwright）失败？**  
A: 确保已安装 Node.js，并运行 `npx playwright install chromium`。

**Q: 如何更换会议目标（venue）？**  
A: 修改 `reviewloop.toml` 中的 `[providers.stanford] venue = "NeurIPS"`。
