# Vedio Make · 交接文档(给下一个会话)

> 写于 2026-06-28,更新至 2026-07-01。换窗口/新会话接手时**先读这份 + `MEMORY.md`(本项目路径下已有 5 条记忆)**。
> 若新会话开在本目录(`~/Documents/Work/Vedio Make`),关键信息都复刻在本文件与记忆里。
>
> **最新进度(2026-07-01)**:三笔已提交在 `main`——`38682a9`(渲染硬化 + 质量闭环)/ `0d0f92f`(schema+成本+决策日志+回退链)/ `68b7476`(引擎决策矩阵)。见 §3/§6/§7。
> 工作区干净(仅剩 3 个未跟踪测试项目)。**daemon 已停**(下次 `npm run serve` 起新的)。
> **⏭ 下一步待办见 §8:全面审计 Vedio Make 自身的问题 + 改进方向(刚起头就换窗口了)。**

## 0. 这是什么
**Vedio Make** = 用户的「字幕(SRT) → 分镜(storyboard) → 渲染 → final.mp4」AI 视频生成管线。
TypeScript/tsx,本地优先,MIT 开源(GitHub: `SherryTOT/vedio-make`)。
- 位置:`~/Documents/Work/Vedio Make`(独立 git 仓,main 分支)。
- 前身:原 `~/Documents/Vedio C/pipeline`,本会话提升为顶层 + git 化 + 发 GitHub。
- 与 `Vedio D`(Restate,视频→文稿工坊)是两个独立项目,别混。
- CLI 三命令:`plan`(切场景)/ `storyboard`(出分镜 html)/ `render`(逐场景渲→ffmpeg 拼 final.mp4);
  渲染引擎走 **HyperFrames(npx)/ Remotion / ffmpeg**。
- 用户审美铁律:**印刷工坊**——陶土橙 `#c36c36` / 米白 `#f6f5f1` / 深褐 `#1b1612`,衬线,克制;
  **禁渐变 / 发光 / 投影 / AI 金光感**。这是产品命门,改任何渲染/UI 都守住。

## 1. 怎么跑 + 验证
```bash
cd "~/Documents/Work/Vedio Make"
npm run serve              # = tsx src/cli.ts serve --projects ./projects,起在 127.0.0.1:8766
                           # 无 PIPELINE_TOKEN 时自动生成并注入页面;开发我一直用 --token devtoken
# 分镜台(web UI):浏览器开 http://127.0.0.1:8766/
# 单镜渲染(可靠):POST /api/projects/{id}/render {"only":N,"force":true}
# 全片渲染(已修,见 §3):POST .../render {}  —— 异步不堵 daemon、实时进度、看门狗超时
# 只拼接(不重渲):  POST .../stitch {}  或 CLI: pipeline render --stitch
```
编译自检(改完 TS 必跑):
```bash
node_modules/.bin/tsx -e "Promise.all([import('./src/proc.ts'),import('./src/harden.ts'),import('./src/render.ts'),import('./src/server.ts'),import('./src/methods/registry.ts'),import('./src/methods/designs.ts'),import('./src/methods/lint.ts'),import('./src/export_nle.ts')]).then(()=>console.log('OK')).catch(e=>{console.error(String(e));process.exit(1)})"
node_modules/.bin/tsc --noEmit -p .   # 严格类型检查(唯一预期报错:providers/session-scrape 缺 puppeteer 类型,与渲染无关)
node --check public/app.js
```
抽帧看渲染(daemon 渲染会同步阻塞,验证用单镜):
`/opt/homebrew/bin/ffmpeg -y -ss 2.5 -i scene-00X.mp4 -frames:v 1 /tmp/x.png` 再看图。

## 2. 已完成(commit e42ce57 + 42ce57 前)
本会话从「给 Vedio D 里制作视频项目定位」一路做到把 Vedio Make 做成开源项目 + 大改造。最新一笔 **e42ce57**:
- **网页分镜台**(`public/index.html|styles.css|app.js`,原生无依赖):项目列表、可编辑 Scene 表
  (文案/方法/备选/理由/转场/备注)、自动保存(debounce PUT)、单镜&整片预览、增删/重排镜头(↑↓✕+加镜头)、下一步引导。
  `server.ts` 加静态服务(免鉴权 serve `public/` + 注入 token;`?token=` 供 `<video>/<img>`)。
- **渲染审美**:16 个方法全去金光(渐变/发光/投影),改印刷工坊审美。
- **多风格设计系统**(核心):
  - `src/methods/designs.ts` = 5 套预设 `DESIGNS`(inkwork 印刷工坊[默认,=原 BRAND 零回归] / swiss 极简黑白 /
    magazine 杂志编辑 / nocturne 克制深色 / claywarm 暖手作)+ `resolveDesign()` / `resolveSceneDesign()` + `DEFAULT_DESIGN_ID`。
  - `types.ts`:`DesignTokens / DesignSelection / ResolvedDesign` + `Storyboard.project.design` + `Scene.style`(每镜覆盖)。
  - `render.ts`:每镜按 `scene.style ?? project.design` 解析出 `ctx.design` 穿进渲染器;**cache key(srcHash)含 design**(改风格必重渲)。
  - `registry.ts`:11 方法读 `ctx.design.*`(风格感知);5 素材方法(poster/mountain/lottie/image-kenburns/video-clip)去金光,
    压图文字用固定浅色(不用 ctx.design,因为压在图上)。
  - UI:顶栏「整体设计」面板(选预设 + 调纸/墨/强调色 + 衬线↔黑体,应用即重渲)+ 每行「风格」下拉。
  - `GET /api/designs` 给 UI 取目录;PUT storyboard 补默认 design(`ensureDesignDefault`)。
- **土味 lint**(`src/methods/lint.ts`):扫渲染源的 渐变文字/发光/玻璃/AI 金紫配色;`render.ts` 渲染时 `console.warn`;
  `POST /api/projects/:id/lint`;分镜台「土味检查」按钮 + 行内 ⚠。
- **NLE 导出**(`src/export_nle.ts`):已渲染分镜按序生成 **FCPXML / CMX3600 EDL**;
  `GET /api/projects/:id/export/{fcpxml,edl}`;分镜台「导出剪辑」按钮(`?token=` 直链下载)。可导入 Final Cut / DaVinci / 剪映。
- **崩溃修复**:`render.ts` 审批闸 `process.exit(2)` → `throw`(以前 daemon 内全片渲染未确认会**杀掉后端进程**);
  `server.ts` runTaskBody 全片渲染(only==null)自动 `stages.approved=true`(UI 点全部渲染=确认)。

验证过:同一章节卡×5 预设真渲对比;lint 对已迁项目 0 命中;FCPXML/EDL 输出正确;分镜台 UI 截图正常。

## 3. ✅ 已完成:硬化「全片渲染 / final.mp4」(2026-06-28)
**实测推翻了原猜测**。做了受控复现:连续两次 `hyperframes render` **不会**卡在 npx/浏览器锁
(第二次反而 2.5s 秒成)。真正卡死的是 **`hf-tailwind-card` 方法里的 `<script src="https://cdn.tailwindcss.com">` 没被 `harden.ts` 本地化**——
网络差/离线时 Chrome 每个资源等到 `ERR_TIMED_OUT`,堆叠成「11 分钟假死」。复现铁证:首渲 74s(全是超时)vs CDN 命中缓存后 2.5s。
**两个独立问题,都已修 + 实测**:

- **A. daemon 被 `spawnSync` 阻塞** → 新建 **`src/proc.ts`**(异步 `spawn` + 看门狗超时 + 进程组 kill + 行级日志流);
  `render.ts` 全链路 `await`(所有 `run()`→`sh()`,含 `ffmpegFilterCapabilities` 那个漏网的 spawnSync→`runCapture`);
  `server.ts` 任务 **FIFO 串行**(`taskChain`/`enqueueTask`,顺带修掉 `captureLogs` 抢 console 的并发 re-entrancy bug)。
  **验证**:渲染**进行中** `/api/health` 30ms 响应(事件循环不再被堵)。
- **B. tailwind CDN 联网假死** → `harden.ts` 把 `cdn.tailwindcss.com` 也本地化(`assets/vendor/tailwind.min.js`,407KB JIT 引擎),
  并对**任何残留外链 `console.warn` 告警**(未来新方法引入 CDN 会被抓到)。
  **验证**:硬化后场景 HTML **零外部可抓取链接**(离线必然安全);真实渲染 3s、日志无 `Failed to download`/`ERR_TIMED_OUT`。

**额外交付**(原 §3 的「单独 stitch」选项):抽出可复用的 **`stitchFinal()`**;新增
- `runRender({stitchOnly:true})` —— 只拼接已渲镜头,不重渲;校验全部已渲、重算 perceived 时间轴、跳过审批闸;
- 端点 **`POST /api/projects/:id/stitch`**;CLI **`pipeline render --stitch`**;
- 前端「看整片」改为**先走可靠的 stitch 重建 `final.mp4` 再播**(带 cache-buster);
- render 任务 **实时进度(onProgress)+ 子进程日志流(onLine→task log)**;看门狗超时(env 可调
  `PIPELINE_HF_TIMEOUT_MS`/`RM`/`FFMPEG`/`SETTLE_MS`);任务表裁剪(防内存泄漏)。

**全链路实测**:`全部渲染`→`final.mp4`(1080×1920、9.98s,hyperframes+remotion 混合**正确拼接**);
stitch-only 重建一致;看门狗 1.5s 内杀掉假死进程树、无孤儿;抽帧确认**印刷工坊审美无误、中文无豆腐块**。
`tsc` 对改动文件零报错(仓里唯一的 tsc 报错是 `providers/session-scrape` 缺 puppeteer 类型,**与本次无关、改动前就有**)。
对抗式代码审查(8 agent)只确认 1 个小一致性点(并发 `--workers>1` 路径也补了 SETTLE_MS),已修。
**关键文件**:`src/proc.ts`(新)、`src/render.ts`(`runRenderInner`/`stitchFinal`/`sh`/timeouts)、
`src/server.ts`(`enqueueTask`/`stitch` case)、`src/harden.ts`(tailwind 规则)、`public/app.js`(看整片)。
**未提交**——按你的纪律等确认后再显式提交(`git add` 具体文件 + `src/proc.ts` + `assets/vendor/tailwind.min.js`)。

## 4. 易踩的坑
- **改 TS 后 daemon 不热重载**:`pkill -f "cli.ts serve"; lsof -ti:8766|xargs kill -9`,再 `npm run serve`。
- **渲染不再阻塞 daemon**(已改异步 `spawn`):但任务现在 **FIFO 串行**(一次只跑一个 task body),这是有意的
  (保护 `captureLogs` 抢 console + 避免浏览器/缓存竞争);别指望两个 render 任务并发。
- **新方法若引入新 CDN**:`harden.ts` 只本地化 gsap/anime/lottie/tailwind/google-fonts。其他外链渲染时会
  `console.warn` 告警(离线会卡)——在 `CDN_REWRITES` 加规则并把文件放进 `assets/vendor/`。
- **Edit 大改 registry**:方法渲染器里 `${ctx.design.x}` 是**外层模板字面量构建期插值**;Remotion TSX 里 `\${...}` 是转义的运行期插值,别搞混。
- **迁移别名**:`resolveDesign` 暂时同时给 `terra/terra2`(= accent/accent2)兼容老引用;`grep -n '\.terra' src/methods/registry.ts` 清零后可删别名 + `ResolvedDesign` 里的 terra/terra2。
- **provider/key**:走 env / `~/.video-toolkit/providers.json` / macOS Keychain `com.restate.mac`(`src/providers/shared.ts`)。仓内零密钥,别提交 key。
- **提交纪律**:**显式文件路径**提交,别 `git add -A`(`projects/` 下有未跟踪测试项目:`测试_AI视频工具三类-98970411`、`效果样片-c31cd3d4`、`效果样片2-8461713c`,是验证数据,可 `rm` 清掉,别提交)。提交信息末尾带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **预览沙箱坑**:`preview_start`(Claude_Preview)进不了 `~/Documents`(TCC),验证 UI 我都用 **headless Chrome 截图**(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --screenshot=/tmp/x.png URL`)。

## 5. 用户偏好(重要)
- 中文回复;不主动加 emoji。
- 审美严格按印刷工坊(§0),禁渐变/发光/AI 感。
- 做事干到底、要看真实产物(截图验证),不要嘴上说「应该可以」。
- 说「做完再提交」= 全做完才 commit;「继续」= 按既定计划往下。

## 6. ✅ 渲染质量闭环(2026-06-30,借鉴 OpenMontage,clean-room)
在 土味 lint 之上加了三道闸(围绕渲染管线),把「看真实产物」自动化:
- **`src/validate.ts`** —— 渲染前**结构校验**。致命(无/未知 method、时长/时间轴非法、序号重复、前景抠像缺失)在**全片渲染**时**拦截**(除非 force);警告(素材缺失、时间轴空隙)仅提示。单镜渲染(only=N)**不设闸**(快速迭代路径)。坏分镜 ~0ms 就失败,不浪费渲染。
- **`src/slideshow.ts`** —— 幻灯片风险评分(**仅提示,不拦**)。4 维:method 重复率 / 纯文字占比 / 缺 reasoning / 节奏单调。**刻意改造过**:评的是「单调/雷同/没说清意图」,**不评「缺炫动效」**(那会违背印刷工坊克制美学)。
- **`src/review.ts`** —— 渲染后**自检**(= 看真实产物)。ffprobe(时长/分辨率/编码/音轨 vs 预期)+ 抽 4 帧查黑帧/纯色(signalstats YAVG,注意米白底帧亮度高~200+,不会误判黑)+ 音频电平(volumedetect 查静音/削波)。写 `output/qa-report.json` + `output/qa/frame-*.jpg`,返回 pass/warn/fail,**永不抛异常**。挂在 `stitchFinal()` 末尾,全片渲染 + stitch-only 都会跑。
- 接线:`proc.ts` 的 `runCapture` 现在也返回 `stderr`(volumedetect 在 stderr)。端点 `POST /api/projects/:id/validate` → {validate, slideshow}(仿 `/lint`)。CLI:`pipeline validate`(有致命退出码 1)、`pipeline review`。`RenderOpts.skipValidate` 可跳过。
- **实测**:健康板 0 问题;坏板(null method 等)被拦、0ms;真实 final.mp4 自检 pass、抽帧 frame-4.jpg 抓到真实 d3 柱图;daemon 全流程 validate→slideshow→render→自检 全部串起。

## 7. ✅ 借鉴 OpenMontage 的 roadmap 四项(2026-07-01,clean-room,零新依赖)
- **storyboard JSON Schema**:`schemas/storyboard.schema.json` + 自研极简校验器 `src/schema.ts`(不引 ajv,守零依赖)。作为 `validate.ts` 的**第一道 shape 检查**(类型/必填/enum),坏结构直接拦。
- **成本预估**:`src/cost.ts`(数量级、非账单;免费 provider=$0)。`pipeline cost` / `pipeline render --estimate`(dry-run 不渲染)/ `GET /api/projects/:id/cost?tts=&image=&music=`。单价是可改常量。**不做预算闸/上限**(单人本地过度)。
- **决策日志**:`src/decisions.ts`(append 到 `output/decisions.json`,永不抛)。`GET /api/projects/:id/decisions`。已接到 TTS provider 回退事件。
- **provider 回退链**:`providers/registry.ts` 加 `fallbackChain()` + `withFallback()`(环安全);已接进 `tts.ts`——主 provider 失败自动降级(→ Edge 免费兜底)并写一条决策日志。链:tts voice→edge、chat minimax→deepseek→openai、image minimax→openai、search minimax↔tavily。
- 实测:schema 抓到 width 类型错/缺 text/坏 transition;cost 免费板 $0、付费 minimax+music $0.20(0.12–0.32);withFallback 主失败→edge 兜底+落日志;daemon /cost /decisions /validate 全通;CLI cost/validate/review 用 `--in` 均通。

## 8. ⏭ 待办:全面审计 Vedio Make 自身 + 改进方向
用户要求(2026-07-01,`/model` 切到 fable-5 后):**「全面分析这个项目有什么问题、还可以怎么改进(可再对照之前发的参考项目 OpenMontage)」**。审计对象是 **Vedio Make 自己**(不是隔壁项目)。刚起头做仓库摸底就换窗口了。
- **审计基线事实(已摸到)**:`src/` 共 53 个 ts、约 10.7k 行;大文件:`methods/registry.ts` 1788、`render.ts` 993、`server.ts` 713、`storyboard.ts` 580、`cli.ts` 543、`analyze.ts` 512、`edit.ts` 343。**没有 `tests/` 目录 —— 零自动化测试**(重要缺口,审计头号候选)。前端仅 `public/{app.js,index.html,styles.css}` 原生无框架。`package.json` **零运行时依赖**(devDeps 只有 tsx/typescript/@types/node)。既有 tsc 报错唯一一处:`providers/session-scrape/index.ts` 缺 puppeteer 类型(与渲染无关、老问题)。
- **建议切法(ultracode 时用 Workflow 多路并行 + 对抗验证)**:① 正确性/健壮性 bug(server 鉴权/路径穿越、render 竞态、provider 错误处理);② 测试/CI 缺失(零测试是最大工程债);③ 安全(token 处理、`?token=` 泄漏、静态服务路径、密钥读取);④ 可维护性(registry.ts 1788 行是否该拆、类型 any、terra/terra2 迁移别名残留见 §4);⑤ 产品级差距对照 OpenMontage(它有而我没有、且值得要的:如更强的 reviewer skill、research→proposal→approval 阶段化——但要按「保持锋利小工具」筛,别照单全收)。
- **纪律提醒**:改进建议要区分「真该做」vs「过度设计」;守零依赖、印刷工坊审美、只学思路不抄 AGPL。产出建议时**先给结论和优先级,别堆罗列**。
