#!/usr/bin/env python3
"""
patch.py - build the v2 viewer from an untouched original.

The original HTML is never modified. This script copies it and applies four
edits, each anchored on an exact unique string so the patch either applies
cleanly or fails loudly:

  1. a bridge line after the post-processing setup, exposing the scene graph
     (THREE, scene, camera, controls, renderer, composer, bloom, labelRenderer)
     on window.__UM - the page's own code is an ES module, so its scope is
     otherwise private and the add-on layers cannot reach it
  2. a `universal-map:ready` event dispatched at the end of the boot block
  3. four new layer toggles and a four-step scale ladder in the sidebar
  4. the add-on module script, appended before </body>

Usage:  python tools/patch.py [--src ORIGINAL.html] [--dst OUT.html]
"""
from __future__ import annotations
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PARENT = os.path.dirname(REPO)

DEFAULT_SRC = os.path.join(PARENT, "Universal Map \u00b7 Skybird Science.html")
DEFAULT_DST = os.path.join(PARENT, "Universal Map \u00b7 Skybird Science (v2).html")

# ---------------------------------------------------------------- edit 1
A_ANCHOR = "composer.addPass(new OutputPass());"
A_INSERT = """

// ---- Universal Map v2 bridge -------------------------------------------------
// The page's own code is an ES module, so `scene`, `camera` and `controls` are
// private to it. The add-on layers (stars, galaxies, dipole, solar system) need
// them, so they are published here and the boot block below fires an event once
// the original scene has finished building.
window.__UM = { THREE, scene, camera, controls, renderer, composer, bloom, labelRenderer };
"""

# ---------------------------------------------------------------- edit 2
B_ANCHOR = "  statusEl.hidden = true;\n} catch (e) {"
B_INSERT = """  window.__UM.meta = meta;
  window.__UM.setScale = setScale;
  window.__UM.flyTo = flyTo;
  // The scale ladder has to be able to hide the cosmological layers when the
  // camera descends below ~1 Mpc/h, or they swamp everything at that size.
  window.__UM.page = { oursObj, othersObj, densGroup, ringGroup, shells };
  window.dispatchEvent(new CustomEvent('universal-map:ready'));
  statusEl.hidden = true;
} catch (e) {"""

# ---------------------------------------------------------------- edit 3
C_ANCHOR = ('<label class="toggle r-only"><input type="checkbox" id="tGrid" checked>'
            '<span class="box"></span><span class="lbl">Distance rings and axes</span></label>\n')
C_INSERT = C_ANCHOR + """        <label class="toggle"><input type="checkbox" id="tStars"><span class="box"></span><span class="lbl"><span class="swatch sw-stars"></span><span class="e-only">Nearby stars</span><span class="r-only">HYG v4.2, 100 pc bubble</span></span></label>
        <label class="toggle"><input type="checkbox" id="tGalaxies"><span class="box"></span><span class="lbl"><span class="swatch sw-gal"></span><span class="e-only">Galaxies</span><span class="r-only">CF4 + 2MRS + SDSS/DESI wedge</span></span></label>
        <label class="toggle r-only"><input type="checkbox" id="tWedge" checked><span class="box"></span><span class="lbl">Include the northern wedge (SDSS, DESI)</span></label>
        <label class="toggle"><input type="checkbox" id="tDipole"><span class="box"></span><span class="lbl"><span class="swatch sw-dip"></span><span class="e-only">Which way we're moving</span><span class="r-only">Number-count dipole measurements</span></span></label>
        <label class="toggle"><input type="checkbox" id="tMW"><span class="box"></span><span class="lbl"><span class="swatch sw-mw"></span>Our galaxy</span></label>
        <label class="toggle"><input type="checkbox" id="tSolar"><span class="box"></span><span class="lbl"><span class="swatch sw-sun"></span>Solar system</span></label>
"""

D_ANCHOR = '    <section class="sec" aria-labelledby="hViews">'
D_INSERT = """    <section class="sec" aria-labelledby="hZoom">
      <h2 id="hZoom">Scale</h2>
      <div class="seg seg4" role="group" aria-labelledby="hZoom">
        <button type="button" id="zSolar"  aria-pressed="false">Solar system</button>
        <button type="button" id="zStars"  aria-pressed="false">Nearby stars</button>
        <button type="button" id="zMW"     aria-pressed="false">Milky Way</button>
        <button type="button" id="zLG"     aria-pressed="false">Local Group</button>
        <button type="button" id="zGal"    aria-pressed="true">Galaxies</button>
        <button type="button" id="zSuper"  aria-pressed="false">Superclusters</button>
      </div>
      <div class="zoomrow">
        <button type="button" class="btn zbtn" id="zOut">\u2190 Zoom out</button>
        <button type="button" class="btn zbtn" id="zIn">Zoom in \u2192</button>
      </div>
      <p class="note" id="zoomNote"></p>
    </section>

""" + D_ANCHOR

# "</style>" occurs twice (the harness reset block in <head> and the page's own
# sheet), so anchor on the last rule of the page's sheet instead.
E_ANCHOR = ".hand .tip { opacity: 1; } }\n</style>"
E_INSERT = """.hand .tip { opacity: 1; } }
  .seg4 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
  .seg4 button { white-space: nowrap; }
  .swatch.sw-stars { background: linear-gradient(90deg, #cdd9ff, #fff1ea); }
  .swatch.sw-gal   { background: linear-gradient(90deg, #38d6c4, #b18cff); }
  .swatch.sw-dip   { background: linear-gradient(90deg, #b3261e, #1d6fb8); }
  .swatch.sw-sun   { background: linear-gradient(90deg, #ffc35e, #ff7a22); }
  .swatch.sw-mw    { background: linear-gradient(90deg, #9fb4ff, #ffd9a8); }
  .zoomrow { display: flex; gap: 6px; margin-top: 6px; }
  .zoomrow .zbtn { flex: 1; font-size: 12px; padding: 5px 6px; }
  .zoomrow .zbtn[disabled] { opacity: 0.35; pointer-events: none; }
  .um-modes { margin: 10px 0 2px; }
  .um-modes button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
  span.sb-brand { cursor: default; }
</style>"""

# ---------------------------------------------------------------- edit 5
# The sidebar brand linked to the public homepage; the map is embedded, so a
# link that navigates the whole page away from it is wrong. Keep the mark, drop
# the anchor. (The `a.sb-brand:hover` rule simply stops matching.)
G_ANCHOR = ('<a class="sb-brand" href="https://www.skybirdscience.com" '
            'target="_blank" rel="noopener">')
G_INSERT = '<span class="sb-brand" role="img" aria-label="Skybird Science">'
G2_ANCHOR = "<span>Skybird Science</span></a>"
G2_INSERT = "<span>Skybird Science</span></span>"

# ---------------------------------------------------------------- edit 6
# Two modes in the sidebar header: the guided tour, or free exploration.
H_ANCHOR = "    </header>"
H_INSERT = """      <div class="seg um-modes" role="group" aria-label="Mode">
        <button type="button" id="umModeTour" aria-pressed="false">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5v9l8-4.5z"/></svg>
          Start Tour
        </button>
        <button type="button" id="umModeMap" aria-pressed="true">Map</button>
      </div>
    </header>"""

# ---------------------------------------------------------------- edit 4
F_ANCHOR = "</body></html>"
F_INSERT = '<script type="module" src="./universal-map/src/addon.js"></script>\n</body></html>'


def apply(text: str, anchor: str, replacement: str, label: str) -> str:
    n = text.count(anchor)
    if n != 1:
        raise SystemExit(f"patch.py: anchor for {label} matched {n} times, expected exactly 1")
    print(f"  {label:<34} anchor at byte {text.index(anchor):>7,}")
    return text.replace(anchor, replacement, 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--dst", default=DEFAULT_DST)
    a = ap.parse_args()
    if not os.path.exists(a.src):
        raise SystemExit(f"patch.py: source not found: {a.src}")
    with open(a.src, encoding="utf-8") as fh:
        html = fh.read()
    before = len(html)
    print(f"patching {os.path.basename(a.src)} ({before:,} bytes)")
    html = apply(html, A_ANCHOR, A_ANCHOR + A_INSERT, "1. scene-graph bridge")
    html = apply(html, B_ANCHOR, B_INSERT,            "2. ready event")
    html = apply(html, C_ANCHOR, C_INSERT,            "3a. layer toggles")
    html = apply(html, D_ANCHOR, D_INSERT,            "3b. scale ladder")
    html = apply(html, E_ANCHOR, E_INSERT,            "3c. styles")
    html = apply(html, G_ANCHOR, G_INSERT,            "5a. brand link removed")
    html = apply(html, G2_ANCHOR, G2_INSERT,          "5b. brand close tag")
    html = apply(html, H_ANCHOR, H_INSERT,            "6. tour / map mode control")
    html = apply(html, F_ANCHOR, F_INSERT,            "4. add-on module")
    with open(a.dst, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote {os.path.basename(a.dst)} ({len(html):,} bytes, +{len(html)-before:,})")
    print(f"original untouched: {os.path.basename(a.src)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
