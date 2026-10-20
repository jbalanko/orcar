#!/usr/bin/env python3
"""Draw a pbcheck --preview JSON as a PNG contact sheet.

    python3 tools/preview.py out/preview.json out/preview.png

One row per moment in time; columns are side view (port side, nose left),
top view from above (nose left, starboard up) and front view (looking at the nose, port on
the right). Positions are the map's inches. Unlit pixels are drawn as faint
grey dots so the sculpture's shape stays visible. Needs Pillow.
"""
import json
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src))
W, H, PAD = 420, 260, 14
X0, X1, Y0, Y1, Z0, Z1 = 0, 160, -5, 300, -5, 140
views = [
    ("side (port, nose left)", lambda p: (p[1], p[2]), (Y0, Y1), (Z0, Z1)),
    ("top, from above (nose left, starboard up)", lambda p: (p[1], -p[0]), (Y0, Y1), (-X1, -X0)),
    ("front (port on right)", lambda p: (p[0], p[2]), (X0, X1), (Z0, Z1)),
]
frames = data["frames"]
img = Image.new("RGB", (W * 3, H * len(frames) + 24), (12, 14, 20))
d = ImageDraw.Draw(img)
d.text((8, 6), data["pattern"], fill=(220, 220, 220))
for r, fr in enumerate(frames):
    pts = [p for b in fr["boards"] for p in b["pixels"]]
    for c, (title, proj, (a0, a1), (b0, b1)) in enumerate(views):
        ox, oy = c * W, 24 + r * H
        d.rectangle([ox + 2, oy + 2, ox + W - 3, oy + H - 3], outline=(40, 44, 55))
        d.text((ox + 8, oy + 6), f"t={fr['t']}s  {title}", fill=(150, 150, 160))
        sx = (W - 2 * PAD) / (a1 - a0)
        sy = (H - 2 * PAD - 14) / (b1 - b0)
        s = min(sx, sy)
        # draw dim first, bright last so lit pixels sit on top
        for p in sorted(pts, key=lambda p: p[3] + p[4] + p[5]):
            u, v = proj(p)
            px = ox + PAD + (u - a0) * s
            py = oy + H - PAD - (v - b0) * s
            col = tuple(int(255 * min(1, max(0, k)) ** (1 / 2.2)) for k in p[3:6])
            if sum(col) < 30:
                d.point((px, py), fill=(45, 48, 58))
            else:
                d.ellipse([px - 1.6, py - 1.6, px + 1.6, py + 1.6], fill=col)
img.save(out)
print("wrote", out)
