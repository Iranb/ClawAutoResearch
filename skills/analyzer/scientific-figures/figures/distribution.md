# 分布图代码模板

## 1. 云雨图 (Raincloud Plot)

**用途**：同时展示多组数据的分布，结合箱线图（统计摘要）、半小提琴图（密度）、散点图（原始数据）。

**依赖**：`numpy`, `pandas`, `matplotlib`

```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# ==================== 数据准备 ====================
categories = ['A', 'B', 'C', 'D', 'E']
np.random.seed(42)
df = pd.DataFrame({
    cat: np.random.normal(loc=i*5, scale=2, size=50)
    for i, cat in enumerate(categories)
})

# ==================== 可视化设置 ====================
fig, ax = plt.subplots(figsize=(10, 8))
box_colors = violin_colors = ["#d36a87", "#ea9979", "#83b6b5", "#bcdfa7", "#a596ee"]
positions = np.arange(len(categories))
box_width = 0.15
violin_width = 0.5

# ==================== 绘制图形 ====================
for i, category in enumerate(categories):
    data_points = df[category].values

    # 箱线图
    box_pos = positions[i] - box_width / 100
    ax.boxplot(
        data_points, positions=[box_pos], widths=box_width,
        patch_artist=True, showfliers=False, notch=True,
        medianprops={'color': 'black', 'linewidth': 3},
        boxprops={'facecolor': box_colors[i], 'edgecolor': violin_colors[i], 'linewidth': 3},
        whiskerprops={'color': violin_colors[i], 'linewidth': 3},
        capprops={'color': violin_colors[i], 'linewidth': 3}
    )

    # 半小提琴图（截断左半侧）
    violin_pos = positions[i] + box_width / 50
    violin = ax.violinplot(
        data_points, positions=[violin_pos], widths=violin_width,
        showmeans=False, showmedians=False, showextrema=False
    )
    for pc in violin['bodies']:
        pc.set_facecolor(violin_colors[i])
        pc.set_edgecolor(violin_colors[i])
        pc.set_alpha(0.35)
        vertices = pc.get_paths()[0].vertices
        # 截断右半侧（只保留左半）
        vertices[:, 0] = np.where(vertices[:, 0] > violin_pos, vertices[:, 0], violin_pos)

    # 数据散点
    ax.scatter(
        np.random.normal(positions[i] - box_width, 0.04, len(data_points)),
        data_points, color=violin_colors[i], alpha=0.8, s=50,
        edgecolor='white', linewidth=0.8, zorder=3
    )

# ==================== 美化 ====================
ax.set_xticks(positions)
ax.set_xticklabels(categories, fontsize=20)
ax.set_ylabel('Value', fontsize=20)
ax.grid(axis='y', linestyle='--', alpha=0.7)
for spine in ['top', 'right', 'bottom', 'left']:
    ax.spines[spine].set_linewidth(2)
plt.title('Raincloud plots', pad=20, fontsize=22)
plt.tight_layout()
plt.savefig('./raincloud.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键参数**：
- `box_width`: 箱线图宽度（默认 0.15）
- `violin_width`: 小提琴宽度（默认 0.5）
- `vertices[:, 0] = np.where(...)`: 截断小提琴为半侧

---

## 2. 边际直方图 (Marginal Histogram / Joint Plot)

**用途**：展示两变量的联合分布，支持 hex/kde/reg/hist 多种模式。

**依赖**：`seaborn`, `matplotlib`, `pandas`, `numpy`

```python
import pandas as pd
import seaborn as sns
import numpy as np
import matplotlib.pyplot as plt

# 生成数据
np.random.seed(42)
n = 500
data = pd.DataFrame({
    "x": np.random.normal(loc=50, scale=10, size=n),
    "y": np.random.normal(loc=100, scale=20, size=n)
})

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

x, y = 'x', 'y'

# 1. 六边形分布 + KDE
sns.set(style="white", font_scale=2.0,
        rc={"axes.linewidth": 2, "axes.edgecolor": "black"})
g = sns.jointplot(x=x, y=y, data=data, color='#843efe',
                  marginal_kws=dict(bins=30, kde=True, color='#843efe'),
                  kind='hex', joint_kws={'gridsize': 30})
g.fig.set_size_inches(12, 10)
plt.show()

# 2. KDE 联合分布
g = sns.jointplot(x=x, y=y, data=data, color='#8835cf',
                  kind='kde',
                  marginal_kws=dict(fill=True, color='#843efe'),
                  joint_kws={'shade': True, 'linewidths': 0.5})
g.fig.set_size_inches(12, 10)
plt.show()

# 3. 带回归线散点图
g = sns.jointplot(x=x, y=y, data=data, color='#7a57be', kind='reg')
g.fig.set_size_inches(12, 10)
plt.show()

# 4. 等高线 KDE
g = sns.jointplot(x=x, y=y, data=data, color='#a67eb7', kind='kde', levels=12, linewidths=3)
g.ax_marg_x.lines[0].set_linewidth(3)
g.ax_marg_y.lines[0].set_linewidth(3)
g.fig.set_size_inches(12, 10)
plt.show()

# 5. 直方图联合分布
g = sns.jointplot(x=x, y=y, data=data, color='#a6569d', kind='hist')
g.fig.set_size_inches(12, 10)
plt.savefig('./marginal_hist.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**`kind` 选项**：`hex` | `kde` | `reg` | `hist` | `scatter`

---

## 3. 椭圆散点图 (PCA Scatter with Confidence Ellipses)

**用途**：PCA 降维后分组散点图，用置信椭圆描述各组分布范围。

**依赖**：`matplotlib`, `sklearn`, `numpy`, `pandas`

```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.datasets import load_iris
from sklearn.decomposition import PCA
from matplotlib.patches import Ellipse
from matplotlib.colors import to_rgba

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

colors = {
    "setosa": "#e97a7a",
    "versicolor": "#5559d1",
    "virginica": "#e5c679"
}

def draw_ellipse(sub_df, ax, n_std=2.0, color="black"):
    """绘制 n_std 标准差的置信椭圆"""
    cov = np.cov(sub_df["PC1"], sub_df["PC2"])
    mean = sub_df[["PC1", "PC2"]].mean().values
    vals, vecs = np.linalg.eigh(cov)
    order = vals.argsort()[::-1]
    vals, vecs = vals[order], vecs[:, order]
    theta = np.degrees(np.arctan2(*vecs[:, 0][::-1]))
    width, height = 2 * n_std * np.sqrt(vals)
    ellip = Ellipse(
        xy=mean, width=width, height=height, angle=theta,
        edgecolor=to_rgba(color, alpha=0.75),
        facecolor=to_rgba(color, alpha=0.2),
        linewidth=2,
    )
    ax.add_patch(ellip)

# 加载 Iris 数据并做 PCA
iris = load_iris()
pca = PCA(n_components=2)
X_pca = pca.fit_transform(iris.data)
df = pd.DataFrame({
    "PC1": X_pca[:, 0],
    "PC2": X_pca[:, 1],
    "Category": [iris.target_names[i] for i in iris.target]
})

fig, ax = plt.subplots()
x_min = df["PC1"].min() - 0.3
y_min = df["PC2"].min()

for category in df["Category"].unique():
    subset = df[df["Category"] == category]
    c = colors[category]
    # 主散点
    ax.scatter(subset["PC1"], subset["PC2"], label=category, color=c, s=100, alpha=0.5)
    # X轴投影（竖线标记）
    ax.scatter(subset["PC1"], [y_min] * len(subset), marker="|", c=c, alpha=0.5, s=500)
    # Y轴投影（横线标记）
    ax.scatter([x_min] * len(subset), subset["PC2"], marker="_", c=c, alpha=0.5, s=500)
    # 置信椭圆
    draw_ellipse(subset.rename(columns={"PC1": "PC1", "PC2": "PC2"}), ax, n_std=2.0, color=c)

ax.set_xlabel("Principal Component 1")
ax.set_ylabel("Principal Component 2")
ax.legend()
plt.tight_layout()
plt.savefig('./pca_ellipse.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键参数**：
- `n_std=2.0`: 椭圆覆盖范围（2σ ≈ 95%）
- 替换 `load_iris()` 为自定义数据时，需保证 DataFrame 包含 `PC1`, `PC2`, `Category` 列
