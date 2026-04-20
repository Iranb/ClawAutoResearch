# GCD 系统产出审核报告

日期：2026-04-15

审核对象：

- 本地导出的 `gcd-paper.pdf`
- 本地导出的 `paper.pdf`

## 结论摘要

最重要的结论只有三点：

1. 这两个 PDF 目前不是“综述论文”和“会议 full paper”两条产线的产物，而是同一份 PDF 的重复导出。两者 SHA-256 完全一致。
2. 这份 PDF 作为会议 full paper 也还没有达到顶会可投状态，问题不是“还需要润色”，而是存在会直接影响审稿可信度的硬伤：方法命名冲突、正文与 checklist 自相矛盾、占位符未清理、引用明显错引、实验竞争力不足。
3. 如果把它当成综述论文来评估，则基本不成立，因为它没有综述论文应有的 scope/protocol、taxonomy、evidence synthesis、benchmark landscape 和 open problems 结构。

我的判断是：

- 推断：如果今天按 CVPR / ICCV / ECCV / ICLR / NeurIPS 的主会 full paper 标准投出，这个版本大概率过不了正常审稿。
- 推断：如果按 TPAMI / IJCV 这类顶级期刊的综述或分析型论文标准来审，这个版本距离更大，因为连论文类型都还没有分化清楚。

## 一级问题

| 问题 | 证据 | 为什么是审稿级问题 |
| --- | --- | --- |
| 两篇论文其实是同一份文件 | 两个 PDF 的 SHA-256 都是 `4946885891617f8ebfdab0cf684152fde87395fcad12a18ab58e35a174a68f3c` | 这说明系统目前没有真正产出两种论文体裁，而只是重复导出同一稿件 |
| 标题、方法名、主线叙事冲突 | 第 1 页标题是 `UGAP: Uncertainty-guided Adaptive Prototypes...`，但摘要和引言写的是 `Frequency Decomposition`; 第 5-6 页方法写 `PAPL / MPA / PDCS`; 第 10 页结论又回到 `UGAP` | 审稿人会直接质疑：论文到底提出了什么方法，核心创新到底是 prototype adaptation 还是 frequency decomposition |
| 主文、结论、checklist 三套实验叙事不一致 | 第 7 页说只做了 3 个 benchmark，学习率 `0.10`；第 10 页结论说做了 4 个 benchmark 且有 `CIFAR-100: 80.79`; 第 12 页 checklist 又写学习率 `0.03`；第 13 页 checklist 写 `p < 0.001` 和 `Cohen's d=3.88`，但第 7、9 页主文明确写 `p = 0.15` | 这是最严重的问题之一，会直接击穿可信度；审稿人会怀疑实验是否真实、是否由多个草稿拼接、是否存在自动生成残留 |
| 稿件未完成，占位符和自动化残留明显 | 第 13 页仍有 `[analyzer]`；第 14 页有 `Table ??`；第 15 页有 `Figure??` / `Figure ??`；首页还有 `Anonymous Author(s) / Affiliation / Address / email` 模板位 | 这类问题在顶会审稿里不是小瑕疵，而是“作者没有把稿件准备完”的明确信号 |
| 引用至少有明显错引 | PDF 将 PromptCAL 写成 `Contrastive affordance learning with vision-language prompts, ICCV 2023`；但官方论文是 CVPR 2023 的 `PromptCAL: Contrastive Affinity Learning via Auxiliary Prompts for Generalized Novel Category Discovery`。PDF 中 SelEx 题目和作者信息也与 ECCV 2024 官方版本不一致 | 错引会让审稿人怀疑 related work 覆盖是否真实、文献综述是否可信 |
| 结果竞争力不够，且统计证据偏弱 | 第 7 页主结果在 Cars 上均值只比 SimGCD 高 `+0.94%`，第 7、9 页自己也承认 `p = 0.15`；Aircraft 只有 `40.11%`，明显偏低 | 顶会 full paper 可以接受负结果或局部增益，但不能接受“核心 claim 只在边缘显著甚至不显著”还试图讲成强方法论文 |

## 作为 full paper 的主要差距

### 1. 研究主线没有收束成一个可 defend 的 thesis

目前稿件同时混杂了两条甚至三条主线：

- `UGAP`：不确定性引导的 prototype adaptation
- `Frequency Decomposition`：频域分解增强 fine-grained distinction
- `PromptCAL / SelEx / local parts`：局部判别与 fine-grained attention 的讨论

这不是“内容丰富”，而是 thesis 没收束。顶会 full paper 通常要求：

- 一个清晰的一句话 thesis
- 一个与 thesis 完整对齐的方法名
- 一个和 thesis 一一对应的证据链

你这份稿件现在的问题是：标题、摘要、方法、讨论、结论并不在说同一件事。

### 2. 证据链还不够硬

当前稿件的证据问题主要有四类：

- 增益偏小：Cars 均值只比 SimGCD 高 `+0.94%`
- 显著性偏弱：主文自己写 `p = 0.15`
- benchmark 不完整：主文只覆盖 3 个 fine-grained benchmark，缺少更系统的 generic / fine-grained 对照
- 机制证据不足：如果核心贡献真的是 `frequency decomposition`，那至少应该有频域可视化、filter analysis、part-level activation 或错误类型变化分析

这意味着当前稿件更像“一个有趣的实验观察”，还不像“一个足以说服审稿人的方法论文”。

### 3. 与近两年同赛道顶会论文相比，竞争力明显不足

下面这组对比更接近真实审稿环境，因为它们都来自 GCD 或 fine-grained GCD 的正式顶会论文：

| 论文 | 官方来源 | 关键信号 |
| --- | --- | --- |
| PromptCAL, CVPR 2023 | CVPR OpenAccess | 官方摘要直接写了在 CUB-200 上接近 `11%` 增益，在 ImageNet-100 上约 `9%` 增益 |
| PIM, ICCV 2023 | ICCV OpenAccess | 官方摘要写的是“在 6 个数据集上 consistently sets new state-of-the-art” |
| CMS, CVPR 2024 | CVPR OpenAccess | 官方摘要写的是“在 6 个公开 GCD benchmark 上达到 SOTA, without bells and whistles” |
| SelEx, ECCV 2024 | ECCV official PDF | 在 fine-grained GCD 上进一步强化 sample selection / expertise 机制 |
| DebGCD, ICLR 2025 | OpenReview / ICLR proceedings | 官方摘要写的是“consistent state-of-the-art performance” |
| APL / AptGCD, CVPR 2025 | CVPR OpenAccess | 最新 fine-grained GCD 方向已经显式转向 part-level / prompt transformer / local attention 建模 |

如果只看你稿件里给出的 3 个 fine-grained 数据集结果，并和公开论文做一个粗略但有参考价值的对比：

| 方法 | Cars | CUB | Aircraft | 三数据集均值 |
| --- | --- | --- | --- | --- |
| 当前稿件 | 54.34 | 55.27 | 40.11 | 49.91 |
| CMS, CVPR 2024 | 56.9 | 68.2 | 56.0 | 60.37 |
| SelEx, ECCV 2024, DINOv1 | 59.2 | 73.6 | 57.1 | 63.30 |
| DebGCD, ICLR 2025 | 65.3 | 66.3 | 61.7 | 64.43 |

说明：

- 这里的直接横向比较并不完全公平，因为 backbone、setting、reporting 口径可能不同。
- 但审稿时并不会因为“不完全公平”就放弃比较；相反，审稿人会默认你需要主动对齐 strongest relevant baselines。

更具体地说，和 DebGCD 这篇 2025 ICLR 论文相比，当前稿件在你自己报告的这三个 fine-grained benchmark 上分别落后大约：

- Cars：`10.96`
- CUB：`11.03`
- Aircraft：`21.59`

这已经不是“还差一点点”的问题，而是说明目前方法和实验设计还没有进入同一竞争层级。

### 4. 你自己在讨论部分提出的“fine-grained 痛点”，已经被 2025 年论文对准了

这点很关键。

当前稿件第 9-10 页其实自己已经承认了一个事实：单纯依赖 global uncertainty / prototype adaptation，对 fine-grained 数据集的细粒度局部差异抓取不够强。这和 2025 年的两篇方向非常一致：

- `Adaptive Part Learning for Fine-Grained Generalized Category Discovery`（CVPR 2025）直接把 part discovery / part representation 作为提升 fine-grained GCD 的关键
- `Less Attention is More: Prompt Transformer for Generalized Category Discovery`（CVPR 2025）明确指出现有方法过度依赖 global receptive field，提出 local prompt / prompt transformer，并在四个 fine-grained 数据集上把 `New` accuracy 相对 SOTA 平均再提高约 `9.2%`

这意味着：

- 你的问题意识是对的
- 但当前方法形态还停留在“发现问题”阶段
- 顶会赛道已经往更强的局部建模方案走了

## 作为 oral / best paper 的差距

如果把标准再往上拉，不是“能不能被接收”，而是“有没有 oral / best paper 的说服力”，差距会更明显。

从官方奖项页看，顶会 best paper / oral 通常有几个共同特征：

- 改变量是决定性的，不是边缘性的
- 证据链非常完整，往往同时覆盖主任务、泛化、效率、规模规律或下游能力
- 稿件表达高度统一，几乎看不到拼稿痕迹

两个可参考的官方例子：

- CVPR 2024 Best Paper 官方新闻里强调，获奖论文是在 `11,500+` submissions 中选出的；评语里反复出现的是 “significantly outperforms prior baselines” 和 “enables downstream applications”
- NeurIPS 2024 Best Paper `Visual Autoregressive Modeling` 官方页面给出的证据是：FID 从 `18.65` 到 `1.73`，推理约 `20x` 更快，还展示了 scaling laws 和 zero-shot downstream generalization

和这种量级相比，当前稿件的问题非常明显：

- 主结果幅度不大
- 统计显著性不强
- 没有规模规律
- 没有更强泛化证据
- 没有真正 release-grade 的实验与写作完成度

所以这篇稿子现在距离 oral / best paper，不是“还差一层 polish”，而是至少差了两层：

- 第一层是先达到“可信、完整、可投”的正常顶会论文
- 第二层才是“有决定性优势”的 oral / best paper 级论文

## 作为综述论文的主要差距

如果把这份产出按“综述”来审，问题会更根本，因为它现在根本不是综述体裁。

一个能过顶级会议 / 顶级期刊 review 的 survey / review / critical analysis，通常至少要有：

- 明确的 scope and protocol
- inclusion / exclusion criteria
- taxonomy 或 problem decomposition
- evidence synthesis，而不是逐篇罗列
- benchmark landscape
- 支持充分的 open problems / future directions

而这份 PDF 实际上是方法论文结构：

- Abstract
- Introduction
- Related Work
- Method
- Experiments
- Discussion
- Conclusion

并没有真正的 survey contract。

这点也能从顶刊文章看出来。比如 IJCV 2025 的 `Dissecting Out-of-Distribution Detection and Open-Set Recognition: A Critical Analysis of Methods and Benchmarks`，不是简单综述文献，而是：

- 做 rigorously cross-evaluation
- 提出 new large-scale benchmark setting
- 给出 actionable takeaways
- 开源代码

也就是说，顶刊 review/analysis 文不是“把相关工作写长一点”，而是要形成一个可复用的学术分析框架。当前系统产出的“综述论文”离这个标准还没开始。

## 继续审核：`main.pdf` 这份真正的综述稿

补充说明：

- 上一部分里“综述论文基本不成立”的结论，针对的是前面那两个重复导出的 PDF。
- 你这次提供的 `main.pdf` 是另一份真正的综述稿，体裁上明显更对，所以需要单独评价。

### 这份综述稿比前一个“伪综述”强很多

这份 `main.pdf` 的优点是明确的：

- 标题就是 survey：`Generalized Category Discovery: A Survey`
- 结构基本符合综述写作 contract：
  - `Introduction`
  - `Scope and Protocol`
  - `Taxonomy of GCD Methods`
  - `Evidence Synthesis`
  - `Benchmark Landscape`
  - `Open Problems`
  - `Conclusion`
- 它确实在做 taxonomy、benchmark landscape 和 open problems，而不是把方法论文换个标题假装综述

如果只和前面那份重复的 full paper 相比，这一版已经往前走了一大步。

### 但它仍然没有达到顶级综述/顶刊 analysis 的标准

#### 1. 形式上像综述，但证据管线还不够“可审计”

这份综述自己在 `Review Protocol` 里明确写了几个限制：

- `no systematic venue sweep of CVPR/ICCV/ECCV/NeurIPS 2024–2026 was conducted`
- `citation chain expansion was not performed`
- `some quantitative results are approximate rather than extracted from original tables`

这三句很关键。

它们说明这篇综述虽然已经有 protocol 意识，但还没有达到顶级综述常见的“可复核”标准。尤其是：

- 如果摘要里宣称自己做了 `quantitative comparison across 10 benchmark datasets`
- 又在 protocol 里承认有些数字是 approximate，而不是从原表精确抽取

那审稿人会自然追问：

- 这些数字是否可复现？
- 是否 apples-to-apples？
- 是否把 backbone、split、metric、protocol 差异都统一控制了？

这正是顶级综述最看重的部分。

#### 2. 文献元数据完整性不够，甚至仍有明显占位

这份综述最危险的问题，不在结构，而在 bibliography 的可信度。

直接证据包括：

- 第 3 页还有 `Figure??(not shown)` 占位
- 参考文献页仍出现 `Placeholder` 条目，如 `[6]`, `[9]`, `[11]`
- 一些已经有正式会议发表的工作，文中仍按 `arXiv preprint` 或不完整信息引用

这会直接拉低综述的可信度，因为综述论文最怕的不是“观点不够新”，而是“文献基础不稳”。

例如，下面这些在官方来源里已经能确认的正式发表信息，与稿件里的引用习惯明显不匹配：

- `TextGCD` 已经是 ECCV 2024 正式论文，不应只当作模糊的 arXiv 线索
- `AF` 已经是 ICCV 2025 正式论文
- `MOS` 已经是 CVPR 2025 正式论文
- `GET` 已经是 CVPR 2025 正式论文
- `SDC / Unleashing the Potential of Model Bias...` 已经是 AAAI 2025 正式论文
- `SEAL` 已经在 NeurIPS 2025 OpenReview / project page 上有正式会议信息

顶级综述对 reference quality 的要求通常比方法论文更严，因为综述本质上就是“替读者做 literature curation”。如果参考文献里同时存在：

- 正式已发表论文
- 最新 arXiv 预印本
- `Placeholder`

却没有清楚区分这些来源的成熟度和可信度，审稿人会质疑整篇 survey 的 literature hygiene。

#### 3. quantitative synthesis 有结论，但缺少足够透明的支撑载体

摘要和正文里有很多明确数字，例如：

- `+9.9% average accuracy`
- `+10.1%`
- `+6.2%`
- `76.3% average accuracy on SSB`
- `14 representative papers`
- `10 benchmark datasets`

这些数字本身不一定错，但当前稿子还缺少一个顶级综述通常会提供的“证据落点”：

- 明确的综述总表
- 每篇论文对应的 benchmark / backbone / protocol / metric 对齐表
- 哪些数字是 `All`，哪些是 `H-score`，哪些是 `New`
- 哪些是相对 SimGCD 的 improvement，哪些是绝对值
- 哪些来自论文主表，哪些来自 appendix，哪些来自 project page / OpenReview

如果没有这个载体，读者只能“相信作者已经整理过”，而不是“自己能顺着表追回去核验”。这对于 workshop survey 还勉强可以接受，但对于 IJCV/TPAMI 风格的 critical analysis 还不够。

#### 4. 跨论文比较里，backbone / protocol 混杂得还比较重

这份 survey 已经注意到 backbone progression，从 `ResNet-50 -> DINOv2 -> CLIP` 做了一条叙事线，这是优点。

但问题在于：很多跨论文比较仍然把“方法本身的收益”和“backbone 升级的收益”混在一起了。

举例说：

- `SEAL` 的优势里有明显的 hierarchical learning 因素
- 但同时也叠加了 `DINOv2` 特征
- `GET` / `TextGCD` 的提升也混合了 multi-modal mechanism 与 CLIP backbone 的收益

顶级综述一般会更强调：

- same-backbone comparison
- same-protocol comparison
- same-benchmark / same-metric comparison

否则容易把“backbone 代际更替”误写成“方法家族更优”。

#### 5. 篇幅和完成度更像“高质量短综述”，还不像“顶刊级综述”

这份 `main.pdf` 目前是 `10` 页。

对于 conference-style short survey 或者系统内部综述，这个长度可以接受；但如果对标的是 IJCV / TPAMI 级综述或 critical analysis，通常会希望看到更完整的：

- literature coverage matrix
- benchmark comparison tables
- protocol normalization discussion
- reproducibility appendix
- limitations of the survey itself

现在这份稿子已经有了这些元素的轮廓，但深度还不够厚。

### 和顶级综述/critical analysis 文章相比，还差什么

一个很好的参照是 IJCV 2025 的这篇文章：

- `Dissecting Out-of-Distribution Detection and Open-Set Recognition: A Critical Analysis of Methods and Benchmarks`

它之所以更像顶刊 analysis，而不只是普通 survey，是因为它除了整理文献，还做了三件更重的事情：

- rigorous cross-evaluation
- new benchmark setting
- actionable takeaways + code release

而你这份综述目前更接近：

- 有结构
- 有 taxonomy
- 有 open problems
- 有定量结论

但还没有进入“analysis paper”层级，因为它还缺：

- 可复核的 benchmark matrix
- 对 protocol 差异的系统控制
- 自己额外做的一层 empirical re-analysis

所以更准确的判断是：

- 这是一篇方向对了的综述稿
- 但目前更像“不错的 first survey draft”
- 还不是“顶刊级 critical survey / analysis manuscript”

### 和前一篇 full paper 并排比较

如果把这份 `main.pdf` 和前面的 full paper 放在一起看：

| 维度 | 前一篇 full paper | 当前 survey `main.pdf` |
| --- | --- | --- |
| 论文体裁是否清晰 | 否，混了方法稿和伪综述 | 是，体裁明确是 survey |
| 结构是否匹配目标体裁 | 否 | 基本匹配 |
| bibliography hygiene | 很差 | 中等，仍明显不够 |
| quantitative claim 可信度 | 低，内部自相矛盾 | 中等，有 protocol，但证据落点不够透明 |
| 距离“普通可投” | 还远 | 明显更近 |
| 距离“顶级综述/顶刊 analysis” | 很远 | 仍有明显差距 |

所以如果只问一句话判断：

- 这份 `main.pdf` 比前面那份“综述”真实得多，也更值得继续打磨。
- 但如果目标是顶级会议 survey track 或 IJCV/TPAMI 级综述，它现在还需要一次“bibliography + evidence matrix + protocol tightening”的大修。

### 最值得优先修的三件事

1. 把参考文献和正文 claim 全量核验一遍。
   删除 `Placeholder`，把已经正式发表的论文改成正式 venue/citation。
2. 补一张真正可审计的 benchmark matrix。
   至少包含 paper / year / venue / backbone / protocol / metrics / key numbers / source location。
3. 把摘要里的强结论降到“可被表格支持”的强度。
   不能再出现“数字很强，但正文找不到统一证据载体”的状态。

## 建议的改进方向

### 路线 A：把它救成一篇可投 full paper

建议按下面顺序做：

1. 先定唯一主线。
   只能二选一：
   - 要么写 `UGAP / uncertainty-guided prototype adaptation`
   - 要么写 `frequency decomposition for fine-grained GCD`
   不能再混写。
2. 彻底重写标题、摘要、贡献点和结论，让四者完全一致。
3. 清空并重建 bibliography。
   只保留核验过的正式论文条目，尤其是 PromptCAL、SelEx、PIM、CMS、DebGCD、AptGCD / APL。
4. 重跑实验。
   至少要：
   - 对齐 strongest baselines
   - 统一 backbone / protocol
   - 补多 seed 或多 split
   - 给出可信的 significance / CI
5. 补机制证据。
   如果卖点是 frequency / uncertainty / prototype，就要有对应 visualization 和 failure analysis。
6. 清理所有模板残留。
   包括 `Table ??`、`Figure ??`、`[analyzer]`、相互矛盾的 checklist。

### 路线 B：真的产出一篇综述

如果你要的是“系统当前产出的综述论文”，那最好的做法不是改这篇，而是另起一条真正的 survey pipeline：

1. 定主题。
   例如 `Generalized Category Discovery for Fine-Grained Recognition: Methods, Benchmarks, and Open Problems`
2. 先做 scope/protocol。
   说明检索来源、时间窗口、纳入排除标准。
3. 再做 taxonomy。
   可以按：
   - prototype / classifier-based
   - prompt / vision-language
   - part-level / local attention
   - bias correction / distribution guidance
   - benchmark / protocol variations
4. 做 evidence matrix。
   用表而不是散文堆砌论文。
5. 最后写 open problems。
   要从论文矩阵推出来，而不是凭空写展望。

### 路线 C：如果目标真的是 oral / best paper

那就需要重新定义贡献目标，而不是继续优化当前这个 marginal gain 版本。

更现实的 oral 方向通常是三选一：

- 在 fine-grained GCD 上拿到明显领先于最新方法的结果
- 提出一个新的 benchmark / protocol / evaluation angle，让社区必须重看这个问题
- 提出一个足够强、足够通用、且有 clear mechanism evidence 的方法，能跨多种 setting 一致获益

当前这份稿件离这三条都还有距离。

## 建议优先级

我建议你先不要继续“修这两个 PDF 的文字”，而是先修系统产出逻辑：

1. 先解决“综述稿和 full paper 实际导出成同一份文件”的产线问题
2. 再决定 full paper 只保留哪一条方法主线
3. 最后才进入实验补强和写作 polish

否则会出现一种很常见的低效循环：

- 一边润色
- 一边换主线
- 一边改实验

最后每一层都不像最终稿。

## 外部对标来源

- [PromptCAL, CVPR 2023](https://openaccess.thecvf.com/content/CVPR2023/html/Zhang_PromptCAL_Contrastive_Affinity_Learning_via_Auxiliary_Prompts_for_Generalized_Novel_CVPR_2023_paper.html)
- [Parametric Information Maximization for GCD, ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Chiaroni_Parametric_Information_Maximization_for_Generalized_Category_Discovery_ICCV_2023_paper.html)
- [Contrastive Mean-Shift Learning for GCD, CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/html/Choi_Contrastive_Mean-Shift_Learning_for_Generalized_Category_Discovery_CVPR_2024_paper.html)
- [Textual Knowledge Matters / TextGCD, ECCV 2024](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/06840.pdf)
- [SelEx, ECCV 2024 official PDF](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/08926.pdf)
- [DebGCD, OpenReview / ICLR 2025](https://openreview.net/forum?id=9B8o9AxSyb)
- [SDC / Unleashing the Potential of Model Bias for GCD, AAAI 2025 official schedule metadata](https://aaai.org/wp-content/uploads/2025/01/AAAI-25-Poster-Schedule_2025-01-22_Saturday-Only.pdf)
- [GET, CVPR 2025 official poster page](https://cvpr.thecvf.com/virtual/2025/poster/34519)
- [MOS, CVPR 2025 official poster page](https://cvpr.thecvf.com/virtual/2025/poster/32559)
- [AF / Distracted Attention, ICCV 2025](https://openaccess.thecvf.com/content/ICCV2025/html/Xu_A_Hidden_Stumbling_Block_in_Generalized_Category_Discovery_Distracted_Attention_ICCV_2025_paper.html)
- [SEAL, NeurIPS 2025 OpenReview](https://openreview.net/forum?id=B7lygdSDii)
- [FREE / Domain Shift Frequency Perspective, OpenReview PDF](https://openreview.net/pdf?id=uUBQ96zs48)
- [GOAL, continual GCD preprint index](https://www.opentrain.ai/papers/goal-geometrically-optimal-alignment-for-continual-generalized-category-discover--arxiv-2602.19872/)
- [Adaptive Part Learning for Fine-Grained GCD, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Dai_Adaptive_Part_Learning_for_Fine-Grained_Generalized_Category_Discovery_A_Plug-and-Play_CVPR_2025_paper.html)
- [Less Attention is More: Prompt Transformer for GCD, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Zhang_Less_Attention_is_More_Prompt_Transformer_for_Generalized_Category_Discovery_CVPR_2025_paper.html)
- [CVPR 2024 Awards official page](https://cvpr.thecvf.com/Conferences/2024/News/Awards)
- [NeurIPS 2024 Awards official page](https://neurips.cc/virtual/2024/awards_detail)
- [NeurIPS 2024 Best Paper: VAR](https://neurips.cc/virtual/2024/oral/94115)
- [IJCV 2025 critical analysis article](https://link.springer.com/article/10.1007/s11263-024-02222-4)

## 审核说明

- 我是基于 PDF 文本抽取、仓库内现有写作模板，以及官方论文/奖项页面做的审核。
- 关于“稿件内部互相矛盾”和“两个 PDF 完全重复”这两类结论，是直接证据，不是推断。
- 关于“如果今天投稿大概率不过审”和“距离 oral / best paper 很远”，这是基于当前顶会同赛道论文与官方奖项标准做出的推断。
