"""Generate the "Grandpa – Vintage American Flag" T-shirt print file.

Output: design.svg — 4500 x 5400 px canvas (15 x 18 in @ 300 dpi, standard DTG/POD
print area), transparent background, all text converted to outlines so no fonts
are needed at print time.

Run:  python3 generate.py   (needs: pip install fonttools brotli)
"""
import math
import random
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).parent
W, H = 4500, 5400

# Faded vintage palette (designed for dark shirts: navy, charcoal, black, olive)
CREAM = "#EFE6CF"
RED = "#B8443C"
NAVY = "#2E3E5C"
STAR = "#EFE6CF"

random.seed(1776)


# --------------------------------------------------------------------------- text
class Font:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.gs = self.tt.getGlyphSet()
        self.cmap = self.tt.getBestCmap()
        self.upm = self.tt["head"].unitsPerEm
        self.hmtx = self.tt["hmtx"]

    def glyph(self, ch):
        return self.cmap[ord(ch)]

    def advance(self, ch):
        return self.hmtx[self.glyph(ch)][0]

    def path(self, ch, size, x, y, angle=0.0):
        """SVG path for one glyph; (x, y) = baseline-left, angle in radians."""
        s = size / self.upm
        c, si = math.cos(angle), math.sin(angle)
        # font y-up -> svg y-down, scaled, rotated, translated
        t = (s * c, s * si, s * si, -s * c, x, y)
        pen = SVGPathPen(self.gs)
        self.gs[self.glyph(ch)].draw(TransformPen(pen, t))
        return pen.getCommands()

    def width(self, text, size, tracking=0):
        s = size / self.upm
        return sum(self.advance(c) * s for c in text) + tracking * (len(text) - 1)


def straight_text(font, text, size, cx, baseline, tracking=0):
    x = cx - font.width(text, size, tracking) / 2
    out = []
    for ch in text:
        if ch != " ":
            out.append(font.path(ch, size, x, baseline))
        x += font.advance(ch) * size / font.upm + tracking
    return " ".join(out)


def arched_text(font, text, size, cx, cy, radius, tracking=0):
    """Text along the top of a circle centred at (cx, cy) – baseline on the arc."""
    total = font.width(text, size, tracking)
    theta = -math.pi / 2 - (total / radius) / 2  # start angle (top of circle = -90°)
    out = []
    for ch in text:
        adv = font.advance(ch) * size / font.upm
        mid = theta + (adv / 2) / radius
        # glyph origin is its left edge; place so its centre sits on the arc
        gx = cx + radius * math.cos(mid) - (adv / 2) * math.cos(mid + math.pi / 2)
        gy = cy + radius * math.sin(mid) - (adv / 2) * math.sin(mid + math.pi / 2)
        if ch != " ":
            out.append(font.path(ch, size, gx, gy, angle=mid + math.pi / 2))
        theta += (adv + tracking) / radius
    return " ".join(out)


# --------------------------------------------------------------------------- shapes
def star(cx, cy, r, rot=-math.pi / 2):
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.382
        a = rot + i * math.pi / 5
        pts.append(f"{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}")
    return "M" + " L".join(pts) + " Z"


def wavy_band(x0, x1, y_top, y_bot, amp, phase, steps=60, ref=None):
    """A horizontal band whose edges follow a gentle wave (waving-flag look).
    ref = (rx0, rx1): the full flag width the wave is measured against."""
    rx0, rx1 = ref or (x0, x1)

    def wy(x, y):
        t = (x - rx0) / (rx1 - rx0)
        return y + amp * math.sin(t * math.pi * 2.2 + phase) * (0.35 + 0.65 * t)

    top = [(x0 + (x1 - x0) * i / steps, None) for i in range(steps + 1)]
    pts = [(x, wy(x, y_top)) for x, _ in top]
    pts += [(x, wy(x, y_bot)) for x, _ in reversed(top)]
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"


def distress_mask():
    """Black specks/scratches on white = worn, cracked-ink vintage texture."""
    els = [f'<rect width="{W}" height="{H}" fill="#fff"/>']
    for _ in range(4200):  # fine specks
        x, y = random.uniform(0, W), random.uniform(0, H)
        r = random.choice([4, 5, 6, 8, 10, 14]) * random.uniform(0.6, 1.4)
        els.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}"/>')
    for _ in range(260):  # irregular chips
        x, y = random.uniform(0, W), random.uniform(0, H)
        n = random.randint(5, 8)
        base = random.uniform(14, 42)
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = base * random.uniform(0.5, 1.3)
            pts.append(f"{x + rr * math.cos(a):.0f},{y + rr * math.sin(a):.0f}")
        els.append(f'<polygon points="{" ".join(pts)}"/>')
    for _ in range(90):  # thin cracks / scratches
        x, y = random.uniform(0, W), random.uniform(0, H)
        a = random.uniform(-0.5, 0.5) + random.choice([0, math.pi / 2])
        L = random.uniform(60, 260)
        x2, y2 = x + L * math.cos(a), y + L * math.sin(a)
        els.append(
            f'<line x1="{x:.0f}" y1="{y:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
            f'stroke="#000" stroke-width="{random.uniform(4, 9):.1f}" stroke-linecap="round"/>'
        )
    return "\n".join(els)


# --------------------------------------------------------------------------- build
def build():
    slab = Font(HERE / "fonts/alfa-slab-one-latin-400-normal.woff2")
    oswald = Font(HERE / "fonts/oswald-latin-700-normal.woff2")
    cx = W / 2
    parts = []

    # Title: GRANDPA, arched
    parts.append(
        f'<path fill="{CREAM}" d="{arched_text(slab, "GRANDPA", 700, cx, 4950, 4300, tracking=30)}"/>'
    )

    # Waving flag
    fx0, fx1, fy0 = 550, 3950, 1250
    stripe_h = 150
    amp = 70
    phase = 0.4
    for i in range(13):
        col = RED if i % 2 == 0 else CREAM
        parts.append(
            f'<path fill="{col}" d="{wavy_band(fx0, fx1, fy0 + i * stripe_h - 1, fy0 + (i + 1) * stripe_h + 1, amp, phase)}"/>'
        )
    # canton follows the same wave on its top/bottom edges
    cw, ch = 1500, 7 * stripe_h
    canton = wavy_band(fx0, fx0 + cw, fy0 - 1, fy0 + ch, amp, phase, 30, ref=(fx0, fx1))
    parts.append(f'<path fill="{NAVY}" d="{canton}"/>')
    # 50 stars: 9 rows alternating 6 / 5
    stars = []
    for row in range(9):
        n = 6 if row % 2 == 0 else 5
        for col in range(n):
            sx = fx0 + cw * ((col * 2 + (1 if row % 2 == 0 else 2)) / 12)
            sy = fy0 + ch * ((row + 1) / 10)
            t = (sx - fx0) / (fx1 - fx0)
            sy += amp * math.sin(t * math.pi * 2.2 + phase) * (0.35 + 0.65 * t)
            stars.append(star(sx, sy, 52))
    parts.append(f'<path fill="{STAR}" d="{" ".join(stars)}"/>')

    # Tagline
    tag_y = fy0 + 13 * stripe_h + 500
    parts.append(
        f'<path fill="{CREAM}" d="{straight_text(oswald, "THE MAN", 300, cx, tag_y, tracking=30)}"/>'
    )
    parts.append(
        f'<path fill="{RED}" d="{straight_text(oswald, "THE MYTH", 300, cx, tag_y + 380, tracking=30)}"/>'
    )
    parts.append(
        f'<path fill="{CREAM}" d="{straight_text(slab, "THE LEGEND", 470, cx, tag_y + 1010, tracking=24)}"/>'
    )
    # flanking stars on the tagline
    for dx in (-1, 1):
        parts.append(f'<path fill="{RED}" d="{star(cx + dx * 820, tag_y - 110, 70)}"/>')
        parts.append(f'<path fill="{RED}" d="{star(cx + dx * 880, tag_y + 270, 70)}"/>')

    # Rule lines framing "THE LEGEND"
    ly = tag_y + 520
    for dx in (-1, 1):
        x_in, x_out = cx + dx * 120, cx + dx * 1500
        parts.append(f'<rect x="{min(x_in, x_out):.0f}" y="{ly}" width="1380" height="22" fill="{CREAM}"/>')
    parts.append(f'<path fill="{CREAM}" d="{star(cx, ly + 11, 60)}"/>')

    # Bottom badge text
    # Oswald has no ★ glyph: set the words, then draw stars in the gaps between them
    words = ["VINTAGE", "PROUD AMERICAN", "GRANDFATHER"]
    size, trk, gap = 150, 36, 260
    widths = [oswald.width(w, size, trk) for w in words]
    x = cx - (sum(widths) + gap * (len(words) - 1)) / 2
    by = tag_y + 1330
    for i, (w, ww) in enumerate(zip(words, widths)):
        parts.append(f'<path fill="{CREAM}" d="{straight_text(oswald, w, size, x + ww / 2, by, trk)}"/>')
        x += ww
        if i < len(words) - 1:
            parts.append(f'<path fill="{RED}" d="{star(x + gap / 2, by - 62, 40)}"/>')
            x += gap

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<title>Grandpa – Vintage American Flag</title>
<defs><mask id="worn" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
{distress_mask()}
</mask></defs>
<g mask="url(#worn)"><g transform="translate(0,140)">
{chr(10).join(parts)}
</g></g>
</svg>
'''
    (HERE / "design.svg").write_text(svg)
    print("wrote design.svg", len(svg) // 1024, "KB")


if __name__ == "__main__":
    build()
