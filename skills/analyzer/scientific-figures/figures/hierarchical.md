# 层次与占比图代码模板

## 1. 嵌套饼图 (Nested Pie / Concentric Ring Chart)

**用途**：多层嵌套数据的占比关系，内环为主分类，外环为子分类。适合展示层次化数据结构的比例分配。

**依赖**：`matplotlib`, `numpy`

```python
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

def create_nested_pie(ax):
    color = ["#dc9eb5", "#b8b2b9", "#b0a3c0", "#e3d0d7", "#ebe8f0"]
    bgcolor = "#ffffff"
    main_name = ["data A", "data B", "data C"]
    sub_name = ["data A-1", "data A-2", "data B-1", "data C-1", "data C-2", "data C-3"]
    # 主分类包含的子分类值列表
    value_list = [[100.0, 120.0], [37.0], [29.0, 10.0, 20.0]]
    
    size = 0.2   # 每层环宽
    ax.set_ylim(0, 0.6)
    ax.set_axis_off()
    
    sum_vals = sum(map(sum, value_list))
    main_divided = [sum(sub) / sum_vals * 2 * np.pi for sub in value_list]
    main_x = np.cumsum([0] + main_divided[:-1])
    
    main_colors = color[:len(value_list)]
    # 绘制外环（主分类）
    main_bars = ax.bar(x=main_x, width=main_divided, bottom=size, height=size,
                       color=main_colors, edgecolor=bgcolor, linewidth=1, align="edge")
    
    # 绘制内环（子分类）
    sub_values = [v for sub in value_list for v in sub]
    sub_divided = [v / sum_vals * 2 * np.pi for v in sub_values]
    sub_x = np.cumsum([0] + sub_divided[:-1])
    sub_colors = [main_colors[i] for i, sub in enumerate(value_list) for _ in sub]
    sub_bars = ax.bar(x=sub_x, width=sub_divided, bottom=2 * size, height=size * 0.5,
                      color=sub_colors, alpha=0.5, edgecolor=bgcolor, linewidth=2, align="edge")
    
    text_attr = {"ha": "center", "va": "center", "fontweight": "bold"}
    # 主分类标签
    for bar, label, val in zip(main_bars, main_name, map(sum, value_list)):
        angle = bar.get_x() + bar.get_width() / 2
        distance = bar.get_height() + bar.get_y()
        pct = f"{label}\n{val / sum_vals * 100:.1f}% | {val:.0f}"
        ax.text(angle, distance - 0.1, pct, color="#ffffff", fontsize=8, **text_attr
                ).set_bbox({"facecolor": "#75879655", "edgecolor": "none", "boxstyle": "round,pad=0.5"})
    
    # 子分类标签
    for bar, label, val in zip(sub_bars, sub_name, sub_values):
        angle = bar.get_x() + bar.get_width() / 2
        distance = bar.get_height() + bar.get_y()
        pct = f"{label}\n{val / sum_vals * 100:.1f}% | {val:.0f}"
        ax.text(angle, distance + 0.1, pct, color="#ffffff", fontsize=8, **text_attr
                ).set_bbox({"facecolor": "#75879677", "edgecolor": "none", "boxstyle": "round,pad=0.5"})
    
    plt.subplots_adjust(left=0.3, right=1.0, top=1.0, bottom=0.05)

fig, ax = plt.subplots(subplot_kw={"projection": "polar"}, figsize=(8, 5), dpi=150)
create_nested_pie(ax)
plt.savefig('./nested_pie.pdf', dpi=300, bbox_inches='tight')
plt.show()
```

**关键技巧**：
- 使用极坐标 (`projection="polar"`) + `bar()` 实现环形效果
- `bottom=size`: 第一层（主分类）从半径 `size` 处开始
- `bottom=2*size`: 第二层（子分类）叠加在外层之上
- `align="edge"`: 以起始角度为对齐点（而非中心）

**自定义数据格式**：
```python
value_list = [[100, 120], [37], [29, 10, 20]]  # 每个子列表是一个主分类的子分类值
main_name = ["A", "B", "C"]       # 主分类名称
sub_name = ["A1", "A2", "B1", "C1", "C2", "C3"]  # 子分类名称（展平顺序）
```

---

## 2. 旭日图 (Sunburst Chart)

**用途**：层次结构数据的圆形可视化，支持多级嵌套，支持点击交互（plotly）。

**依赖**：`plotly`, `pandas`

```python
import plotly.graph_objects as go
import pandas as pd

# 数据结构：每个节点有 label, parent, value
# parent="" 为根节点，parent=某label 为该节点的子节点
data = {
    'labels': ["Root", "A", "B", "C", "A1", "A2", "B1", "B2", "C1"],
    'parents': ["",    "Root", "Root", "Root", "A", "A", "B", "B", "C"],
    'values':  [0,     0,      0,      0,      30,  20,  25,  15,  10]
}
df = pd.DataFrame(data)

fig = go.Figure(go.Sunburst(
    labels=df['labels'].tolist(),
    parents=df['parents'].tolist(),
    values=df['values'].tolist(),
    textinfo='label+percent root',          # 显示标签和占根节点的百分比
    textfont=dict(color='white', size=14),
    marker=dict(
        colors=["#ffffff", "#f9b99e", "#f87f8c", "#e37e8e", "#a9758c",
                "#796b88", "#f9b99e", "#e37e8e", "#a9758c"],
        line=dict(color='white', width=3)   # 分区边界
    )
))

fig.update_layout(
    margin=dict(t=0, l=0, r=0, b=0),
    width=800, height=500
)
fig.show()
# fig.write_image('./sunburst.pdf', scale=2)
```

**数据格式说明**：
```python
# 根节点：parent=""，value 通常为 0（plotly 自动汇总子节点）
# 叶节点：有实际 value 值
# 示例：
labels  = ["总计", "A类", "B类", "A-1", "A-2", "B-1"]
parents = ["",     "总计", "总计", "A类", "A类", "B类"]
values  = [0,      0,      0,      50,    30,    40  ]
```

**颜色建议**：
- 用 `marker.colors` 为每个节点指定颜色
- 颜色数量必须与 `labels` 数量一致
