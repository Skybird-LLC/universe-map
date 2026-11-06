#!/usr/bin/env python3
"""
verify.py - decode every packed binary back and check it against its source.

Run from the repo root:  python tools/verify.py
Exits non-zero if any check fails.
"""
from __future__ import annotations
import json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, REPO)
from tools import cfpack  # noqa: E402

CAT = os.path.join(REPO, "data", "catalogs")
PQ = dict(engine="fastparquet")

rows, failures = [], 0


def check(layer, name, got, want, tol=None, unit=""):
    global failures
    if tol is None:
        ok = got == want
        detail = f"{got}"
    else:
        ok = abs(got - want) <= tol
        detail = f"{got:.6g} vs {want:.6g} (tol {tol:g})"
    if not ok:
        failures += 1
    rows.append((layer, name, "PASS" if ok else "FAIL", f"{detail} {unit}".strip()))


# ----------------------------------------------------------------- stars
meta, arr = cfpack.read_pair(os.path.join(REPO, "data", "stars"))
nb, ns = meta["bubble"]["count"], meta["shell"]["count"]
check("stars", "bubble count", len(arr["bub_pos"]) // 3, nb)
check("stars", "shell count", len(arr["shl_dir"]) // 3, ns)
check("stars", "bubble colour triples", len(arr["bub_rgb"]) // 3, nb)
pos = arr["bub_pos"].reshape(-1, 3) * meta["bubble"]["pos_scale"]
r = np.linalg.norm(pos, axis=1)
check("stars", "max bubble radius", float(r.max()), 100.0, tol=0.01, unit="pc")
d = arr["shl_dir"].reshape(-1, 3) * meta["shell"]["dir_scale"]
check("stars", "shell vectors unit", float(np.abs(np.linalg.norm(d, axis=1) - 1).max()), 0.0,
      tol=2e-4)
mag = meta["mag_offset"] + arr["bub_absmag"] * meta["mag_scale"]
check("stars", "absmag within table range", bool(mag.min() >= -10 and mag.max() <= 15.5), True)

# ----------------------------------------------------------------- galaxies
gmeta, g = cfpack.read_pair(os.path.join(REPO, "data", "galaxies"))
n = gmeta["count"]
check("galaxies", "point count", len(g["pos"]) // 3, n)
for k in ("prov", "vpec", "basin_s0", "basin_s10"):
    check("galaxies", f"{k} length", len(g[k]), n)
xyz = cfpack.dequant_pos(g["pos"]).reshape(-1, 3)
check("galaxies", "max |coordinate| under int16 limit",
      bool(np.abs(xyz).max() < 32767 * cfpack.POS_SCALE), True)

cf4 = pd.read_parquet(os.path.join(CAT, "cf4_galaxies.parquet"), **PQ)
nc = int((g["prov"] == 0).sum())
check("galaxies", "CF4 rows", nc, len(cf4))
src = cf4[["SGX", "SGY", "SGZ"]].values
err = np.abs(xyz[: len(cf4)] - src).max()
# Two error sources, not one: half a quantization step from the int16 rounding,
# plus the float32 cast in dequant_pos, which is relative so it scales with the
# largest coordinate. Ignoring the second term makes this check fail by ~1e-5.
q_tol = cfpack.POS_SCALE / 2
f32_tol = float(np.abs(xyz).max()) * np.finfo(np.float32).eps
check("galaxies", "CF4 positions within quantization", float(err), 0.0,
      tol=q_tol + f32_tol, unit="Mpc/h")
for code, want in [(1, "2MRS"), (2, "SDSS DR17"), (3, "DESI DR1 BGS")]:
    check("galaxies", f"{want} rows", int((g["prov"] == code).sum()),
          gmeta["provenance"][str(code)]["n"])
vp = g["vpec"][g["vpec"] != gmeta["vpec_missing"]]
check("galaxies", "rows carrying a peculiar velocity", len(vp), 55864)
check("galaxies", "peculiar velocity range plausible",
      bool(vp.min() > -9000 and vp.max() < 9000), True)
nb0 = int((g["basin_s0"] != 255).sum())
check("galaxies", "basin-tagged rows (s0)", nb0, int((g["basin_s10"] != 255).sum()))
check("galaxies", "basin ids within the page's palette",
      bool(set(np.unique(g["basin_s0"])) <= set(range(10)) | {255}), True)

# ----------------------------------------------------------------- milky way
mmeta, mw = cfpack.read_pair(os.path.join(REPO, "data", "milkyway"))
nmw = mmeta["count"]
check("milkyway", "point count", len(mw["pos"]) // 3, nmw)
check("milkyway", "colour triples", len(mw["rgb"]) // 3, nmw)
mxyz = cfpack.dequant_pos(mw["pos"], mmeta["pos_scale"]).reshape(-1, 3)
check("milkyway", "disk radius drawn", float(np.hypot(mxyz[:, 0], mxyz[:, 1]).max()), 0.0,
      tol=40.0, unit="kpc (loose: SG axes are not the disk plane)")
gc = np.array(mmeta["galactic_centre_sg_kpc"])
# |Sun -> GC| is hypot(R0, z_sun), not R0: the Sun sits 20 pc above the plane.
check("milkyway", "Sun-to-centre distance", float(np.linalg.norm(gc)),
      float(np.hypot(mmeta["parameters"]["R0_kpc"], mmeta["parameters"]["z_sun_kpc"])),
      tol=1e-5, unit="kpc")
check("milkyway", "disk normal is a unit vector",
      float(np.linalg.norm(mmeta["disk_normal_sg"])), 1.0, tol=1e-8)
check("milkyway", "model is declared schematic", mmeta["model"].startswith("SCHEMATIC"), True)
check("milkyway", "every parameter has a reference", len(mmeta["references"]) >= 3, True)

# ----------------------------------------------------------------- dipole
dip = json.load(open(os.path.join(REPO, "data", "dipole.json"), encoding="utf-8"))
check("dipole", "entries", len(dip["entries"]), 7)
check("dipole", "markers", len(dip["markers"]), 5)
check("dipole", "every entry cites a source",
      all(e.get("reference") and e.get("verified_from") for e in dip["entries"]), True)
for e in dip["entries"]:
    if e["amplitude_ratio"]:
        check("dipole", f"implied v, {e['key']}",
              e["implied_velocity_kms"],
              round(dip["reference_velocity_kms"] * e["amplitude_ratio"], 1), tol=0.05, unit="km/s")

# ----------------------------------------------------------------- solar system
ss = json.load(open(os.path.join(REPO, "data", "solarsystem.json"), encoding="utf-8"))
check("solarsystem", "planets", len(ss["planets"]), 8)
for nm, p in ss["planets"].items():
    o = np.array(p["orbit_ecliptic_au"])
    check("solarsystem", f"{nm} orbit samples", len(o), 256)
    a, e = p["elements_j2000"]["a_au"], p["elements_j2000"]["e"]
    check("solarsystem", f"{nm} aphelion", float(np.linalg.norm(o, axis=1).max()),
          a * (1 + e), tol=1e-6, unit="au")
    check("solarsystem", f"{nm} period vs Kepler", p["period_years"], a ** 1.5,
          tol=0.001 * a ** 1.5, unit="yr")
M = np.array(ss["frames"]["ecliptic_to_supergalactic"])
check("solarsystem", "frame matrix orthonormal", float(np.abs(M @ M.T - np.eye(3)).max()), 0.0, tol=1e-9)
check("solarsystem", "frame matrix right-handed", float(np.linalg.det(M)), 1.0, tol=1e-9)

# ----------------------------------------------------------------- page payload
for ed in ["Universal Map.html", "Universal Map \u00b7 Skybird Science.html",
           "Universal Map \u00b7 Skybird Science (v2).html"]:
    p = os.path.join(os.path.dirname(REPO), ed)
    if not os.path.exists(p):
        continue
    m, b = cfpack.read_html(p)
    tbl, rebuilt = cfpack.pack(list(cfpack.unpack(m, b).items()))
    check("payload", f"{ed[:40]} repack byte-identical", rebuilt == b, True)

# ----------------------------------------------------------------- report
w = max(len(r[1]) for r in rows) + 2
print(f"{'layer':<13}{'check':<{w}}{'result':<8}detail")
print("-" * (13 + w + 8 + 34))
for lay, nm, res, det in rows:
    print(f"{lay:<13}{nm:<{w}}{res:<8}{det}")
print("-" * (13 + w + 8 + 34))
print(f"{len(rows)} checks, {failures} failed")
sys.exit(1 if failures else 0)
