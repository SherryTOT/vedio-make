# Vedio Make

> 字幕(SRT) → 分镜 → 渲染 → `final.mp4` 的 AI 视频生成管线 · 本地优先 · 零运行时依赖 · MIT

Claude 当大脑(给每条字幕挑可视化方法),CLI 当肌肉(解析 SRT、生成合成源、调用 **HyperFrames / Remotion / ffmpeg** 渲染、拼接成片)。既能在网页分镜台里点点点,也能纯 CLI 跑。

## 环境要求

- **Node ≥ 18**(用 `tsx` 直接跑 TypeScript,无构建步骤)
- 本机装好 **`ffmpeg`**(拼接 / 混音 / 抽帧自检都靠它)
- 渲染引擎 **HyperFrames / Remotion** 通过 `npx --yes` 按需拉取(首次联网,之后走缓存)
- 运行时**零 npm 依赖**;`npm install` 只装 devDeps(`tsx` / `typescript`)

```bash
git clone https://github.com/SherryTOT/vedio-make.git
cd vedio-make
npm install
```

## 最快上手:网页分镜台

```bash
npm run serve          # daemon 起在 http://127.0.0.1:8766/
```

打开 `http://127.0.0.1:8766/` → 「新建项目」→ 粘贴一段 SRT 字幕 → 自动切出分镜。之后在表格里逐镜编辑文案 / 方法 / 风格,一条工具栏走完全流程:

**分析**(Claude 自动选方法)→ **配图** → **配音** → **配乐** → **全部渲染** → **看整片** → **导出剪辑**(FCPXML / EDL,可进 Final Cut / DaVinci / 剪映)。

> daemon 默认只绑 `127.0.0.1` 且带 bearer token 鉴权(未设 `--token` 时自动生成并注入页面)。只在本机可用;要局域网访问需显式 `--host 0.0.0.0`(自担风险)。

## 零 key 免费路径

不配任何 API key 也能出片——只是方法要自己挑(不跑「分析」这步 LLM):

1. `npm run serve`,新建项目粘贴 SRT(`plan` 只做解析,不需 key)
2. 在分镜台里给每镜手动选 `method`(下拉里都是已实现的方法)
3. **配音**用免费的 Edge 音色(无 MiniMax key 时自动降级到 Edge,零成本)
4. **全部渲染** → HyperFrames / Remotion / ffmpeg 全部本地、免费

配图(图库/生成)和「分析」需要 provider key,见下。

## Provider keys(可选)

只有用到 LLM(分析 / 改写 / 翻译)、付费配音、配图生成、联网检索时才需要。三条解析通道(按优先级):

1. **环境变量** `<PROVIDER>_API_KEY`,例如 `export MINIMAX_API_KEY=…` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `TAVILY_API_KEY` / `PEXELS_API_KEY`
2. `~/.video-toolkit/providers.json`(`{ "providers": [{ "id": "minimax", "base_url": "…", "api_key": "…", "model": "…" }] }`)
3. macOS Keychain(service `com.restate.mac`,account = provider id)

仓库内**不含任何 key**。缺 key 时相关命令会报清楚缺哪个、去哪配。免费兜底:配音有 Edge,回退链会在主 provider 失败时自动降级并记一条决策日志(`output/decisions.json`)。

## CLI(`pipeline <cmd>` 或 `npx tsx src/cli.ts <cmd>`)

| 命令 | 作用 |
|---|---|
| `plan --in x.srt --title …` | SRT → `storyboard.json`(每镜一个 scene,方法待填) |
| `analyze` | Claude/LLM 给每镜选方法(读 `methods/catalog.json`) |
| `edit "<指令>"` | 自然语言改分镜 |
| `approve` | 标记 `stages.approved`(全片渲染的闸) |
| `storyboard` | 生成 `storyboard.html` 预览 |
| `research` / `images` / `matte` | 数据检索 / 生成配图 / 前景抠像 |
| `fetch --scene N` / `import <file>` | 图库检索配图(Pexels/Pixabay/Unsplash)/ 导入本地素材 |
| `tts` / `bgm` / `say` / `voice` | 配音 / 配乐 / 单句朗读 / 音色管理 |
| `translate <lang>` | 整片翻译 |
| `render [--only N] [--force] [--workers 2] [--stitch] [--estimate]` | 逐镜渲染 + 拼接 `final.mp4` |
| `validate` / `review` / `cost` | 渲前结构校验+幻灯片风险 / 渲后自检 / 成本预估 |
| `serve --projects ./projects [--port] [--token]` | 起网页分镜台 daemon |

单镜快迭代:`pipeline render --only 3`;只重拼不重渲:`pipeline render --stitch`。

## 审美:印刷工坊(可切换)

默认 **印刷工坊**——陶土橙 `#c36c36` / 米白 `#f6f5f1` / 深褐 `#1b1612`,衬线,克制,**禁渐变 / 发光 / 投影 / AI 金光感**。另有 4 套预设(极简黑白 Swiss / 杂志编辑 / 克制深色 Nocturne / 暖手作 Claywarm),在分镜台「整体设计」里切,也可每镜覆盖。渲染时有「土味 lint」自动扫描 AI-slop 信号并告警。

## 项目结构

```
vedio-make/
├── methods/catalog.json    ← 方法注册表(16 项,分析器从这里挑;S/A/B 三档可靠性)
├── schemas/                ← storyboard JSON Schema
├── assets/vendor/          ← 本地化的 CDN 资产(gsap/anime/lottie/tailwind/字体,离线可渲)
├── src/
│   ├── cli.ts              ← CLI 入口
│   ├── server.ts           ← 分镜台 daemon
│   ├── render.ts           ← 渲染 + 拼接 + 混音 + 自检
│   ├── harden.ts           ← 渲染前把外链 CDN 本地化(可复现/离线安全)
│   ├── validate/slideshow/review/cost/decisions.ts  ← 质量闭环
│   ├── methods/{registry,designs,lint}.ts           ← 方法渲染器 / 设计系统 / 土味 lint
│   └── providers/          ← chat/tts/image/music/search 适配器 + 回退链
├── public/                 ← 网页分镜台(原生 JS,无框架)
└── projects/               ← 各项目数据(每个含 output/storyboard.json)
```

## 开发

```bash
npm run typecheck    # tsc --noEmit(严格模式)
npm test             # tsx --test(纯函数单测,<2s,不渲染/不起 daemon)
npm run check        # node --check + typecheck + test(CI 跑的同一套门禁)
```

CI 见 `.github/workflows/ci.yml`。

## License

MIT。渲染引擎(HyperFrames / Remotion)与各 provider 有各自的许可与计费,自行确认。
