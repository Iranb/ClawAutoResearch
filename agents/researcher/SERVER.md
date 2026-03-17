# SERVER.md — 远程服务器配置

> 请根据你的实际服务器信息修改此文件。
ssh claw@211.71.76.29

## GPU Server

- **SSH 别名**: `ssh claw@211.71.76.29`
- **GPU**: 4x 5880 42GB
- **uv 路径**: `~/.local/bin/uv`（如未安装: `curl -LsSf https://astral.sh/uv/install.sh | sh`）
- **PyPI 镜像**: `UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`
- **代码目录**: `/home/<user>/experiments/`
- **数据目录**: `/data/datasets/`
- **日志目录**: `/home/<user>/experiments/logs/`
- **结果目录**: `/home/<user>/experiments/results/`

## 资源检查命令

```bash
# GPU 状态
ssh gpu-server "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"

# 内存和磁盘
ssh gpu-server "free -h && echo '---' && df -h /home /data16T"

# 运行中的实验
ssh gpu-server "screen -ls"

# 查看实验日志（最近 50 行）
ssh gpu-server "tail -50 /home/<user>/experiments/logs/<exp_name>.log"
```

## 本地项目目录

- **代码**: `~/research/code/`
- **rsync 排除**: `.git`, `__pycache__`, `*.pyc`, `wandb/`, `checkpoints/`
