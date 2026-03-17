---
name: scientific-figures
description: 生成用于学术论文的高质量科学图表，涵盖 23 种图表类型的 Python 代码模板。包含分布图、散点图、气泡图、折线图、热力图、相关性网络图、旭日图等。当用户需要绘制科学图、数据可视化、论文配图、matplotlib/seaborn/plotly 图表时使用。
---

# 科学图表技能 (Awesome Scientific Figures)

原始 notebook 路径：`/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/Awesome-Virtual-Cell/Awesome-Scientific-Figures/`

## 图表类型索引

### 分布图
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 云雨图 (Raincloud Plot) | 展示多组数据分布，结合箱线图+小提琴图+散点 | [distribution.md](figures/distribution.md) |
| 边际直方图 (Marginal Histogram) | 联合分布图，主图+边际KDE/直方图 | [distribution.md](figures/distribution.md) |
| 椭圆散点图 (Ellipse Scatter/PCA) | PCA 降维后分组散点 + 置信椭圆 | [distribution.md](figures/distribution.md) |

### 散点/气泡图
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 分组气泡图 | 多组数据 X-Y 分布，气泡大小表示第三维 (plotly) | [scatter-bubble.md](figures/scatter-bubble.md) |
| 单轴分组气泡图 | 多组一维数据分布+大小 | [scatter-bubble.md](figures/scatter-bubble.md) |
| 综合排序气泡图 | 方法综合性能对比，归一化指标+气泡大小 | [scatter-bubble.md](figures/scatter-bubble.md) |
| 趋势分布散点图 | 散点图+拟合趋势线 (线性/多项式/指数) | [scatter-bubble.md](figures/scatter-bubble.md) |
| 散点图+误差棒 | 模型/方法在两个指标上的表现及误差 | [scatter-bubble.md](figures/scatter-bubble.md) |
| 对比点图 | 少量方法在两个指标上的对比 | [scatter-bubble.md](figures/scatter-bubble.md) |

### 柱状/极坐标图
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 堆叠柱状图 | 多组数据的数量与占比 | [bar-charts.md](figures/bar-charts.md) |
| 径向柱状图 (Radial Bar) | 周期性数据，极坐标柱状 | [bar-charts.md](figures/bar-charts.md) |
| 玫瑰图 (Rose Chart) | 极坐标扇形，替代柱状图展示多类别数值 | [bar-charts.md](figures/bar-charts.md) |

### 趋势/折线图
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 折线图 | 多方法在多指标上的变化曲线 | [trend-line.md](figures/trend-line.md) |
| 多变量变化趋势图 | 多变量随时间变化，面积重叠图 | [trend-line.md](figures/trend-line.md) |

### 层次/占比图
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 嵌套饼图 (Nested Pie) | 多层嵌套数据的占比关系 | [hierarchical.md](figures/hierarchical.md) |
| 旭日图 (Sunburst) | 层次结构数据的圆形可视化 (plotly) | [hierarchical.md](figures/hierarchical.md) |

### 相关性图
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 热力图 (Heatmap) | 参数网格搜索结果/相关系数矩阵 | [correlation.md](figures/correlation.md) |
| 相关性网络热图 | 多变量相关性矩阵+物种-特征连接线 | [correlation.md](figures/correlation.md) |
| 相关性网络热图_蝴蝶图 | 双矩阵蝴蝶布局 + Mantel连线 | [correlation.md](figures/correlation.md) |
| 弦图 (Chord Diagram) | 多变量/基因之间的关联强度 (pycirclize) | [correlation.md](figures/correlation.md) |

### 特殊图表
| 图表 | 用途 | 参考文件 |
|------|------|--------|
| 雷达图 (Radar/Spider) | 多维度性能对比，三/五/六边形 | [special.md](figures/special.md) |
| 环形蜂窝条形图 | SHAP 特征重要性展示，极坐标+散点 | [special.md](figures/special.md) |
| 配色方案 | 推荐颜色列表，可直接用于任何图表 | [special.md](figures/special.md) |

## 通用设置

```python
# Nature 期刊风格字体设置（所有图表通用）
plt.rcParams["font.sans-serif"] = ["Liberation Sans", "Arial", "Helvetica", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

# 保存为高分辨率 PDF
plt.savefig('./Fig.pdf', dpi=300, bbox_inches='tight')
```

## 依赖库

| 库 | 用途 |
|----|------|
| matplotlib, numpy, pandas | 所有图表基础 |
| seaborn | 热力图、边际直方图、综合气泡图 |
| plotly | 分组气泡图、旭日图 |
| scipy | 趋势拟合、Mantel 检验 |
| sklearn | PCA 椭圆散点图 |
| pycirclize | 弦图 |
| shap, sklearn | 环形蜂窝条形图 |
| adjustText | 综合排序气泡图标签防重叠 |
