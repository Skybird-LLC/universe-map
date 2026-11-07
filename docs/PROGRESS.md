# Universe Map — Progress

Public progress notes for [Skybird-LLC/universe-map](https://github.com/Skybird-LLC/universe-map) (Skybird Science interactive 3D universe map).

Companion: `RESEARCH-AND-RENDERING.md` (catalogs, rendering references, license-separated OSS candidates).

Visual issues stay open until a later check accepts them. A Chrome frame is evidence about that frame. It is not a sign-off.

---

## Research and rendering milestones

| Milestone | Status |
|---|---|
| Public repository with project description | Present on `main` before this branch |
| Application source in this branch | Included. Not on `main` until merged |
| Catalog and rendering notes | This file and `RESEARCH-AND-RENDERING.md`, adapted to the tree at publication |
| Open-source GitHub resource survey (LICENSE-verified, 2026-11-06) | Complete as research only. No code adopted |
| Reference front-ends (Globaïa, CosmosMap, Cosmoscope) | Study only. No reuse license verified for Cosmoscope |
| Local Group members in the viewer | 22 named members in `data/localgroup.json`. See the open-items table |
| CF4 grid axis / velocity scale | **Unresolved.** Conflicting notes by product. Not asserted as one convention |
| Offline / network-disabled run | Not run |
| Full catalog verification (`tools/verify.py`) | **Not run** for this publication. An earlier record is `docs/verification.txt` |

---

## Checked for this publication

Date: 6 November 2026 (America/Los_Angeles).

| Check | Result |
|---|---|
| `cd tools/smoketest && node smoke.js` | Passed. Loads modules against a three.js stub and the data files. Does not compile shaders and does not draw a frame |
| `python tools/verify.py` | Not run. numpy and pandas were not available, and the script also expects the original HTML payloads |
| Chrome, Milky Way, Research | Edge-on, face-on, and oblique frames. No blown white oval. No 100/200/300 Mpc/h rulers. A soft disk remains under the schematic point sample |
| Chrome, Local Group, Research | Named members on screen, including small Milky Way and Andromeda disks, and a 200 kpc bar. No supercluster rulers. LMC and SMC labels still crowd the Milky Way label |
| Chrome, Galaxies | One earlier frame the same day did not show a filled pink block. Markers in `src/dipole.js` are wireframe. Not a sign-off |
| Safari | Not part of this pass |

---

## Open

| Issue | Notes |
|---|---|
| Earth surface flicker | Still open. A stable clip plane in an earlier Chrome sequence does not close it |
| Milky Way appearance | The reported blown oval and supercluster rulers were absent in the 6 Nov Chrome frames. A soft disk remains. The point sample is the schematic in `data/milkyway.json`, not Xu et al. 2023. Not accepted |
| Local Group framing and labels | Members and the 200 kpc bar are visible at the published radii. LMC and SMC labels still overlap the Milky Way label. Inclinations are not applied. Not accepted |
| Colored marker block | Filled Great Attractor and Vela gems are wireframe. The label and the flow lines stay. Not accepted from one frame |
| Full catalog byte checks | `verify.py` not run on this tree |
| Offline run | Not run. A bundled page can still request Google Fonts and a Zenodo record URL |

---

## In the tree, not a visual sign-off

| Item | Status |
|---|---|
| NASA Moon maps (SVS 4720) | In `textures/`, public-domain credit in `textures/ATTRIBUTION.md`. The smoke test checks the Research orbit distance (about 63 Earth radii) and that Explore hides the Moon while planets are enlarged. A finished close-up review is not claimed here |
| Solar System Scope planet textures | In `textures/`, CC BY 4.0, separate from any application license |
| Explore solar sizes | Smoke test: planets ×360 and Sun ×4 in Explore; true radii in Research. Stated exaggeration, not a new measurement |
| Scale chrome on the Milky Way and Local Group steps | Supercluster rings and axis labels were hidden in the Chrome frames above |

---

## Rights

No application license is stated. Texture rights, catalog rights, and any future code license stay separate. Cite Xu et al. 2023 (ApJ 947, 54, doi:10.3847/1538-4357/acc45c). Do not redistribute a PDF of that paper from this repository.

---

## Next content milestones (no schedule)

1. Accept or reject each open visual issue from a later review, including Safari.
2. Re-run `tools/verify.py` where its dependencies and the original page payloads are available.
3. Record one CF4 velocity-grid product, its index order, and its velocity scale only after that product is named and the check is repeated.
4. Run a network-disabled check before calling the page offline.
5. Choose and record an application license separately from the texture and catalog terms.
