# 特殊图表与配色代码模板

## 1. 雷达图 (Radar / Spider Chart)

**用途**：多维度性能对比，支持三角形/五边形/六边形等形状，适合论文中模型综合能力对比。

**依赖**：`matplotlib`, `numpy`

### 1a. 三角形雷达图（3个维度）

```python
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]

methods = ['MethodA', 'MethodB', 'MethodC', 'MethodD']
categories = ['Dataset1', 'Dataset2', 'Dataset3']
values = np.array([
    [41.3, 25.9, 14.9],
    [26.3, 23.4, 10.2],
    [23.4, 22.8, 13.1],
    [21.5, 17.5,  9.3]
])

# 归一化
max_values = values.max(axis=0)
min_values = values.min(axis=0)
adjusted_min = min_values * 0.9
normalized = (values - adjusted_min) / (max_values - adjusted_min)

num_vars = len(categories)
angles = np.linspace(0, 2*np.pi, num_vars, endpoint=False).tolist()
# 使一个顶点朝上
angles = [(a + np.pi/2) % (2*np.pi) for a in angles]
angles += angles[:1]

colors = ['#E64B35B2', '#3C5488B2', '#00A087B2', '#91D1C2B2']

fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(polar=True), dpi=150)
ax.set_facecolor('white')
ax.grid(color='grey', linestyle='--', linewidth=1.2, alpha=0.6)

for i, method in enumerate(methods):
    data = normalized[i].tolist() + [normalized[i][0]]
    lw = 3 if i == 0 else 2
    ax.plot(angles, data, linewidth=lw, linestyle='solid', color=colors[i], label=method)
    ax.fill(angles, data, color=colors[i], alpha=0.2)

ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
ax.set_yticklabels(['20%','30%','50%','70%','100%'], fontsize=16, color='grey')
ax.set_xticks(angles[:-1])
ax.set_xticklabels(categories, fontsize=22, fontweight='bold')
plt.legend(loc='center left', bbox_to_anchor=(1.05, 0.5), fontsize=16)
plt.tight_layout()
plt.savefig('./radar_triangle.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

### 1b. 五边形雷达图（5个维度）

```python
import numpy as np
import matplotlib.pyplot as plt
from math import pi

methods = ['MethodA', 'MethodB', 'MethodC', 'MethodD', 'MethodE']
datasets = ['DS1', 'DS2', 'DS3', 'DS4', 'DS5']
performance = np.array([
    [0.193, 0.141, 0.178, 0.188, 0.182],
    [0.094, 0.097, 0.124, 0.089, 0.162],
    [0.087, 0.010, 0.113, 0.092, 0.163],
    [0.081, 0.095, 0.102, 0.074, 0.142],
    [0.151, 0.112, 0.128, 0.144, 0.233]
])

max_v, min_v = performance.max(axis=0), performance.min(axis=0)
norm_perf = (performance - min_v) / (max_v - min_v)

angles = np.linspace(0, 2*pi, len(datasets), endpoint=False).tolist()
angles += angles[:1]

colors = ['#E64B35B2', '#3C5488B2', '#00A087B2', '#91D1C2B2', '#D4B9DA']

fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(polar=True), dpi=150)
ax.set_facecolor((0.9, 0.9, 0.9, 0.2))
ax.grid(color='grey', linestyle='--', linewidth=0.6, alpha=0.3)

for i, method in enumerate(methods):
    vals = norm_perf[i].tolist() + [norm_perf[i][0]]
    ax.plot(angles, vals, linewidth=1.5, color=colors[i], label=method, alpha=0.8)
    ax.fill(angles, vals, color=colors[i], alpha=0.15)

ax.set_theta_offset(pi / 2)
ax.set_theta_direction(-1)
ax.set_xticks(angles[:-1])
ax.set_xticklabels(datasets, fontsize=20)
ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
ax.set_yticklabels(['20%','40%','60%','80%','100%'], fontsize=12, color='grey')
plt.legend(loc='upper right', bbox_to_anchor=(0.1, 0.1), fontsize=16)
plt.tight_layout()
plt.savefig('./radar_pentagon.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键注意**：
- 数据首尾需闭合：`data += data[:1]`, `angles += angles[:1]`
- `set_theta_offset(pi/2)`: 从顶部开始
- `set_theta_direction(-1)`: 顺时针排列

---

## 2. 环形蜂窝条形图 (Ring Beeswarm + SHAP Bar)

**用途**：可视化机器学习模型的特征重要性（SHAP 值），结合极坐标条形图（全局重要性）和散点蜂窝图（个体 SHAP 值分布）。

**依赖**：`matplotlib`, `numpy`, `pandas`, `shap`, `sklearn`

```python
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.cm import ScalarMappable
import shap
from sklearn.ensemble import RandomForestRegressor

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]

# 准备数据（替换为实际数据）
np.random.seed(42)
n_samples = 100
data = pd.DataFrame({f'F{i}': np.random.normal(i, 1, n_samples) for i in range(1, 11)})
data['target'] = np.random.normal(2, 1, n_samples)
target = "target"
X, y = data.drop(columns=target), data[target]

# 训练模型并计算 SHAP
model = RandomForestRegressor(random_state=42)
model.fit(X, y)
explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X)
feats = X.columns.tolist()

# 特征重要性（平均绝对 SHAP）
importance = {f: np.abs(shap_values[:, i]).mean() for i, f in enumerate(feats)}
sorted_feats = sorted(importance, key=importance.get, reverse=True)
sorted_vals = [importance[f] for f in sorted_feats]

# 配色
bar_cmap = LinearSegmentedColormap.from_list("bar", ["#a0d7fd", "#42abf4"])
shap_cmap = LinearSegmentedColormap.from_list("shap", [
    "#313695", "#4575b4", "#74add1", "#abd9e9", "#e0f3f8",
    "#fee090", "#fdae61", "#f46d43", "#d73027"
])

# 极坐标画布
fig = plt.figure(figsize=(14, 14))
ax = plt.subplot(111, projection='polar')

n = len(sorted_feats)
width = 2 * np.pi / n
angles = np.linspace(0, 2 * np.pi, n, endpoint=False)
max_imp = max(sorted_vals)
norm_imp = [v / max_imp for v in sorted_vals]
magnification = 3

# 条形图（全局重要性）
bar_colors = bar_cmap(Normalize(0, 1)(norm_imp))
ax.bar(angles, np.array(sorted_vals) * magnification, width=width,
       bottom=0.0, alpha=0.8, color=bar_colors, edgecolor='white', linewidth=1)

# 特征标签
for angle, feat in zip(angles, sorted_feats):
    rotation = np.degrees(angle)
    ha = "right" if 90 < rotation < 270 else "left"
    rotation = rotation - 180 if 90 < rotation < 270 else rotation
    ax.text(angle, max(sorted_vals) * magnification + 0.02,
            feat, ha=ha, va="center", fontsize=10, rotation=rotation,
            rotation_mode="anchor", fontweight="bold")

# 蜂窝散点（个体 SHAP 值）
shap_norm = Normalize(vmin=min(X.min()), vmax=max(X.max()))
for i, feat in enumerate(sorted_feats):
    feat_idx = feats.index(feat)
    feat_shap = shap_values[:, feat_idx]
    feat_vals = X[feat].values
    
    jitter = np.random.uniform(-width * 0.35, width * 0.35, len(feat_shap))
    scatter_r = np.abs(feat_shap) * magnification
    scatter_colors = shap_cmap(shap_norm(feat_vals))
    
    ax.scatter(angles[i] + jitter, scatter_r, c=scatter_colors,
               s=20, alpha=0.6, zorder=5)

ax.set_yticks([])
ax.set_xticks([])
ax.grid(True, linestyle='--', linewidth=0.3, alpha=0.5)

# 颜色条
sm = ScalarMappable(cmap=shap_cmap, norm=shap_norm)
sm.set_array([])
cbar = plt.colorbar(sm, ax=ax, orientation='horizontal',
                    pad=0.05, fraction=0.03, aspect=40)
cbar.set_label('Feature Value', fontsize=12)

plt.tight_layout()
plt.savefig('./shap_ring_beeswarm.pdf', dpi=200, bbox_inches='tight')
plt.show()
```

---

## 3. 推荐配色方案

**用途**：论文图表常用颜色组合，可直接替换任何图表中的颜色列表。

```python
# Nature/Science 期刊风格（常用于分组对比）
nature_palette = ['#E64B35B2', '#3C5488B2', '#00A087B2', '#91D1C2B2', '#D4B9DA', '#78617E']

# 暖色系（适合分类变量）
warm_palette = ["#d36a87", "#ea9979", "#e5c679", "#bcdfa7", "#83b6b5", "#a596ee"]

# 项目推荐配色（来自配色.ipynb）
project_colors = [
    "#C96144", "#E99D4E", "#5185C0", "#8281B9",
    "#55966B", "#99C290", "#C0BEDC", "#8EA9D4",
    "#F2CB9F", "#99AABB", "#FFB3C1", "#FFD3E0", "#87CEEB"
]

# 蓝-红发散（适合相关系数、SHAP值）
diverging_colors = [
    "#313695", "#4575b4", "#74add1", "#abd9e9",  # 蓝色系
    "#e0f3f8",                                    # 中性
    "#fee090", "#fdae61", "#f46d43", "#d73027"   # 红色系
]

# 学术常用5色方案
academic_5 = ["#8e93af", "#d7a6b3", "#edd9ba", "#9dc1c5", "#b0a3c0"]

# 渐变蓝（适合单变量热力图、条形图）
blue_gradient = ["#a0d7fd", "#42abf4", "#0d7bc9", "#094a8b"]

# 渐变紫（边际直方图）
purple_gradient = ['#843efe', '#8835cf', '#7a57be', '#a67eb7', '#a6569d']
```

**使用示例**：
```python
# 将配色方案应用到 matplotlib 图表
colors = project_colors  # 选择配色

for i, label in enumerate(labels):
    ax.bar(i, values[i], color=colors[i % len(colors)])
```
