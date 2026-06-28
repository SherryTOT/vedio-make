#!/usr/bin/env python3
"""Build a VISUAL storyboard: one reference thumbnail per beat + narration +
recommended engine/method. Output: output/storyboard.html (open in browser).
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP4 = os.path.join(HERE, "input", "ref", "BV1hN596zEas.mp4")
BEATS = json.load(open(os.path.join(HERE, "output", "beats.json")))
FRAMES_DIR = os.path.join(HERE, "output", "storyboard-frames")
OUT = os.path.join(HERE, "output", "storyboard.html")
os.makedirs(FRAMES_DIR, exist_ok=True)

# Treatment overrides from PICTURE-MAP Layer B: (start, end, tag, note).
# tag ∈ kou(口播) hf rm cust(定制) cut(删) bro(占位).  Default = kou.
OV = [
    (0, 8, "hf", "片头标题卡:5国名击出+红脉冲 hf-kinetic-text"),
    (39, 54, "hf", "概念卡「华盛顿共识 1989/金融自由化」"),
    (130, 159, "cust", "资本套利示意:美3%→墨5% 锚定挂钩(SVG资本流)"),
    (159, 173, "rm", "R1 墨西哥GDP/外资流入折线 1990-94"),
    (173, 203, "rm", "R2 美联储利率折线 1990-95"),
    (233, 265, "rm", "R3 比索/美元崩盘折线 +大数字-40%"),
    (285, 316, "hf", "大数字 $500亿 IMF救助 + IMF logo(素材)"),
    (316, 350, "hf", "章节卡「资本的魔力」+ 道德风险概念图"),
    (366, 394, "rm", "R4 亚洲各国GDP增速柱状"),
    (407, 454, "rm", "R5 日资占各国外债比柱状"),
    (529, 544, "hf", "大数字 $2300亿 日本坏账"),
    (557, 575, "rm", "R6 泰国SET指数1996折线(跌段红)"),
    (575, 589, "hf", "章节卡「正面进攻/空头狙击」"),
    (589, 649, "cust", "空头狙击四步流程示意(SVG,可复用)"),
    (634, 649, "rm", "R7 英镑/马克黑色星期三折线 +大数字$18亿"),
    (679, 730, "cut", "❌雅诗兰黛520广告 整段删除(beats48-51)"),
    (832, 866, "cust", "两股资本流向泰国:日资撤↘+空头涌入↗(SVG)"),
    (866, 911, "hf", "大数字组 泰国外储<400/270/80亿"),
    (930, 942, "hf", "事件卡 1997.5 高盛报告(截图素材)"),
    (958, 973, "hf", "大数字 1500% 拆借利率(冲击放大)"),
    (973, 1003, "hf", "大数字 $10亿/$30亿 大决战"),
    (1003, 1033, "cust", "★1997.7.2泰铢脱钩·东南亚连环(复用地球仪范式)"),
    (1033, 1049, "rm", "R9 各国货币贬幅柱状 菲-40/马-46/印尼-80%"),
    (1069, 1077, "hf", "大数字 $600亿+ 港府弹药"),
    (1077, 1107, "cust", "★18:23 多米诺传染地球仪 ✅已完成"),
    (1107, 1138, "hf", "大数字300% + R10恒生10月崩盘折线"),
    (1179, 1194, "hf", "大数字组 IMF救韩$570亿/总$1180亿"),
    (1256, 1316, "cust", "香港保卫战高潮 + R11港股爆量柱(8/28=790亿20x)"),
    (1332, 1345, "rm", "R12 恒生1998-2000回升折线 →17000+"),
    (1345, 1376, "hf", "事件卡 休克疗法/GKO + 概念示意"),
    (1376, 1420, "rm", "R13 GKO利率→150%/油价折线"),
    (1420, 1440, "hf", "事件卡 1998.8.17 俄违约"),
    (1440, 1466, "rm", "R14 GKO面值10-15%/LTCM/巴西/油价<$11"),
    (1466, 1482, "hf", "章节卡「资本的流动/影响」"),
    (1525, 1555, "rm", "R15 失业人数柱状 泰>200万/印尼>2000万"),
    (1571, 1602, "cust", "★资本流动主线总回顾(墨→东南亚→东亚→俄→巴西)"),
    (1694, 1719, "hf", "收尾呼应 + 片尾卡「谢谢观看」"),
]

# B-roll placeholder windows (政要/交易所/人群) — coarse, from contact sheets.
BRO = [(218, 233), (454, 529), (760, 832), (1138, 1179), (1602, 1694)]

LABEL = {"kou": ("口播·保留原片", "#6b7280"), "hf": ("HyperFrames", "#3b6fe0"),
         "rm": ("Remotion·需数据", "#1f9d57"), "cust": ("定制 3D/SVG", "#8b46d6"),
         "cut": ("删除", "#d63a3a"), "bro": ("B-roll·占位", "#c98a1e")}


def tag_for(b):
    mid = (b["start"] + b["end"]) / 2
    for s, e, t, note in OV:
        if s <= mid < e:
            return t, note
    for s, e in BRO:
        if s <= mid < e:
            return "bro", "历史影像/政要/交易所 — 暂占位后补"
    return "kou", "保留原片主持人(可选关键词浮层)"


def mmss(t):
    return f"{int(t//60):02d}:{int(t%60):02d}"


rows = []
last_chap = None
for i, b in enumerate(BEATS):
    img = f"storyboard-frames/b{i:03d}.jpg"
    out_img = os.path.join(HERE, "output", img)
    if not os.path.exists(out_img):
        mid = (b["start"] + b["end"]) / 2
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-ss",
                         f"{mid:.2f}", "-i", MP4, "-frames:v", "1", "-vf",
                         "scale=384:-1", "-q:v", "4", out_img, "-y"], check=False)
    t, note = tag_for(b)
    lbl, color = LABEL[t]
    if b["chap"] != last_chap:
        rows.append(f'<h2 class="chap">{b["chap"]}</h2>')
        last_chap = b["chap"]
    txt = b["text"].replace("<", "&lt;")
    if len(txt) > 140:
        txt = txt[:140] + "…"
    rows.append(f'''<div class="card">
<img src="{img}" loading="lazy"/>
<div class="meta">
  <div class="tline"><span class="t">[{i:03d}] {mmss(b["start"])}–{mmss(b["end"])}</span>
  <span class="badge" style="background:{color}">{lbl}</span></div>
  <div class="nar">{txt}</div>
  <div class="rec">▸ {note}</div>
</div></div>''')

html = f'''<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>分镜故事板 — 亚洲金融危机 BV1hN596zEas</title>
<style>
 body{{margin:0;background:#0d0f14;color:#e9eaf0;font-family:"PingFang SC",system-ui,sans-serif}}
 header{{position:sticky;top:0;background:#12151c;padding:14px 24px;border-bottom:1px solid #262b36;z-index:9}}
 header h1{{margin:0 0 6px;font-size:18px}} header .sub{{font-size:12px;color:#9aa0ad}}
 .legend{{margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;font-size:12px}}
 .legend span{{display:inline-flex;align-items:center;gap:5px}}
 .dot{{width:11px;height:11px;border-radius:3px;display:inline-block}}
 .chap{{margin:26px 24px 10px;font-size:16px;color:#ffd27a;border-left:3px solid #ffd27a;padding-left:10px}}
 .card{{display:flex;gap:16px;margin:10px 24px;background:#161a22;border:1px solid #232938;border-radius:10px;overflow:hidden}}
 .card img{{width:384px;height:216px;object-fit:cover;background:#000;flex:none}}
 .meta{{padding:12px 16px;min-width:0}}
 .tline{{display:flex;align-items:center;gap:10px;margin-bottom:7px}}
 .t{{font-variant-numeric:tabular-nums;color:#9aa0ad;font-size:13px}}
 .badge{{font-size:12px;font-weight:700;color:#fff;padding:3px 9px;border-radius:5px}}
 .nar{{font-size:14px;line-height:1.6;color:#cfd3dd}}
 .rec{{margin-top:8px;font-size:13px;color:#8fd6a8;font-weight:600}}
</style></head><body>
<header><h1>分镜故事板 · 《一口气了解亚洲金融危机》28:39 · 122 节拍</h1>
<div class="sub">每节拍 = 原片代表帧 + 旁白(faster-whisper 转写) + 推荐引擎/做法。确认前不渲染。</div>
<div class="legend">
 <span><i class="dot" style="background:#6b7280"></i>口播·保留原片</span>
 <span><i class="dot" style="background:#3b6fe0"></i>HyperFrames(章节卡/大数字/片头尾)</span>
 <span><i class="dot" style="background:#1f9d57"></i>Remotion·需数据(折线/柱状)</span>
 <span><i class="dot" style="background:#8b46d6"></i>定制 3D/SVG(地球仪类)</span>
 <span><i class="dot" style="background:#c98a1e"></i>B-roll·占位</span>
 <span><i class="dot" style="background:#d63a3a"></i>删除(广告)</span>
</div></header>
{''.join(rows)}
<div style="height:60px"></div></body></html>'''

open(OUT, "w", encoding="utf-8").write(html)
print(f"storyboard.html written: {len(BEATS)} beats, frames in {FRAMES_DIR}")
