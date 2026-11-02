# input/ 样例字幕来源

本目录随仓库公开发布(MIT)。**只放自己写的或明确可再分发的字幕**；他人视频的转写、字幕不要提交，放 `input/ref/`(已 gitignore)。
新增 `.srt` 时在下表登记一行，`src/input-sources.test.ts` 会检查每个 `.srt` 都有登记。

| 文件 | 来源 | 用途 |
|---|---|---|
| `2026-ai-video-tools.srt` | 本项目自写 | 数据类短片样例(大数字/对比) |
| `animation-libs-2025.srt` | 本项目自写 | 方法选择样例(对比表) |
| `hero-frame.srt` | 本项目自写 | 单镜头标题卡 |
| `matting-test.srt` | 本项目自写 | 抠像/人物镜头测试 |
| `sample.srt` | 本项目自写 | 最小样例(README 快速开始) |
| `sample-asr-longform.srt` | 本项目自写(2026-11-01，替换原第三方长篇转写) | ASR 风格长字幕：碎句、不均匀停顿、≥1s 空隙，测 `mergeCues` 合并与时间轴空隙 |
| `sample-talking-head.srt` | 本项目自写(2026-11-01，替换原第三方口播字幕) | 口播开场：主讲人自我介绍 + 中英混说 |
