---
name: run-experiment
description: "Deploy experiment to remote GPU server via SSH. Handles resource check, code sync, and screen launch."
argument-hint: "[experiment name and config]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Grep
  - Glob
  - Edit
---

# Run Experiment

通过 SSH 在远程 GPU 服务器上部署实验。

## Prerequisites

读取 `SERVER.md` 获取：
- SSH 别名（如 `gpu-server`）
- 远程代码目录（含 `requirements.txt` 或 `pyproject.toml`）
- 远程日志/结果目录
- uv 路径（默认 `~/.local/bin/uv`）

## Steps

### 1. Resource Check

```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"
ssh <server> "free -h | head -2"
```

如果目标 GPU 已占满，选择空闲 GPU 或提示用户。

### 2. Code Sync

```bash
rsync -avz --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' --exclude='wandb' --exclude='checkpoints' <local_src>/ <server>:<remote_dst>/
```

### 3. Install Dependencies (if needed)

```bash
ssh <server> "cd <remote_dst> && UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv pip install -r requirements.txt 2>&1 | tail -5"
```

### 4. Launch in Screen

```bash
ssh <server> "screen -dmS <exp_name> bash -c 'cd <remote_dst> && CUDA_VISIBLE_DEVICES=<gpu_id> uv run python <script> <args> > logs/<exp_name>.log 2>&1; echo EXIT_CODE=\$? >> logs/<exp_name>.log'"
```

### 5. Verify Launch

```bash
ssh <server> "screen -ls | grep <exp_name> && echo 'RUNNING' || echo 'FAILED TO START'"
ssh <server> "sleep 5 && tail -5 <remote_dst>/logs/<exp_name>.log"
```

## Error Recovery

- screen 启动失败 → 检查日志前 20 行定位错误
- ImportError → 安装缺失包后重跑
- CUDA OOM（前 10 秒内） → 减半 batch size 重跑
