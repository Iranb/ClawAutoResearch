# 趋势与折线图代码模板

## 1. 折线图 (Line Chart)

**用途**：多方法/模型在一系列指标上的性能比较曲线，支持不同标记符号区分方法。

**依赖**：`matplotlib`, `numpy`

```python
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

# 数据：方法 × 指标
positions = ['Recall@1', 'Recall@3', 'Recall@5', 'Recall@10']
methods_data = {
    'MethodA': [0.041, 0.087, 0.121, 0.182],
    'MethodB': [0.032, 0.071, 0.108, 0.155],
    'MethodC': [0.032, 0.062, 0.093, 0.134],
    'MethodD': [0.021, 0.053, 0.080, 0.119],
    'MethodE': [0.018, 0.050, 0.072, 0.117],
    'Baseline': [0.009, 0.029, 0.049, 0.099],
}
colors = ['#E64B35B2', '#3C5488B2', '#00A087B2', '#91D1C2B2', '#D4B9DA', "#78617E"]
markers_list = ['s', 'o', '^', 'd', 'v', '+']

plt.figure(figsize=(10, 6))
for i, (name, values) in enumerate(methods_data.items()):
    plt.plot(positions, values, marker=markers_list[i], linestyle='-',
             color=colors[i], label=name, markersize=12)

plt.title('Performance Comparison', fontsize=26)
plt.xlabel('Metric', fontsize=24)
plt.ylabel('Score', fontsize=24)
plt.grid(True, linestyle='--', alpha=0.7)

legend = plt.legend(fontsize=18)
for text, color in zip(legend.get_texts(), colors):
    text.set_color(color)

plt.xticks(fontsize=20)
plt.yticks(fontsize=20)
plt.tight_layout()
plt.savefig('./line_chart.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键技巧**：
- 图例文字颜色与对应线条颜色一致（`text.set_color(color)`）
- `markers_list` 中的标记：`'s'`(方形), `'o'`(圆), `'^'`(三角), `'d'`(菱形), `'v'`(倒三角), `'+'`(加号)

---

## 2. 多变量变化趋势图 (Multi-Variable Trend / Overlapping Area Chart)

**用途**：多个变量随时间（或其他连续变量）的变化趋势，面积填充+折线叠加，直观展示各变量的相对大小和趋势。适合展示不同变量随某因素的协同变化。

**依赖**：`matplotlib`, `pandas`, `numpy`

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["font.size"] = 10

# 自定义样式
plt.rcParams["grid.color"] = "#fed2d2"
plt.rcParams["figure.facecolor"] = "#ffffff"
plt.rcParams["axes.facecolor"] = "#f1f5f9"
plt.rcParams["axes.edgecolor"] = "#ffffff"
plt.rcParams["axes.labelcolor"] = "#515a85"
plt.rcParams["axes.labelweight"] = "bold"
plt.rcParams["text.color"] = "#515a85"
plt.rcParams["xtick.color"] = "#515a85"
plt.rcParams["ytick.color"] = "#515a85"

# ---- 生成数据（替换为真实数据）----
# 真实数据格式：pivoted DataFrame，行=时间，列=各变量
groups = ["GroupA", "GroupB", "GroupC", "GroupD", "GroupE"]
x_values = np.arange(1960, 2016)
np.random.seed(42)

data = {}
for i, g in enumerate(groups):
    base = (i + 1) * 1e11
    trend = np.cumsum(np.random.normal(5e9, 1e9, len(x_values)))
    data[g] = base + trend

df_pivot = pd.DataFrame(data, index=x_values)

# ---- 绘图 ----
fig, ax = plt.subplots(figsize=(10, 6), dpi=120)
color = ["#2e86ab", "#a23b72", "#f18f01", "#c73e1d", "#6a994e"]

zorder = 1
for idx, group in enumerate(groups):
    # 面积填充（半透明）
    ax.fill_between(df_pivot.index, df_pivot[group] * 1e-12,
                    alpha=0.3, zorder=zorder - 1, color=color[idx], label=group)
    # 折线（清晰显示）
    ax.plot(df_pivot.index, df_pivot[group] * 1e-12,
            zorder=zorder, color=color[idx], linewidth=2)
    # 在线末端添加标签
    last_x = df_pivot.index[-1]
    last_y = df_pivot[group].iloc[-1] * 1e-12
    ax.text(last_x + 0.5, last_y, group, ha="left", va="center",
            color=color[idx], fontweight="bold", fontsize=9)
    zorder += 2

ax.set_ylabel("Value (Trillion)")
ax.set_xlabel("Year")
ax.set_title("Multi-Variable Trend Chart", fontsize=18, x=0.065, y=0.85,
             ha="left", va="top")
ax.set_xlim(df_pivot.index[0], df_pivot.index[-1] + 5)
ax.set_ylim(0)
ax.legend(loc="upper left", bbox_to_anchor=(0.05, 0.80), ncols=3)

plt.tight_layout()
plt.savefig('./multi_trend.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键技巧**：
- `fill_between()`: 面积填充，`alpha=0.3` 保持半透明
- `zorder` 管理：面积在折线下方（`zorder-1`），折线在面积上方
- 末端标签：在最后一个数据点右侧用 `ax.text()` 添加组名
- `* 1e-12`: 单位换算（如换为万亿），根据实际数据调整
