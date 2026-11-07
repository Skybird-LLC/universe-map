# Universal Map — star, galaxy, dipole and solar-system layers

Add-on layers for **Laniakea Remapped** (`laniakea.skybirdscience.com`), the
single-file three.js page that visualizes the Cosmicflows-4 flow field.

The original page is never modified. `tools/patch.py` builds a v2 copy from it;
`tools/inline.py` folds everything back into one file.

---

## What this adds

| Layer | Contents | File |
|---|---|---|
| **Stars** | 24,704 HYG v4.2 stars within 100 pc at true 3-D positions, plus 8,920 naked-eye directions on a shell | `data/stars.bin` (370 kB) |
| **Galaxies** | 287,758 galaxies with provenance flags, CF4 peculiar velocities and basin tags at both smoothing levels | `data/galaxies.bin` (3.2 MB) |
| **Dipole** | 7 cited number-count dipole measurements with 1σ direction cones, plus 5 mass/sink markers | `data/dipole.json` |
| **Milky Way** | 186,819-point schematic of our own galaxy with the Sun in it, at 8.178 kpc | `data/milkyway.bin` (1.7 MB) |
| **Local Group** | 22 named members at published distances. Circles use the radius on each row. LMC and SMC are position marks | `data/localgroup.json` |
| **Solar system** | 8 planets with true orbital planes from the JPL element table, multi-layer Earth, Moon, Sun | `data/solarsystem.json`, `textures/` |

The supercluster layer is **not** rebuilt — the page already ships ten named,
coloured basins matched to the Dupuy & Courtois (2023) attractors.
`src/superclusters.js` is a handle over those, and every new layer inherits that
palette rather than introducing a competing one.

---

## Three findings worth stating up front

**1. The dipole does not point at Shapley.** Every measured direction sits within
about 20° of the CMB dipole; Shapley is **40.4°** away from the CMB direction and
**40.0°** from the Böhme et al. 2025 fit. The flow sink carried in the page's own
`cf-meta` is 2° from Shapley, so it is 41° off too. The layer draws that offset
rather than asserting an alignment.

**2. The deep surveys cannot see the thing the map is about.** Measured from the
nearest catalogued object to each landmark direction:

| Landmark | 2MRS | CF4 | SDSS DR17 | DESI DR1 |
|---|---|---|---|---|
| Shapley | 0.11° | 0.08° | **25.61°** | **21.79°** |
| Great Attractor | 0.05° | 0.85° | **59.00°** | **54.35°** |

SDSS and DESI cover the north galactic cap only. Their points are flagged
per-galaxy (`prov` 2 and 3), toggleable, and visually distinct by default.

**3. Vela is inside the volume and the existing segmentation misses it.** The
Vela supercluster (Hollinger et al. 2026, A&A 713, A4) sits at supergalactic
(−118.0, +19.5, −146.4) Mpc/h, 189 Mpc/h out, with a mass approaching Shapley's.
The CF4 watershed assigns that region to **Lepus** — there is no Vela basin,
because CF4 barely samples the Zone of Avoidance. This galaxy layer carries
**zero** catalogued galaxies within 20 Mpc/h of the Vela centre and only 239
within its 74 Mpc/h characteristic radius. It is marked in `data/dipole.json`
with that caveat attached.

---

## Building

```bash
python tools/patch.py          # original -> "... (v2).html"            2.73 MB
python tools/inline.py         # + data and modules inlined             7.68 MB
python tools/inline.py --with-textures \
       --dst "../Universal Map · Skybird Science (v2, standalone).html"  21.7 MB
```

`patch.py` applies six edits, each anchored on a string asserted to be unique, so
it either applies cleanly or fails loudly. The resulting diff is **34 lines added,
0 removed**, and the original `cf-data` payload stays byte-identical.

The edits are:

1. a `window.__UM` bridge after the post-processing setup — the page's code is an
   ES module, so `scene` / `camera` / `controls` are otherwise private
2. a `universal-map:ready` event at the end of the boot block
3. four layer toggles, a four-step scale ladder, and their styles
4. the `<script type="module" src="./universal-map/src/addon.js">` tag

### file:// versus http://

The v2 build **fetches** its layer files, so it must be served over `http://`.
A `file://` load cannot fetch them and the layers will be missing (the console
says so explicitly). Use `inline.py` for a single file that works from disk:
modules are registered as `data:` URLs under bare `um:*` specifiers in the
import map, so no path assumptions survive. `--with-textures` embeds the texture
set too, which is what makes the standalone build 21.7 MB.

Note that `three` itself still comes from `cdn.jsdelivr.net` via the page's
original import map, so every build needs network access at load time.

---

## The scale ladder

Five steps spanning about fourteen orders of magnitude:

```
solar system  ->  nearby stars  ->  Milky Way  ->  galaxies  ->  superclusters
```

| Step | Scaling | Content size | near | far | OrbitControls |
|---|---|---|---|---|---|
| Solar system | 1 au → 2 units | Neptune at 60 | 0.05 | 5000 | 2–600 |
| Nearby stars | 1 pc → 2 units | bubble at 200 | 0.5 | 20000 | 5–2000 |
| Milky Way | 1 kpc → 20 units | disk at 600 | 1 | 20000 | 20–6000 |
| Galaxies | 1 Mpc/h → 1 unit | field at ~260 | 1 | 5000 | 60–1400 |
| Superclusters | 1 Mpc/h → 1 unit | field at ~600 | 1 | 12000 | 100–3000 |

**A level is authoritative.** Entering one sets the scale *and* the visibility of
every layer — the new ones and the page's own flow lines, isosurfaces, rings and
labels — and the layer toggles only choose among what that level contains.
Toggles for layers outside the current level are disabled.

That is deliberate, and it is a correction. These steps cannot share a
coordinate system: the solar system is 3×10⁻¹⁰ Mpc/h across, so at any size that
makes it visible next to the galaxy field it is about 10¹¹ times too large. The
first build let a manually-ticked toggle survive a level change, and the solar
system rendered **261 million light-years across**, swallowing the supercluster
field. The ladder now rescales every layer on every transition and offers no way
to put two scales on screen at once, because there is none at which both are
legible.

Planet radii are additionally exaggerated ×1200 and the Sun ×60; at true scale
Earth is 4×10⁻⁵ au across and would never exceed one pixel.

### Zooming in

* **Click the Milky Way marker** in the galaxy view, then **Enter the galaxy** on
  its info card — this drops you into the Milky Way step.
* In that view the Sun is a marker at the scene origin, with the 100 pc bubble
  from the previous step drawn as a small ring around it. **Click the Sun** to
  descend to the star bubble, and again to the solar system.
* **Zoom in / Zoom out** buttons under the scale segment walk the ladder one
  step at a time and name the step they lead to.

### The Milky Way layer is a schematic

Stated here because it is easy to mistake for a map. We observe the Milky Way
from inside it, so its spiral pattern is not directly measured. The global
parameters *are* real — R₀ = 8.178 kpc (GRAVITY Collaboration 2019), the Sun 20 pc
above the plane (Bennett & Bovy 2019), a 2.6 kpc disk scale length, a 3 kpc bar
at 25° to the Sun–centre line — but the four arms are an idealised logarithmic
spiral at 12.5° pitch, not a fitted model. The arm *names* follow Reid et al.
(2019); the geometry does not. `data/milkyway.json` says so in a `model` field,
and `verify.py` asserts that field still begins with "SCHEMATIC".

## Data provenance

Full detail in `data/catalogs/PROVENANCE.md`. All positions are supergalactic
cartesian in **Mpc/h with h = 0.75**, matching the page's `cf-meta` convention.

* **Cosmicflows-4** — Tully et al. 2023, ApJ 944, 94. `table2` (55,877 galaxies)
  and `groups` (38,053 groups, carrying `Vpec`). Distance `10^((DM−25)/5)`, ×h.
* **2MRS** — Huchra et al. 2012, ApJS 199, 26, via HEASARC. 43,496 usable
  redshifts, CMB-corrected with 369.82 km/s toward galactic (264.021, 48.253).
* **SDSS DR17** `specObj-dr17.fits`, **DESI DR1** BGS — local copies, `z < 0.0655`,
  `SPECPRIMARY = 1`, `CLASS = GALAXY`, `ZWARNING = 0`.
* **HYG v4.2** — equatorial parsec xyz, rotated into the supergalactic frame.
  Colours are blackbody sRGB from B−V via Ballesteros (2012) and the CIE 1931
  fits of Wyman et al. (2013).
* **Orbits** — JPL/Standish, *Keplerian Elements for Approximate Positions of the
  Major Planets*, valid 1800–2050.
* **Textures** — Solar System Scope, CC BY 4.0, except the Moon (NASA SVS 4720, public domain). See `textures/ATTRIBUTION.md`. Texture rights are separate from catalog rights. This repository does not state an application license.
* **Local Group members** — distances and Galactic coordinates from McConnachie 2012, AJ 144, 4. Radii and the plane they are drawn in are recorded in `data/localgroup.json`. The Milky Way circle on that step is the 15 kpc schematic cutoff, not an isophotal diameter.

### Dipole citations

Each entry in `data/dipole.json` carries a `verified_from` field recording how
the number was obtained.

| Source | Ratio to Ellis–Baldwin | Significance | Read from |
|---|---|---|---|
| CMB (Planck 2018) | 1 (reference, 369.82 km/s) | — | standard value |
| Böhme et al. 2025, PRL 135, 201001 | 3.67 ± 0.49 | 5.4σ | fetched full text |
| Böhme et al. 2025, NVSS+RACS only | — | 4.5σ | fetched full text |
| Wagenveld et al. 2023, A&A 675, A72 | ~3.5 | 4.8σ | as tabulated in Böhme |
| Secrest et al. 2021, ApJL 908, L51 | ~2 | 4.9σ | published abstract |
| Secrest et al. 2022, ApJL 937, L31 | ~2 | 4.4σ | published abstract |
| Dam, Lewis & Brewer 2023, MNRAS 525, 231 | 2.46 ± 0.18 | 5.7σ | published abstract |

Two corrections against the original plan: Secrest 2022 is **4.4σ**, not 5.1σ,
and no "Land-Strykowski 2026" could be verified, so it was **dropped** rather
than invented.

`implied_velocity_kms` is the ratio times 369.82 km/s — the speed required *if
the whole excess were kinematic*. That reading is deliberately literal. Most
authors treat the excess as a tension with the standard model rather than as a
measurement of our speed, and the file says so.

---

## Binary format

`docs/FORMAT.md` documents it in full. In short: arrays concatenated in
`meta.arrays` order, each starting at an offset aligned up to **8 bytes**, no
trailing padding, little-endian. Positions `int16 × 0.02` Mpc/h, normals
`int8 / 127`, speeds `uint8 × 4` km/s, basin ids `uint8` with 255 unassigned.

```bash
python tools/cfpack.py verify "../Universal Map · Skybird Science.html"
# offset table reproduced : True
# buffer byte-identical   : True (1,945,412 vs 1,945,412 bytes)
```

---

## What was checked

`docs/verification.txt` records an earlier run of `python tools/verify.py`:
67 checks, 0 failed. That program was **not** run again for this publication.
It needs numpy and pandas, and it also expects the original HTML payloads
beside the repo.

On 6 November 2026 (America/Los_Angeles), `cd tools/smoketest && node smoke.js`
passed. It loads the modules in Node against a stubbed three.js and the data
files. It does not compile shaders and it does not draw a frame.

Recorded earlier, and not repeated by that smoke run:

* Supergalactic rotation against CF4 `SGL`/`SGB` over 55,877 galaxies: median
  separation 0.305 arcsec (`data/catalogs/PROVENANCE.md`).
* Basin-volume agreement with the page's streamline seeds, 90.9% at smoothing 0
  and 93.3% at smoothing 10, is a build note. It is not a new measurement here.
* CF4 velocity-grid axis order and the factor that turns grid speeds into km/s
  are **not settled**. One build note indexes `vel[component, iSGX, iSGY, iSGZ]`
  and treats `|v|` as about 48.6× below km/s. An earlier note on the public 64³
  FITS says the axes are stored `(SGZ, SGY, SGX)` and the speeds are multiplied
  by 52. Those notes may describe different products. See
  `docs/RESEARCH-AND-RENDERING.md`. Neither factor is a global scale.
* The smoke test's Kepler solver gives Earth's heliocentric distance at J2000
  as 0.983307 au.

## What is still open

Chrome frames on 6 November 2026 (America/Los_Angeles) are evidence, not a
sign-off. Safari was not part of this pass.

* **Milky Way.** Edge-on, face-on, and oblique Research frames did not show the
  blown white oval or the supercluster Mpc/h rulers. A soft disk remains under
  the point sample. The arms are the schematic in `data/milkyway.json`, not the
  arm geometry of Xu et al. 2023.
* **Local Group.** Research showed the named members, a 200 kpc bar, and no
  supercluster rulers. The Milky Way and Andromeda are small disks at the radii
  in `data/localgroup.json`. The LMC and SMC labels still crowd the Milky Way label.
* **Earth.** Surface flicker is still open.
* **Markers.** Great Attractor and Vela markers are wireframe in `src/dipole.js`.
  One Galaxies frame did not show a filled pink block. The label and the flow
  lines stay. That frame is not a sign-off.
* A network-disabled run was not done. A bundled page can still request Google
  Fonts and a Zenodo record URL.

`tools/qa.py` can serve a page and capture console errors. It was not the check
used above.

---

## Figures

| File | Shows |
|---|---|
| `figures/coverage_allsky.png` | All-sky footprints of the four catalogs, with the measured Shapley gap |
| `figures/galaxies_sgplane.png` | SGX–SGY slab with the wedge's true angular bounds |
| `figures/basin_validation.png` | Recomputed basin slices against the page's streamline seeds |
| `figures/dipole_sky.png` | Every dipole direction with 1σ cones, and the implied speeds |
| `figures/orbits_check.png` | Orbits face-on and edge-on, with inclinations |
| `figures/milkyway_check.png` | The galaxy model face-on and edge-on, with the Sun, and the ladder to scale |

---

## Layout

```
universal-map/
  data/            stars.bin/.json, galaxies.bin/.json, dipole.json,
                   milkyway.bin/.json, localgroup.json, solarsystem.json,
                   basin_volume.npz, catalogs/*.parquet
  src/             loader, stars, galaxies, superclusters, dipole, milkyway,
                   localgroup, solarsystem, addon
  textures/        web-optimized maps, manifest, attribution
  tools/           cfpack.py, patch.py, inline.py, bundle.py, verify.py, qa.py, smoketest/
  docs/            FORMAT.md, PROGRESS.md, RESEARCH-AND-RENDERING.md
  figures/         diagnostic figures
```

Source catalogs (CF4 TSVs, 2MRS, HYG, the CF4 FITS grids, DESI and SDSS) live in
`../Cosmological Data` and are gitignored — they total about 7.5 GB.
