# 相关性图代码模板

## 1. 热力图 (Heatmap)

**用途**：展示参数网格搜索结果、相关系数矩阵、超参数性能对比。

**依赖**：`seaborn`, `matplotlib`, `pandas`

```python
import seaborn as sns
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]

# 数据格式：三列 (row_param, col_param, value)
data = {
    'λ_2': [1]*5 + [10]*5 + [100]*5,
    'λ_3': [1, 10, 100, 1000, 10000] * 3,
    'performance': [0.082, 0.086, 0.084, 0.085, 0.081,
                    0.085, 0.087, 0.088, 0.085, 0.088,
                    0.090, 0.091, 0.089, 0.090, 0.088]
}
df = pd.DataFrame(data)
pivot_df = df.pivot_table(values='performance', index='λ_2', columns='λ_3')

# 颜色方案
custom_cmap = sns.cubehelix_palette(start=0.5, rot=-0.75, light=0.85, dark=0.35, as_cmap=True)

plt.figure(figsize=(10, 8))
heatmap = sns.heatmap(pivot_df, annot=True, cmap=custom_cmap, annot_kws={"size": 16})

plt.title('Performance Heatmap', fontsize=24)
plt.xlabel('λ₃', fontsize=26)
plt.ylabel('λ₂', fontsize=26)
plt.xticks(fontsize=16)
plt.yticks(fontsize=16)

cbar = heatmap.collections[0].colorbar
cbar.ax.tick_params(labelsize=16)

plt.tight_layout()
plt.savefig('./heatmap.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**颜色方案候选**：
```python
# cubehelix（渐变，适合连续数据）
cmap = sns.cubehelix_palette(start=0.5, rot=-0.75, light=0.85, dark=0.35, as_cmap=True)
# diverging（发散，适合有正负的相关系数）
cmap = sns.diverging_palette(220, 20, as_cmap=True)
# 自定义蓝-红发散
from matplotlib.colors import LinearSegmentedColormap
import matplotlib.pyplot as plt
red = plt.cm.Reds(np.linspace(0.3, 1, 256))
blue = plt.cm.Blues(np.linspace(1, 0.3, 256))
cmap = LinearSegmentedColormap.from_list('br', np.vstack((blue, red)))
```

---

## 2. 相关性网络热图 (Correlation Network Heatmap)

**用途**：多变量相关性矩阵（右上三角方块图）+ 物种/分类与特征的连接线（左侧）。生物信息领域常用于物种-环境因子相关性分析。

**依赖**：`matplotlib`, `numpy`

```python
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import matplotlib.lines as mlines
import matplotlib.colors as mcolors

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

def gradient_color(min_val, max_val, hex_colors, value):
    """在颜色列表间插值"""
    if max_val == min_val:
        return hex_colors[len(hex_colors) // 2]
    norm = np.clip((value - min_val) / (max_val - min_val), 0, 1)
    idx = int(norm * (len(hex_colors) - 1))
    c1, c2 = mcolors.hex2color(hex_colors[idx]), mcolors.hex2color(hex_colors[min(idx+1, len(hex_colors)-1)])
    interp = [(1 - norm % 1) * s + (norm % 1) * e for s, e in zip(c1, c2)]
    return mcolors.to_hex(interp)

def p_to_color(p):
    """p值转颜色：<0.01金色, <0.05蓝绿, 其他灰"""
    return "#e4c696" if p < 0.01 else "#69a1a7" if p < 0.05 else "#c7c7c7"

def r_to_width(r):
    """r值转线宽"""
    return 1.0 if r < 0.2 else 2.0 if r < 0.4 else 4.0

np.random.seed(10)
feature_labels = "N P K Ca Mg S Al Fe Mn Zn Mo pH".split()
n = len(feature_labels)
spec_labels = ["spec1", "spec2", "spec3"]

pearson_data = np.random.uniform(-1, 1, (n, n))
np.fill_diagonal(pearson_data, 1)
p_data = np.random.beta(0.8, 5, (len(spec_labels), n))
r_data = np.random.uniform(-1, 1, (len(spec_labels), n))

fig, ax = plt.subplots(figsize=(12, 10))

# 绘制相关性矩阵方块（右上三角）
pearson_colors = ["#515a85", "#ecf4f8", "#c0627a"]
for i in range(n):
    for j in range(i, n):
        size = pearson_data[i, j]
        color = gradient_color(-1, 1, pearson_colors, size)
        # 背景方块
        ax.add_patch(patches.Rectangle((n-i-1, j), 1, 1, lw=0.25,
                                        edgecolor="#999999", facecolor="#ffffff"))
        # 填充方块（大小与相关系数绝对值成比例）
        s = abs(size)
        ax.add_patch(patches.Rectangle((n-i-0.5-s/2, j+0.5-s/2), s, s,
                                        lw=0.5, edgecolor="#999999", facecolor=color))

# 绘制特征标签
for i, label in enumerate(feature_labels):
    ax.text(0.5 + i, 0.5 + n, label, va="center", ha="center", fontsize=8)
    ax.text(n + 0.5, n - i - 0.5, label, va="center", ha="center", fontsize=8)

# 物种-特征连接线（左侧）
spec_y_positions = np.linspace(0, n, len(spec_labels) + 2).tolist()
for i, spec in enumerate(spec_labels):
    ax.text(spec_y_positions[i+1] - 4.5, spec_y_positions[-2-i] - 3.5,
            spec, va="center", ha="center")
    for j in range(n):
        ax.plot([spec_y_positions[i+1] - 4, -0.5 + j],
                [spec_y_positions[-2-i] - 3, n - j - 0.5],
                linestyle="--", linewidth=r_to_width(r_data[i, j]),
                color=p_to_color(p_data[i, j]), zorder=1/p_data[i, j],
                marker="o", markersize=4)

ax.set_xlim(-5, n + 1)
ax.set_ylim(-4, n + 1.5)
ax.set_aspect('equal')
ax.axis('off')

# 图例
legend_handles = [
    mlines.Line2D([], [], color="#e4c696", linewidth=2, label="p < 0.01"),
    mlines.Line2D([], [], color="#69a1a7", linewidth=2, label="p < 0.05"),
    mlines.Line2D([], [], color="#c7c7c7", linewidth=2, label="p ≥ 0.05"),
]
ax.legend(handles=legend_handles, loc="lower left", frameon=False)

plt.tight_layout()
plt.savefig('./correlation_network.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

---

## 3. 相关性网络热图_蝴蝶图 (Butterfly Correlation Heatmap)

**用途**：两个相关性矩阵（A和B）蝴蝶布局展示，中间通过 Mantel 检验连线连接第三变量 C 与 A、B 的关系。

**依赖**：`seaborn`, `matplotlib`, `scipy`, `pandas`

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.spatial.distance import pdist, squareform
from scipy.stats import pearsonr
from itertools import product
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import ConnectionPatch

np.random.seed(0)

# 数据
A = pd.DataFrame(np.random.rand(10, 10), columns=[f'A{i}' for i in range(10)])
B = pd.DataFrame(np.random.rand(10, 10), columns=[f'B{i}' for i in range(10)])
C = pd.DataFrame(np.random.rand(10, 4),  columns=[f'C{i}' for i in range(4)])

# 相关性矩阵
corr_A = A.corr()
corr_B = B.corr()

# 自定义蓝-红颜色映射
red_colors  = plt.cm.Reds(np.linspace(0.3, 1, 256))
blue_colors = plt.cm.Blues(np.linspace(1, 0.3, 256))
cmap = LinearSegmentedColormap.from_list('custom', np.vstack((blue_colors, red_colors)))
norm = plt.Normalize(-1, 1)

# Mantel 检验
def mantel(x, y):
    x_flat = x[np.triu_indices_from(x, k=1)]
    y_flat = y[np.triu_indices_from(y, k=1)]
    r_obs, _ = pearsonr(x_flat, y_flat)
    greater = sum(abs(pearsonr(x_flat, np.random.permutation(y_flat))[0]) >= abs(r_obs)
                  for _ in range(999))
    return r_obs, (greater + 1) / 1000

dist_C = [squareform(pdist(C[[col]])) for col in C.columns]
dist_A = [squareform(pdist(A[[col]])) for col in A.columns]
dist_B = [squareform(pdist(B[[col]])) for col in B.columns]

mantel_CA = [mantel(dc, da) for dc, da in product(dist_C, dist_A)]
mantel_CA_r = np.array([x[0] for x in mantel_CA]).reshape(len(C.columns), len(A.columns))
mantel_CA_p = np.array([x[1] for x in mantel_CA]).reshape(len(C.columns), len(A.columns))
mantel_CB = [mantel(dc, db) for dc, db in product(dist_C, dist_B)]
mantel_CB_r = np.array([x[0] for x in mantel_CB]).reshape(len(C.columns), len(B.columns))
mantel_CB_p = np.array([x[1] for x in mantel_CB]).reshape(len(C.columns), len(B.columns))

def color_p(p):
    if p <= 0.001: return "#45943b"
    elif p <= 0.01: return "#625c82"
    elif p <= 0.05: return "#b7b426"
    else: return "#d4d3d1"

def draw_link(axA, axB, p1, p2, r_val, p_val):
    lw = 4.0 if abs(r_val) > 0.5 else 2.5 if abs(r_val) >= 0.25 else 1.5
    rad = -0.15 if r_val >= 0 else 0.15
    con = ConnectionPatch(
        xyA=p1, coordsA=axA.transData,
        xyB=p2, coordsB=axB.transData,
        arrowstyle="-", lw=lw, color=color_p(p_val),
        linestyle='-' if r_val >= 0 else '--',
        connectionstyle=f"arc3,rad={rad}", alpha=1, zorder=0
    )
    axA.add_artist(con)

# 绘图
fig, ax = plt.subplots(figsize=(16, 10))
ax.axis('off')
left_ax  = fig.add_axes([0.07, 0.0, 0.4, 0.8])
right_ax = fig.add_axes([0.53, 0.2, 0.4, 0.8])
mid_ax   = fig.add_axes([0.45, 0.1, 0.1, 0.8])

mask_A = np.triu(np.ones_like(corr_A, dtype=bool))
sns.heatmap(corr_A, mask=mask_A, annot=True, fmt=".2f", cmap=cmap, norm=norm,
            square=True, cbar=False, ax=left_ax)
mask_B = np.tril(np.ones_like(corr_B, dtype=bool))
sns.heatmap(corr_B, mask=mask_B, annot=True, fmt=".2f", cmap=cmap, norm=norm,
            square=True, cbar=False, ax=right_ax)
right_ax.xaxis.tick_top()
right_ax.xaxis.set_label_position('top')
right_ax.yaxis.tick_right()
right_ax.yaxis.set_label_position('right')

# 连线
nA, nB, nC = len(A.columns), len(B.columns), len(C.columns)
points_A = [(j, j) for j in range(nA)]
points_B = [(j, j) for j in range(nB)]
points_C = [(i/(nC-1), 1 - i/(nC-1)) for i in range(nC)]
offset = 0.15

for (x, y), feat in zip(points_A, A.columns):
    left_ax.plot(x, y, marker="*", color="#435ca2", markersize=12, zorder=1)
for (x, y), feat in zip(points_B, B.columns):
    right_ax.plot(x, y, marker="*", color="#435ca2", markersize=12, zorder=1)
for (x, y), feat in zip(points_C, C.columns):
    mid_ax.text(x, y, feat, ha="center", va='bottom', fontsize=14)

for i, c_feat in enumerate(C.columns):
    for j, a_feat in enumerate(A.columns):
        r, p = mantel_CA_r[i, j], mantel_CA_p[i, j]
        if not np.isnan(r):
            draw_link(left_ax, mid_ax, points_A[j], (points_C[i][0]-offset, points_C[i][1]), r, p)
    for j, b_feat in enumerate(B.columns):
        r, p = mantel_CB_r[i, j], mantel_CB_p[i, j]
        if not np.isnan(r):
            draw_link(right_ax, mid_ax, points_B[j], (points_C[i][0]+offset, points_C[i][1]+offset), r, p)

mid_ax.set_aspect('equal')
mid_ax.axis("off")
plt.savefig('./butterfly_correlation.pdf', dpi=200, bbox_inches='tight')
plt.show()
```

---

## 4. 弦图 (Chord Diagram)

**用途**：展示多变量/多基因之间的关联强度，弧线粗细表示关联权重。

**依赖**：`pycirclize`, `pandas`, `numpy`

```python
from pycirclize import Circos
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

# 标签和颜色
labels = ["Gene A", "Gene B", "Gene C", "Gene D", "Gene E",
          "Gene F", "Gene G", "Gene H", "Gene I", "Gene J"]
color_map = ["#214e81", "#c0627a"] * 5
cmap = {label: color_map[i] + "77" for i, label in enumerate(labels)}

# 生成关联矩阵（替换为真实数据）
np.random.seed(2)
def gen_matrix(size, min_v, max_v, large_prob=0.2):
    m = np.zeros((size, size))
    for i in range(size):
        for j in range(size):
            if i != j:
                if np.random.rand() < large_prob:
                    m[i][j] = np.random.uniform(max_v*0.95, max_v)
                else:
                    m[i][j] = np.random.uniform(min_v, max_v*0.1)
    return m

interaction_df = pd.DataFrame(gen_matrix(10, 1, 500), index=labels, columns=labels)

# 绘制弦图
circos = Circos.initialize_from_matrix(
    interaction_df,
    space=3,
    r_lim=(63, 70),
    cmap=cmap,
    ticks_interval=500,
    label_kws=dict(r=64, size=6, color="#ffffff", fontweight="bold"),
    ticks_kws=dict(line_kws=dict(ec="#597cab"), text_kws=dict(weight="bold"), label_size=6),
    link_kws=dict(alpha=0.4),
)
for sector in circos.sectors:
    sector.tracks[0].axis(ec="#ffffff", lw=1.5)

fig = circos.plotfig(figsize=(8, 5), dpi=150)
plt.tight_layout()
plt.subplots_adjust(left=0.33, right=1, top=1, bottom=0)
plt.savefig('./chord_diagram.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**安装**：`pip install pycirclize`
