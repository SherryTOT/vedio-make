# 在 Windows 上让 Claude 续接 video-pipeline 开发

> **谁会读这份文档?** Claude(在 Windows 机器上的对话里)。
> **目的**:让一个全新的 Claude 会话快速拿到本项目的身份、技术栈、Windows 适配缺口,顺利接手——不依赖跨机器 memory 迁移。
> **基线**:2026-06-01。原始开发机是 macOS;本文档专讲移植到 Windows。
> **更新**:macOS 专用障碍(clean 脚本 / 烧字幕字体 / 克隆原子写)**已改完跨平台并实测**(§9 ①③⑥);新增**配音/音色克隆**产品线(§10)。代码层面已无已知 macOS 阻塞,**仍待 Windows 真机 smoke test**(§2)。

---

## 0. 你是谁、这是什么

你在帮 air 续接 **video-pipeline** —— 一条「**字幕 → 选方法 → 分镜 → 渲染**」的视频生成管线。Claude 当大脑(每条字幕挑可视化方法),CLI 当肌肉(解析 SRT、生成 HTML/TSX、调 HyperFrames / Remotion / ffmpeg 渲染)。

**目录(本地路径)**:`<...>\Documents\Vedio C\pipeline\`(原 macOS 路径 `/Users/sherry/Documents/Vedio C/pipeline/`)。

**这不是** Restate(那是另一个项目,Swift+Python,在 `Vedio D/`)。别混。

---

## 1. 在 Windows 上装环境

- [ ] **Node.js ≥ 18**(`node -v`)。项目用 `tsx` 直跑 TypeScript,无 build。
- [ ] **ffmpeg 进 PATH**:`winget install Gyan.FFmpeg`(Gyan 的 full build **带 libass**,中文烧字幕走得通——见 §9)。装完 `ffmpeg -version` 能跑。
- [ ] **Chrome / Chromium**:HyperFrames 截帧渲染要 headless Chrome。首次 `npx hyperframes browser` 让它装/认浏览器。
- [ ] (可选)**Python 3.10+**:只有用到 `transcribe`(Whisper)/`remove-background`(u2net)时需要;它们其实是 `npx hyperframes` 子命令自带模型,不是本仓 Python。本仓**没有** Python 依赖。

```powershell
cd "<...>\Documents\Vedio C\pipeline"
npm install            # 装 tsx / typescript / @types/node
npx hyperframes browser  # 一次性,确认 Chrome 可用
```

依赖很轻:`tsx` `typescript` `@types/node`(devDeps)。HyperFrames / Remotion 都是 `npx --yes` 按需拉,不在 package.json。

---

## 2. 验证跑通

```powershell
# 1. 解析字幕 → storyboard.json
npm run plan -- input\sample.srt --title "测试"

# 2. 渲染单个已有项目(最快的烟测):直接渲一个 projects/ 下的成品
cd projects\ascii-reasoning
npx --yes hyperframes@0.6.7 lint
npx --yes hyperframes@0.6.7 render --output renders\test.mp4
# → 出 mp4 = Chrome + ffmpeg 链路通
```

如果 `npm run plan` 出 `output\storyboard.json`、且单项目能 render 出 mp4,环境就 OK。

---

## 3. 项目结构 / 怎么用

```
pipeline\
├─ package.json        scripts: plan / storyboard / render / clean
├─ src\
│  ├─ cli.ts           入口(plan / storyboard / render 子命令)
│  ├─ render.ts        渲染调度 + ffmpeg 拼接 + 烧字幕   ← §9 重点
│  ├─ harden.ts        渲染前加固:打包中文字体 + 本地化 CDN  ← 已跨平台
│  ├─ methods\registry.ts  各方法的 HTML/TSX 生成器
│  └─ ...              plan / storyboard / srt / providers / tts / matte ...
├─ methods\catalog.json  方法注册表(S/A/B 三档可靠性)
├─ assets\fonts\       打包的中文 woff2(Noto Sans/Serif SC)
├─ assets\vendor\      打包的 gsap / three / lottie
├─ projects\           独立 HyperFrames 成品(GSAP/Three.js 合成)
└─ output\             运行时产物(storyboard.json / scenes / final.mp4)
```

**流程**:`npm run plan -- input\x.srt` → Claude 填 method → `npm run storyboard`(出 html 复核)→ `npm run render`(每 scene 一个 mp4 → ffmpeg concat → `output\final.mp4`)。只重渲一个:`npm run render -- --only 3`;强制全渲:`npm run render -- --force`。

---

## 4. 关键约束(从 memory 复刻)

- **确定性渲染**:合成里禁 `Math.random()` / `Date.now()` / `setTimeout` / CSS 无限动画;用种子 PRNG、有限 repeat、GSAP 时间线。HyperFrames 靠 seek 时间线截帧。
- **HyperFrames 捕获引擎陷阱**(踩过很多次,见 memory `reference_hyperframes_three_gotchas`):
  - 透明 `MeshBasicMaterial`、`setDrawRange`、`TubeGeometry`(Frenet NaN)、**首帧不可见(scale/opacity≈0 或 visible:false)的对象**——都会**静默不渲染**。对策:不透明材质 + 完整几何 + 首帧即可见,用位移/亮度表达出现。
  - `gsap.fromTo` 默认 `immediateRender:true`:时间门控的逐元素 tween 要传 `immediateRender:false`;`tl.from(opacity:0)` 到当前态本就是 0 时会全程不可见,改用 `fromTo` 到 1。
- **动画观感/节奏**(用户两次反馈,见 memory `reference_animation_quality_bar`):富但不能跳。离散视觉事件 ≤ 每 ~1.5–2s 一个;短字幕句合并进一个稳定演化的场景;全片 ~3–5 次硬切;禁 back/elastic/抖动/快 stagger 当节奏用。
- **渲染版本钉 `hyperframes@0.6.7`**:0.5.x 不嵌入 `@font-face url()` 引用的字体 → 中文豆腐块。`src\render.ts` 和 `src\matte.ts` 都钉版本,别降。

---

## 5. 不要做的事

- ❌ 别把渲染版本降回 `0.5.7`(字体嵌入会坏,§4)。
- ❌ 别在合成里用 `Math.random` / `setTimeout` / 无限 CSS 动画(破坏 seek 确定性)。
- ❌ 别删 `src\harden.ts` 的加固步骤——它是中文跨平台 + 离线渲染的保证。
- ❌ 别把 `assets\fonts` / `assets\vendor` 当可删的缓存(它们是离线/确定性渲染的打包资产)。

---

## 6. 怎么继续工作

- 看 `README.md`(流程总览)、`methods\catalog.json`(可用方法)。
- 加新方法 = `src\methods\registry.ts` 写生成器 + 注册进 `METHOD_RENDERERS` + `catalog.json` 标 `implemented`。
- 加固对所有方法生效(单一入口 `renderHyperFramesScene`),新方法用同样的字体族名就会被 `harden.ts` 的别名命中。

---

## 7. 常见问题(Windows)

| 现象 | 原因 / 处理 |
|---|---|
| `say` 报「Edge 配音组件连接失败」 | Edge 免费引擎软依赖,受限网络握手被拒。改 `--voice minimax:<id>`,或换网络/代理(§10)。 |
| `render` 出的视频中文是豆腐块 | **只可能在烧字幕那一步**(§9-③):ffmpeg 用了 macOS 系统字体路径。HTML 画面本身的中文已由 `harden.ts` 嵌入,不受影响。 |
| `npx hyperframes render` 报找不到 Chrome | 跑 `npx hyperframes browser`;或装系统 Chrome。 |
| ffmpeg 烧字幕报 `No such filter: 'subtitles'` | 你的 ffmpeg 没编 libass。换 Gyan full build(§1),或走 drawtext 回退(也要改字体路径,§9-③)。 |
| provider key 没生效 | Windows 没有 macOS Keychain(§9-④)。把 key 写进 `~\.video-toolkit\providers.json` 或 `.env`。 |
| 直接 `./src/cli.ts` 跑不了 | shebang 在 Windows 无效(§9-②)。always 走 `npm run ...` / `npx tsx src\cli.ts`。 |

---

## 8. 前端(HTML / CSS / JS 合成)

本管线的「前端」= `projects\*\index.html` 里的**浏览器合成**(GSAP / Three.js / SVG / Canvas),由 HyperFrames 在 headless Chrome 里 seek 时间线、逐帧截图成视频。**和平台无关**——同一份 HTML 在 macOS / Windows 渲染结果一致。

- **作者契约**:根元素 `data-composition-id` + `data-duration`;时间线 `gsap.timeline({paused:true})` 注册到 `window.__timelines["root"]`;监听 `hf-seek` 驱动 Three.js。
- **可靠性铁律**(§4 的捕获引擎陷阱):确定性 + 不透明几何 + 首帧可见 + `immediateRender:false`。
- **节奏铁律**(§4):稳定锚点 + 缓慢累加,别一字幕一切场。
- **中文字体**:写 `font-family:"PingFang SC"/"Noto Sans SC"/...` 即可,`src\harden.ts` 会自动剥 Google Fonts、注入 `@font-face` 指向 `assets\fonts` 的 woff2、把 gsap/three/lottie 的 CDN 换成 `assets\vendor` 本地副本。**新方法沿用这些字体族名**就会被命中。这一层让前端跨平台,无需为 Windows 改任何 HTML。

---

## 9. 适配(macOS → Windows)

代码整体跨平台:`os.tmpdir()` / `path.join` / `os.homedir()` / `fs.rmSync`,无硬编码 `/`。**①③ 已在 2026-06-01 改完并验证**(下面标「✅ 已改」);②④⑤ 是说明/前提,无需改文件。

**① `package.json` 的 `clean` 脚本 —— ✅ 已改跨平台**
原 `"clean": "rm -rf output/*"`(Unix-only)已换成纯 Node 实现:遍历 `output/` 删内容、保留目录。Win/mac 都行,实测过。无需再动。

**② `src\cli.ts` 的 shebang 在 Windows 失效**
第 1 行 `#!/usr/bin/env -S npx tsx` —— Windows 不认 shebang。
改法:不用改文件,**永远走 `npm run plan/storyboard/render` 或 `npx tsx src\cli.ts`**,别试图 `./src/cli.ts` 直接执行。(`package.json` 的 `bin` 字段在 Windows 也是靠 npm 生成 `.cmd` shim,正常 `npm install` 后可用。)

**③ ffmpeg 烧字幕的 macOS 字体 —— ✅ 已改平台感知** —— `src\render.ts` `burnSubtitles()` + 新增 `cjkBurnFont()`
- 新增 `cjkBurnFont()` 按 `process.platform` 返回 `{name, file}`:**Win = 微软雅黑**(name `Microsoft YaHei` / file `C:\Windows\Fonts\msyh.ttc`、`msyhbd.ttc`、`simhei.ttf`、`simsun.ttc`)、Linux = Noto CJK、mac = PingFang。
- **Path A(libass)**:`force_style` 的 `FontName=` 现在取 `cjkBurnFont().name`。
- **Path B(drawtext 回退)**:字体从 `cjkBurnFont().file` 取;**找不到可用 CJK 字体不再抛错,而是跳过烧字幕、原样复制**(final.mp4 不受影响)。
- ⚠️ 仍只影响**烧进画面的字幕**;`projects\` 里 HTML 画面的中文由 §8 `harden.ts` 嵌入,不走这条路。
- 罕见:Windows 精简版若连微软雅黑都没有 → 烧字幕被跳过(有 warning)。装任一 CJK 字体到 `C:\Windows\Fonts` 即可。

**⑥ 克隆音色本地清单的原子写 —— ✅ 已加 Windows 兜底** —— `src\providers\minimax\voice-clone.ts`
`renameSync(tmp, dest)` 在 Windows 覆盖已有文件可能 `EPERM`;已加 `catch → copyFile + unlink` 回退,`chmod` 已 try/catch(Win 上是 no-op)。

**④ provider key 的 macOS Keychain 读取(非阻塞)** —— `src\providers\shared.ts:21` `keychainGet()`
调 `/usr/bin/security`,已用 `if (process.platform !== "darwin") return ""` 守住,**Windows 上直接返回空、不报错**。后果只是没有 Keychain 集成。
改法:不用改;Windows 把 LLM/TTS key 放 `~\.video-toolkit\providers.json` 或 `.env` 即可(代码本来就有这条 fallback)。如果想要 Windows 凭据管理器集成,再单独做。

**⑤ ffmpeg 必须带 libass 才有最佳中文字幕** —— 见 §1 用 Gyan full build。否则只能走 ③ 的 Path B drawtext(需 libfreetype + 可用字体路径)。

**没有发现**:硬编码绝对路径、`/`-only 分隔符、macOS-only 的 `open`/`pbcopy` 之类被代码依赖(那些只在我手动预览命令里出现过,不在管线代码里)。

---

## 10. 配音 / 音色克隆(2026-06-01 从 Restate 移植进来)

两引擎,按 voice-id 前缀**自动路由**,调用方不用关心:

| 引擎 | 触发(voice id) | 成本 | key |
|---|---|---|---|
| **Edge**(免费) | `zh-CN-XiaoxiaoNeural` 等(非 `minimax:` 前缀) | 免费无配额 | 不需要 |
| **MiniMax**(付费) | `minimax:<id>`;克隆音色 `minimax:user_<hex>` | 按量 | 需 `MINIMAX_API_KEY` |

```powershell
npx tsx src\cli.ts voices                                       # 分组列:免费Edge / 付费MiniMax / 我的克隆
npx tsx src\cli.ts say "你好世界" --voice zh-CN-XiaoxiaoNeural --out hello.mp3   # 任意文本→mp3(免费)
npx tsx src\cli.ts say "正式播报" --voice minimax:presenter_male --emotion happy  # 付费,带情绪
npx tsx src\cli.ts voice clone my_sample.m4a --label "我的声音"  # 克隆 → minimax:user_<hex>
npx tsx src\cli.ts voice list | keepalive <id> | rm <id>        # 克隆管理
npx tsx src\cli.ts tts --voice minimax:female-shaonv            # 逐场配音(读 storyboard)
```

**实现**(都在 `src\providers\`):`edge\tts.ts`(原生 WebSocket,**无新依赖**,Node 22+ 全局 WebSocket)、`minimax\tts.ts`(T2A,模型候选链 + 2061/2056 跳过 + hex 解码 + 情绪白名单 + HTTPS 强制)、`minimax\voice-clone.ts`(克隆:upload→clone→本地清单 `~\.video-toolkit\cloned_voices.json`、168h 永久规则、file_id 不 cast、1004 当成功)、`voice-router.ts`(前缀路由,注册为默认 tts provider)。文本清洗(markdown 剥离 + 1万字上限)在 `src\tts-clean.ts`。

**Windows 注意**:
- 全部跨平台(`os.homedir()`、原生 fetch/FormData/WebSocket;`chmod`/`rename` 已加 Win 兜底,§9-⑥)。
- ⚠️ **Edge 是软依赖**:受限网络 WebSocket 握手可能被拒(报「Edge 配音组件连接失败」+ 改用 MiniMax 的提示)。预期行为,非 bug——换网络/代理,或用 `minimax:*`。
- 克隆音色 168h 内**用一次即转永久**(任何 say/tts 调用都算);删除**只删本地**(MiniMax 无远程删除 API)。
- key 走环境变量 `MINIMAX_API_KEY` 或 `~\.video-toolkit\providers.json`(§9-④);**泄露过的旧 key 轮换后再用**。

---

**给 Claude 的最后提醒**:本管线的价值在「确定性可渲染 + 中文跨平台 + 观感不跳」。改 Windows 适配时,§9 的⑤项改完就能跑通;别顺手降 hyperframes 版本、别破坏 `harden.ts`、别在合成里引入非确定性。有疑问先看 memory 里 `reference_hyperframes_three_gotchas` 和 `reference_animation_quality_bar`。
