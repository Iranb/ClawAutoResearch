---
name: monitor-experiment
description: "Monitor running experiments on remote server: check status, read logs, detect completion."
argument-hint: "[server or experiment name]"
allowed-tools:
  - Bash(ssh *)
  - Bash(echo *)
  - Read
  - Write
  - Edit
---

# Monitor Experiment

监控远程服务器上的实验状态。

## Process

### 1. Check Running Experiments

```bash
ssh <server> "screen -ls"
```

### 2. Read Recent Logs

```bash
ssh <server> "tail -30 <remote_dst>/logs/<exp_name>.log"
```

### 3. Check Results

```bash
ssh <server> "ls -lt <remote_dst>/results/*.json 2>/dev/null | head -5"
```

如果有结果文件：
```bash
ssh <server> "cat <remote_dst>/results/<latest>.json"
```

### 4. Detect Completion

实验完成标志：
- screen 会话不存在（`screen -ls` 不包含 `<exp_name>`）
- 日志末尾包含 `EXIT_CODE=0`
- 结果文件已生成

### 5. Polling Strategy

- 首次检查：启动后 30 秒
- 短实验（< 10 min）：每 30s 检查
- 中等实验（10-60 min）：每 2min 检查
- 长实验（> 60 min）：每 5min 检查

### 6. Report

完成后输出状态摘要：
- 运行时长
- 最终指标（从结果文件提取）
- 是否有错误或警告
