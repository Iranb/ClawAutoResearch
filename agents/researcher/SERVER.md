# SERVER.md — Remote Server Configuration

> Replace this file with your actual server information.

ssh claw@211.71.76.29

## GPU Server

- **SSH alias**: `ssh claw@211.71.76.29`
- **GPU**: `4x 5880 42GB`
- **uv path**: `~/.local/bin/uv` (if missing: `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- **PyPI mirror**: `UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`
- **Code directory**: `/home/<user>/experiments/`
- **Data directory**: `/data/datasets/`
- **Log directory**: `/home/<user>/experiments/logs/`
- **Result directory**: `/home/<user>/experiments/results/`

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
