"""Regenerate the PWA icons in src/web/public/ (requires Pillow): python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "web" / "public"
BG, CUP, STEAM = (107, 66, 38), (247, 243, 238), (240, 228, 216)


def draw(size: int, scale: float) -> Image.Image:
    """Full-bleed square icon; `scale` shrinks the artwork (maskable icons need a safe zone)."""
    S = size * 4  # supersample for smooth edges
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)
    u = S * scale / 100  # artwork drawn on a 100-unit grid, centred
    ox = oy = (S - 100 * u) / 2
    P = lambda x, y: (ox + x * u, oy + y * u)
    w = lambda n: max(1, int(n * u))
    # saucer
    d.ellipse([*P(12, 78), *P(88, 90)], fill=CUP)
    # cup body (rounded bottom)
    d.rounded_rectangle([*P(20, 42), *P(70, 82)], radius=w(14), fill=CUP)
    d.rectangle([*P(20, 42), *P(70, 60)], fill=CUP)
    # handle
    d.ellipse([*P(60, 48), *P(86, 72)], outline=CUP, width=w(7))
    # coffee surface
    d.ellipse([*P(23, 38), *P(67, 48)], fill=(74, 44, 24))
    # steam
    import math
    for x in (34, 45, 56):
        pts = [P(x + 2.6 * math.sin(t / 20 * 2 * math.pi), 33 - t * 0.9) for t in range(0, 21)]
        d.line(pts, fill=STEAM, width=w(3.6), joint="curve")
        for end in (pts[0], pts[-1]):  # round caps
            r = w(1.8)
            d.ellipse([end[0] - r, end[1] - r, end[0] + r, end[1] + r], fill=STEAM)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, 0.86).save(OUT / "icon-192.png")
draw(512, 0.86).save(OUT / "icon-512.png")
draw(512, 0.64).save(OUT / "icon-maskable-512.png")  # artwork inside the 80% safe zone
draw(180, 0.80).save(OUT / "apple-touch-icon.png")  # iOS home screen (no transparency)
draw(64, 0.92).save(OUT / "favicon.png")
print("icons written to", OUT)
