# Coder 数据集路径约束

## 1. 核心原则

Coder 当前被 workflow guard 约束为：

- 数据集路径是只读输入
- 不允许原地修改共享 `datasets/` 根目录
- 生成产物必须写到项目目录、结果目录或远程 scratch

## 2. 数据集路径优先级

当前推荐的读取顺序是：

1. `orchestrator/PLAN.md` 中明确写出的数据集配置
2. `PROJECT_MANIFEST.json` 中的项目级数据集信息
3. 远程训练脚本或运行参数中的只读 `dataset_path`
4. `researcher/SERVER.md` 中的通用服务器目录说明

## 3. 推荐放哪里

### 通用数据集目录

适合写在 [SERVER.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/agents/researcher/SERVER.md)：

- `/data/datasets/...`
- `/data/shared/datasets/...`

### 项目级数据集说明

适合写在：

- `PROJECT_MANIFEST.json`
- `orchestrator/PLAN.md`

这样 Coder 能在当前项目上下文里读取到更明确的数据集约束。

## 4. 不允许做的事

- 删除或覆盖共享数据集文件
- 在 `datasets/` 目录中就地生成缓存并提交为项目结果
- 通过 `bash`、`edit`、`write` 对公共数据目录做 destructive 修改

## 5. 建议做法

- 在计划里明确 `dataset_path`
- 把预处理缓存、checkpoint、日志、可视化输出放在 `{PROJ}/coder/` 或结果目录
- 需要临时转换数据时，复制到项目 scratch 后再处理

## 6. 相关文档

- [Agent 角色与目录配置](./agents.md)
- [科研工作流与自动迭代器](../concepts/workflow-and-auto-iterator.md)
