# OpenClaw 插件配置正确格式

## ✅ 官方文档标准格式

根据 [OpenClaw 官方插件文档](https://docs.openclaw.ai/tools/plugin)，正确的配置格式如下：

### 完整配置示例

```json5
{
  // 顶层配置
  "projectsRoot": "~/.openclaw/projects",
  
  // 插件配置
  "plugins": {
    // 1. 是否启用插件系统（必需）
    "enabled": true,
    
    // 2. 插件加载路径（可选，是 plugins 的子字段）
    "load": {
      "paths": [
        "~/.openclaw/plugins",      // 全局插件目录
        "./plugins",                 // 工作区插件目录
        "/absolute/path/to/plugin"   // 绝对路径
      ]
    },
    
    // 3. 插件允许列表（可选）
    "allow": ["openclaw-research", "voice-call"],
    
    // 4. 插件拒绝列表（可选，deny 优先于 allow）
    "deny": ["untrusted-plugin"],
    
    // 5. 独占插槽配置（可选）
    "slots": {
      "memory": "memory-core",        // 内存插件
      "contextEngine": "legacy"       // 上下文引擎
    },
    
    // 6. 具体插件条目配置（必需）
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          // 插件特定配置
          "projectsRoot": "~/.openclaw/projects",
          "requireProjectIsolation": true
        }
      }
    }
  }
}
```

---

## 📋 配置字段详解

### `plugins` 对象

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | 是 | `true` | 是否启用插件系统 |
| `load.paths` | string[] | 否 | `[]` | 插件加载路径数组 |
| `allow` | string[] | 否 | 全部允许 | 允许的插件 ID 列表 |
| `deny` | string[] | 否 | 无 | 拒绝的插件 ID 列表 |
| `slots` | object | 否 | - | 独占插槽配置 |
| `entries` | object | 是 | - | 各插件的具体配置 |

### `plugins.load.paths` 数组

路径搜索顺序（优先级从高到低）：

1. **配置路径**：`plugins.load.paths` 中指定的路径
2. **工作区扩展**：`<workspace>/.openclaw/extensions/*.ts`
3. **全局扩展**：`~/.openclaw/extensions/*.ts`
4. **内置插件**：OpenClaw 自带的插件

---

## 🚨 常见错误

### ❌ 错误 1：load 不是 plugins 的子字段

```json
// 错误格式
{
  "plugins.load": {
    "paths": ["~/.openclaw/plugins"]
  },
  "plugins": {
    "enabled": true
  }
}
```

```json
// 正确格式
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["~/.openclaw/plugins"]
    }
  }
}
```

---

### ❌ 错误 2：entries 配置在 load 内部

```json
// 错误格式
{
  "plugins": {
    "load": {
      "paths": ["~/.openclaw/plugins"],
      "entries": {
        "my-plugin": { ... }
      }
    }
  }
}
```

```json
// 正确格式
{
  "plugins": {
    "load": {
      "paths": ["~/.openclaw/plugins"]
    },
    "entries": {
      "my-plugin": { ... }
    }
  }
}
```

---

### ❌ 错误 3：缺少 entries 字段

```json
// 错误格式
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["~/.openclaw/plugins"]
    }
  }
}
```

```json
// 正确格式
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["~/.openclaw/plugins"]
    },
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": { ... }
      }
    }
  }
}
```

---

## 🔧 openclaw-research 插件完整配置

```json5
{
  "plugins": {
    "enabled": true,
    
    "load": {
      "paths": ["~/.openclaw/plugins"]
    },
    
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          // ── Data Integrity Policies ──────────
          "allowWorkspaceFallback": false,
          "requireProjectIsolation": true,
          "requireProjectIdInEntries": true,
          "requireTrackId": true,
          "requireEvidencePointers": true,
          "reviewStateMaxAgeHours": 24,
          
          // ── Project & Server Configuration ──────────
          "projectsRoot": "~/.openclaw/projects",
          
          // ── GPU Server Configuration ──────────
          "servers": {
            "default": "gateway",
            "list": ["gateway", "gpu-node-2"]
          },
          
          // ── Idea Generation ──────────
          "ideaGeneration": {
            "divergeSize": 8,
            "portfolioSize": 4,
            "tournamentRounds": 2
          },
          
          // ── Track Portfolio ──────────
          "trackPortfolio": {
            "maxActiveTracks": 2,
            "maxParkedTracks": 1,
            "parkedBudgetPolicy": "zero"
          },
          
          // ── Compute Budget ──────────
          "computeBudget": {
            "defaultGpuHoursPerTrack": 100,
            "maxConcurrentExperiments": 4,
            "gpuType": "A100"
          },
          
          // ── Review Loop ──────────
          "reviewLoop": {
            "maxRounds": 3,
            "scoreThreshold": 6.0,
            "autoAdvanceScore": 7.5
          },
          
          // ── Graph Configuration ──────────
          "graphConfig": {
            "autoRefreshTrigger": "per-track",
            "noveltyThreshold": 0.7,
            "maxPapersToIngest": 5000
          }
        }
      }
    }
  }
}
```

---

## 🎯 最小可用配置

如果只需要最基本的配置：

```json5
{
  "plugins": {
    "enabled": true,
    "entries": {
      "openclaw-research": {
        "enabled": true
      }
    }
  }
}
```

这样会使用插件的默认配置。

---

## 📞 验证配置

### 1. 检查配置语法

```bash
# 使用 JSON 验证工具
cat ~/.openclaw/openclaw.json | jq .
```

### 2. 验证插件加载

```bash
# 列出已加载的插件
openclaw plugins list

# 查看插件状态
openclaw plugins status

# 检查插件问题
openclaw plugins doctor
```

### 3. 重启 Gateway

配置修改后必须重启：

```bash
# 重启 Gateway
openclaw gateway restart

# 或者完全重启
openclaw gateway stop
openclaw gateway start
```

---

## 🔗 相关文档

- [OpenClaw 插件文档](https://docs.openclaw.ai/tools/plugin)
- [构建插件](https://docs.openclaw.ai/plugins/building-plugins)
- [插件清单](https://docs.openclaw.ai/plugins/manifest)
- [CLI 参考](https://docs.openclaw.ai/cli/plugins)

---

**最后更新**: 2026-03-21  
**基于版本**: OpenClaw 官方文档
