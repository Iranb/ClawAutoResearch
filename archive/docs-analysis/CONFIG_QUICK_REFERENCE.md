# 配置快速参考 (Quick Config Guide)

## 一句话总结

**当前状态**：项目根目录和 GPU 服务器配置**不能**完全通过 plugin config 实现（虽然部分可以）  
**建议方案**：按 [CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md) 扩展 plugin config 结构  
**实施时间**：Phase 1 约 7.5 小时（必须），Phase 2-3 可选

---

## 现状对比表

### 项目根目录 (projectsRoot)

| 需求 | 当前 | 建议改 |
|------|------|--------|
| **在 openclaw.json 顶级** | ✅ 支持 | - |
| **在 plugin config 中** | ❌ 不支持 | ✅ 扩展支持 |
| **位置** | `openclaw.json` 第 5 行 | `plugins.entries["openclaw-research"].config.projectsRoot` |
| **示例** | `projectsRoot: "~/Projects"` | `config: { projectsRoot: "~/Projects" }` |

### GPU 服务器 (servers)

| 需求 | 当前 | 建议改 |
|------|------|--------|
| **全局配置** | ✅ `~/.openclaw/openclaw-research.json` | 可迁移到 plugin config |
| **项目级覆盖** | ✅ `{PROJ}/servers.json` | 保留不变 |
| **Plugin config** | ❌ 不支持 | ✅ 扩展支持 |
| **示例** | 分散在两个文件 | 统一在 `config.servers` |

### 其他业务参数

| 参数 | 当前 | 建议 |
|------|------|------|
| IDEA 候选数 (divergeSize) | ❌ 无 | ✅ 扩展到 config |
| 活跃轨道数 (maxActiveTracks) | ❌ 硬编码为 2 | ✅ 扩展到 config |
| 保留轨道数 (maxParkedTracks) | ❌ 硬编码为 1 | ✅ 扩展到 config |
| 评审轮数 (reviewLoop.maxRounds) | ❌ 硬编码为 3 | ✅ 扩展到 config |
| GPU 小时数 (defaultGpuHours) | ❌ 无 | ✅ 扩展到 config |

---

## 常见配置场景

### 场景 1: 单 GPU 本地开发

```json5
{
  projectsRoot: "~/.openclaw/projects",
  
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          // 数据完整性（默认值已足够）
          requireProjectIsolation: true,
          
          // 服务器（本地）
          servers: {
            default: "localhost",
            list: ["localhost"]
          },
          
          // 降低资源消耗
          ideaGeneration: {
            divergeSize: 4,        // 只生成 4 个想法
            portfolioSize: 2,       // 选 2 个进竞赛
            tournamentRounds: 1     // 1 轮竞赛
          },
          
          trackPortfolio: {
            maxActiveTracks: 1,     // 只进行 1 条轨道
            maxParkedTracks: 0      // 不保留轨道
          },
          
          computeBudget: {
            defaultGpuHoursPerTrack: 20,     // 只有 20 小时预算
            maxConcurrentExperiments: 1,     // 一个一个跑
            gpuType: "auto"                  // 自动选择
          }
        }
      }
    }
  }
}
```

### 场景 2: 多 GPU 工作站（2-4 块卡）

```json5
{
  projectsRoot: "/data/projects",
  
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          servers: {
            default: "workstation-gpu",
            list: ["workstation-gpu"]
          },
          
          ideaGeneration: {
            divergeSize: 8,
            portfolioSize: 4,
            tournamentRounds: 2
          },
          
          trackPortfolio: {
            maxActiveTracks: 2,
            maxParkedTracks: 1,
            parkedBudgetPolicy: "minimal"  // 保留轨道分 5% 预算
          },
          
          computeBudget: {
            defaultGpuHoursPerTrack: 100,
            maxConcurrentExperiments: 2,   // 最多同时 2 个
            gpuType: "A40"
          }
        }
      }
    }
  }
}
```

### 场景 3: 云端 GPU 集群（8+ 块 A100）

```json5
{
  projectsRoot: "/mnt/shared/research-projects",
  
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          servers: {
            default: "gpu-cluster-1",
            list: [
              "gpu-cluster-1", "gpu-cluster-2", "gpu-cluster-3",
              "gpu-cluster-4", "gpu-cluster-5"
            ]
          },
          
          ideaGeneration: {
            divergeSize: 12,        // 大规模探索
            portfolioSize: 6,
            tournamentRounds: 3
          },
          
          trackPortfolio: {
            maxActiveTracks: 3,     // 3 条并行轨道
            maxParkedTracks: 2,
            parkedBudgetPolicy: "shared"  // 动态分配
          },
          
          computeBudget: {
            defaultGpuHoursPerTrack: 500,     // 充足预算
            maxConcurrentExperiments: 8,      // 并发度高
            gpuType: "A100"
          },
          
          reviewLoop: {
            maxRounds: 5,                     // 多轮评审
            scoreThreshold: 7.0,              // 更严格的标准
            autoAdvanceScore: 8.0
          }
        }
      }
    }
  }
}
```

### 场景 4: 成本受限的学术研究（预算 < 500 小时）

```json5
{
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          trackPortfolio: {
            maxActiveTracks: 1,     // 集中在一条轨道
            maxParkedTracks: 0      // 没有保留的余地
          },
          
          computeBudget: {
            defaultGpuHoursPerTrack: 100,   // 紧凑预算
            maxConcurrentExperiments: 1,
            gpuType: "auto"                 // 便宜的可用卡
          },
          
          reviewLoop: {
            maxRounds: 2,                   // 快速评审
            scoreThreshold: 5.0             // 宽松标准
          },
          
          graphConfig: {
            maxPapersToIngest: 200,         // 限制文献量
            autoRefreshTrigger: "manual"    // 手动刷新，省时间
          }
        }
      }
    }
  }
}
```

---

## 字段优先级矩阵

### Tier 1 - 必须配置的

| 字段 | 优先级 | 为什么 |
|------|--------|--------|
| `projectsRoot` | 🔴 必须 | 所有项目的存储位置 |
| `servers.default` | 🔴 必须 | GPU 执行的位置 |
| `trackPortfolio.maxActiveTracks` | 🔴 必须 | 约束资源消耗 |
| `computeBudget.defaultGpuHoursPerTrack` | 🔴 必须 | 预算管理 |

### Tier 2 - 强烈建议

| 字段 | 优先级 | 为什么 |
|------|--------|--------|
| `ideaGeneration.divergeSize` | 🟡 高 | 影响创意多样性 |
| `maxConcurrentExperiments` | 🟡 高 | 影响任务吞吐量 |
| `reviewLoop.scoreThreshold` | 🟡 高 | 影响质量把控 |

### Tier 3 - 可选微调

| 字段 | 优先级 | 为什么 |
|------|--------|--------|
| `parkedBudgetPolicy` | 🟢 可选 | 只在有保留轨道时需要 |
| `autoRefreshTrigger` | 🟢 可选 | 影响图谱更新策略 |
| `noveltyThreshold` | 🟢 可选 | 细粒度控制新颖性 |

---

## 配置检查清单

使用此清单确保 openclaw.json 配置完整：

### 必须项 ✅

- [ ] `projectsRoot` 已设置
- [ ] `servers.default` 已设置
- [ ] `servers.list` 至少包含 `default` 中的主机
- [ ] `trackPortfolio.maxActiveTracks` ≥ 1
- [ ] `computeBudget.defaultGpuHoursPerTrack` > 0
- [ ] `requireProjectIsolation: true`

### 强烈建议 ✅

- [ ] `ideaGeneration.divergeSize` ≥ `trackPortfolio.maxActiveTracks`
- [ ] `ideaGeneration.portfolioSize` ≥ `ideaGeneration.divergeSize`（实际应 ≤）
- [ ] `computeBudget.maxConcurrentExperiments` ≤ 总可用 GPU 卡数
- [ ] `reviewLoop.scoreThreshold` ≤ `autoAdvanceScore`

### 一致性检查 ✅

- [ ] divergeSize (8) ≥ portfolioSize (4) ≥ maxActiveTracks (2)
- [ ] maxConcurrentExperiments (4) ≤ 集群内 GPU 卡数
- [ ] defaultGpuHoursPerTrack × maxActiveTracks ≤ 总预算
- [ ] scoreThreshold (6.0) < autoAdvanceScore (7.5) ≤ 10

### 与其他文件一致 ✅

- [ ] projectsRoot 与 `openclaw.json` 顶级 `projectsRoot` 一致（如有冲突，plugin config 优先）
- [ ] servers.list 包含 `tools.exec.host` 指定的主机
- [ ] 如存在 `{PROJ}/servers.json`，确认项目级覆盖策略

---

## 迁移指南（从当前配置 → 扩展后）

### Step 1: 备份

```bash
cp openclaw.json openclaw.json.backup
cp ~/.openclaw/openclaw-research.json ~/.openclaw/openclaw-research.json.backup
```

### Step 2: 收集当前配置

```bash
# 当前项目根目录
grep -i projectsRoot openclaw.json

# 当前服务器配置
cat ~/.openclaw/openclaw-research.json | grep -A 5 "servers"

# 当前的硬编码约束（在 skills 代码中）
grep -r "maxActiveTracks\|divergeSize\|maxConcurrentExperiments" skills/
```

### Step 3: 迁移到新格式

```json5
{
  // 保留顶级 projectsRoot（可选，plugin config 会读取）
  projectsRoot: "~/.openclaw/projects",
  
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          // 从 ~/.openclaw/openclaw-research.json 迁移
          servers: {
            default: "gateway",
            list: ["gateway", "gpu-node-2"]
          },
          
          // 从 skills 代码中的硬编码迁移
          trackPortfolio: {
            maxActiveTracks: 2,
            maxParkedTracks: 1
          },
          
          // 新增
          ideaGeneration: {
            divergeSize: 8,
            portfolioSize: 4,
            tournamentRounds: 2
          }
        }
      }
    }
  }
}
```

### Step 4: 测试

```bash
# 验证配置有效性
npm run validate:config

# 启动一个测试项目
openclaw "/research-pipeline 'test idea'"

# 检查 get_paths 返回的配置
research_memory({ action: "get_paths" })
```

### Step 5: 清理（可选）

```bash
# 删除 ~/.openclaw/openclaw-research.json
# 或保留用于其他工具的全局配置
```

---

## 故障排除

### 问题 1: "OPENCLAW_PROJECT is required"

**原因**：plugin config 中 `requireProjectIsolation: true` 但环境变量未设置  
**解决**：
```bash
export OPENCLAW_PROJECT=my-project-001
# 或改 config 为 requireProjectIsolation: false（不建议）
```

### 问题 2: 配置被忽视，使用默认值

**原因**：plugin config 写错了字段名或格式  
**检查**：
```bash
# 获取实际加载的配置
research_memory({ action: "get_paths" })

# 检查 openclaw.json 语法
npm run validate:json openclaw.json
```

### 问题 3: "Servers list does not include default"

**原因**：`servers.list` 不包含 `servers.default` 指定的主机  
**解决**：
```json5
{
  servers: {
    default: "gpu-1",
    list: ["gpu-1", "gpu-2"]  // ← 加上 "gpu-1"
  }
}
```

### 问题 4: 类型错误 (string 当 number)

**原因**：JSON 中数字被引号包裹  
**错误**：
```json5
divergeSize: "8"  // ❌ 字符串
```
**正确**：
```json5
divergeSize: 8    // ✅ 数字
```

---

## 示例配置文件集合

### 📦 GitHub 配置模板

主仓库中提供的预置配置（待扩展）：

```
configs/
├── local-single-gpu.json5
├── workstation-multi-gpu.json5
├── cloud-cluster.json5
├── academic-budget.json5
└── enterprise-production.json5
```

---

## 更多资源

- **详细分析**：[CONFIG_EXTENSIBILITY_ANALYSIS.md](./CONFIG_EXTENSIBILITY_ANALYSIS.md)
- **实施检查表**：[CONFIG_IMPLEMENTATION_CHECKLIST.md](./CONFIG_IMPLEMENTATION_CHECKLIST.md)
- **主配置文档**：[CONFIG.md](./CONFIG.md)
- **技能文档**：[SKILL.md](./SKILL.md)
- **工作流文档**：[WORKFLOW.md](./WORKFLOW.md)

---

**最后更新**：2026-03-21  
**维护者**：OpenClaw Research Team  
**状态**：Proposed (Phase 1 实施中)
