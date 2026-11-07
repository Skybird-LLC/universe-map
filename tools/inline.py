#!/usr/bin/env python3
"""
inline.py - fold the external layer files back into a single-file build.

The v2 page fetches its layer payloads and ES modules as separate files, which
means it must be served over http://. A file:// load cannot fetch them. This
script rewrites the page so everything travels inside the HTML:

  * binary layer pairs  -> <script id="stars-meta"> / <script id="stars-data">
                           in the same base64 convention as the page's cf-data
  * JSON layers         -> <script id="dipole-meta"> etc.
  * ES modules          -> data: URLs registered in the page's import map under
                           bare "um:*" specifiers, so no path assumptions survive
  * textures (optional) -> data: URLs in globalThis.__UM_TEXTURES

`loader.js` already looks for the inline <script> elements before falling back
to fetch, so the modules need no change; `solarsystem.js` checks
globalThis.__UM_TEXTURES the same way.

  * three.js (optional) -> --vendor-three inlines three.module.js and the whole
                           transitive addon graph as data: URLs too, so the page
                           has NO network dependency at all

Usage:
  python tools/inline.py                       # data + modules (~7 MB page)
  python tools/inline.py --with-textures       # everything (~25 MB page)
  python tools/inline.py --with-textures --vendor-three \
      --dst "../Universal Map ... (v2, offline).html"   # zero network
"""
from __future__ import annotations
import argparse, base64, json, mimetypes, os, posixpath, random, re, sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PARENT = os.path.dirname(REPO)

DEFAULT_SRC = os.path.join(PARENT, "Universal Map \u00b7 Skybird Science (v2).html")
DEFAULT_DST = os.path.join(PARENT, "Universal Map \u00b7 Skybird Science (v2, single-file).html")

BIN_LAYERS = ["stars", "galaxies", "milkyway"]
JSON_LAYERS = ["dipole", "solarsystem", "localgroup"]
MODULES = ["loader", "stars", "galaxies", "superclusters", "dipole",
           "solarsystem", "milkyway", "localgroup", "tour", "addon"]

ADDON_TAG = '<script type="module" src="./universal-map/src/addon.js"></script>'


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def rewrite_imports(src: str) -> str:
    """Turn relative module specifiers into bare `um:*` ones."""
    src = re.sub(r"(['\"])\./shaders/index\.js\1", r"\1um:shaders\1", src)
    src = re.sub(r"(['\"])\./([A-Za-z0-9_]+)\.js\1", r"\1um:\2\1", src)
    return src


def data_url(text: str, mime: str = "text/javascript") -> str:
    return f"data:{mime};base64,{b64(text.encode('utf-8'))}"


# ---------------------------------------------------------------------------
# three.js vendoring
# ---------------------------------------------------------------------------

THREE_VERSION = "0.160.0"
CDN = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}"
VENDOR = os.path.join(HERE, "vendor", f"three@{THREE_VERSION}")

# Every specifier a module can carry. Anchored to real import/export statements
# at the start of a line (plus the dynamic form) so that string literals which
# merely contain the word "from" - three.js has several, e.g.
# `'... from ' + image.width + ' ...'` - are not mistaken for specifiers.
# The `[^;'"]*?` clause stops a match from reaching across a quoted string.
SPEC_RE = re.compile(r"""
      (?: ^[ \t]*import\b[^;'"]*?\bfrom\s*      # import ... from 'x'
        | ^[ \t]*import\s*                      # import 'x'
        | ^[ \t]*export\b[^;'"]*?\bfrom\s*      # export ... from 'x'
        | \bimport\s*\(\s*                      # import('x')
      )
      (['"])([^'"\n]+)\1
    """, re.X | re.M)


def module_specifiers(src: str) -> list[str]:
    """Every module specifier appearing in `src`, in source order."""
    return [m.group(2) for m in SPEC_RE.finditer(src)]


def fetch_cached(url_path: str) -> str:
    """Fetch <CDN>/<url_path>, caching under tools/vendor/ so rebuilds are offline."""
    local = os.path.join(VENDOR, *url_path.split("/"))
    if os.path.exists(local):
        with open(local, encoding="utf-8") as fh:
            return fh.read()
    url = f"{CDN}/{url_path}"
    with urllib.request.urlopen(url, timeout=120) as r:
        if r.status != 200:
            raise SystemExit(f"inline.py: {url} -> HTTP {r.status}")
        text = r.read().decode("utf-8")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    with open(local, "w", encoding="utf-8") as fh:
        fh.write(text)
    return text


# The six addons the page imports directly. Paths are relative to examples/jsm/.
PAGE_ADDONS = [
    "controls/OrbitControls.js",
    "postprocessing/EffectComposer.js",
    "postprocessing/RenderPass.js",
    "postprocessing/UnrealBloomPass.js",
    "postprocessing/OutputPass.js",
    "renderers/CSS2DRenderer.js",
]


def discover_page_addons(html: str) -> list[str]:
    """Read the addon list out of the page itself rather than trusting a constant."""
    found = sorted({s[len("three/addons/"):] for s in module_specifiers(html)
                    if s.startswith("three/addons/")})
    return found


def rewrite_addon_specs(src: str, self_path: str) -> str:
    """Rewrite relative specifiers in an examples/jsm module to bare
    `three/addons/<path>` keys. `self_path` is the module's own path relative
    to examples/jsm/. Bare specifiers (`three`) are left alone."""
    here = posixpath.dirname(self_path)

    def sub(m: re.Match) -> str:
        q, spec = m.group(1), m.group(2)
        if not spec.startswith("."):
            return m.group(0)
        resolved = posixpath.normpath(posixpath.join(here, spec))
        if resolved.startswith(".."):
            raise SystemExit(f"inline.py: {self_path} escapes examples/jsm/: {spec}")
        return m.group(0).replace(f"{q}{spec}{q}", f"{q}three/addons/{resolved}{q}", 1)

    return SPEC_RE.sub(sub, src)


def vendor_three(html: str) -> tuple[dict[str, str], list[tuple[str, int]], dict[str, str]]:
    """Fetch three.js + the transitive addon graph, rewrite specifiers, and return
    (import-map entries, size report, raw rewritten sources keyed by bare specifier)."""
    sources: dict[str, str] = {}

    core = fetch_cached("build/three.module.js")
    core_rel = [s for s in module_specifiers(core) if s.startswith(".")]
    if core_rel:
        raise SystemExit(f"inline.py: three.module.js has relative imports: {core_rel}")
    sources["three"] = core

    seen: set[str] = set()
    queue = list(discover_page_addons(html)) or list(PAGE_ADDONS)
    entry = list(queue)
    while queue:
        rel = queue.pop(0)
        if rel in seen:
            continue
        seen.add(rel)
        raw = fetch_cached(f"examples/jsm/{rel}")
        for spec in module_specifiers(raw):
            if spec.startswith("."):
                child = posixpath.normpath(posixpath.join(posixpath.dirname(rel), spec))
                if child not in seen:
                    queue.append(child)
            elif spec != "three" and not spec.startswith("three/addons/"):
                print(f"  ! unexpected bare specifier {spec!r} in examples/jsm/{rel}")
        sources[f"three/addons/{rel}"] = rewrite_addon_specs(raw, rel)

    report = [("three.module.js", len(core.encode("utf-8")))]
    for key in sorted(k for k in sources if k != "three"):
        tag = key[len("three/addons/"):]
        mark = "  *" if tag in entry else "   "
        report.append((f"{mark} addons/{tag}", len(sources[key].encode("utf-8"))))

    # ---- closure assertions ------------------------------------------------
    leftovers = {k: [s for s in module_specifiers(v) if s.startswith(".")]
                 for k, v in sources.items()}
    leftovers = {k: v for k, v in leftovers.items() if v}
    print(f"\n  three vendored: {len(sources)} modules "
          f"({len(entry)} entry points, {len(sources) - 1 - len(entry)} transitive deps)")
    if leftovers:
        for k, v in leftovers.items():
            print(f"  FAIL relative specifier survives in {k}: {v}")
        raise SystemExit("inline.py: module graph is not closed")
    print("  ASSERT graph closed: no './' or '../' specifier remains in any "
          f"of the {len(sources)} vendored modules - PASS")

    referenced = {s for v in sources.values() for s in module_specifiers(v)
                  if not s.startswith(".")}
    missing = sorted(referenced - set(sources))
    if missing:
        for s in missing:
            print(f"  FAIL bare specifier with no import-map key: {s}")
        raise SystemExit("inline.py: unresolvable bare specifier")
    print(f"  ASSERT every bare specifier referenced ({len(referenced)} distinct: "
          f"{', '.join(sorted(referenced)[:3])}{'...' if len(referenced) > 3 else ''}) "
          "has an import-map key - PASS")

    return {k: data_url(v) for k, v in sources.items()}, report, sources


def verify_built_html(path: str, sources: dict[str, str], n: int = 3) -> None:
    """Re-parse the written page, pull the import map back out and spot-check
    that randomly chosen vendored entries base64-decode to the right JS."""
    with open(path, encoding="utf-8") as fh:
        built = fh.read()
    m = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', built, re.S)
    if not m:
        raise SystemExit("inline.py: built page has no import map")
    imap = json.loads(m.group(1))["imports"]
    print(f"\n  re-parsed built page: import map has {len(imap)} keys, "
          f"{sum(1 for v in imap.values() if v.startswith('data:'))} of them data: URLs, "
          f"{sum(1 for v in imap.values() if v.startswith('http'))} http")
    if any(v.startswith("http") for v in imap.values()):
        print("  ! import map still contains an http entry")
    picks = random.sample(sorted(sources), min(n, len(sources)))
    for key in picks:
        url = imap.get(key)
        if url is None or not url.startswith("data:text/javascript;base64,"):
            raise SystemExit(f"inline.py: {key} missing or not a data: URL in built page")
        text = base64.b64decode(url.split(",", 1)[1]).decode("utf-8")
        if text != sources[key]:
            raise SystemExit(f"inline.py: {key} decoded bytes differ from source")
        head = text.lstrip()[:60].replace("\n", " ")
        plausible = text.lstrip().startswith(("/*", "//", "import", "export", "const", "class"))
        print(f"    {key:<48} {len(text):>8,} B  decodes OK, "
              f"round-trips exact, starts {'plausibly' if plausible else 'ODDLY'}: {head!r}")

    # ---- whole-bundle resolution check -------------------------------------
    # Decode EVERY module in the map and scan the page's own inline <script
    # type="module"> bodies too, then resolve each bare specifier the way a
    # browser would: exact key first, then longest trailing-slash prefix key.
    def resolves(spec: str) -> bool:
        if spec in imap:
            return True
        return any(k.endswith("/") and spec.startswith(k)
                   for k in imap)

    units: dict[str, str] = {}
    for key, url in imap.items():
        if url.startswith("data:text/javascript;base64,"):
            units[key] = base64.b64decode(url.split(",", 1)[1]).decode("utf-8")
    for i, body in enumerate(re.findall(
            r'<script type="module"[^>]*>(.*?)</script>', built, re.S)):
        units[f"<inline script #{i}>"] = body

    unresolved: list[tuple[str, str]] = []
    rel_left: list[tuple[str, str]] = []
    for name, text in units.items():
        for spec in module_specifiers(text):
            if spec.startswith((".", "/")):
                rel_left.append((name, spec))
            elif spec.startswith("data:"):
                continue
            elif not resolves(spec):
                unresolved.append((name, spec))
    print(f"  scanned {len(units)} modules in the built page "
          f"({len(units) - sum(1 for k in units if k.startswith('<'))} from the import map, "
          f"{sum(1 for k in units if k.startswith('<'))} inline <script type=\"module\">)")
    for name, spec in rel_left:
        print(f"  FAIL relative specifier in built page: {name} -> {spec}")
    for name, spec in unresolved:
        print(f"  FAIL unresolvable specifier in built page: {name} -> {spec}")
    if rel_left or unresolved:
        raise SystemExit("inline.py: built page would fail to resolve a module")
    print("  ASSERT whole built bundle resolves: every specifier in every module "
          "and inline script has an import-map key, none relative - PASS")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--dst", default=DEFAULT_DST)
    ap.add_argument("--with-textures", action="store_true",
                    help="also embed the texture set as data: URLs (large)")
    ap.add_argument("--vendor-three", action="store_true",
                    help="inline three.js and its whole transitive addon graph, "
                         "removing the last network dependency")
    a = ap.parse_args()

    if not os.path.exists(a.src):
        raise SystemExit(f"inline.py: source not found: {a.src}\nRun tools/patch.py first.")
    with open(a.src, encoding="utf-8") as fh:
        html = fh.read()
    before = len(html)

    blocks: list[str] = []
    report: list[tuple[str, int]] = []

    # ---- binary layer pairs --------------------------------------------------
    for stem in BIN_LAYERS:
        jp = os.path.join(REPO, "data", f"{stem}.json")
        bp = os.path.join(REPO, "data", f"{stem}.bin")
        meta = json.load(open(jp, encoding="utf-8"))
        raw = open(bp, "rb").read()
        blocks.append(f'<script id="{stem}-meta" type="application/json">'
                      f'{json.dumps(meta, separators=(",", ":"))}</script>')
        blocks.append(f'<script id="{stem}-data" type="application/base64">{b64(raw)}</script>')
        report.append((f"{stem}.bin", len(raw)))

    # ---- JSON-only layers ----------------------------------------------------
    for stem in JSON_LAYERS:
        p = os.path.join(REPO, "data", f"{stem}.json")
        txt = open(p, encoding="utf-8").read()
        blocks.append(f'<script id="{stem}-meta" type="application/json">{txt}</script>')
        report.append((f"{stem}.json", len(txt)))

    # ---- textures ------------------------------------------------------------
    if a.with_textures:
        tex = {}
        tdir = os.path.join(REPO, "textures")
        total = 0
        for fn in sorted(os.listdir(tdir)):
            if not fn.lower().endswith((".jpg", ".png")):
                continue
            mime = mimetypes.guess_type(fn)[0] or "application/octet-stream"
            raw = open(os.path.join(tdir, fn), "rb").read()
            tex[fn] = f"data:{mime};base64,{b64(raw)}"
            total += len(raw)
        blocks.append(f'<script>globalThis.__UM_TEXTURES = '
                      f'{json.dumps(tex, separators=(",", ":"))};</script>')
        report.append((f"textures ({len(tex)} files)", total))

    # ---- modules as data: URLs in the import map -----------------------------
    imports = {}
    for name in MODULES:
        src = open(os.path.join(REPO, "src", f"{name}.js"), encoding="utf-8").read()
        imports[f"um:{name}"] = data_url(rewrite_imports(src))
        report.append((f"src/{name}.js", len(src)))
    sh = open(os.path.join(REPO, "src", "shaders", "index.js"), encoding="utf-8").read()
    imports["um:shaders"] = data_url(sh)
    report.append(("src/shaders/index.js", len(sh)))

    # ---- three.js itself -----------------------------------------------------
    three_sources: dict[str, str] = {}
    if a.vendor_three:
        print("vendoring three.js ...")
        three_imports, three_report, three_sources = vendor_three(html)
        imports.update(three_imports)
        report.extend(three_report)

    m = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', html, re.S)
    if not m:
        raise SystemExit("inline.py: no <script type=\"importmap\"> found")
    imap = json.loads(m.group(1))
    if a.vendor_three:
        # Drop the CDN prefix key so an unvendored addon fails loudly instead of
        # silently reaching for the network.
        imap["imports"].pop("three/addons/", None)
    imap["imports"].update(imports)
    html = html[:m.start()] + \
        f'<script type="importmap">\n{json.dumps(imap, indent=1)}\n</script>' + \
        html[m.end():]

    # ---- swap the external add-on tag for an inline import -------------------
    if ADDON_TAG not in html:
        raise SystemExit("inline.py: add-on <script> tag not found; was tools/patch.py run?")
    html = html.replace(ADDON_TAG,
                        "\n".join(blocks) + '\n<script type="module">import "um:addon";</script>')

    with open(a.dst, "w", encoding="utf-8") as fh:
        fh.write(html)

    print(f"{'item':<34} {'bytes':>12}")
    for k, v in report:
        print(f"  {k:<32} {v:>12,}")
    print(f"\n{os.path.basename(a.src)}  {before:,} bytes")
    print(f"{os.path.basename(a.dst)}  {len(html):,} bytes  (+{len(html)-before:,})")
    if not a.with_textures:
        print("\nTextures are still external; pass --with-textures for a true single file.")
    if a.vendor_three:
        verify_built_html(a.dst, three_sources)
        print("\n  Module-graph closure was verified STATICALLY. The page was not "
              "executed - this build step has no browser.")
    else:
        print("\nthree.js still comes from cdn.jsdelivr.net; pass --vendor-three to remove it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
