# OPUS-BRIEF.md — 执行任务书(给 Opus 会话的开工文件)

> 你是本项目的执行工程师。使命:按 [MOTION.md](MOTION.md)(怎么动)与 [DIRECTION.md](DIRECTION.md)(选什么/验收什么)把 Vedio Make 升级到「极客湾/小Lin说级动效」,并保证今后用你(Opus)做片也稳定过线。
> 凡法典有明确规定的,照做,不发挥;想放宽法典 = 停下来问用户。

## 开工必读(顺序)
1. `HANDOFF.md`(项目现状与坑,尤其 §0 印刷工坊、§4 易踩坑)
2. `docs/MOTION.md` + `docs/DIRECTION.md`(两部法典,你的执行标准)
3. `methods/catalog.json`(方法目录与引擎决策矩阵)

## 工作纪律
- 审美红线 = 印刷工坊 + MOTION.md §一,一票否决,不商量。
- 验证 = 看真实产物:headless Chrome 截图(HANDOFF §4 命令)+ 单镜渲染抽帧(`ffmpeg -ss 2.5 -i scene-00N.mp4 -frames:v 1`),嘴上「应该可以」无效。
- 每步改完跑:编译自检(HANDOFF §1 的 tsx import 一行)+ `tsc --noEmit` + 既有单测。
- 提交纪律:显式文件路径 `git add`,别 `-A`(projects/ 有未跟踪测试项目);信息末尾 `Co-Authored-By` 带你的模型名。
- 卡壳升级条件:同一问题迭代 2 轮不过 → 停,写清卡点等强模型/用户。

## P0 · 工程收尾(半天,先做)
1. **合分支**:`audit-hardening` 领先 main 3 笔(硬化+单测+CI+文档),快进合入 main,推 GitHub。
2. **审美事实源统一**(DIRECTION §〇 的裁决,根治系统性分裂):
   - 根目录 `design.md` 重写为「叙事调性档」:只留节奏/语气/观众/风格档案引用,删除全部色值、字体、光效、3D 相机段(紫金时代残留)。
   - `design-presets/*.md` 同步清洗:视觉字段改为 design 预设 id(inkwork/swiss/magazine/nocturne/claywarm)+ 调性文字。
   - `src/images.ts` STYLE_RECIPES:删掉写死的 "deep purple and gold" 等色调词,改为从 `resolveDesign()` 拿当前 tokens,把 paper/ink/accent 转成自然语言色描述注入 prompt(实现为一个 `tokensToPromptPalette(design)` 帮手,配单测)。
3. **拆 `methods/registry.ts`**(1817 行,加新方法前必拆):一方法一文件到 `src/methods/impl/<method-id>.ts`,registry 只做汇总表;零行为变化,拆完全量单测+编译门须绿,抽 2 个方法单镜渲染对帧验证无回归。
4. **session-scrape 类型错隔离**:给它单独 tsconfig exclude 或补最小类型声明,让 `tsc --noEmit` 全仓转绿(目前唯一报错点)。

## P1 · 方法包七式(主菜,MOTION.md §三为规格书)
按序实装,每个方法的 DoD(完成定义):
- 实现 + 注册 catalog.json(含语义标签,供 analyzer 按 DIRECTION §一映射表选取);
- 参数走 `ctx.design.*`,零写死色;
- 单镜真渲染 → 抽 3 帧截图对照 spec(进场中/常驻/强调时刻);
- 土味 lint 0 命中;加进单测(至少 render 产物存在+时长正确)。

顺序:`hf-mega-counter` → `hf-versus-panel` → `rm-d3-line-draw` → `rm-d3-bar-race` → `hf-word-punch` → `hf-scribble-annotate` → `hf-sticker-pop`(依赖 P2 素材线,可与 P2 交错)。
顺手项:既有方法校准(MOTION §三末节 4 条)。

## P2 · 生图贴纸素材线
1. `pipeline images --provider openai` 实测:key 走 `~/.video-toolkit/providers.json` 或 Keychain(用户提供;MyTokk 中转则配 `base_url` 测 `/v1/images/generations` 通不通,不通就用官方 key)。
2. 贴纸工作流:images 生「白底单体」→ `matte.ts` 抠像 → 输出 `assets/stickers/` → `hf-sticker-pop` 消费;做成一条命令 `pipeline stickers`(prompt 清单进,贴纸 png 出)。
3. 验收:同一 design 下生 3 张贴纸 + 1 张底图,色调与版式协调(截图并排对照),AI 手病人工筛查流程写进 DIRECTION §三已定,不合格重生。

## P3 · 闸门与分析器(收尾)
1. `slideshow.ts` 加「>6s 无视觉事件」维度(仅提示)。
2. analyzer 提示词接 DIRECTION §一映射表 + §二风格档案(catalog.json 语义标签就位后)。
3. `review.ts` 报告尾部追加 DIRECTION §四 checklist 的自查表(能自动判的自动判,判不了的留人工栏)。

## 总验收(全部做完后)
用「极客湾式档案 A」做一条 **30s 内部样片**(题材:AI Switch 费用仪表盘,数据可用假数据标注「示例」):
- 全流程:SRT → 分镜(新映射表)→ 生图底图 → 渲染 → review;
- DIRECTION §四 checklist 10 条全过,附抽帧截图证据;
- 交付物:final.mp4 + qa-report + 使用的方法清单,等用户审。
