# 柱状图与极坐标图代码模板

## 1. 堆叠柱状图 (Stacked Bar Chart)

**用途**：同时展示多组数据的绝对数量和各组占比，适合有组合关系的数据（如不同地区经济数据、多能源碳排放）。

**依赖**：`matplotlib`, `numpy`

```python
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

fig, ax = plt.subplots(figsize=(8, 5), dpi=100)

sublabel = ["Data 1", "Data 2", "Data 3"]
color = ["#8e93af", "#d7a6b3", "#edd9ba", "#9dc1c5"]

# 替换为实际数据，shape: (n_samples, n_groups)
x = np.arange(10)
np.random.seed(2)
value = np.random.randint(10, 200, size=(10, 3))
bottom_values = np.zeros(10)

for i in range(len(sublabel)):
    ax.bar(x, value[:, i], width=0.7, color=color[i],
           label=sublabel[i], bottom=bottom_values, zorder=2)
    bottom_values += value[:, i]

ax.grid(axis='y', linestyle='-', linewidth=1.5, color="#ffffff", zorder=1)

# 交替背景色
yticks = ax.get_yticks()
for i in range(len(yticks) - 1):
    if i % 2 == 1:
        ax.axhspan(yticks[i], yticks[i + 1], facecolor="#f6f8fb")

ax.text(0.015, 0.975, "Stacked Bar Chart", fontsize=14, fontweight="bold",
        ha="left", va="top", transform=ax.transAxes)
ax.legend(ncols=4, loc="upper right", handleheight=1, handlelength=1)

plt.tight_layout()
plt.savefig('./stacked_bar.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键技巧**：
- `bottom=bottom_values` + 累加：实现堆叠效果
- `ax.axhspan()`: 交替背景条纹

---

## 2. 径向柱状图 (Radial / Polar Bar Chart)

**用途**：周期性数据展示（如一天内24小时的数据变化），或多方向分布数据，是普通柱状图的极坐标变体。

**依赖**：`matplotlib`, `numpy`

```python
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

values = [20, 27, 16, 17, 16, 22, 24, 26, 30, 22, 18, 24,
          17, 14, 23, 17, 20, 18, 14, 18, 21, 13, 14, 20]
count = len(values)
angles = np.linspace(0, 2 * np.pi, count, endpoint=False)

fig, ax = plt.subplots(figsize=(8, 5), subplot_kw={"projection": "polar"}, dpi=150)

# 根据值范围着色
colors = []
for v in values:
    if v < 15:
        colors.append("#9dc1c5")   # Below normal
    elif v > 25:
        colors.append("#d7a6b3")   # Above normal
    else:
        colors.append("#8e93af")   # Normal

bars = ax.bar(angles, values, width=2 * np.pi / count, bottom=10,
              color=colors, edgecolor="#f1f5f9", linewidth=1, zorder=2)

# 在每个条顶部添加数值标签
for bar, angle, value in zip(bars, angles, values):
    rotation = np.degrees(angle)
    ha = "right" if 90 < rotation < 270 else "left"
    rotation = rotation - 180 if 90 < rotation < 270 else rotation
    ax.text(angle, value + 7, f"{int(value)}", ha=ha, va="center",
            fontsize=8, fontweight="bold", rotation=rotation,
            rotation_mode="anchor", color="#ffffff", zorder=4)

# 图例
handles = [
    mpatches.Patch(color="#9dc1c5", label="Below Normal"),
    mpatches.Patch(color="#8e93af", label="Normal"),
    mpatches.Patch(color="#d7a6b3", label="Above Normal"),
]
fig.legend(handles=handles, loc="center right", handleheight=1, handlelength=1, ncols=3)

ax.set_yticks([])
ax.set_xticks(angles)
ax.set_xticklabels(range(count))
ax.tick_params(axis="x", labelsize=8, pad=-5)
ax.grid(axis="x", linestyle="--", linewidth=0.5, color="#8e93af", alpha=0.5, zorder=1)
fig.text(x=0.68, y=0.55, s="Radial Bar Chart", fontdict={"size": 28, "weight": "bold"})

plt.tight_layout()
plt.subplots_adjust(right=0.65)
plt.savefig('./radial_bar.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键参数**：
- `bottom=10`: 基准半径，避免柱从原点出发（视觉上更美观）
- `subplot_kw={"projection": "polar"}`: 极坐标投影

---

## 3. 玫瑰图 (Rose Chart / Polar Area Chart)

**用途**：特殊饼图，扇形的角度和半径都表达数值，适合对比多类别数值（可替代柱状图，展示不同模型性能差距）。

**依赖**：`matplotlib`, `numpy`

```python
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

labels = ["Type 1", "Type 2", "Type 3", "Type 4", "Type 5",
          "Type 6", "Type 7", "Type 8", "Type 9"]
values = np.array([30, 35, 40, 45, 50, 55, 60, 65, 70])

# 计算角度范围
width = 2 * np.pi * values / sum(values)
color = ["#dc9eb5", "#e3d0d7", "#b0a3c0"] * 3  # 循环配色

fig, ax = plt.subplots(subplot_kw={"projection": "polar"}, figsize=(8, 5), dpi=150)

start_x = 0
for i in range(len(values)):
    start_x += 0.5 * width[i]
    ax.bar(start_x, values[i], width=width[i], bottom=10.0,
           linewidth=2, edgecolor="#ffffff", color=color[i])
    
    # 标签文本
    label = f"{labels[i]}\n{width[i]/np.pi*100:.1f}% | {values[i]}"
    text = ax.text(start_x, values[i] * 0.75 + 10, label,
                   color="#ffffff", fontsize=8,
                   ha="center", va="center", fontweight="bold")
    text.set_bbox(dict(facecolor="#75879655", edgecolor="none", boxstyle="round,pad=0.5"))
    start_x += 0.5 * width[i]

ax.set_yticklabels([])
ax.set_xticklabels([])
ax.set_rticks([])
ax.set_xticks([])
ax.set_theta_direction(1)    # 逆时针
ax.set_theta_offset(np.pi * 0.5)  # 从顶部开始

plt.subplots_adjust(left=0.3, right=1.0, top=1, bottom=-0.1)
plt.savefig('./rose_chart.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键技巧**：
- `bottom=10.0`: 从半径 10 处开始画，形成玫瑰状（中心空洞）
- `start_x += 0.5 * width[i]` 前后各加一次：将柱中心对齐累积位置
