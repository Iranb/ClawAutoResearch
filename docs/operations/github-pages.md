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

## 5. 第一次启用 GitHub Pages 的最短步骤

如果仓库还没真正对外发布 Pages，按这个顺序做：

1. 把文档改动合并到 `main`
2. 进入 GitHub 仓库 `Settings -> Pages`
3. 在 `Build and deployment` 里选择 `GitHub Actions`
4. 确认仓库里已经存在 `.github/workflows/deploy-docs.yml`
5. 手动运行一次 `Deploy Docs` workflow，或直接向 `main` 推送文档改动
6. 等待 workflow 完成后，访问 GitHub Pages 返回的站点 URL

> [!TIP]
> 如果是项目站而不是用户站，最终 URL 通常是：
>
> `https://<user>.github.io/<repo>/`

## 6. 发布前检查清单

部署前至少确认这几件事：

- `npm run docs:build` 本地通过
- 新增页面已经被 nav / sidebar 或入口页接住
- 站内链接尽量使用相对链接，避免仓库子路径部署时跳到根路径
- 静态资源放在 `docs/public/`
- 文档里不要把“给用户看的教程”和“给维护者看的架构细节”混在同一入口里

## 7. 维护时要注意什么

- 如果调整了 nav / sidebar / docs 路径，记得重新跑 `npm run docs:build`。
- 如果修改了仓库名或希望部署到自定义子路径，要同步更新 `base` 推导或设置 `DOCS_BASE`。
- 如果你引入新的静态资源，确认它们在 `docs/public/` 或 VitePress 可处理路径下。
- 如果首页里用了原生 HTML 链接，优先写相对路径，不要写 `href=\"/...\"` 这种站点根路径链接。
