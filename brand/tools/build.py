import re, json, sys
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = f"{ROOT}/brand"; W = f"{ROOT}/src/web"
sym = open(f"{B}/brewlab-refined-symbol.svg").read()
paths = dict((c.upper(), d) for c, d in re.findall(r'<path fill="(#[0-9A-Fa-f]+)" fill-rule="evenodd" d="([^"]+)"', sym))
COFFEE, TAN, INK, LED = paths["#75401F"], paths["#DDA77C"], paths["#F2E9DF"], paths["#83C66B"]
wm = json.load(open(sys.argv[1]))
def symbol(ink="#F2E9DF", tan="#DDA77C", coffee="#75401F", led="#83C66B"):
    # the user's symbol, unchanged except for colours (its own translate(-1 0) kept)
    return (f'<g transform="translate(-1 0)"><path fill="{coffee}" fill-rule="evenodd" d="{COFFEE}"/>'
            f'<path fill="{tan}" fill-rule="evenodd" d="{TAN}"/><path fill="{ink}" fill-rule="evenodd" d="{INK}"/>'
            f'<path fill="{led}" fill-rule="evenodd" d="{LED}"/></g>')
BG = '#151210'
def square(s, cx, cy, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="{BG}"/>'
            f'<g transform="translate({512 - s*cx:.1f} {512 - s*cy:.1f}) scale({s})">{symbol()}</g></svg>\n')
# Optical centre in symbol units: halfway between the outline centre and the visual weight.
CX, CY = 643, 557
open(f"{B}/icon.svg", "w").write(square(0.84, CX, CY))
open(f"{B}/icon-maskable.svg", "w").write(square(0.72, CX, CY))        # inside Android's 80% safe circle
open(f"{B}/favicon.svg", "w").write(square(1.1, 649.5, 499.5))          # fills the tab icon (outline-centred)

# Wordmark: symbol + "brewlab" as outlines (Nunito ExtraBold, OFL) — the same everywhere.
SYM_TOP, SYM_BOT, SYM_L, SYM_R = 40, 935, 351, 948     # symbol bounds (incl. steam)
H = 120; pad = 6
ss = (H - 2*pad) / (SYM_BOT - SYM_TOP)                  # symbol scale → 108 px tall
sym_w = (SYM_R - SYM_L) * ss
ts = (0.66 * (H - 2*pad)) / wm["tallTop"]               # tall letters ≈ 2/3 of the symbol
gap = 16
tx = pad + sym_w + gap
base = pad + (SYM_BOT - SYM_TOP) * ss - 4               # baseline on the server base
width = tx + wm["width"] * ts + pad
def wordmark(ink, tan, coffee, led, brew, lab):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {H}">'
            f'<g transform="translate({pad - SYM_L*ss:.2f} {pad - SYM_TOP*ss:.2f}) scale({ss:.5f})">{symbol(ink, tan, coffee, led)}</g>'
            f'<g transform="translate({tx:.2f} {base:.2f}) scale({ts:.5f})"><path fill="{brew}" d="{wm["brew"]}"/><path fill="{lab}" d="{wm["lab"]}"/></g></svg>\n')
open(f"{B}/brewlab-refined-header.svg", "w").write(wordmark("#F2E9DF", "#DDA77C", "#75401F", "#83C66B", "#F2E9DF", "#DDA77C"))
open(f"{B}/brewlab-refined-header-light.svg", "w").write(wordmark("#2B1E17", "#B06A30", "#75401F", "#3F8F3A", "#2B1E17", "#B06A30"))

# The app's inline logo: same shapes, colours from the theme (CSS variables), so it follows light/dark.
tsx = f'''// Brewlab wordmark (generated from brand/ — see brand/README.md). Colours come from the theme.
export function Wordmark({{ height = 28, className = "" }}: {{ height?: number; className?: string }}) {{
  return (
    <svg className={{`wordmark ${{className}}`}} viewBox="0 0 {width:.0f} {H}" height={{height}} role="img" aria-label="Brewlab">
      <g transform="translate({pad - SYM_L*ss:.2f} {pad - SYM_TOP*ss:.2f}) scale({ss:.5f})">
        <g transform="translate(-1 0)">
          <path className="lg-coffee" fillRule="evenodd" d="{COFFEE}" />
          <path className="lg-tan" fillRule="evenodd" d="{TAN}" />
          <path className="lg-ink" fillRule="evenodd" d="{INK}" />
          <path className="lg-led" fillRule="evenodd" d="{LED}" />
        </g>
      </g>
      <g transform="translate({tx:.2f} {base:.2f}) scale({ts:.5f})">
        <path className="lg-ink" d="{wm["brew"]}" />
        <path className="lg-tan" d="{wm["lab"]}" />
      </g>
    </svg>
  );
}}
'''
open(f"{W}/Logo.tsx", "w").write(tsx)
print("wordmark", round(width), "x", H)
