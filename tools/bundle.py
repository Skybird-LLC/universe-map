#!/usr/bin/env python3
"""
bundle.py - build a page with NO import map, NO data: URL modules, NO CDN.

WHY THIS EXISTS
---------------
Earlier builds loaded three.js from a CDN, then from `data:` URLs registered in
an import map. Both are load-time dependencies on something outside the file,
and when either is unavailable the page's main ES module never executes - which
takes the page's OWN controls down with the new ones, so the whole interface
goes dead with no error anywhere. That failure was reported from several
different environments.

This build removes the entire class of problem. esbuild resolves every import
ahead of time and emits ONE plain `<script type="module">` with no imports at
all. Nothing is fetched at load: not three, not the addons, not the layer code.

WHAT IT PRODUCES
----------------
  * the page's own module and src/addon.js bundled together, addon first so its
    `universal-map:ready` listener is registered before the page code runs
  * three 0.160.0 and its six addons resolved from tools/vendor/ (fetched once
    by inline.py --vendor-three; no network needed here)
  * layer payloads inlined as <script id="...-meta"> / "-data" blocks, exactly
    as loader.js already expects
  * textures inlined as data: URLs in globalThis.__UM_TEXTURES
  * a visible error overlay: if anything still throws at startup, the page SAYS
    SO on screen instead of sitting there inert

Usage:  python tools/bundle.py [--src "... (v2).html"] [--dst "... (v2, bundled).html"]
"""
from __future__ import annotations
import argparse, base64, json, mimetypes, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PARENT = os.path.dirname(REPO)
VENDOR = os.path.join(HERE, "vendor", "three@0.160.0")
ESBUILD = os.path.join(HERE, "bundle", "node_modules", ".bin", "esbuild")

DEFAULT_SRC = os.path.join(PARENT, "Universal Map \u00b7 Skybird Science (v2).html")
DEFAULT_DST = os.path.join(PARENT, "Universal Map \u00b7 Skybird Science (v2, bundled).html")

BIN_LAYERS = ["stars", "galaxies", "milkyway"]
JSON_LAYERS = ["dipole", "solarsystem", "localgroup"]

ADDON_TAG = '<script type="module" src="./universal-map/src/addon.js"></script>'

# Shown if the bundle throws before the app can report anything itself.
ERROR_OVERLAY = """
<script>
(function () {
  var shown = false;
  function show(what, detail) {
    if (shown) return; shown = true;
    var d = document.createElement('div');
    d.setAttribute('style', 'position:fixed;inset:auto 12px 12px 12px;z-index:99999;'
      + 'background:rgba(40,8,8,.94);color:#ffd9d9;border:1px solid #a33;border-radius:10px;'
      + 'padding:14px 16px;font:13px/1.5 ui-monospace,Menlo,monospace;max-height:50vh;overflow:auto');
    d.textContent = 'Universal Map failed to start \\u2014 ' + what + '\\n\\n' + detail;
    (document.body || document.documentElement).appendChild(d);
  }
  window.addEventListener('error', function (e) {
    show(e.message || 'script error', (e.filename || '') + ':' + (e.lineno || '') + '\\n' + ((e.error && e.error.stack) || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    show('unhandled rejection', (r && (r.stack || r.message)) || String(r));
  });
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!window.__UM) show('the main module never ran',
        'No window.__UM after load. Nothing was fetched at load time, so this is a script or '
        + 'WebGL failure rather than a missing file. Any message above is the cause.');
    }, 4000);
  });
})();
</script>
"""


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def extract_page_module(html: str) -> tuple[str, int, int]:
    """Return (source, start, end) of the page's own <script type="module"> block."""
    m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit("bundle.py: the page's module script was not found")
    return m.group(1), m.start(), m.end()


def run_esbuild(entry_dir: str, entry: str) -> str:
    if not os.path.exists(ESBUILD):
        raise SystemExit(f"bundle.py: esbuild not found at {ESBUILD}\n"
                         "Run: cd tools/bundle && npm install esbuild")
    out = os.path.join(entry_dir, "bundle.js")
    # No --alias: it would also capture the `three/addons/*` subpaths. The staged
    # node_modules/three package below resolves both the root and the subpaths.
    cmd = [ESBUILD, entry, "--bundle", "--format=esm", "--target=es2022",
           "--platform=browser", "--legal-comments=none", f"--outfile={out}"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("bundle.py: esbuild failed\n" + r.stderr)
    if r.stderr.strip():
        print("  esbuild:", r.stderr.strip()[:400])
    with open(out, encoding="utf-8") as fh:
        return strip_build_paths(fh.read())


def strip_build_paths(js: str) -> str:
    """Drop comment lines that leak the esbuild temp directory into the page."""
    kept = []
    removed = 0
    for line in js.split("\n"):
        stripped = line.strip()
        comment = stripped.startswith("//") or stripped.startswith("/*")
        leaks = ("um-bundle-" in line or "/var/folders" in line or "/Users/" in line
                 or "/private/var/" in line)
        if comment and leaks:
            removed += 1
            continue
        kept.append(line)
    if removed:
        print(f"  stripped {removed} build-path comments")
    return "\n".join(kept)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--dst", default=DEFAULT_DST)
    ap.add_argument("--no-textures", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(a.src):
        raise SystemExit(f"bundle.py: source not found: {a.src}\nRun tools/patch.py first.")
    if not os.path.isdir(VENDOR):
        raise SystemExit(f"bundle.py: no vendored three at {VENDOR}\n"
                         "Run: python tools/inline.py --vendor-three  (needs network once)")

    with open(a.src, encoding="utf-8") as fh:
        html = fh.read()
    before = len(html)
    page_src, p0, p1 = extract_page_module(html)
    print(f"page module: {len(page_src):,} chars")

    work = tempfile.mkdtemp(prefix="um-bundle-")
    try:
        # three/addons/* -> the vendored examples/jsm tree, as a real directory so
        # esbuild resolves the addons' own relative imports naturally.
        shutil.copytree(os.path.join(VENDOR, "examples", "jsm"),
                        os.path.join(work, "node_modules", "three", "addons"))
        shutil.copy(os.path.join(VENDOR, "build", "three.module.js"),
                    os.path.join(work, "node_modules", "three", "three.module.js"))
        with open(os.path.join(work, "node_modules", "three", "package.json"), "w") as fh:
            json.dump({"name": "three", "version": "0.160.0", "type": "module",
                       "main": "three.module.js",
                       "exports": {".": "./three.module.js", "./addons/*": "./addons/*"}}, fh)

        # Stage src/ inside the work dir so every module - the page's and ours -
        # resolves `three` from the same staged node_modules.
        shutil.copytree(os.path.join(REPO, "src"), os.path.join(work, "src"))
        with open(os.path.join(work, "page.js"), "w", encoding="utf-8") as fh:
            fh.write(page_src)
        # addon first: its ready-listener must exist before the page code runs
        with open(os.path.join(work, "entry.js"), "w", encoding="utf-8") as fh:
            fh.write("import './src/addon.js';\nimport './page.js';\n")
        bundle = run_esbuild(work, os.path.join(work, "entry.js"))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"bundle:      {len(bundle):,} chars")

    # the add-on's own data/texture URLs are now meaningless; everything is inline
    blocks = []
    for stem in BIN_LAYERS:
        meta = json.load(open(os.path.join(REPO, "data", f"{stem}.json"), encoding="utf-8"))
        raw = open(os.path.join(REPO, "data", f"{stem}.bin"), "rb").read()
        blocks.append(f'<script id="{stem}-meta" type="application/json">'
                      f'{json.dumps(meta, separators=(",", ":"))}</script>')
        blocks.append(f'<script id="{stem}-data" type="application/base64">{b64(raw)}</script>')
    for stem in JSON_LAYERS:
        txt = open(os.path.join(REPO, "data", f"{stem}.json"), encoding="utf-8").read()
        blocks.append(f'<script id="{stem}-meta" type="application/json">{txt}</script>')
    if not a.no_textures:
        tex, tdir = {}, os.path.join(REPO, "textures")
        for fn in sorted(os.listdir(tdir)):
            if fn.lower().endswith((".jpg", ".png")):
                mime = mimetypes.guess_type(fn)[0] or "application/octet-stream"
                tex[fn] = f"data:{mime};base64,{b64(open(os.path.join(tdir, fn), 'rb').read())}"
        blocks.append("<script>globalThis.__UM_TEXTURES = "
                      f"{json.dumps(tex, separators=(',', ':'))};</script>")
        print(f"textures:    {len(tex)} inlined")

    # 1. drop the import map entirely - nothing resolves specifiers any more
    html = re.sub(r'<script type="importmap">\s*\{.*?\}\s*</script>\s*', "", html, count=1, flags=re.S)
    # 2. drop the external add-on tag; it is inside the bundle now
    html = html.replace(ADDON_TAG, "")
    # 3. replace the page's module with payloads + the bundle
    p_src, p0, p1 = extract_page_module(html)
    html = (html[:p0]
            + "\n".join(blocks) + "\n"
            + '<script type="module">\n' + bundle + '\n</script>'
            + html[p1:])
    # 4. the overlay goes first so it catches everything after it
    html = html.replace("<body>", "<body>" + ERROR_OVERLAY, 1) if "<body>" in html \
        else ERROR_OVERLAY + html

    with open(a.dst, "w", encoding="utf-8") as fh:
        fh.write(html)

    left = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
    print(f"\n{os.path.basename(a.src)}  {before:,} bytes")
    print(f"{os.path.basename(a.dst)}  {len(html):,} bytes")
    imap_marker = 'type="importmap"'
    print(f"import maps remaining : {html.count(imap_marker)}")
    print(f"module imports in page: {len(re.findall(r'^import ', bundle, re.M))}")
    print("external URLs remaining:")
    for u in sorted(set(left)):
        print("   ", u[:78], "(fonts, cosmetic)" if "fonts." in u else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
