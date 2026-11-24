# Outline "brewlab" in Nunito ExtraBold → SVG path data (font units, baseline at y=0, y down).
import sys, json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
font = instantiateVariableFont(TTFont(sys.argv[1]), {"wght": 800})
gs = font.getGlyphSet(); cmap = font.getBestCmap(); hmtx = font["hmtx"]
upm = font["head"].unitsPerEm
track = -0.02 * upm  # slightly tight
out = {}; x = 0.0
for part, text in (("brew", "brew"), ("lab", "lab")):
    d = []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        d.append(pen.getCommands())
        x += hmtx[g][0] + track
    out[part] = " ".join(d)
out["width"] = x - track; out["upm"] = upm
out["capTop"] = -font["OS/2"].sxHeight if False else None
# ascender of 'b'/'l' (top of the tall letters)
from fontTools.pens.boundsPen import BoundsPen
bp = BoundsPen(gs); gs[cmap[ord("b")]].draw(bp); out["tallTop"] = bp.bounds[3]
bp = BoundsPen(gs); gs[cmap[ord("e")]].draw(bp); out["xTop"] = bp.bounds[3]
json.dump(out, open(sys.argv[2], "w"))
print(out["width"], upm, out["tallTop"], out["xTop"])
