"""Turns a pinball-video.mjs recording into a GIF, a contact sheet and the
speeds of the ball, to compare with a real table (most of the play at 1 to
2 m/s, full shots leaving the flippers at 3 to 5 m/s).
  python pinball-video.py <dir> [start_s] [end_s] [every_nth_frame]
Table units: the ball is 0.54 across (27 mm), so 1 unit = 50 mm.
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

d = sys.argv[1]
start = float(sys.argv[2]) if len(sys.argv) > 2 else 0
end = float(sys.argv[3]) if len(sys.argv) > 3 else 1e9
step = int(sys.argv[4]) if len(sys.argv) > 4 else 2
UNIT_M = 0.05

frames = json.load(open(os.path.join(d, "frames.json")))
track = json.load(open(os.path.join(d, "track.json")))
t0 = frames[0]["t"]
sel = [f for f in frames if start <= f["t"] - t0 <= end][::step]
imgs = []
for f in sel:
    im = Image.open(os.path.join(d, "frames", f["file"])).convert("RGB")
    im = im.resize((im.width // 2, im.height // 2))
    ImageDraw.Draw(im).text((6, 6), "%.2fs" % (f["t"] - t0), fill=(255, 255, 0))
    imgs.append(im)
if imgs:
    dur = int(1000 * (sel[1]["t"] - sel[0]["t"])) if len(sel) > 1 else 40
    imgs[0].save(os.path.join(d, "clip.gif"), save_all=True, append_images=imgs[1:], duration=max(20, dur), loop=0)
    # contact sheet: 12 frames
    k = max(1, len(imgs) // 12)
    pick = imgs[::k][:12]
    w, h = pick[0].size
    sheet = Image.new("RGB", (w * 6, h * 2))
    for i, im in enumerate(pick):
        sheet.paste(im, ((i % 6) * w, (i // 6) * h))
    sheet.save(os.path.join(d, "sheet.jpg"), quality=80)

# Motion statistics, ball by ball on the table
speeds = []
ups = []
prev = None
for s in track:
    if prev and s["b"] and prev["b"] and s["t"] > prev["t"]:
        dt = s["t"] - prev["t"]
        for a, b in zip(prev["b"], s["b"]):
            if a["mode"] == "table" and b["mode"] == "table" and a["floor"] == b["floor"]:
                v = math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / dt
                if v < 200:
                    speeds.append(v)
                    if b["y"] > a["y"]:
                        ups.append(v)
    prev = s
speeds.sort()
def pct(lst, p):
    return lst[min(len(lst) - 1, int(len(lst) * p))] if lst else 0
print("frames", len(frames), "track", len(track))
for name, lst in (("all", speeds), ("going up", sorted(ups))):
    print("%s: median %.1f u/s (%.2f m/s), p90 %.1f (%.2f m/s), max %.1f (%.2f m/s)" % (
        name, pct(lst, 0.5), pct(lst, 0.5) * UNIT_M, pct(lst, 0.9), pct(lst, 0.9) * UNIT_M, lst[-1] if lst else 0, (lst[-1] if lst else 0) * UNIT_M))
# Flips: count presses and time between a press and the ball going over y 15
presses = 0
last = {"left": False, "right": False}
for s in track:
    for k in ("left", "right"):
        if s["f"][k] and not last[k]:
            presses += 1
        last[k] = s["f"][k]
print("flipper presses", presses)
