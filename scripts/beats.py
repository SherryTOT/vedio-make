#!/usr/bin/env python3
"""Group the 1175 transcript segments into reviewable narrative BEATS.

Boundary = silence gap >= 1.0s, OR running beat duration >= 16s, OR a chapter
boundary (from the visual contact-sheet analysis). Emits beats.json + a compact
console listing (time | text) grouped by chapter for building PICTURE-MAP B.
"""
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEGS = json.load(open(os.path.join(HERE, "output", "BV1hN596zEas.transcript.json")))["segments"]

# Chapter boundaries (sec) — approx from contact-sheet visual structure S0..S7.
CHAPTERS = [
    (0,    8,    "S0 片头"),
    (8,    285,  "S1 背景·亚洲奇迹/墨西哥龙舌兰危机"),
    (285,  575,  "S2 资本涌入·泰国泡沫「资本的魔力」"),
    (575,  865,  "S3 索罗斯狙击泰铢「正面进攻/空头狙击」"),
    (865,  1150, "S4 危机扩散·韩国「多米诺骨牌 97-99」"),
    (1150, 1440, "S5 香港保卫战 + 俄罗斯 GKO 违约"),
    (1440, 1730, "S6 总结·影响「资本的流动」"),
    (1730, 9999, "S7 片尾"),
]

def chap(t):
    for a, b, name in CHAPTERS:
        if a <= t < b:
            return name
    return "S?"

GAP = 1.0
MAXLEN = 16.0
beats = []
cur = None
for s in SEGS:
    boundary = False
    if cur is None:
        boundary = True
    else:
        if s["start"] - cur["end"] >= GAP:
            boundary = True
        elif s["end"] - cur["start"] >= MAXLEN:
            boundary = True
        elif chap(s["start"]) != chap(cur["start"]):
            boundary = True
    if boundary:
        cur = {"start": s["start"], "end": s["end"], "text": s["text"],
               "chap": chap(s["start"])}
        beats.append(cur)
    else:
        cur["end"] = s["end"]
        cur["text"] += s["text"]

json.dump(beats, open(os.path.join(HERE, "output", "beats.json"), "w"),
          ensure_ascii=False, indent=1)

def mmss(t):
    return f"{int(t//60):02d}:{int(t%60):02d}"

last = None
for i, b in enumerate(beats):
    if b["chap"] != last:
        print(f"\n#### {b['chap']}")
        last = b["chap"]
    print(f"[{i:03d}] {mmss(b['start'])}-{mmss(b['end'])} ({b['end']-b['start']:4.0f}s) {b['text']}")

print(f"\nTOTAL beats={len(beats)}  segs={len(SEGS)}  dur={SEGS[-1]['end']:.0f}s")
