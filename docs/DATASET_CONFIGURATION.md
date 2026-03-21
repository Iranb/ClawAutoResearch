# 为 Coder 配置数据集路径指南

## 📊 当前架构

Coder 通过以下**优先级顺序**确定数据集路径：

```
1. PLAN.md 中的 dataset 配置 (最高优先级)
   ↓
2. PROJECT_MANIFEST.json 中的 dataset_path
   ↓
3. openclaw.json 中 Coder 的 config.datasetPaths
   ↓
4. SERVER.md 中的默认数据集目录 (最低优先级)
```

---

## 🎯 四种配置方式

### 方式 1️⃣：在 SERVER.md 中配置（推荐用于通用路径）

**适用场景**：所有项目共享相同的数据集位置

**修改文件**：`agents/researcher/SERVER.md`

```markdown
## Dataset Directories (Coder 可访问)
- **主数据集**: `/data/datasets/` (COCO, ImageNet 等)
- **项目数据集**: `/data/projects/{PROJ}/datasets/` (项目专用)
- **临时数据集**: `/tmp/datasets/` (小数据集，定期清理)
- **共享数据集**: `/data/shared/datasets/` (团队共享)
```

**✅ 优点**：
- 集中管理，一处修改所有项目生效
- Coder 会自动按顺序查找

**❌ 缺点**：
- 不能为不同项目定制特定路径

---

### 方式 2️⃣：在 PLAN.md 中指定（推荐用于特定实验）

**适用场景**：每个实验需要不同的数据集

**在 `{PROJ}/orchestrator/PLAN.md` 中添加**：

```markdown
## Dataset

- **Name**: COCO 2017 Detection
- **Path**: `/data/datasets/coco`
- **Format**: COCO detection format
- **Splits**: 
  - Train: train2017 (118K images)
  - Val: val2017 (5K images)
- **Classes**: 80 object categories
- **Preprocessing**:
  - Resize to 800x1333
  - Normalize with ImageNet mean/std
  - Random horizontal flip (p=0.5)
```

**✅ 优点**：
- 最灵活，每个实验可以不同
- 数据集配置与实验设计在一起，易于理解

**❌ 缺点**：
- 需要在每个 PLAN.md 中重复配置

---

### 方式 3️⃣：在 PROJECT_MANIFEST.json 中配置（推荐用于项目级管理）

**适用场景**：整个项目使用固定数据集

**创建或修改 `{PROJ}/PROJECT_MANIFEST.json`**：

```json
{
  "projectId": "my-object-detection",
  "current_stage": "EXPERIMENT",
  "dataset_path": "/data/datasets/coco",
  "checkpoint_path": "/data/checkpoints/my-object-detection/",
  "data_config": {
    "format": "coco_detection",
    "num_classes": 80,
    "input_size": [800, 1333]
  }
}
```

**✅ 优点**：
- 项目级配置，所有实验共享
- 易于版本控制和追踪

**❌ 缺点**：
- 需要手动创建 PROJECT_MANIFEST.json

---

### 方式 4️⃣：在 openclaw.json 中配置（推荐用于团队标准化）

**适用场景**：团队需要统一的数据集路径规范

**修改 `openclaw.json` 中 Coder 的配置**：

```json
{
  "agents": {
    "list": [
      {
        "id": "coder",
        "name": "Coder",
        "config": {
          "datasetPaths": [
            "/data/projects/{PROJ}/datasets/",
            "/data/datasets/",
            "/data/shared/datasets/"
          ],
          "checkpointPath": "/data/checkpoints/{PROJ}/",
          "dataExcludes": ["*.tmp", "*.cache"]
        }
      }
    ]
  }
}
```

**✅ 优点**：
- 集中配置，可以版本控制
- 团队共享统一标准

**❌ 缺点**：
- 修改后需要重启 OpenClaw

---

## 🔧 实际使用示例

### 示例 1：使用 COCO 数据集

**步骤 1**：在 PLAN.md 中指定

```markdown
## Dataset Configuration

使用 COCO 2017 数据集进行目标检测实验。

- **路径**: `/data/datasets/coco`
- **格式**: COCO JSON 格式
- **类别**: 80 类
```

**步骤 2**：Coder 会自动读取并生成代码

```python
# 生成的 data/dataset.py
from torchvision.datasets import CocoDetection

train_dataset = CocoDetection(
    root='/data/datasets/coco/train2017',
    annFile='/data/datasets/coco/annotations/instances_train2017.json'
)
```

---

### 示例 2：使用项目自定义数据集

**步骤 1**：创建 PROJECT_MANIFEST.json

```json
{
  "projectId": "medical-image-segmentation",
  "dataset_path": "/data/projects/medical-image-segmentation/datasets",
  "data_config": {
    "format": "custom",
    "modality": "CT",
    "num_classes": 5
  }
}
```

**步骤 2**：Coder 会使用指定路径

```bash
# Coder 生成的训练命令
ssh gpu-server "cd /home/claw/experiments && \
  CUDA_VISIBLE_DEVICES=0 python train.py \
  --data_path /data/projects/medical-image-segmentation/datasets \
  --config configs/segmentation.yaml"
```

---

### 示例 3：多数据集对比实验

**在 PLAN.md 中配置多个数据集**：

```markdown
## Datasets

本实验对比在多个数据集上的泛化能力：

1. **源域**: COCO (`/data/datasets/coco`)
2. **目标域 1**: Cityscapes (`/data/shared/datasets/cityscapes`)
3. **目标域 2**: KITTI (`/data/shared/datasets/kitti`)

实验流程：
- 在 COCO 上训练
- 在 Cityscapes 和 KITTI 上测试零样本迁移
```

---

## ⚙️ 配置优先级验证

Coder 会按以下顺序查找数据集路径：

```bash
# 1. 检查 PLAN.md
grep -A 10 "^## Dataset" {PROJ}/orchestrator/PLAN.md

# 2. 检查 PROJECT_MANIFEST.json
cat {PROJ}/PROJECT_MANIFEST.json | jq '.dataset_path'

# 3. 检查 openclaw.json (如果有配置)
cat ~/.openclaw/openclaw.json | jq '.agents.list[] | select(.id=="coder") | .config.datasetPaths'

# 4. 使用 SERVER.md 默认值
cat agents/researcher/SERVER.md | grep "Data directory"
```

---

## 🚨 常见问题

### Q1: Coder 找不到数据集怎么办？

**检查步骤**：

```bash
# 1. 验证路径是否存在
ssh gpu-server "ls -la /data/datasets/coco"

# 2. 检查权限
ssh gpu-server "stat /data/datasets/coco"

# 3. 查看 Coder 实际使用的路径
cat {PROJ}/coder/<experiment-name>/REMOTE_RUN.json | grep "data_path"
```

**解决方案**：
- 确保路径在 SERVER.md 中配置
- 确保 GPU 服务器上有该路径
- 确保有读取权限

---

### Q2: 如何为不同实验使用不同数据集？

**推荐方式**：在 PLAN.md 中分别指定

```markdown
# Experiment 1: PLAN.md
## Dataset
- Path: /data/datasets/coco

# Experiment 2: PLAN.md
## Dataset
- Path: /data/shared/datasets/custom
```

---

### Q3: 数据集路径包含特殊字符怎么办？

**使用引号包裹**：

```markdown
## Dataset
- Path: "/data/datasets/my dataset (2024)/"
```

在代码生成时会自动处理引号。

---

### Q4: 如何配置多个 GPU 服务器上的数据集？

**在 SERVER.md 中为每个服务器配置**：

```markdown
## Server 1: gateway
- Data directory: `/data/datasets/`

## Server 2: gpu-node-2
- Data directory: `/data16T/datasets/`

## Server 3: a100-cluster
- Data directory: `/ssd/datasets/`
```

Coder 会根据选择的服务器自动使用对应路径。

---

## 📋 最佳实践

### ✅ 推荐做法

1. **使用绝对路径**：避免相对路径导致的混淆
2. **统一命名规范**：`/data/datasets/<dataset-name>/`
3. **在 PLAN.md 中明确说明**：便于 Reviewer 理解
4. **使用 PROJECT_MANIFEST.json 追踪**：便于版本控制

### ❌ 避免做法

1. ❌ 硬编码个人路径：`/home/zhangsan/data/`
2. ❌ 使用模糊路径：`../data/`
3. ❌ 在代码中直接写路径：应该从配置读取
4. ❌ 混合使用多种配置方式：选择一种并坚持使用

---

## 🔗 相关文件

- `agents/researcher/SERVER.md` - 服务器配置
- `skills/coder/run-experiment/SKILL.md` - 实验执行技能
- `skills/coder/implement-experiment/SKILL.md` - 代码实现技能
- `DATASET_CONFIG_EXAMPLE.json` - 配置示例

---

**最后更新**: 2026-03-21
