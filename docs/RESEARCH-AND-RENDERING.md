# Universe Map — Research and Rendering

Companion to `PROGRESS.md`. Catalogs, coordinate and velocity conventions, rendering references, and open-source candidates for a three.js-style (~0.160) interactive 3D universe map.

## Provenance of dated checks

| Check set | Date (America/Los_Angeles) | Scope |
|---|---|---|
| Catalog / host reachability | 2026-11-01 | HTTP HEAD/GET against public astronomy hosts |
| Open-source LICENSE/README survey | 2026-11-06 | GitHub API reads; no clones; no runtime profiling |
| Build notes on CF4 grid indexing | Document date 2026-11-06 | Quoted below as **build-reported**, not re-run for this note |
| Module smoke test and Chrome frames | 2026-11-06 | `tools/smoketest/smoke.js` passed. Chrome frames are described in `PROGRESS.md`. They do not close the open visual issues |

Symbols for the **2026-11-01** host checks only:

- ✅ = HTTP 200 (HEAD/GET), size from `Content-Length` where available
- ⚠️ = Canonical host unreachable from that research network (TLS reset / timeout / 504)
- ❌ = Failed or wrong path (replacement noted)

**Standing rules**

1. **Code license ≠ texture rights ≠ catalog/data rights.** This repository states no application license.
2. Illustrative galaxy demos are **not** measured Milky Way or Local Group science.
3. Application source is in this branch. It is not on `main` until that branch is merged. The notes below describe this tree. They do not replace a later visual review.
4. Do **not** assert a single global CF4 axis order or velocity scale. Distinguish product and version. Mismatches stay unresolved until a named product is checked again.
5. Cite Xu et al. 2023. Do not add a PDF of that paper to the repository.

---

## 1. What this tree draws

Distances and radii below are the values stored in the data files, not a new fit.

### Milky Way

`data/milkyway.json` is marked `SCHEMATIC`. The arm pattern is not a direct observation.

| Parameter | Value in the file | Reference recorded there |
|---|---|---|
| R₀ | 8.178 kpc | GRAVITY Collaboration 2019, A&A 625, L10 |
| Sun height | 20 pc | Bennett & Bovy 2019, MNRAS 482, 1417 |
| Disk cutoff drawn | 15 kpc | Display cutoff, not an isophotal diameter |
| Arms | Idealised four-arm log spiral, pitch 12.5° | Names follow Reid et al. 2019, ApJ 885, 131. The geometry is not their fit and is not Xu et al. 2023 |

Xu, Hao, Liu, Lin, Bian, Hou, Li & Li 2023, ApJ 947, 54, doi:10.3847/1538-4357/acc45c, is a spiral-structure paper. It is the morphology citation. It is not a lighting model, and it is not the arm geometry in `milkyway.bin`. That paper's R₀ (8.15 kpc, Reid et al. 2019) is not the 8.178 kpc used here.

On the Milky Way step the disk is a thin cylinder with a soft edge, a brighter centre, and a dust lane when the disk is seen nearly edge-on. Bloom is off on that step. The 5 kpc bar is in kiloparsecs. Supercluster rings are not part of this step.

### Local Group

`data/localgroup.json` places 22 named members. The packed redshift catalog is not used: it has no names, and a redshift is not a position inside a few megaparsecs.

| Quantity | Source recorded in the file |
|---|---|
| Distance and Galactic (l, b) | McConnachie 2012, AJ 144, 4 (arXiv:1204.1562), Tables 1–3 |
| M31 circle | RC3 D25 via NED: log D25 + 1 = 3.28, so D25 = 190.5 arcmin. Half of that at 783 kpc is 21.705 kpc. Inclination is not applied |
| M33 circle | Tully 1988 Nearby Galaxies Catalog, D25 = 56.5 arcmin, at the McConnachie distance |
| NGC 6822, NGC 147, NGC 185, IC 10 | r25 arcmin quoted by McConnachie 2012 Table 3 from de Vaucouleurs et al. 1991, times each galaxy's distance |
| LMC, SMC | No half-light radius in that table. A 1.2 kpc cross is a position mark, not a size |
| Other circles | Half-light radii from the same table. A trailing colon in the paper is stored as `half-light-approx` |
| Plane of the circles | Milky Way disk plane, so one view can show the radii together. Not each galaxy's inclination |
| Milky Way circle on this step | The same 15 kpc schematic cutoff. Not an RC3 diameter, so it is not the same kind of measurement as the M31 circle |
| Bar | 200 kpc |

The galactic-to-supergalactic matrix is the de Vaucouleurs pole (l, b) = (47.37, +6.32) and origin (137.37, 0), the same convention as `data/catalogs/PROVENANCE.md`. The smoke test checks that it maps the Sun-centred galactic centre (8.178, 0, −0.020) kpc onto `milkyway.json` to better than 0.001 kpc.

### Larger scales

Galaxy positions in the packed catalog are supergalactic cartesian **Mpc/h with h = 0.75**, as in `data/catalogs/PROVENANCE.md` and `docs/FORMAT.md`. That statement is about those catalog columns. It does not settle the FITS velocity-grid index order in §3.2.

---

## 2. Distance helpers (general)

- Cosmicflows-4 distance modulus: `d[Mpc] = 10**((DM - 25) / 5)`
- Redshift catalogs in this tree: `d[Mpc/h] = cz / 100`, so the stored distance does not depend on a separate H0. See `data/catalogs/PROVENANCE.md`
- Supergalactic Cartesian from sky + distance uses the rotation in that same note. Axis **storage order for velocity grids** is a separate, versioned question (§3.2)

---

## 3. Primary catalogs and grids

### 3.1 Cosmicflows-4 (CF4) distance tables

**Citation:** Tully, R.B., Kourkchi, E., Courtois, H.M. et al. 2023, ApJ 944, 94 — doi:10.3847/1538-4357/ac94d8; VizieR doi:10.26093/cds/vizier.19440094

| Resource | URL | 2026-11-01 status |
|---|---|---|
| CDS FTP dir | https://cdsarc.cds.unistra.fr/ftp/J/ApJ/944/94/ | ⚠️ |
| Galaxies (`table2.dat`, ~55,877 rows) | https://cdsarc.cds.unistra.fr/ftp/J/ApJ/944/94/table2.dat | ⚠️ |
| Groups (`groups.dat`) | https://cdsarc.cds.unistra.fr/ftp/J/ApJ/944/94/groups.dat | ⚠️ |
| VO registry record | https://dc.g-vo.org/rr/q/lp/custom/CDS.VizieR/J/ApJ/944/94 | ✅ |
| EDD table builder / CF4 calculator | https://edd.ifa.hawaii.edu/dfirst.php · https://edd.ifa.hawaii.edu/CF4calculator/ | ⚠️ |

**3D columns (tables):** `RA, DE` (J2000), `SGL, SGB`, `Vcmb`, `DM`. Prefer the published 2023 tables over earlier flawed August-2022 EDD snapshots (per EDD notes).

The extracts in `data/catalogs/` cite those tables. Row counts are in `data/catalogs/PROVENANCE.md`. Host reachability below is a dated network observation, not a claim about later availability.

- **2026-11-01 research network:** CDS/EDD hosts for the CF4 tables were unreachable. The classic CfA VizieR FTP path `…/ftp/cats/J/…` returned **404** in that same pass. Classic `V/`/`VII/`/`VIII/` coverage does not imply a `J/` journal FTP.
- **Build notes (2026-11-06):** report that `cdsarc.cds.unistra.fr` and `edd.ifa.hawaii.edu` returned **502** at that origin, and that the CF4 tables were obtained via the CfA VizieR host `vizier.cfa.harvard.edu`, with row counts matching the published totals. The exact download path was **not** re-checked for this note.

### 3.2 CF4 velocity / density field grids — conventions unresolved

Page: https://projets.ip2i.in2p3.fr/cosmicflows/ (✅ on 2026-11-01).

| File / product | Citation | Notes from dated sources |
|---|---|---|
| `CF4_new_64-z008_delta.fits` / `…_velocity.fits` | Courtois et al. 2023, A&A 670, L15 (doi:10.1051/0004-6361/202245331) | See the conflict below |
| Grouped `CF4gp_new_64-z008_*` | same | Grouped CF4 variant |
| Zenodo 128³ density/velocity | Zenodo record 20653238 | Higher-resolution grids |
| `new_CF4pp_mean_std_grids.npz` | Courtois, Mould, Hollinger, Dupuy, Zhang 2025, A&A 701, 187 | HAMLET mean field; erratum re-issue noted 13 Oct 2026 (`vr_data` fix) |

Hoffman et al. 2024 (MNRAS 527, 3788): data “available upon reasonable request.” No public download was noted.

#### Convention conflict (do not pick a global winner)

| Source | Product context | Axis / indexing claim | Velocity scale claim |
|---|---|---|---|
| Catalog research note, 2026-11-01 (summarizing the IP2I Cosmicflows page for the 64³ CF4 grids) | Public FITS grids on projets.ip2i.in2p3.fr | Stored as **`(SGZ, SGY, SGX)`** | Project-page note: **multiply by 52** |
| Build notes, 2026-11-06 | That build's tested velocity-grid indexing | **`vel[component, iSGX, iSGY, iSGZ]`** (components in SG order), compared with that page's streamline tangents (build note: median cos 0.979) | Grid `\|v\|` **~48.6×** smaller than km/s. Build note: only *direction* is meaningful unscaled |

These may be different products, array layouts, or documentation layers. This repository does not name a FITS reader that repeats either test. Until a current source names the exact FITS or NPZ product and the check is run again, axis order and the velocity conversion stay **unresolved**. Do not apply ×52 or ×48.6 as a global scale.

Catalog positions in `data/catalogs/PROVENANCE.md` are a different object: SGX, SGY, SGZ in Mpc/h. That note does not choose a velocity-grid layout.

### 3.3 Watershed superclusters / basins

**Citation:** Dupuy, A. & Courtois, H.M. 2023, A&A 678, A176 — doi:10.1051/0004-6361/202346802; arXiv:2305.02339

- No VizieR machine-readable table for attractor positions (`J/A+A/678/A176` absent from the VO registry in the 2026-11-01 check).
- ✅ Watershed label grids: https://projets.ip2i.in2p3.fr/cosmicflows/CF4_new_128-z008_watersheds-fits.zip (67.1 MB). 128³ integer grids; basin index order matches Table A.1 (1 = Laniakea, …); 0 = none.
- Attractor / repeller positions: paper Table 1 / A.1. arXiv: https://arxiv.org/abs/2305.02339 ✅
- A build note reports streamline-id agreement of 90.9% (smoothing 0) and 93.3% (smoothing 10) against a recomputed basin volume. That check was not repeated for this note.

### 3.4 DESI DR1 redshift catalogs

**Citation:** DESI Collaboration 2025, arXiv:2503.14745; docs https://data.desi.lbl.gov/doc/releases/dr1/ ✅ (2026-11-01)

- Full zcatalogs under https://data.desi.lbl.gov/public/dr1/spectro/redux/iron/zcatalog/v1/
- Prefer smaller **LSS clustering** catalogs: https://data.desi.lbl.gov/public/dr1/survey/catalogs/dr1/LSS/iron/LSScats/v1.5/ ✅
- The extract here is the BGS clustering subset cut at z < 0.0655. See `data/catalogs/PROVENANCE.md`.

### 3.5 2MASS Redshift Survey (2MRS)

**Citation:** Huchra, J.P. et al. 2012, ApJS 199, 26 — doi:10.1088/0067-0049/199/2/26

| Resource | 2026-11-01 status |
|---|---|
| CDS `J/ApJS/199/26` | ⚠️ |
| HEASARC bulk `heasarc_twomassrsc.tdat.gz` | ✅ (44,599 rows checked in that pass) |
| HEASARC TAP `twomassrsc` | ✅ |
| CfA project page | ✅ https://lweb.cfa.harvard.edu/~dfabricant/huchra/2mass/ |

### 3.6 SDSS spectroscopic (DR18 optical = DR17 `specObj`)

**Citation:** Almeida et al. 2023, ApJS 267, 44 (DR18); Abdurro'uf et al. 2022, ApJS 259, 35 (DR17)

- ✅ `specObj-dr17.fits` at SDSS SAS. `specObj-dr18.fits` → ❌ 404 in the 2026-11-01 check (DR18 reuses DR17 optical spectro).

### 3.7 Abell / ACO clusters

**Citations:** Abell, Corwin & Olowin 1989, ApJS 70, 1 (VII/110A); Andernach 1991 (VII/165A)

- CfA VizieR FTP mirrors ✅ (2026-11-01) for VII/110A and VII/165A; HEASARC dumps ✅. Prefer HEASARC J2000. VII/165A CDS positions are B1950.

### 3.8 Bright stars: BSC5 and HYG

- BSC5 (Hoffleit & Warren 1991, CDS V/50): CfA mirror ✅; HEASARC `bsc5p` ✅ (2026-11-01)
- HYG Database (Nash / astronexus, CC BY-SA 4.0): https://github.com/astronexus/HYG-Database ✅ — precomputed equatorial `x, y, z` (pc). The star layer uses HYG v4.2.

### 3.9 Gaia EDR3 Catalogue of Nearby Stars (GCNS)

**Citation:** Gaia Collaboration, Smart et al. 2021, A&A 649, A6 — doi:10.1051/0004-6361/202039498

- CDS FTP ⚠️ (2026-11-01); ✅ Gaia Archive TAP `external.gaiaedr3_gcns_main_1` (331,312 rows; Galactic Cartesian pc). Not the star layer in this tree.

### 3.10 Dipole / radio layers

- CatWISE2020 quasars (Secrest et al. 2021; Zenodo 8303800) ✅
- NVSS (Condon et al. 1998, VIII/65): CfA / HEASARC ✅
- RACS-low DR1: CASDA TAP ✅
- Each entry in `data/dipole.json` carries its own citation. Implied speeds in the earlier `verify.py` record match `reference_velocity_kms × amplitude_ratio`. That program was not re-run for this note.

### 3.11 Name resolvers

- NED ✅; SIMBAD Harvard mirror TAP ✅ (CDS host ⚠️ on 2026-11-01)

### 3.12 Local Volume database (candidate, not the layer above)

| Resource | License (verified 2026-11-06) | Role |
|---|---|---|
| https://github.com/apace7/local_volume_database | **CC0-1.0** | Candidate for a broader Local Volume membership table |
| Pace 2025 overview paper | Cite per the upstream README | Required scientific citation for LVDB |
| McConnachie 2012 | The compilation cited in `data/localgroup.json` | The 22 members actually drawn |

LVDB is data only. It is not a three.js renderer, and it is not what the current Local Group step reads.

---

## 4. Working mirrors (2026-11-01 observations and the later build note)

| Mirror | Scope as of the dated checks |
|---|---|
| CfA VizieR FTP `https://vizier.cfa.harvard.edu/ftp/cats/<cat>/` | Classic `V/`/`VII/`/`VIII/` ✅ on 2026-11-01; **`J/` FTP path 404** in that pass |
| CfA VizieR host (broader than FTP `cats/J/`) | Build notes of 2026-11-06 report a successful CF4 **table** fetch when CDS/EDD returned 502. Path not re-checked here |
| HEASARC tdat dumps + TAP | 2MRS, Abell, Abell-z, BSC5, NVSS |
| IP2I Cosmicflows project site | CF4 grids, watersheds, CF4++ mean field |
| Gaia / NOIRLab / CASDA / NED TAP | Query without a full CDS FTP |

---

## 5. Reference visualizations (study only)

Not dependencies.

**Globaïa — Atlas of the Cosmos** (https://globaia.org/cosmos/ ✅ 2026-11-01). Credits include CF4, CF4++ grids, watersheds, Valade et al. 2024, SDSS/DESI subsets, 2MRS, IllustrisTNG/Planck, Pomarède glTF (CC BY 4.0).

**CosmosMap** (https://cosmosmap.org ✅ 2026-11-01). Credits include HYG, 2MRS, McConnachie 2012 Local Group, NED, NASA SVS Deep Star Maps 2020, JPL Horizons, Solar System Scope textures (CC BY 4.0).

**Cosmoscope** — public front-end: https://cosmoscope.space/

**License status:** no reusable open-source license was verified for Cosmoscope. Use it as a public front-end comparison only. Do not copy its shaders or textures. Do not label it proprietary without a stated license, and do not treat a missing license as permission.

The Milky Way disk in this tree is an independent thin-cylinder shading with a simple tone map (`color / (1 + color)`) and bloom turned off on that step. That is a display choice. It is not a reconstruction of another site's shader.

---

## 6. Textures in this tree

| Asset | Where | Rights |
|---|---|---|
| Planet, Earth, and Sun maps | `textures/` | Solar System Scope, CC BY 4.0. Downsample notes in `textures/ATTRIBUTION.md` |
| Moon color and normal | `textures/moon_2k.jpg`, `textures/moon_normal.png` | NASA SVS 4720, https://svs.gsfc.nasa.gov/4720, public domain. Credit NASA SVS. Separate from any application license |

Research solar sizes are the physical radii. Explore enlarges planets ×360 and the Sun ×4 so the orbits stay readable. The smoke test checks both modes. The Moon is shown at its physical size in Research and hidden while the planets are enlarged.

---

## 7. Rendering status

Checked and still open: see `PROGRESS.md`. Short form:

| Topic | Status on 6 Nov 2026 |
|---|---|
| Milky Way blown oval and Mpc/h rulers | Absent in the Chrome Research frames (edge-on, face-on, oblique). Soft disk and schematic arms remain. Not accepted |
| Local Group members | On screen in Chrome Research, at the stored radii, with a 200 kpc bar. Label crowding remains. Not accepted |
| Earth flicker | Open |
| Filled pink marker | Wireframe in source. One Galaxies frame had no filled block. Not accepted |
| `verify.py` | Not run this pass |
| Network-disabled run | Not run |

---

## 8. Open-source references (LICENSE-verified, 2026-11-06)

Research only. None of these were adopted as a dependency.

### 8.1 Candidates

| # | Repo | Verified license | Fit | Hard limits |
|---|---|---|---|---|
| 1 | https://github.com/apace7/local_volume_database | **CC0-1.0** | Local Volume positions and membership | Data only. Cite Pace 2025. Not the current member file |
| 2 | https://github.com/alexmensch/stellata | **AGPL-3.0-only** | Scientific volumetric Milky Way (study) | AGPL. WebGPU. Not a WebGL 0.160 dependency |
| 3 | https://github.com/zjoooooo/galaxy-explorer | **MIT** | Illustrative disc and dust | Not a measured Milky Way. three.js r128 |
| 4 | https://github.com/hyqzz/Solar-Wanderer | **MIT** | Physical solar proportions | Large app. Texture rights separate |
| 5 | https://github.com/protectwise/troika (`troika-three-text`) | **MIT** | SDF labels | No leader lines. Not used here |
| 6 | https://github.com/gabereiser/earth | **MIT** | Atmosphere scattering reference | Not a flicker fix. Not used here |
| 7 | https://github.com/leoawen/volumetric_cloud_atmosphere_scattering | **MIT** | Heavier atmosphere | Secondary. Not used here |

**Older solar alternative:** https://github.com/sanderblue/solar-system-threejs — **Apache-2.0** (2022).

### 8.2 Not reusable as open source from the survey

| Candidate | Why |
|---|---|
| https://github.com/mohnasr137/earth-3d | README claims MIT. No LICENSE file |
| https://github.com/mitchcamza/Earth3D | README claims MIT. No LICENSE file |
| https://github.com/elewiradder/-The-Milky-Way-Galaxy | Empty. No license |
| Cosmoscope public front-end | No reusable license verified. Study only |

### 8.3 Survey limits

- No verified drop-in Earth flicker fix in the permissive projects surveyed.
- No permissive measured-Milky-Way renderer suitable as a small WebGL three.js ~0.160 dependency.
- AGPL scientific Milky Way code is study material unless AGPL compliance for a combined public work is accepted.

---

## 9. Citation practice

1. Short display credit on the page.
2. Full citation and DOI where one exists.
3. Separate application license (none stated), data rights, and texture terms.
4. File version or download date. For a CF4 grid, the filename, the index convention, and the velocity scale, each marked as checked or unchecked.
5. Xu et al. 2023 by DOI. Do not commit the PDF.

---

## 10. Left out of this note

Assignment lists, private paths, and run transcripts. `docs/HANDOFF.md` in a local working copy is not part of this public branch.
