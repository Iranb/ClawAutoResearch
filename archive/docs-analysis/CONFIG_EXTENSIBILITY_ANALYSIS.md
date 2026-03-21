# Config 可扩展性分析与实施方案

## 概览

**问题**：能否通过 plugin config 实现项目根目录、GPU服务器等业务级配置？

**现状**：部分支持 ❌ → 建议：完整支持 ✅

---

## 一、当前架构分析

### 1.1 现有配置链路

```
openclaw.json (顶级配置)
    ↓
plugins.entries["openclaw-research"].config
    ↓
index.ts getPolicy() 函数
    ↓
ResearchMemoryPolicy (tools/research-memory.ts)
    ↓
research_memory 工具的策略验证
```

### 1.2 当前支持的 config 字段

**openclaw.plugin.json 定义的 configSchema**：

```json
{
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "allowWorkspaceFallback": { "type": "boolean", "default": false },
      "requireProjectIsolation": { "type": "boolean", "default": true },
      "requireProjectIdInEntries": { "type": "boolean", "default": true },
      "requireTrackId": { "type": "boolean", "default": true },
      "requireEvidencePointers": { "type": "boolean", "default": true },
      "reviewStateMaxAgeHours": { "type": "number", "minimum": 1, "default": 24 }
    }
  }
}
```

**现有 getPolicy() 函数**（index.ts L92-102）：

```typescript
function getPolicy(config: Record<string, unknown> | undefined) {
  return {
    allowWorkspaceFallback: config?.allowWorkspaceFallback === true,
    requireProjectIsolation: config?.requireProjectIsolation !== false,
    requireProjectIdInEntries: config?.requireProjectIdInEntries !== false,
    requireTrackId: config?.requireTrackId !== false,
    requireEvidencePointers: config?.requireEvidencePointers !== false,
    reviewStateMaxAgeHours:
      typeof config?.reviewStateMaxAgeHours === "number"
        ? config.reviewStateMaxAgeHours
        : 24,
  };
}
```

---

## 二、当前缺陷分析

### 2.1 ❌ 项目根目录 (projectsRoot)

**当前状态**：
- ✅ 可在 `openclaw.json` 顶级定义：`projectsRoot: "~/.openclaw/projects"`
- ❌ **但不能在 plugin config 中定义**
- ❌ plugin config 采用 `additionalProperties: false`，会拒绝未知字段

**问题**：
```json5
{
  projectsRoot: "~/.openclaw/projects",  // 顶级 ← 可以
  plugins: {
    entries: {
      "openclaw-research": {
        config: {
          projectsRoot: "..."  // 这里会被拒绝！❌
        }
      }
    }
  }
}
```

### 2.2 ❌ GPU 服务器 (servers)

**当前状态**：
- ✅ 可在 `~/.openclaw/openclaw-research.json` 定义全局 servers
- ✅ 可在 `{PROJ}/servers.json` 定义项目级 servers
- ❌ **但不能在 plugin config 中统一管理**

**问题**：
- servers 配置分散在多个文件中
- plugin config 中完全没有 servers 相关字段
- 无法从单个配置源进行服务器管理

### 2.3 ❌ 业务级参数（轨道数、预算等）

**当前状态**：
- ❌ 完全不支持在 plugin config 中定义：
  - `ideaPortfolioSize` (IDEA 阶段的轨道数)
  - `maxActiveTracks` (最多活跃轨道数)
  - `maxParkedTracks` (最多保留轨道数)
  - `defaultGpuHours` (默认 GPU 预算)
  - 等等

**代码证据**：
- `research-memory.ts` 中 `ResearchMemoryPolicy` 接口只有 6 个布尔/数字字段
- `index.ts` 中 `getPolicy()` 只处理这 6 个字段
- 没有配置读取其他业务参数的逻辑

---

## 三、实施方案

### 3.1 第一步：扩展 openclaw.plugin.json 的 configSchema

**修改位置**：`openclaw.plugin.json`

```json5
{
  "configSchema": {
    "type": "object",
    "additionalProperties": false,  // 仍然禁止未知字段，确保类型安全
    "properties": {
      // ───── 现有字段（保持不变） ─────
      "allowWorkspaceFallback": {
        "type": "boolean",
        "default": false,
        "description": "Allow fallback to workspace-level memory"
      },
      // ... 其他现有字段 ...

      // ───── 新增字段 ─────
      
      // 1. 项目根目录
      "projectsRoot": {
        "type": "string",
        "description": "Project root directory (can also be set via openclaw.json top-level)",
        "examples": ["~/.openclaw/projects", "~/ResearchProjects", "/data/projects"]
      },

      // 2. GPU 服务器
      "servers": {
        "type": "object",
        "description": "GPU server configuration",
        "additionalProperties": false,
        "properties": {
          "default": {
            "type": "string",
            "description": "Default SSH host for experiments",
            "examples": ["gateway", "gpu-node-1"]
          },
          "list": {
            "type": "array",
            "items": { "type": "string" },
            "description": "List of available SSH hosts",
            "examples": [["gateway", "gpu-node-2", "gpu-node-3"]]
          }
        },
        "required": ["default", "list"]
      },

      // 3. IDEA 阶段配置
      "ideaGeneration": {
        "type": "object",
        "description": "Configuration for idea generation phase",
        "additionalProperties": false,
        "properties": {
          "divergeSize": {
            "type": "number",
            "minimum": 2,
            "maximum": 20,
            "default": 8,
            "description": "Number of candidate ideas to generate"
          },
          "portfolioSize": {
            "type": "number",
            "minimum": 1,
            "maximum": 10,
            "default": 4,
            "description": "Final portfolio size before tournament"
          },
          "tournamentRounds": {
            "type": "number",
            "minimum": 1,
            "maximum": 5,
            "default": 2,
            "description": "Number of tournament rounds for idea selection"
          }
        }
      },

      // 4. 轨道管理
      "trackPortfolio": {
        "type": "object",
        "description": "Hypothesis track portfolio constraints",
        "additionalProperties": false,
        "properties": {
          "maxActiveTracks": {
            "type": "number",
            "minimum": 1,
            "maximum": 5,
            "default": 2,
            "description": "Maximum number of active (consuming budget) tracks"
          },
          "maxParkedTracks": {
            "type": "number",
            "minimum": 0,
            "maximum": 3,
            "default": 1,
            "description": "Maximum number of parked (not consuming budget) tracks"
          },
          "parkedBudgetPolicy": {
            "type": "string",
            "enum": ["zero", "minimal", "shared"],
            "default": "zero",
            "description": "Budget allocation for parked tracks: 'zero'=no budget, 'minimal'=5%, 'shared'=split with active"
          }
        }
      },

      // 5. 计算预算
      "computeBudget": {
        "type": "object",
        "description": "GPU and compute resource limits",
        "additionalProperties": false,
        "properties": {
          "defaultGpuHoursPerTrack": {
            "type": "number",
            "minimum": 1,
            "maximum": 10000,
            "default": 100,
            "description": "Default GPU-hours budget per active track"
          },
          "maxConcurrentExperiments": {
            "type": "number",
            "minimum": 1,
            "maximum": 32,
            "default": 4,
            "description": "Maximum concurrent experiment jobs"
          },
          "gpuType": {
            "type": "string",
            "enum": ["A100", "A40", "V100", "RTX_A6000", "auto"],
            "default": "auto",
            "description": "Preferred GPU type, or 'auto' for availability-based selection"
          }
        }
      },

      // 6. 评审循环
      "reviewLoop": {
        "type": "object",
        "description": "Internal review stage parameters",
        "additionalProperties": false,
        "properties": {
          "maxRounds": {
            "type": "number",
            "minimum": 1,
            "maximum": 10,
            "default": 3,
            "description": "Maximum review iterations before escalation"
          },
          "scoreThreshold": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "default": 6.0,
            "description": "Minimum review score (out of 10) to proceed to writing"
          },
          "autoAdvanceScore": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "default": 7.5,
            "description": "Auto-advance to writing if score exceeds this"
          }
        }
      },

      // 7. 文献图谱
      "graphConfig": {
        "type": "object",
        "description": "PaperNexus graph-building parameters",
        "additionalProperties": false,
        "properties": {
          "autoRefreshTrigger": {
            "type": "string",
            "enum": ["always", "smart", "manual"],
            "default": "smart",
            "description": "When to refresh the research graph"
          },
          "noveltyThreshold": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "default": 0.6,
            "description": "Novelty score threshold (0-1) for ideas"
          },
          "maxPapersToIngest": {
            "type": "number",
            "minimum": 10,
            "maximum": 10000,
            "default": 500,
            "description": "Maximum papers to ingest into project corpus"
          }
        }
      }
    }
  }
}
```

---

### 3.2 第二步：扩展 ResearchMemoryPolicy 接口

**修改位置**：`tools/research-memory.ts` 第 11-19 行

```typescript
export interface ResearchMemoryPolicy {
  // ───── 现有字段 ─────
  allowWorkspaceFallback?: boolean;
  requireProjectIsolation?: boolean;
  requireProjectIdInEntries?: boolean;
  requireTrackId?: boolean;
  requireEvidencePointers?: boolean;
  reviewStateMaxAgeHours?: number;

  // ───── 新增字段 ─────
  
  // 项目根目录
  projectsRoot?: string;

  // GPU 服务器
  servers?: {
    default: string;
    list: string[];
  };

  // IDEA 生成
  ideaGeneration?: {
    divergeSize?: number;
    portfolioSize?: number;
    tournamentRounds?: number;
  };

  // 轨道管理
  trackPortfolio?: {
    maxActiveTracks?: number;
    maxParkedTracks?: number;
    parkedBudgetPolicy?: "zero" | "minimal" | "shared";
  };

  // 计算预算
  computeBudget?: {
    defaultGpuHoursPerTrack?: number;
    maxConcurrentExperiments?: number;
    gpuType?: "A100" | "A40" | "V100" | "RTX_A6000" | "auto";
  };

  // 评审循环
  reviewLoop?: {
    maxRounds?: number;
    scoreThreshold?: number;
    autoAdvanceScore?: number;
  };

  // 图谱配置
  graphConfig?: {
    autoRefreshTrigger?: "always" | "smart" | "manual";
    noveltyThreshold?: number;
    maxPapersToIngest?: number;
  };
}
```

---

### 3.3 第三步：扩展 normalizePolicy 函数

**修改位置**：`tools/research-memory.ts` 第 79-117 行

```typescript
const DEFAULT_POLICY: Required<ResearchMemoryPolicy> = {
  // ───── 现有默认值 ─────
  allowWorkspaceFallback: false,
  requireProjectIsolation: true,
  requireProjectIdInEntries: true,
  requireTrackId: true,
  requireEvidencePointers: true,
  reviewStateMaxAgeHours: 24,

  // ───── 新增默认值 ─────
  projectsRoot: "~/.openclaw/projects",

  servers: {
    default: "gateway",
    list: ["gateway"],
  },

  ideaGeneration: {
    divergeSize: 8,
    portfolioSize: 4,
    tournamentRounds: 2,
  },

  trackPortfolio: {
    maxActiveTracks: 2,
    maxParkedTracks: 1,
    parkedBudgetPolicy: "zero",
  },

  computeBudget: {
    defaultGpuHoursPerTrack: 100,
    maxConcurrentExperiments: 4,
    gpuType: "auto",
  },

  reviewLoop: {
    maxRounds: 3,
    scoreThreshold: 6.0,
    autoAdvanceScore: 7.5,
  },

  graphConfig: {
    autoRefreshTrigger: "smart",
    noveltyThreshold: 0.6,
    maxPapersToIngest: 500,
  },
};

function normalizePolicy(
  policy: ResearchMemoryPolicy = {}
): Required<ResearchMemoryPolicy> {
  return {
    // ───── 现有字段 ─────
    allowWorkspaceFallback:
      policy.allowWorkspaceFallback ?? DEFAULT_POLICY.allowWorkspaceFallback,
    // ... 其他现有字段 ...

    // ───── 新增字段 ─────
    projectsRoot: policy.projectsRoot ?? DEFAULT_POLICY.projectsRoot,

    servers: {
      default: policy.servers?.default ?? DEFAULT_POLICY.servers.default,
      list: policy.servers?.list ?? DEFAULT_POLICY.servers.list,
    },

    ideaGeneration: {
      divergeSize:
        policy.ideaGeneration?.divergeSize ??
        DEFAULT_POLICY.ideaGeneration.divergeSize,
      portfolioSize:
        policy.ideaGeneration?.portfolioSize ??
        DEFAULT_POLICY.ideaGeneration.portfolioSize,
      tournamentRounds:
        policy.ideaGeneration?.tournamentRounds ??
        DEFAULT_POLICY.ideaGeneration.tournamentRounds,
    },

    trackPortfolio: {
      maxActiveTracks:
        policy.trackPortfolio?.maxActiveTracks ??
        DEFAULT_POLICY.trackPortfolio.maxActiveTracks,
      maxParkedTracks:
        policy.trackPortfolio?.maxParkedTracks ??
        DEFAULT_POLICY.trackPortfolio.maxParkedTracks,
      parkedBudgetPolicy:
        policy.trackPortfolio?.parkedBudgetPolicy ??
        DEFAULT_POLICY.trackPortfolio.parkedBudgetPolicy,
    },

    computeBudget: {
      defaultGpuHoursPerTrack:
        policy.computeBudget?.defaultGpuHoursPerTrack ??
        DEFAULT_POLICY.computeBudget.defaultGpuHoursPerTrack,
      maxConcurrentExperiments:
        policy.computeBudget?.maxConcurrentExperiments ??
        DEFAULT_POLICY.computeBudget.maxConcurrentExperiments,
      gpuType:
        policy.computeBudget?.gpuType ?? DEFAULT_POLICY.computeBudget.gpuType,
    },

    reviewLoop: {
      maxRounds:
        policy.reviewLoop?.maxRounds ?? DEFAULT_POLICY.reviewLoop.maxRounds,
      scoreThreshold:
        policy.reviewLoop?.scoreThreshold ??
        DEFAULT_POLICY.reviewLoop.scoreThreshold,
      autoAdvanceScore:
        policy.reviewLoop?.autoAdvanceScore ??
        DEFAULT_POLICY.reviewLoop.autoAdvanceScore,
    },

    graphConfig: {
      autoRefreshTrigger:
        policy.graphConfig?.autoRefreshTrigger ??
        DEFAULT_POLICY.graphConfig.autoRefreshTrigger,
      noveltyThreshold:
        policy.graphConfig?.noveltyThreshold ??
        DEFAULT_POLICY.graphConfig.noveltyThreshold,
      maxPapersToIngest:
        policy.graphConfig?.maxPapersToIngest ??
        DEFAULT_POLICY.graphConfig.maxPapersToIngest,
    },
  };
}
```

---

### 3.4 第四步：导出配置读取函数

**在 `tools/research-memory.ts` 中添加新的导出函数**：

```typescript
/**
 * Get fully resolved business configuration
 * 
 * @param policy - Research memory policy (includes all business config)
 * @returns Business-level configuration object
 */
export function getBusinessConfig(
  policy: Required<ResearchMemoryPolicy>
) {
  return {
    projectsRoot: policy.projectsRoot,
    servers: policy.servers,
    ideaGeneration: policy.ideaGeneration,
    trackPortfolio: policy.trackPortfolio,
    computeBudget: policy.computeBudget,
    reviewLoop: policy.reviewLoop,
    graphConfig: policy.graphConfig,
  };
}
```

---

### 3.5 第五步：在 index.ts 中暴露配置

**修改 index.ts 的 getPolicy 函数**，添加对新字段的支持：

```typescript
function getPolicy(config: Record<string, unknown> | undefined) {
  return {
    // ───── 现有字段 ─────
    allowWorkspaceFallback: config?.allowWorkspaceFallback === true,
    requireProjectIsolation: config?.requireProjectIsolation !== false,
    // ... 其他现有字段 ...

    // ───── 新增字段 ─────
    projectsRoot:
      typeof config?.projectsRoot === "string"
        ? config.projectsRoot
        : "~/.openclaw/projects",

    servers:
      config?.servers && typeof config.servers === "object"
        ? {
            default: String(
              (config.servers as Record<string, unknown>).default ?? "gateway"
            ),
            list: Array.isArray((config.servers as Record<string, unknown>).list)
              ? ((config.servers as Record<string, unknown>).list as string[])
              : ["gateway"],
          }
        : { default: "gateway", list: ["gateway"] },

    // ... 其他新增字段类似处理 ...
  };
}
```

---

### 3.6 在 SKILL.md 中更新文档

添加新的配置示例：

```json5
{
  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          // ─────── 策略级配置（强制数据完整性）──────────
          allowWorkspaceFallback: false,
          requireProjectIsolation: true,
          requireProjectIdInEntries: true,
          requireTrackId: true,
          requireEvidencePointers: true,
          reviewStateMaxAgeHours: 24,

          // ─────── 基础配置（项目和服务器）──────────
          projectsRoot: "~/.openclaw/projects",
          servers: {
            default: "gateway",
            list: ["gateway", "gpu-node-2", "gpu-node-3"]
          },

          // ─────── IDEA 阶段配置──────────
          ideaGeneration: {
            divergeSize: 8,          // 发散生成 8 个候选
            portfolioSize: 4,        // 精选到 4 个进入竞赛
            tournamentRounds: 2      // 进行 2 轮竞赛
          },

          // ─────── 轨道管理配置──────────
          trackPortfolio: {
            maxActiveTracks: 2,      // 最多 2 个活跃轨道（消耗预算）
            maxParkedTracks: 1,      // 最多 1 个保留轨道
            parkedBudgetPolicy: "zero"  // 保留轨道不消耗预算
          },

          // ─────── 计算预算配置──────────
          computeBudget: {
            defaultGpuHoursPerTrack: 100,
            maxConcurrentExperiments: 4,
            gpuType: "A100"  // 或 "A40", "V100", "RTX_A6000", "auto"
          },

          // ─────── 评审循环配置──────────
          reviewLoop: {
            maxRounds: 3,         // 最多 3 轮评审
            scoreThreshold: 6.0,  // 评审分数需 ≥ 6 才能进入写作
            autoAdvanceScore: 7.5 // 分数 ≥ 7.5 自动进入写作
          },

          // ─────── 图谱配置──────────
          graphConfig: {
            autoRefreshTrigger: "smart",  // "always" | "smart" | "manual"
            noveltyThreshold: 0.6,        // 0.0-1.0，新颖性分数阈值
            maxPapersToIngest: 500        // 最多导入 500 篇论文
          }
        }
      }
    }
  }
}
```

---

## 四、使用示例

### 4.1 在 openclaw.json 中配置

```json5
{
  projectsRoot: "~/.openclaw/projects",

  plugins: {
    entries: {
      "openclaw-research": {
        enabled: true,
        config: {
          // 策略级
          requireProjectIsolation: true,
          requireTrackId: true,

          // 业务级
          servers: {
            default: "gpu-lab-1",
            list: ["gpu-lab-1", "gpu-lab-2", "gpu-lab-3"]
          },
          
          trackPortfolio: {
            maxActiveTracks: 2,
            maxParkedTracks: 1,
            parkedBudgetPolicy: "zero"
          },
          
          computeBudget: {
            defaultGpuHoursPerTrack: 150,
            maxConcurrentExperiments: 8,
            gpuType: "A100"
          }
        }
      }
    }
  }
}
```

### 4.2 在技能中读取配置

在 skills 中调用 `research_memory` 工具：

```typescript
// 获取完整配置
const result = await research_memory({
  action: "get_paths"
});

// 返回结果包含：
{
  "policy": {
    "projectsRoot": "~/.openclaw/projects",
    "servers": { "default": "gpu-lab-1", "list": [...] },
    "trackPortfolio": { "maxActiveTracks": 2, ... },
    "computeBudget": { "defaultGpuHoursPerTrack": 150, ... }
  },
  "mode": "project",
  // ... 其他字段
}
```

---

## 五、兼容性分析

| 方面 | 影响 | 说明 |
|------|------|------|
| **向后兼容** | ✅ 完全兼容 | 所有新字段都有默认值，现有 config 可不改 |
| **现有代码** | ✅ 不需改 | 现有读取策略的代码可继续工作 |
| **OpenClaw 框架** | ✅ 无影响 | 只是扩展 plugin config 结构 |
| **技能实现** | ⚠️ 可选采用 | 技能可以选择读取新配置或使用硬编码值 |
| **项目迁移** | ✅ 平滑 | 旧项目不需要改 openclaw.json |

---

## 六、实施优先级

### Phase 1 - 核心 (必须)
1. ✅ 扩展 `openclaw.plugin.json` configSchema
2. ✅ 扩展 `ResearchMemoryPolicy` 接口
3. ✅ 更新 `normalizePolicy` 函数
4. ✅ 更新 SKILL.md 文档

### Phase 2 - 集成 (建议)
1. ⏳ 在 Researcher 的 `/idea-phase` 技能中读取 `ideaGeneration` 配置
2. ⏳ 在 Researcher 的 track 决策逻辑中读取 `trackPortfolio` 配置
3. ⏳ 在 Coder 的实验执行中读取 `computeBudget` 配置
4. ⏳ 在 Reviewer 的评审逻辑中读取 `reviewLoop` 配置

### Phase 3 - 增强 (可选)
1. 🔮 添加动态配置验证（如轨道数 vs 预算的一致性检查）
2. 🔮 添加配置冲突检测（如 maxActiveTracks > divergeSize）
3. 🔮 添加配置历史跟踪（记录每个项目的实际 config）

---

## 七、总结表

| 功能 | 当前 | 扩展后 | 位置 |
|------|------|--------|------|
| **项目根目录** | ❌ plugin config | ✅ plugin config | `openclaw.plugin.json` |
| **GPU 服务器** | ❌ plugin config | ✅ plugin config | `openclaw.plugin.json` |
| **IDEA 参数** | ❌ 无 | ✅ plugin config | `openclaw.plugin.json` |
| **轨道约束** | ❌ 无 | ✅ plugin config | `openclaw.plugin.json` |
| **计算预算** | ❌ 无 | ✅ plugin config | `openclaw.plugin.json` |
| **评审循环** | ❌ 无 | ✅ plugin config | `openclaw.plugin.json` |
| **图谱配置** | ❌ 无 | ✅ plugin config | `openclaw.plugin.json` |

---

**建议**：按 Phase 1 + Phase 2 的优先级实施，可以显著增强系统的可配置性和灵活性。
