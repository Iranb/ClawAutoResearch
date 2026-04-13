# workflow 中间产物只读可视化工作台设计

> 日期：2026-04-09  
> 范围：为当前 `openclaw-research` workflow 构建一个独立的本地 TypeScript Web 工作台，用于多项目阶段总览、阻塞原因理解，以及关键中间产物的只读查看。  
> 约束：第一版只读、可点进详情、不触发 workflow 动作；不挂进 `VitePress` 文档站；优先复用现有 durable state，而不是重新实现 workflow 推理逻辑。

## 背景

当前仓库已经具备完整的 workflow 控制平面和 durable state 体系：

- 主阶段机定义在 `WORKFLOW.md`
- 控制平面说明见 `docs/architecture/workflow-control-plane.md`
- 状态合同见 `docs/reference/state-contracts.md`
- 模块地图见 `docs/reference/module-map.md`

系统已经能生成和维护大量中间产物，例如：

- `PROJECTS_STATE.json`
- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/graph/PAPERNEXUS_PROGRESS.json`
- `{PROJ}/graph/GRAPH_PRESENCE_CHECK.json`
- `{PROJ}/.openclaw-research/workflow-mailbox.json`
- `{PROJ}/.openclaw-research/workflow-runtime-sessions.json`
- `{PROJ}/.openclaw-research/workflow-events.jsonl`

这些文件本身已经足够表达“项目在哪个阶段、为什么阻塞、下一步建议是什么”，但当前主要通过：

- slash command 文本摘要
- 原始 JSON / JSONL 文件
- 分散在文档站里的解释文档

来理解系统状态。

这会带来几个直接痛点：

- 多项目并行时，很难一眼看出“哪个项目卡住了、卡在哪个阶段”
- 单项目诊断时，用户需要自己在多个文件之间切换
- 原始中间产物可追溯，但不够易读
- 文档站解释的是“系统是什么”，而不是“系统现在处于什么状态”

因此需要一个专门的、本地只读的可视化工作台，承担“状态解释”和“中间产物浏览”的职责。

## 用户已确认的产品边界

本设计基于以下已确认决策：

1. 第一版优先支持**多项目总览**
2. 首页采用**阶段矩阵**，而不是阻塞看板或总控卡片列表
3. 点击项目后，详情页第一屏优先展示：
   - `current stage`
   - `owner`
   - `status`
   - `updated_at`
   - `blocking reason`
   - `next action`
4. 其他内容通过按钮或二级入口查看，而不是挤在详情页首屏
5. 数据读取采用**summary first, raw fallback**
   - 首页优先读 summary
   - 详情页再按需读原始文件
6. 第一版是**独立的本地 TS Web App**
   - 不直接挂进现有 `VitePress` 文档站
7. 第一版是**只读解释型工作台**
   - 不提供 `/graph-build`、`resume`、`refresh` 等动作按钮

## 目标

这个工作台第一版需要稳定回答 3 个问题：

1. **多项目视角：** 每个项目现在在哪个主阶段，是否阻塞，阻塞是否值得优先关注
2. **单项目视角：** 当前项目为什么停在这里，推荐的下一步是什么
3. **证据视角：** 支撑这些判断的中间产物具体是什么，原始文件长什么样

## 不做的事

第一版明确不做：

- 不写任何 workflow 文件
- 不直接调用 `research_workflow` 去推进状态
- 不提供动作按钮，如“resume”“repair”“graph-build”
- 不尝试复现 `auto_iterator_tick` 的完整决策逻辑
- 不实现多用户或远程部署能力
- 不把工作台嵌入 `VitePress`
- 不做复杂筛选器、报表系统或历史对比面板
- 不默认实时推送；允许用手动刷新或短轮询作为后续增强点

## 信息源与运行约束

### 1. projects root

工作台必须围绕 workflow 的权威 `projectsRoot` 工作，而不是围绕当前仓库 workspace 乱扫目录。

第一版建议至少支持以下根路径来源：

1. 启动参数或 app 本地配置显式传入 `projectsRoot`
2. `OPENCLAW_PROJECTS_ROOT`

第一版**不要求**解析完整的 `openclaw.json` 插件配置；显式配置和环境变量已经足够启动这个工具。

### 2. 首页数据来源

首页优先依赖：

- `{PROJECTS_ROOT}/PROJECTS_STATE.json`

必要时回退读取：

- `{PROJECTS_ROOT}/{projectId}/PROJECT_MANIFEST.json`
- `{PROJECTS_ROOT}/{projectId}/graph/PAPERNEXUS_PROGRESS.json`

### 3. 详情页数据来源

详情页首屏优先依赖：

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/graph/PAPERNEXUS_PROGRESS.json`

二级面板按需读取：

- `{PROJ}/graph/GRAPH_PRESENCE_CHECK.json`
- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/.openclaw-research/workflow-mailbox.json`
- `{PROJ}/.openclaw-research/workflow-runtime-queue.json`
- `{PROJ}/.openclaw-research/workflow-runtime-sessions.json`
- `{PROJ}/.openclaw-research/workflow-events.jsonl`
- `{PROJ}/.openclaw-research/workflow-trace.jsonl`

## 总体架构

推荐实现为一个仓库内的独立子应用：

- `apps/workflow-dashboard/`

内部拆成两层：

1. **本地只读数据层**
2. **前端可视化层**

### 1. 本地只读数据层

职责：

- 读取 `projectsRoot` 下的 summary 与原始文件
- 做最小必要的 schema 归一化
- 生成前端需要的 view model
- 明确标记当前结果是来自权威 summary 还是 fallback 推导

这层**不能**承担：

- 写回 workflow 状态
- 代替 `workflow-guard` 做业务推进
- 推断比现有 durable state 更多的“隐藏真相”

### 2. 前端可视化层

职责：

- 渲染多项目阶段矩阵
- 渲染项目详情首屏摘要
- 提供 artifact 二级查看入口
- 提供原始文件预览器

前端应该消费“人类可读的 view model”，而不是自己理解 manifest 深层字段。

## 页面信息架构

## 1. 首页：Projects Matrix

首页是**多项目阶段矩阵**。

### 首页回答的问题

- 哪些项目正在推进
- 哪些项目阻塞
- 每个项目位于哪个主阶段
- 当前阻塞是否是 graph、plan、review、writing 等常见类别

### 首页主要区域

1. **顶部摘要条**
   - 总项目数
   - blocked 项目数
   - active 项目数
   - 各阶段项目分布

2. **阶段矩阵**
   - 行：项目
   - 列：workflow 主阶段
   - 建议列顺序与 `WORKFLOW.md` 保持一致：
     - `setup`
     - `graph_build`
     - `frontier_mapping`
     - `idea`
     - `plan`
     - `code`
     - `experiment`
     - `analyze`
     - `review`
     - `write`
     - `submit`

3. **项目行首信息**
   - `project id`
   - `title`
   - 短 blocker 标签
   - 最近更新时间

### 首页响应式约束

第一版不需要为移动端重做成完全不同的卡片布局，但必须保证窄屏可读：

- 优先允许矩阵区域横向滚动
- 项目行首信息应保持 sticky 或至少在滚动时仍可辨认当前项目
- 不允许在窄屏时把 blocker 文本挤压到不可读

### 首页不展示的内容

- 完整 `blocking_reason`
- 大段 `next_action`
- runtime 文件内容
- 原始 JSON 文本

这些信息都应该留给项目详情页。

## 2. 项目详情页：Project Summary

详情页首屏只保留核心解释信息。

### 首屏卡片

- `Current Stage`
- `Owner`
- `Status`
- `Updated At`
- `Blocking Reason`
- `Next Action`

### 二级入口

详情页首屏提供固定入口：

- `Summary`
- `Manifest`
- `Graph`
- `Runtime`
- `Raw JSON`

默认落在 `Summary`。

## 3. Artifact 查看层

artifact 查看层承担“从解释层跳到证据层”的职责。

推荐结构：

- 左侧：可切换的 artifact 列表
- 右侧：格式化预览区

支持的内容类型：

- JSON：格式化树或 prettified JSON 文本
- Markdown：渲染预览
- JSONL：按行摘要视图，必要时分页或限制条数

## 数据 read model 设计

前端不直接读取文件路径，也不直接解析 workflow schema。  
后端必须提供稳定的 read model。

### 1. `ProjectOverview`

```ts
type ProjectOverview = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  currentStageIndex: number | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  blockerLabel: string | null;
  blockerReason: string | null;
  nextAction: string | null;
  updatedAt: string | null;
  source: "projects_state" | "manifest_fallback";
};
```

用途：

- 首页列表和矩阵
- 阶段分布统计

### 2. `ProjectDetailSummary`

```ts
type ProjectDetailSummary = {
  id: string;
  title: string | null;
  projectRoot: string;
  currentStage: string | null;
  owner: string | null;
  status: "blocked" | "active" | "ready" | "incomplete";
  updatedAt: string | null;
  blockingReason: string | null;
  nextAction: string | null;
  resumeAction: string | null;
  papernexusPhase: string | null;
  papernexusProgressSummary: string | null;
  source: Array<"manifest" | "papernexus_progress" | "fallback">;
};
```

用途：

- 项目详情首屏

### 3. `ArtifactDescriptor`

```ts
type ArtifactDescriptor = {
  key: "manifest" | "graph_progress" | "graph_presence" | "graph_status" | "runtime_mailbox" | "runtime_queue" | "runtime_sessions" | "runtime_events" | "runtime_trace";
  label: string;
  path: string;
  kind: "json" | "jsonl" | "markdown" | "text";
  exists: boolean;
};
```

用途：

- 详情页 artifact tab
- 原始文件查看器

## 首页与详情页的数据映射规则

## 1. 首页

首页使用以下优先级：

1. `PROJECTS_STATE.json`
2. `PROJECT_MANIFEST.json`
3. `graph/PAPERNEXUS_PROGRESS.json`

映射规则：

- `title`
  - 优先 `PROJECTS_STATE.json.projects[].title`
  - 回退 `PROJECT_MANIFEST.json.title`
- `currentStage`
  - 优先 `PROJECTS_STATE.json.projects[].stage`
  - 回退 `PROJECT_MANIFEST.json.current_stage`
- `nextAction`
  - 优先 `PROJECTS_STATE.json.projects[].next_action`
  - 回退 `PROJECT_MANIFEST.json.next_action`
- `blockerReason`
  - 优先 `PROJECTS_STATE.json.projects[].blocked_by`
  - 回退 `PROJECT_MANIFEST.json.blocking_reason`
- `updatedAt`
  - 优先 `PROJECTS_STATE.json.projects[].updated`
  - 回退 `PROJECT_MANIFEST.json.updated_at`

`blockerLabel` 不应直接抄整段文本，而应做短摘要，例如：

- `missing graph artifacts`
- `missing sources`
- `waiting selection`
- `review pending`
- `writing contract missing`

第一版可以使用规则摘要，不要求自然语言总结模型。

## 2. 详情页首屏

详情页优先读取：

- `PROJECT_MANIFEST.json`
- `PAPERNEXUS_PROGRESS.json`

映射规则：

- `currentStage` <- `PROJECT_MANIFEST.json.current_stage`
- `owner` <- `PROJECT_MANIFEST.json.owner_agent`
- `updatedAt` <- `PROJECT_MANIFEST.json.updated_at`
- `blockingReason` <- `PROJECT_MANIFEST.json.blocking_reason`
- `nextAction` <- `PROJECT_MANIFEST.json.next_action`
- `resumeAction` <- `PROJECT_MANIFEST.json.resume_action`
- `papernexusPhase` <- `PAPERNEXUS_PROGRESS.json.phase`

## 交互与可视化规则

## 1. 矩阵颜色语义固定

- `红色`：blocked
- `黄色`：active / in progress
- `绿色`：ready / healthy
- `蓝色边框或蓝色强调`：当前聚焦阶段
- `灰色`：未到达阶段或无相关状态

颜色语义不应在不同页面里发生漂移。

当前阶段与状态颜色同时存在时，**以状态填充色表达 blocked/active/ready，以蓝色边框或角标表达“这是当前阶段”**，避免一个单元格同时需要两种主填充色。

## 2. 首页只显示短标签

首页矩阵中，项目名下方只允许显示短 blocker 标签。  
完整的 `blocking_reason` 只能在详情页显示。

这是为了避免首页从“可扫视矩阵”退化成“长文本列表”。

## 3. 原始文件查看器不直接 dump 全量内容

原始文件查看器应根据文件类型选择展示方式：

- JSON：格式化并折叠层级
- Markdown：渲染视图 + 原文切换
- JSONL：显示最近 N 行和总行数提示
- 长文本：限制初始展开长度，支持“查看全部”

## 技术实现建议

## 1. 目录结构

建议：

```text
apps/workflow-dashboard/
  src/
    pages/
    components/
    lib/
  server/
    file-access/
    read-models/
    routes/
```

## 2. 技术栈

- 前端：`React + TypeScript + Vite`
- 路由：`react-router`
- 后端：本地 `Node + TypeScript` 只读服务
- 样式：简单 CSS 或 CSS Modules 即可

第一版不需要复杂 UI 框架。

## 3. 服务边界

### 后端负责

- 路径解析
- 文件读取
- fallback 逻辑
- blocker label 归纳
- read model 输出

### 前端负责

- 页面布局
- 矩阵渲染
- tab 切换
- artifact 预览
- 空状态和错误状态呈现

## 建议 API

第一版建议提供 4 个只读接口：

- `GET /api/projects`
- `GET /api/projects/:id/summary`
- `GET /api/projects/:id/artifacts`
- `GET /api/projects/:id/raw/:artifactKey`

其中：

- `/api/projects`
  返回首页矩阵所需的 `ProjectOverview[]`
- `/api/projects/:id/summary`
  返回详情首屏的 `ProjectDetailSummary`
- `/api/projects/:id/artifacts`
  返回所有可查看 artifact 的 `ArtifactDescriptor[]`
- `/api/projects/:id/raw/:artifactKey`
  返回某个 artifact 的格式化内容和元信息

## 降级与错误处理

必须支持以下情况：

1. **缺少 `PROJECTS_STATE.json`**
   - 扫描 `projectsRoot` 下的项目目录
   - 直接读取各项目 manifest 生成降级首页

2. **manifest 存在但字段不完整**
   - 项目仍然显示
   - `status = incomplete`

3. **artifact 文件缺失**
   - artifact 面板显示 `missing artifact`
   - 保留路径信息

4. **JSON 解析失败**
   - 显示 `invalid artifact`
   - 允许查看原始文本

5. **JSONL 文件过大**
   - 默认只展示最近 N 行
   - 明确告知已截断

## 验收口径

如果第一版完成，至少应满足以下可验证结果：

1. 能在指定 `projectsRoot` 下列出所有 workflow 项目
2. 首页能用矩阵准确显示每个项目的当前阶段
3. 首页能把 blocked 项目与 active 项目明显区分
4. 点击某个项目后，能看到：
   - 当前阶段
   - owner
   - blocking reason
   - next action
5. 能通过二级入口查看至少以下 artifact：
   - manifest
   - PaperNexus progress
   - runtime sessions 或 mailbox
6. 当 summary 文件缺失时，系统能自动 fallback 到原始文件而不是直接报废
7. 当 artifact 缺失或损坏时，页面能解释问题，而不是只显示空白

## 这份设计对 implementation planning 的约束

后续 implementation plan 应保持以下方向不变：

1. 第一版必须是**独立本地只读应用**
2. 首页必须是**多项目阶段矩阵**
3. 详情页首屏必须优先展示**状态解释**而不是原始文件
4. 数据层必须采用**read model**，不能让前端直接理解 workflow 深层 schema
5. summary-first + raw-fallback 是核心策略，不能被后续实现简化成“只读 summary”或“只读原始文件”
