#!/usr/bin/env python3
"""
qa.py - load a built page in a real headless browser, capture the console, and
screenshot it at three viewports.

The project's QA standard is a headless Playwright load reviewed by eye. The
sandbox cannot download Playwright's own Chromium (its CDN redirects to a
denylisted host), so this script drives a locally installed Chromium instead,
with a throwaway profile. Pass --browser to point at a different binary.

Software rasterization is forced, so this proves the page BOOTS, the module
graph resolves and the GLSL COMPILES. It is not a judgement of how the result
looks on a real GPU - in particular the project has a history of Safari-only
glow bugs that only a real Mac or iPhone will show.

Usage:  python tools/qa.py [--page "Universal Map ... (v2).html"] [--port 8777]
"""
from __future__ import annotations
import argparse, http.server, json, os, socketserver, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PARENT = os.path.dirname(REPO)
CHROMIUM = "/Applications/Chromium.app/Contents/MacOS/Chromium"

VIEWPORTS = [("desktop", 1600, 1000), ("phone", 390, 844), ("landscape", 844, 390)]


def serve(root: str, port: int):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
        def log_message(self, *a): pass
    httpd = socketserver.TCPServer(("127.0.0.1", port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default="Universal Map \u00b7 Skybird Science (v2).html")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--browser", default=CHROMIUM)
    ap.add_argument("--out", default=os.path.join(REPO, "figures"))
    ap.add_argument("--settle", type=float, default=9.0)
    a = ap.parse_args()

    if not os.path.exists(a.browser):
        raise SystemExit(f"qa.py: no browser at {a.browser}")
    from playwright.sync_api import sync_playwright

    # Prefer a local http server; the sandbox forbids binding a socket, in which
    # case fall back to file://, which only works for a fully inlined build.
    httpd = None
    try:
        httpd = serve(PARENT, a.port)
        url = f"http://127.0.0.1:{a.port}/" + a.page.replace(" ", "%20").replace("\u00b7", "%C2%B7")
        print(f"serving {PARENT}\n  -> {url}\n")
    except PermissionError:
        from urllib.request import pathname2url
        url = "file://" + pathname2url(os.path.join(PARENT, a.page))
        print(f"cannot bind a local port; loading over file://\n  -> {url}\n"
              f"  (only a fully inlined build works this way - see tools/inline.py --with-textures)\n")

    logs, errors, requests_failed = [], [], []
    shots = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=a.browser, headless=True,
                args=["--enable-unsafe-swiftshader", "--use-gl=angle",
                      "--use-angle=swiftshader", "--ignore-gpu-blocklist",
                      "--enable-webgl", "--disable-dev-shm-usage"])
            for name, w, h in VIEWPORTS:
                page = browser.new_page(viewport={"width": w, "height": h},
                                        device_scale_factor=2 if name != "desktop" else 1)
                page.on("console", lambda m, n=name: logs.append((n, m.type, m.text[:400])))
                page.on("pageerror", lambda e, n=name: errors.append((n, str(e)[:400])))
                page.on("requestfailed",
                        lambda r, n=name: requests_failed.append((n, r.url[:140], str(r.failure)[:120])))
                page.goto(url + "?nointro", wait_until="networkidle", timeout=90_000)
                page.wait_for_timeout(int(a.settle * 1000))
                os.makedirs(a.out, exist_ok=True)
                f = os.path.join(a.out, f"qa_{name}.png")
                page.screenshot(path=f)
                shots[name] = f
                info = page.evaluate("""() => ({
                  um: !!window.__UM,
                  layers: window.__UM && window.__UM.layers ? Object.keys(window.__UM.layers) : [],
                  canvases: document.querySelectorAll('canvas').length,
                  webgl: (() => { try { const c = document.createElement('canvas');
                            return !!(c.getContext('webgl2') || c.getContext('webgl')); }
                          catch (e) { return false; } })(),
                  zoomNote: (document.getElementById('zoomNote') || {}).textContent || '',
                  toggles: ['tStars','tGalaxies','tDipole','tSolar','tWedge']
                            .filter(i => document.getElementById(i)).length,
                  ladder: ['zSolar','zStars','zGal','zSuper']
                            .filter(i => document.getElementById(i)).length,
                })""")
                print(f"{name:<10} {w}x{h}  bridge={info['um']}  webgl={info['webgl']}  "
                      f"canvases={info['canvases']}  toggles={info['toggles']}/5  ladder={info['ladder']}/4")
                print(f"           layers: {', '.join(info['layers']) or '(none)'}")
                if info["zoomNote"]:
                    print(f"           zoomNote: {info['zoomNote'][:96]}")
                page.close()
            browser.close()
    finally:
        if httpd: httpd.shutdown()

    print("\n--- console ---")
    bad = [l for l in logs if l[1] in ("error", "warning")]
    for n, t, msg in bad[:25]:
        print(f"  [{n}/{t}] {msg}")
    if not bad:
        print("  no errors or warnings")
    info_logs = [l for l in logs if l[1] == "info"]
    for n, t, msg in info_logs[:6]:
        print(f"  [{n}/info] {msg}")
    print("\n--- page errors ---")
    for n, e in errors[:15]:
        print(f"  [{n}] {e}")
    if not errors:
        print("  none")
    print("\n--- failed requests ---")
    for n, u, f in requests_failed[:15]:
        print(f"  [{n}] {u}  {f}")
    if not requests_failed:
        print("  none")
    print("\nscreenshots: " + ", ".join(shots.values()))
    return 1 if (errors or requests_failed) else 0


if __name__ == "__main__":
    sys.exit(main())
