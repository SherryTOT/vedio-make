#!/usr/bin/env python3
"""Build a VISUAL storyboard: one reference thumbnail per beat + narration +
recommended engine/method. Output: output/storyboard.html (open in browser).

Usage: python3 scripts/storyboard_html.py <reference.mp4> [plan.json]
Run scripts/beats.py first (reads output/beats.json).

plan.json (optional) = {"title", "subtitle", "overrides": [[start, end, tag, note], ...],
                        "broll": [[start, end], ...]}
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if len(sys.argv) < 2:
    sys.exit(__doc__)

MP4 = sys.argv[1]
PLAN = json.load(open(sys.argv[2], encoding="utf-8")) if len(sys.argv) > 2 else {}
BEATS = json.load(open(os.path.join(HERE, "output", "beats.json"), encoding="utf-8"))
FRAMES_DIR = os.path.join(HERE, "output", "storyboard-frames")
OUT = os.path.join(HERE, "output", "storyboard.html")
os.makedirs(FRAMES_DIR, exist_ok=True)

# Treatment overrides (PICTURE-MAP Layer B): [start, end, tag, note].
# tag ∈ kou(口播) hf rm cust(定制) cut(删) bro(占位).  Default = kou.
OV = [tuple(o) for o in PLAN.get("overrides", [])]
# B-roll placeholder windows [start, end] — coarse, from contact sheets.
BRO = [tuple(b) for b in PLAN.get("broll", [])]
TITLE = PLAN.get("title", f"分镜故事板 · {os.path.basename(MP4)} · {len(BEATS)} 节拍")
SUBTITLE = PLAN.get("subtitle", "每节拍 = 原片代表帧 + 旁白 + 推荐引擎/做法。确认前不渲染。")

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
<title>{TITLE}</title>
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
<header><h1>{TITLE}</h1>
<div class="sub">{SUBTITLE}</div>
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
