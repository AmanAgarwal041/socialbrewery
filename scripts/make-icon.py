"""Render the Socialbrewery app icon as a square PNG (Slack wants 512-2000 px).

Usage: python3 scripts/make-icon.py [size]   (default 1024)
Writes web/public/socialbrewery-icon.png; `npm run web:build` copies it into public/.
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

PALETTE = ["#9FA1FF", "#B5BAFF", "#AEE2FF", "#D9F9DF"]
STOPS = [0.0, 0.4, 0.75, 1.0]
INK = (29, 26, 58, 255)

size = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
if not 512 <= size <= 2000:
    sys.exit("Size must be between 512 and 2000.")

SS = 4
S = size * SS


def rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def gradient_color(t):
    colors = [rgb(c) for c in PALETTE]
    for i in range(len(STOPS) - 1):
        if t <= STOPS[i + 1]:
            local = (t - STOPS[i]) / (STOPS[i + 1] - STOPS[i])
            a, b = colors[i], colors[i + 1]
            return tuple(round(a[k] + (b[k] - a[k]) * local) for k in range(3))
    return colors[-1]


# Diagonal gradient, top-left to bottom-right, built on a small strip then stretched.
steps = 512
strip = Image.new("RGB", (steps, 1))
for i in range(steps):
    strip.putpixel((i, 0), gradient_color(i / (steps - 1)))
diag = strip.resize((S * 2, S * 2), Image.BILINEAR).rotate(-45, resample=Image.BICUBIC)
offset = (diag.width - S) // 2
image = diag.crop((offset, offset, offset + S, offset + S)).convert("RGBA")

# The cup mark from favicon.svg (32-unit grid), scaled up and centered.
unit = S / 32 * 0.95
cx, cy = 16.75, 15.75


def pt(x, y):
    return (S / 2 + (x - cx) * unit, S / 2 + (y - cy) * unit)


def arc(xc, yc, r, start, end, n=48):
    return [
        pt(xc + r * math.cos(math.radians(start + (end - start) * i / n)), yc + r * math.sin(math.radians(start + (end - start) * i / n)))
        for i in range(n + 1)
    ]


def bezier(p0, p1, p2, p3, n=48):
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t**2 * p2[0] + t**3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t**2 * p2[1] + t**3 * p3[1]
        out.append(pt(x, y))
    return out


cup = [pt(8, 13), pt(21, 13), pt(21, 20)] + arc(16, 20, 5, 0, 90) + [pt(13, 25)] + arc(13, 20, 5, 90, 180) + [pt(8, 13)]
handle = [pt(21, 15), pt(23, 15)] + arc(23, 17.5, 2.5, -90, 90) + [pt(21, 20)]
steam = [bezier((x, 6.5), (x + 1, 7.5), (x + 1, 8.5), (x, 9.5)) for x in (12, 16)]

draw = ImageDraw.Draw(image)
width = round(2 * unit)
radius = width / 2
# PIL leaves hairline gaps where thick polylines bend, so stamp a round brush densely along each path.
for path in [cup, handle, *steam]:
    for (x0, y0), (x1, y1) in zip(path, path[1:]):
        draw.line([(x0, y0), (x1, y1)], fill=INK, width=width)
        steps_along = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / (radius / 4)))
        for i in range(steps_along + 1):
            x = x0 + (x1 - x0) * i / steps_along
            y = y0 + (y1 - y0) * i / steps_along
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=INK)

out = Path(__file__).resolve().parent.parent / "web" / "public" / "socialbrewery-icon.png"
image.resize((size, size), Image.LANCZOS).convert("RGB").save(out, optimize=True)
print(f"Wrote {out} ({size}x{size})")
