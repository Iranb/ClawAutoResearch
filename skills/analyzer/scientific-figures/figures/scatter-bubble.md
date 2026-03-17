# 散点图与气泡图代码模板

## 1. 分组气泡图 (Grouped Bubble Chart)

**用途**：多组数据的 X-Y 分布，气泡大小表示第三维度数值，适合定性表达。两组坐标不同时可展示两类数据的分布相关性（如基因和细胞形态）。

**依赖**：`plotly`, `pandas`, `numpy`

```python
import numpy as np
import pandas as pd
import plotly.graph_objects as go

# 生成数据（可替换为 pd.read_csv）
n = 40
np.random.seed(6)
df = pd.DataFrame({
    "X": np.concatenate([np.random.normal(30, 8, n), np.random.normal(70, 13, n), np.random.normal(55, 15, n)]),
    "Y": np.concatenate([np.random.normal(60, 18, n), np.random.normal(90, 20, n), np.random.normal(50, 15, n)]),
    "S": np.concatenate([np.random.uniform(10, 100, n)] * 3),
    "Type": ["类型1"] * n + ["类型2"] * n + ["类型3"] * n
})
colors = {"类型1": "#d36a87", "类型2": "#619cf5", "类型3": "#e5c679"}

fig = go.Figure()
for type_name, group in df.groupby("Type"):
    color = colors.get(type_name, "#999999")
    # 主气泡
    fig.add_trace(go.Scatter(
        x=group["X"], y=group["Y"], mode="markers", name=type_name,
        marker=dict(size=group["S"]*12, sizemode="area", color=color, opacity=0.5,
                    line=dict(width=0, color="white")),
        customdata=group[["S"]],
        hovertemplate="X: %{x:.2f}<br>Y: %{y:.2f}<br>值: %{customdata[0]:.2f}<extra></extra>",
    ))
    # X轴投影线标记
    fig.add_trace(go.Scatter(
        x=[0]*len(group), y=group["Y"], mode="markers", showlegend=False, hoverinfo="skip",
        marker=dict(symbol="line-ew-open", size=30, color=color, opacity=1),
    ))
    # Y轴投影线标记
    fig.add_trace(go.Scatter(
        x=group["X"], y=[0]*len(group), mode="markers", showlegend=False, hoverinfo="skip",
        marker=dict(symbol="line-ns-open", size=30, color=color, opacity=1),
    ))

fig.update_layout(xaxis_title="X轴", yaxis_title="Y轴", width=1200, height=750)
fig.show()
```

---

## 2. 单轴分组气泡图 (Single-Axis Grouped Bubble)

**用途**：多组一维数据的数值大小与分布，气泡大小体现具体数值，适合展示多特征的协同变化。

**依赖**：`matplotlib`, `numpy`, `pandas`

```python
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import matplotlib.ticker as ticker
from matplotlib.lines import Line2D

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

# 生成数据
np.random.seed(2)
categories = ["data1", "data2", "data3", "data4", "data5"]
num_points = 20
category_colors = ["#d36a87", "#e5c679", "#83b6b5", "#619cf5", "#a596ee"]

rows = []
for idx, cat in enumerate(categories):
    for x, size in zip(np.random.uniform(0, 10, num_points), np.random.randint(10, 1500, num_points)):
        rows.append([cat, x, idx, size, category_colors[idx]])
df = pd.DataFrame(rows, columns=["category", "x", "y", "size", "color"])

fig, ax = plt.subplots(figsize=(8, 5), dpi=150)
for cat in df["category"].unique():
    sub = df[df["category"] == cat]
    ax.scatter(sub["x"], sub["y"], s=sub["size"], c=sub["color"], alpha=0.5, label=cat)

ax.set_yticks(range(len(categories)))
ax.set_yticklabels(categories)
ax.xaxis.set_major_locator(ticker.MultipleLocator(1))
ax.set_ylim(-0.5, len(categories))
ax.grid(axis='y')
ax.set_xlabel("Value")
ax.set_title("Single-axis Grouped Bubble Chart")

# 气泡大小图例
def make_legend_marker(color, label, size):
    return Line2D([0], [0], marker="o", color="#ffffff", markersize=size,
                  markerfacecolor=color, markeredgecolor="#ffffff", label=label)

legend = ax.legend(handles=[
    make_legend_marker("#aaaaaa", "Value=20", 8),
    make_legend_marker("#aaaaaa", "Value=250", 16),
    make_legend_marker("#aaaaaa", "Value=500", 24),
], loc="upper center", ncol=3)
legend.get_frame().set_edgecolor("#ffffff")
ax.add_artist(legend)
plt.tight_layout()
plt.savefig('./single_axis_bubble.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

---

## 3. 综合排序气泡图 (Ranked Performance Bubble)

**用途**：多方法在两个归一化指标上的综合性能对比，气泡大小表示综合得分。

**依赖**：`seaborn`, `matplotlib`, `pandas`, `adjustText`

```python
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
from adjustText import adjust_text

methods = ['Method-A', 'Method-B', 'Method-C', 'Method-D', 'Method-E', 'Method-F']
np.random.seed(42)
df = pd.DataFrame({
    'Method': methods,
    'PCC': np.random.uniform(0.6, 0.9, len(methods)),
    'RMSE': np.random.uniform(0.1, 0.3, len(methods))
})

# 归一化（PCC越高越好，RMSE越低越好）
df['Norm_PCC'] = (df['PCC'] - df['PCC'].min()) / (df['PCC'].max() - df['PCC'].min())
df['Norm_RMSE'] = 1 - (df['RMSE'] - df['RMSE'].min()) / (df['RMSE'].max() - df['RMSE'].min())
df['Score'] = (df['Norm_PCC'] + df['Norm_RMSE']) / 2

plt.rcParams.update({"font.sans-serif": ["Liberation Sans", "Arial"], "font.size": 14})
plt.style.use('seaborn-v0_8-whitegrid')
plt.figure(figsize=(10, 8))

ax = sns.scatterplot(x='Norm_PCC', y='Norm_RMSE', size='Score',
                     sizes=(200, 2000), hue='Method', data=df, legend=False, alpha=0.7)

texts = [plt.text(row['Norm_PCC'], row['Norm_RMSE'], row['Method'],
                  ha='center', va='center', fontsize=14, weight='bold')
         for _, row in df.iterrows()]
adjust_text(texts, arrowprops=dict(arrowstyle='-', color='k', lw=0.5))

plt.xlabel('Normalized PCC')
plt.ylabel('Normalized RMSE')
plt.xlim(-0.1, 1.1)
plt.ylim(-0.1, 1.1)
plt.tight_layout()
plt.savefig('./ranked_bubble.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

---

## 4. 趋势分布散点图 (Scatter with Trend Lines)

**用途**：散点图加拟合趋势线（线性/多项式/指数），同时展示投影标记。

**依赖**：`matplotlib`, `scipy`

```python
import numpy as np
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

def linear_fit(X, Y, color, ax):
    coeffs = np.polyfit(X, Y, 1)
    xs = np.linspace(X.min(), X.max(), 100)
    ax.plot(xs, np.poly1d(coeffs)(xs), color=color, linestyle="--", linewidth=3)

def polynomial_fit(X, Y, color, ax):
    coeffs = np.polyfit(X, Y, 2)
    xs = np.linspace(X.min(), X.max(), 100)
    ax.plot(xs, np.poly1d(coeffs)(xs), color=color, linestyle="--", linewidth=3)

def exponential_fit(X, Y, color, ax):
    def model(x, a, b, c): return a * np.exp(b * x) + c
    popt, _ = curve_fit(model, X, Y)
    xs = np.linspace(X.min(), X.max(), 100)
    ax.plot(xs, model(xs, *popt), color=color, linestyle="--", linewidth=3)

np.random.seed(42)
n = 80
colors = ["#e97a7a", "#5559d1", "#e5c679"]
Xs = [np.random.uniform(0, 10, n)] * 3
Ys = [
    2 * Xs[0] + 3 + np.random.normal(0, 5, n) + 10,
    1.5 * Xs[1]**2 - 10 * Xs[1] + 5 + np.random.normal(0, 10, n) + 80,
    2 * np.exp(0.3 * Xs[2]) + np.random.normal(0, 15, n) + 40,
]
labels = ["Linear Data", "Quadratic Data", "Exponential Data"]
fits = [linear_fit, polynomial_fit, exponential_fit]

fig, ax = plt.subplots(figsize=(10, 8))
for i in range(3):
    ax.scatter(Xs[i], Ys[i], s=100, c=colors[i], alpha=0.5, label=labels[i])
    ax.scatter(Xs[i], [-0.5]*n, marker="|", color=colors[i], alpha=0.5, s=300)
    ax.scatter([-0.5]*n, Ys[i], marker="_", color=colors[i], alpha=0.5, s=300)
    fits[i](Xs[i], Ys[i], colors[i], ax)

ax.legend(fontsize=14)
plt.tight_layout()
plt.savefig('./scatter_trend.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

---

## 5. 散点图 + 误差棒 (Scatter + Error Bar)

**用途**：展示多个算法/模型在两个指标上的均值和误差范围。

**依赖**：`matplotlib`, `pandas`, `numpy`

```python
import numpy as np
import matplotlib.pyplot as plt
import pandas as pd

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False
np.random.seed(42)

algorithms = ["Seurat", "CiteFuse", "TotalVI", "Tangram", "Scanpy", "CustomMethod"]
df = pd.DataFrame({
    "Algorithm": algorithms,
    "M1_mean": np.random.uniform(0.6, 0.9, 6),
    "M1_err": np.random.uniform(0.02, 0.08, 6),
    "M2_mean": np.random.uniform(0.5, 0.85, 6),
    "M2_err": np.random.uniform(0.03, 0.09, 6)
})

colors = ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4"]
markers = ["o", "s", "^", "D", "p", "*"]

fig, ax = plt.subplots(figsize=(6, 5))
for i, row in df.iterrows():
    ax.scatter(row["M1_mean"], row["M2_mean"], label=row["Algorithm"],
               color=colors[i], marker=markers[i], s=50,
               edgecolors='black', linewidth=0.8)
    ax.errorbar(row["M1_mean"], row["M2_mean"],
                xerr=row["M1_err"], fmt='none', ecolor=colors[i], elinewidth=1.2, capsize=3)
    ax.errorbar(row["M1_mean"], row["M2_mean"],
                yerr=row["M2_err"], fmt='none', ecolor=colors[i], elinewidth=1.2, capsize=3)

ax.set_xlabel("Metric 1 (e.g., ARI)")
ax.set_ylabel("Metric 2 (e.g., cASW)")
ax.set_title("Algorithm Performance Comparison")
ax.grid(True, linestyle=':', alpha=0.3)
ax.legend(bbox_to_anchor=(1.01, 1), loc='upper left', frameon=False)
plt.tight_layout()
plt.savefig('./scatter_errbar.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

---

## 6. 对比点图 (Comparison Dot Plot)

**用途**：少量方法在两个指标（FoE vs MAP）上的直接对比，带文本标注。

**依赖**：`matplotlib`

```python
import matplotlib.pyplot as plt
from matplotlib.ticker import FormatStrFormatter

methods = ['MethodA', 'MethodB', 'MethodC', 'MethodD', 'MethodE']
metric_x = [0.092, 0.075, 0.073, 0.072, 0.054]   # MAP (横轴)
metric_y = [48.0, 29.2, 28.9, 27.0, 10.3]         # FoE (纵轴)
colors = ['#E64B35B2', '#3C5488B2', '#00A087B2', '#91D1C2B2', '#D4B9DA']

plt.figure(figsize=(10, 6))
for method, x, y, color in zip(methods, metric_x, metric_y, colors):
    plt.scatter(x, y, label=method, color=color, s=200)
    plt.text(x + 0.0005, y - 0.6, method, fontsize=20, ha='left', color=color)

plt.xlabel('MAP', fontsize=24)
plt.ylabel('FoE', fontsize=24)
plt.xticks(fontsize=20)
plt.yticks(fontsize=20)
plt.gca().xaxis.set_major_formatter(FormatStrFormatter('%.3f'))
plt.grid(True, linestyle='--', linewidth=0.5, alpha=0.7)
plt.gca().set_axisbelow(True)
plt.gca().xaxis.set_major_locator(plt.MultipleLocator(0.01))
plt.gca().yaxis.set_major_locator(plt.MultipleLocator(10))
plt.tight_layout()
plt.savefig('./comparison_dot.pdf', dpi=300, bbox_inches='tight')
plt.show()
```
