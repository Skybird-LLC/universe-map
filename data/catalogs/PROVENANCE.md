# Catalog provenance

All positions are supergalactic cartesian (SGX, SGY, SGZ) in **Mpc/h with h = 0.75**,
matching the viewer's `cf-meta` convention. Fetched 2026-11-01.

| File | Rows | Source | Distance |
|---|---|---|---|
| `cf4_galaxies.parquet` | 55,877 | Cosmicflows-4, Tully et al. 2023, ApJ 944, 94 — VizieR `J/ApJ/944/94/table2` | `d[Mpc] = 10^((DM-25)/5)`, then x h |
| `cf4_groups.parquet` | 38,053 | same catalog, `groups` table (Tables 3 and 4) | published `Dist` column, x h; carries `Vpec` |
| `twomrs.parquet` | 43,496 | 2MASS Redshift Survey, Huchra et al. 2012, ApJS 199, 26 — HEASARC `heasarc_twomassrsc` | `d[Mpc/h] = cz_CMB / 100` |
| `sdss_dr17_nearby.parquet` | 186,153 | SDSS DR17 `specObj-dr17.fits`, local copy | `d[Mpc/h] = cz / 100` |
| `desi_dr1_bgs_nearby.parquet` | 186,112 | DESI DR1 LSS `BGS_ANY_NGC_clustering`, local copy | `d[Mpc/h] = cz / 100` |

## Conventions and checks

* **Why `cz/100`.** In Mpc/h the Hubble distance is `d = cz/(100h) x h = cz/100`,
  so the redshift-space catalogs carry no dependence on the adopted H0. The
  CF4 distance moduli are true metric distances in Mpc and are multiplied by
  h = 0.75 to enter the same units.
* **Supergalactic rotation.** Built from the de Vaucouleurs pole
  (galactic l = 47.37, b = +6.32) and origin (l = 137.37, b = 0), composed with
  the J2000 equatorial-to-galactic matrix. Validated against CF4's own `SGL`/`SGB`
  columns over all 55,877 galaxies: **median separation 0.305 arcsec**,
  99th percentile 0.703 arcsec.
* **2MRS CMB correction.** Heliocentric cz corrected with a solar motion of
  369.82 km/s toward galactic (l, b) = (264.021, 48.253); applied shift spans
  -370 to +370 km/s. 1,103 of 44,599 rows dropped for missing or non-positive
  cz_CMB.
* **CF4 `Dist` vs `DMzp`.** Agree to a median relative deviation of 1.2e-4. The
  40 rows above 1% are all at Dist <= 4.0 Mpc, where the published F5.1 column is
  rounded to 0.1 Mpc.
* **Nearby cut.** SDSS and DESI are stored only for z < 0.0655 (r < 196 Mpc/h),
  the volume the viewer actually renders. SDSS rows are `SPECPRIMARY = 1`,
  `CLASS = GALAXY`, `ZWARNING = 0`.

## Coverage limitation

SDSS and DESI cover the north galactic cap only. Measured from the nearest
catalogued object to each landmark direction:

| Landmark | 2MRS | CF4 | SDSS DR17 | DESI DR1 |
|---|---|---|---|---|
| Shapley | 0.11 deg | 0.08 deg | **25.61 deg** | **21.79 deg** |
| Great Attractor | 0.05 deg | 0.85 deg | **59.00 deg** | **54.35 deg** |
| Perseus-Pisces | 0.04 deg | 0.06 deg | 0.02 deg | 32.41 deg |
| Coma | 0.04 deg | 0.01 deg | 0.01 deg | 1.44 deg |

Neither deep survey reaches the Shapley or Great Attractor directions, so the
galaxy layer's wedge is flagged per-point and kept visually distinct from the
all-sky sets.

## Fetch note

`cdsarc.cds.unistra.fr` and `edd.ifa.hawaii.edu` were both returning HTTP 502 at
the origin, so the CF4 tables were pulled from the CfA VizieR mirror
`vizier.cfa.harvard.edu` (`viz-bin/asu-tsv`, `-out.max=unlimited`). Row counts
match the published totals exactly.
