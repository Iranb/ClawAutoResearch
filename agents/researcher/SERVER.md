# SERVER.md — Remote Server Configuration

> Replace this file with your actual server information.

ssh claw@211.71.76.29

## GPU Server

- **SSH alias**: `ssh claw@211.71.76.29`
- **GPU**: `4x 5880 42GB`
- **uv path**: `~/.local/bin/uv` (if missing: `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **PyPI mirror**: `UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`

## Directory Configuration

### Code Directories
- **Remote code directory**: `/home/claw/experiments/`
- **Local code directory**: `~/research/code/`

### Dataset Directories (Coder 可访问)
- **主数据集**: `/data/datasets/` (COCO, ImageNet 等)
- **项目数据集**: `/data/projects/{PROJ}/datasets/` (项目专用)
- **临时数据集**: `/tmp/datasets/` (小数据集，定期清理)
- **共享数据集**: `/data/shared/datasets/` (团队共享)

### Log & Result Directories
- **Log directory**: `/home/claw/experiments/logs/`
- **Result directory**: `/home/claw/experiments/results/`
- **Checkpoint directory**: `/data/checkpoints/{PROJ}/`

## Resource Check Commands

```bash
# GPU status
ssh gpu-server "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"

# Memory and disk
ssh gpu-server "free -h && echo '---' && df -h /home /data16T"

# Running experiments
ssh gpu-server "screen -ls"

# View experiment logs (last 50 lines)
ssh gpu-server "tail -50 /home/<user>/experiments/logs/<exp_name>.log"
```

## Local Project Directory

- **Code**: `~/research/code/`
- **rsync excludes**: `.git`, `__pycache__`, `*.pyc`, `wandb/`, `checkpoints/`
