# Vedio Make

> 字幕 → 分镜 → 渲染 的 AI 视频生成管线 · MIT 开源

字幕 → 方法选择 → 分镜确认 → 渲染 的视频生成管线。Claude 当大脑（每条字幕挑选合适的视觉化方法），CLI 当肌肉（解析 SRT、生成代码、调用 HyperFrames / Remotion / ffmpeg 渲染）。

## 安装

```bash
cd pipeline
npm install
```

依赖：Node 18+，本机装好 `ffmpeg`。HyperFrames 和 Remotion 通过 `npx --yes` 按需拉取。

## 流程

### 1. 准备输入

- 把字幕放到 `input/sample.srt`（SRT 格式，带时间码）
- 把素材（图片 / Lottie JSON / Rive .riv / 视频 / 数据 JSON）放到 `assets/`
- 视项目需要修改 `design.md`（颜色、字体、动效个性）

### 2. 解析字幕

```bash
npm run plan -- input/sample.srt --title "标题"
```

产出 `output/storyboard.json` —— 每条字幕一个 scene，`method` / `fallback` / `reasoning` 全部 `null`。

### 3. Claude 填方法

在 Claude Code 对话里让 Claude：

1. 读 `methods/catalog.json`（可选方法列表）
2. 读 `output/storyboard.json`（要填的 scene）
3. 读 `design.md` + `assets/` 文件清单
4. 给每个 scene 写 `method`（reliability=S 优先）/ `fallback` / `reasoning` / `assets`

### 4. 生成分镜预览

```bash
npm run storyboard
```

产出 `output/storyboard.html` —— 浏览器打开看每个 scene 的卡片（方法名 + tier 色块 + 素材引用 + 理由）。

### 5. Review + 改

用户在 storyboard.html 看完，对不满意的 scene 直接编辑 `output/storyboard.json`（改 method id），或者让 Claude 改。

### 6. 渲染

```bash
npm run render
```

- 每个 scene 独立渲染到 `output/scenes/scene-XXX.mp4`
- HyperFrames 方法 → 写临时 HTML → `npx hyperframes render`
- Remotion 方法 → 写临时 TSX + 安装依赖 → `npx remotion render`
- 全部成功后 ffmpeg concat 拼接成 `output/final.mp4`

只重渲一个 scene：

```bash
npm run render -- --only 3
```

强制重渲全部（忽略缓存）：

```bash
npm run render -- --force
```

## 当前可用方法（前 3 个）

| id | engine | reliability |
|---|---|---|
| `hf-css-fade` | hyperframes (CSS) | S |
| `hf-kinetic-text` | hyperframes (GSAP) | S |
| `rm-d3-bar-chart` | remotion (D3) | A |

完整 15 个方法定义在 `methods/catalog.json`，待实现的方法 renderer 在 `src/methods/registry.ts` 里加函数即可。

## 项目结构

```
pipeline/
├── package.json
├── tsconfig.json
├── design.md             ← 项目品牌定义
├── methods/
│   └── catalog.json      ← 方法注册表（15 项，分 S/A/B 三档可靠性）
├── src/
│   ├── cli.ts            ← 入口（plan / storyboard / render 三个子命令）
│   ├── types.ts          ← 共享类型
│   ├── srt.ts            ← SRT 解析器
│   ├── plan.ts           ← `plan` 子命令实现
│   ├── storyboard.ts     ← `storyboard` 子命令实现
│   ├── render.ts         ← `render` 子命令实现
│   └── methods/
│       └── registry.ts   ← 各方法的代码生成器
├── input/                ← 用户放 SRT
├── assets/               ← 用户放图片/视频/JSON 等
└── output/               ← 运行时产物
    ├── storyboard.json
    ├── storyboard.html
    ├── scenes/
    └── final.mp4
```
