# Vite 与当前系统真实状态

最后更新：2026-04-28

本文记录当前仓库里真实存在的 Vite / VitePress 结构，以及它和 ClawAutoResearch 运行系统之间的边界。这里描述的是代码仓库当前状态，不是未来路线图。

## 结论摘要

- 文档站是 `VitePress`，源码根目录是 `docs/`。
- 仓库根目录没有独立的 `vite.config.*`；文档站配置在 `docs/.vitepress/config.mts`。
- `apps/workflow-dashboard/` 是另一个独立的 Vite + React 前端，用于 workflow 可视化，不是 GitHub Pages 文档站。
- GitHub Pages 发布只构建 `docs/` 文档站，不构建 dashboard。
- 当前系统核心仍然是 OpenClaw 插件与 workflow control plane，Vite 只负责文档站和 dashboard 前端构建。

## 仓库里的 Vite 入口

| 位置 | 类型 | 配置文件 | 入口命令 | 当前用途 |
| --- | --- | --- | --- | --- |
| `docs/` | VitePress 文档站 | `docs/.vitepress/config.mts` | `npm run docs:dev` / `npm run docs:build` / `npm run docs:preview` | 对外发布的统一文档站 |
| `apps/workflow-dashboard/` | Vite + React 应用 | `apps/workflow-dashboard/vite.config.ts` | `npm run dashboard:dev` / `npm run dashboard:build` / `npm run dashboard:test` | 本地只读 workflow dashboard |

根 `package.json` 里的文档命令是：

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

根 `package.json` 里的 dashboard 代理命令是：

```bash
npm run dashboard:dev
npm run dashboard:build
npm run dashboard:test
```

## VitePress 文档站真实状态

当前文档站使用 `vitepress`，依赖声明在根 `package.json`：

```json
{
  "devDependencies": {
    "vitepress": "^1.6.3"
  }
}
```

当前根 `package-lock.json` 锁定到：

| 包 | 锁定版本 |
| --- | --- |
| `vitepress` | `1.6.4` |
| `vite` | `5.4.21` |

文档站配置要点：

- `title` 是 `ClawAutoResearch Docs`。
- `lang` 是 `zh-CN`。
- `srcDir` 是 `.`，也就是 `docs/` 本身作为 VitePress source root。
- `base` 会根据 `GITHUB_REPOSITORY`、`GITHUB_ACTIONS` 和可选 `DOCS_BASE` 推导。
- 本地开发默认使用 `/`。
- GitHub Actions 中构建项目站时默认使用 `/<repo-name>/`。
- 站点导航和 sidebar 都集中在 `docs/.vitepress/config.mts`。

当前 GitHub Pages workflow 是 `.github/workflows/deploy-docs.yml`。它会在 `main` 上相关路径变化时执行：

```bash
npm ci
npm run docs:build
```

然后上传 `docs/.vitepress/dist` 作为 Pages artifact。

## Workflow dashboard 的 Vite 真实状态

`apps/workflow-dashboard/` 是独立 package，当前声明：

```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build": "vite build && tsc -p tsconfig.node.json",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^5.2.1",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router-dom": "^7.14.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.7.0",
    "vite": "^5.4.21",
    "vitest": "^2.1.8"
  }
}
```

`apps/workflow-dashboard/vite.config.ts` 的真实配置是：

- 使用 `@vitejs/plugin-react`。
- Vite dev server 端口是 `4173`。
- `/api` 代理到 `http://localhost:4317`。
- Vitest 环境是 `jsdom`。
- Vitest setup file 是 `./src/test/setup.ts`。

dashboard server 的真实行为：

- `apps/workflow-dashboard/server/index.ts` 启动 Express API。
- 默认 API 端口是 `4317`，可用 `PORT` 覆盖。
- server 通过 `resolveProjectsRoot(...)` 解析项目根目录。
- 启动日志声明 dashboard 是 `read-only` 模式。

这个 dashboard 当前不是 GitHub Pages 发布对象。它是本地或内部运维视图，和对外文档站是两个不同的 Vite 面。

## 当前系统真实边界

ClawAutoResearch 当前不是一个纯前端项目。真实系统分成四层：

| 层 | 当前真实角色 |
| --- | --- |
| OpenClaw plugin | 根包 `claw-auto-research`，导出 `dist/index.js`，插件 ID 是 `ClawAutoResearch` |
| Workflow control plane | `workflow-guard`、runtime queue、mailbox、handoff、durable state contracts |
| 文档发布 | `docs/` + VitePress + GitHub Pages workflow |
| 运维 dashboard | `apps/workflow-dashboard/` + Vite React + Express read-only API |

两条主要自动流程仍然是：

| 入口 | 当前定位 |
| --- | --- |
| `/auto-research "topic"` | 实验论文主线：`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit` |
| `/auto-review "topic"` | 科研综述主线：`setup -> survey_review -> write -> submit` |

真实 workflow 状态不应该从 Vite 页面推断。调试卡住状态时，仍然要回到项目目录里的 durable state：

```text
PROJECT_MANIFEST.json
.openclaw-research/auto-iterator-state.json
.openclaw-research/workflow-runtime-queue.json
.openclaw-research/workflow-runtime-sessions.json
.openclaw-research/workflow-mailbox.json
.openclaw-research/workflow-handoff-intents.json
.openclaw-research/workflow-events.jsonl
.openclaw-research/workflow-trace.jsonl
.openclaw-research/workflow-diagnostics.jsonl
```

## 发布链路真实状态

GitHub Pages 发布链路只对 `main` 生效，触发条件包括：

- `docs/**`
- `.github/workflows/deploy-docs.yml`
- `package.json`
- `package-lock.json`
- 手动 `workflow_dispatch`

因此：

- 推送 feature branch 只会把文档变更发布到 GitHub 仓库，不会自动更新 Pages。
- 合并到 `main` 后，Pages workflow 才会自动构建并部署。
- 如果只想验证构建，应运行 `npm run docs:build`。
- 如果改的是 dashboard，应运行 `npm run dashboard:build`，但这不会影响 Pages。

## 维护规则

- 改文档站导航时，只改 `docs/.vitepress/config.mts` 和相关 `docs/**` 页面。
- 不要把 dashboard 配置写进 VitePress 的 GitHub Pages 部署逻辑。
- 不要把 VitePress 的 `base` 固定成 `/`，否则 GitHub Pages 项目站路径会坏。
- 不要从 dashboard UI 判断 workflow 是否真的可推进；真实状态以 durable state 和 workflow diagnostics 为准。
- 如果 dashboard 需要独立发布，应新增单独 workflow，而不是复用 `deploy-docs.yml`。
