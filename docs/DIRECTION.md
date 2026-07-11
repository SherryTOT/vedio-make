# DIRECTION.md — 导演手册(台词→画面的决策规范)

> 目标:让任何执行模型(默认 Opus)拿到 SRT 就能做出「有导演」的片子,而不是幻灯片。
> 与 MOTION.md 的分工:MOTION 管「怎么动」,本文件管「选什么、何时用、验收什么」。

## 〇、审美事实源裁决(先读,系统性问题的根治)

**唯一视觉真相 = `src/methods/designs.ts` 的 design tokens(印刷工坊 5 预设)。**

- 根目录 `design.md` 的紫金色板与 3D 相机段**作废**(它是早期紫金时代残留,与产品命门冲突)。`design.md` 降级为**叙事调性档**:只写节奏密度、语气、目标观众、参考风格档——**不写任何色值/字体/光效**,视觉字段一律写 design 预设 id(inkwork/swiss/magazine/nocturne/claywarm)。
- `design-presets/*.md` 同步清洗:删除色值,改为「预设 id + 调性描述」。
- `src/images.ts` 的 STYLE_RECIPES 里写死的「deep purple and gold」等色调词全部删除,改为**运行时注入当前 design tokens**(paper/ink/accent 转成自然语言色描述进 prompt),保证生图素材与版式同一血统。

## 一、台词 → 方法映射表(analyzer 的选法依据,进 catalog.json)

| 台词语义信号 | 首选方法 | 备选 |
|---|---|---|
| 数字/百分比/金额/分数(单个核心值) | `hf-mega-counter` | `hf-stat-counter` |
| 多主体排名/份额对比 | `rm-d3-bar-race` | `rm-d3-bar-chart` |
| 趋势/增长/下跌/随时间变化 | `rm-d3-line-draw` | `rm-d3-line-trend` |
| A vs B 对比/参数拉表 | `hf-versus-panel` | `rm-framer-card-stack` |
| 人物/公司/产品实体登场 | `hf-sticker-pop`(配生图抠像) | `hf-poster-hero` |
| 关系/流程/钱怎么流 | `hf-scribble-annotate`(箭头流) | — |
| 金句/结论/转折词 | `hf-word-punch` | `hf-chapter-card` |
| 章节切换 | `hf-chapter-card` | `hf-line-reveal` |
| 实拍/截图素材段 | `rm-video-clip` / `rm-image-kenburns` | — |
| 无明确信号的过渡句 | `hf-css-fade`(兜底) | 连续 2 镜兜底 = 单调警告 |

选法纪律:先按 catalog.json 引擎决策矩阵定引擎语法,再从该引擎方法池里按上表选;**全片 method 重复率 ≤40%**(slideshow.ts 已检),相邻两镜不同方法优先。

## 二、风格档案(选题类型 → 全套预设)

### A.「极客湾式」数据评测片
- 适用:评测/跑分/价格对比/性能分析(如 AI Switch 费用仪表盘片)。
- design 预设:`nocturne`(克制深色)或 `swiss`;节奏密度 2.5–3.5s/事件。
- 方法池:mega-counter、bar-race、line-draw、versus-panel、d3 系 + spotlight 强调。
- 生图:`minimal-dark` 风格(色调注入 design tokens),用作图表底图;少贴纸。
- 语气:快、准、结论先行,每段落以一个数据事件开场。

### B.「小Lin说式」拼贴叙事片
- 适用:讲公司/讲事件/讲关系的科普叙事(如「我用 AI 做了个恐怖游戏」的幕后叙事段)。
- design 预设:`inkwork` 或 `claywarm`;节奏密度 3–4s/事件。
- 方法池:sticker-pop、scribble-annotate、word-punch、chapter-card + kenburns 垫底。
- 生图:白底单体(人物/物件/logo 式插画)→ `matte.ts` 抠像 → 贴纸;一片预算 8–15 张。
- 语气:口语、有梗,关键词弹字承担笑点节拍。

### C.「印刷工坊经典」杂志片
- 适用:品牌感开场、情绪段、片尾;现有 16 方法原样,节奏 4–5s/事件。

一部片可以分段混用(开场 C → 主体 A/B → 收尾 C),但**一段内只用一个档案**。

## 三、生图素材规范(GPT/minimax 通用)

1. prompt 由 `pipeline images` 自动扩写,风格配方必须引用当前 design tokens(见〇);人工补 prompt 时同样禁止外来色调词。
2. 贴纸类素材:要求「single subject, plain white background, no text」,过 matte 抠像后进 `hf-sticker-pop`。
3. 底图类素材:要求留出安全区负空间(文字/图表位),`minimal-dark`/`editorial` 配方。
4. 一镜一图上限;能用矢量/纯排版解决的不生图(成本与一致性都更好)。
5. 生成后必看:色调是否协调、有没有 AI 手病(肢体/文字乱码);不合格就换 seed 重生,**不许将就**。

## 四、渲染后审美验收 checklist(每片必过,10 条)

1. 开场 10s 内有钩子事件(数据/悬念/冲突画面)。
2. 全片无 >6s 视觉静默段。
3. 每个关键数据/关键词都有对应强调动效,且落点在发音区间。
4. 同屏动效 ≤1 主 1 辅;抽 3 处核对。
5. 转场:硬切为主、种类 ≤2、无糊脸 dissolve。
6. 土味 lint 0 命中;色彩全部出自 design tokens。
7. 数字全部等宽,滚动不抖。
8. method 重复率 ≤40%,相邻镜不同方法为主。
9. 音画:volumedetect 无削波/静音(review.ts 已查);BGM 不压解说。
10. 结尾定帧收束 ≥1.5s。

不过线的项:回到分镜台改该镜 method/参数,单镜重渲(`only=N`),不整片重跑。

## 五、模型分工(SOP 级约定)

- **执行(默认 Opus)**:按本手册+MOTION.md 做片全流程——分镜、渲染、迭代、生图、验收自查。凡有明确规范的决策,照规范,不发挥。
- **升级到 Fable/更强模型的时机**:新风格档案的创设、法典本身的修订、验收争议仲裁、连续 2 轮迭代仍不过 checklist。
- 法典改动(本文件/MOTION.md)= 需用户或强模型点头,执行模型不得自行放宽。
