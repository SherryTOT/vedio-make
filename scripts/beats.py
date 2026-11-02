#!/usr/bin/env python3
"""Group transcript segments into reviewable narrative BEATS.

Usage: python3 scripts/beats.py <transcript.json> [chapters.json]

transcript.json = {"segments": [{"start", "end", "text"}, ...]} (e.g. faster-whisper output).
chapters.json   = optional [[start_sec, end_sec, "name"], ...] from a visual contact-sheet pass;
                  without it the whole video is one chapter.

Boundary = silence gap >= 1.0s, OR running beat duration >= 16s, OR a chapter
boundary. Emits output/beats.json + a compact console listing (time | text)
grouped by chapter for building PICTURE-MAP B.
"""
import json
import os
import sys

if len(sys.argv) < 2:
    sys.exit(__doc__)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEGS = json.load(open(sys.argv[1], encoding="utf-8"))["segments"]
CHAPTERS = ([tuple(c) for c in json.load(open(sys.argv[2], encoding="utf-8"))]
            if len(sys.argv) > 2 else [(0, float("inf"), "全片")])

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

os.makedirs(os.path.join(HERE, "output"), exist_ok=True)
json.dump(beats, open(os.path.join(HERE, "output", "beats.json"), "w", encoding="utf-8"),
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
