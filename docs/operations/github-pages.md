# GitHub Pages 部署

这个文档站已经按 GitHub Pages 兼容方式重构，核心是：`VitePress` 负责构建，GitHub Actions 负责上传并部署静态产物。

## 1. 为什么需要特殊处理 `base`

GitHub Pages 的项目站通常部署在仓库子路径下，例如：

```text
https://<user>.github.io/ClawAutoResearch/
```

所以 VitePress 不能把站点永远假设在 `/` 根路径。当前配置会根据：

- `GITHUB_REPOSITORY`
- `GITHUB_ACTIONS`
- 可选的 `DOCS_BASE`

动态推导 `base`，这样本地预览仍然是 `/`，而 GitHub Pages 构建时会自动切到 `/<repo-name>/`。

## 2. 本地命令

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

其中 `npm run docs:build` 实际执行的是：

```bash
vitepress build docs
```

这也是 CI 与 GitHub Pages workflow 的核心构建命令。

## 3. GitHub Actions workflow 在哪里

部署定义位于：

- `.github/workflows/deploy-docs.yml`

它会：

1. checkout 仓库
2. 安装依赖
3. 运行 `npm run docs:build`
4. 上传 `docs/.vitepress/dist`
5. 调用 GitHub Pages 部署动作

## 4. 什么时候会触发部署

建议在以下情况下触发：

- 推送到 `main`
- 文档相关路径发生变化
- 手动执行 workflow_dispatch

## 5. 维护时要注意什么

- 如果调整了 nav / sidebar / docs 路径，记得重新跑 `npm run docs:build`。
- 如果修改了仓库名或希望部署到自定义子路径，要同步更新 `base` 推导或设置 `DOCS_BASE`。
- 如果你引入新的静态资源，确认它们在 `docs/public/` 或 VitePress 可处理路径下。
