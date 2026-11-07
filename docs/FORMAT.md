# Universal Map binary payload format

The viewer is a single self-contained HTML page. All geometry travels inside it
as one base64 blob plus a JSON offset table:

```html
<script id="cf-meta"  type="application/json">{ "units": "Mpc/h", ... }</script>
<script id="cf-data"  type="application/base64">RQBWAF0AQgBO...</script>
```

The page decodes the blob with `atob` into an `ArrayBuffer` and creates typed
array **views** over it — no copies, no per-array fetches. Everything below was
recovered by reading the shipped page and is verified by
`tools/cfpack.py verify`, which repacks the original payload and asserts the
result is byte-identical (1,945,412 bytes, 22 arrays, both editions).

## Buffer layout

* Arrays are concatenated in the order they appear in `meta.arrays`.
* **Every array starts at an offset aligned up to 8 bytes.** Gaps are zero fill.
* The buffer ends at the end of the last array — there is no trailing padding.
* All integers are little-endian.

A `meta.arrays` entry is `{"offset": <byte>, "dtype": <name>, "length": <element count>}`.
`length` counts **elements, not bytes**; multiply by the dtype width for the span.

## Coordinate frame

| | |
|---|---|
| Axes | supergalactic cartesian `SGX`, `SGY`, `SGZ` (`meta.axes`) |
| Units | Mpc/h with h = 0.75 (`meta.units`) |
| Origin | the Milky Way |

Anything new added to the payload must arrive in this frame. Equatorial or
ecliptic inputs are rotated into it before quantization.

## Quantization

| Quantity | dtype | Decode | Source |
|---|---|---|---|
| Positions | `int16` | `value * 0.02` Mpc/h | `meta.line_point_scale` |
| Normals | `int8` | `value / 127` | fixed |
| Line speed | `uint8` | `value * 4.0` km/s | `meta.line_speed_scale` |
| Mesh indices | `uint32` | — | fixed |
| Basin ids | `uint8` | `255` = unassigned | fixed |

The int16 position scale caps the representable range at
`32767 x 0.02 = +/-655.34` Mpc/h, comfortably outside the 500 Mpc/h half-box of
the CF4 grid. `cfpack.quant_pos` raises rather than silently wrapping if a layer
would exceed it.

## The 22 shipped arrays

Streamlines (2,119 of them, 169,296 points total):

| Array | dtype | Length | Meaning |
|---|---|---|---|
| `line_counts` | `uint16` | 2,119 | points per streamline |
| `line_flags` | `uint8` | 2,119 | per-line render flags |
| `line_pts` | `int16` | 507,888 | 169,296 x 3 positions |
| `line_speed` | `uint8` | 169,296 | per-point flow speed |

Density isosurfaces, low and high threshold:

| Array | dtype | Length |
|---|---|---|
| `dens_lo_pos` / `dens_lo_nrm` | `int16` / `int8` | 23,184 each (7,728 verts) |
| `dens_lo_idx` | `uint32` | 46,248 |
| `dens_hi_pos` / `dens_hi_nrm` | `int16` / `int8` | 4,116 each (1,372 verts) |
| `dens_hi_idx` | `uint32` | 8,076 |

Basin boundary meshes at the two smoothing levels:

| Array | dtype | Length |
|---|---|---|
| `basin_s0_pos` / `basin_s0_nrm` | `int16` / `int8` | 7,320 each (2,440 verts) |
| `basin_s0_idx` | `uint32` | 14,628 |
| `basin_s10_pos` / `basin_s10_nrm` | `int16` / `int8` | 31,992 each (10,664 verts) |
| `basin_s10_idx` | `uint32` | 63,972 |

Basin membership, one id per primitive, for smoothing 0 and 10:

`line_b_s0`, `line_b_s10` (2,119 each), `dens_lo_b_s0`, `dens_lo_b_s10`
(7,728 each), `dens_hi_b_s0`, `dens_hi_b_s10` (1,372 each) — all `uint8`.

These are the arrays the galaxy layer is validated against: a recomputed basin
label volume is sampled at the streamline seed points and compared to
`line_b_s0` / `line_b_s10`.

## Semantic blocks in `cf-meta`

Beyond `arrays`, `cf-meta` carries the scene's astronomy:

* **`scales`** — `["0", "10"]`, the two watershed smoothing lengths in Mpc/h.
* **`landmarks`** — SG positions of Virgo, Centaurus, the Great Attractor, Coma,
  Perseus–Pisces, Shapley, Ophiuchus.
* **`published_attractors`** — the nine Dupuy & Courtois (2023) attractor
  positions the basins were matched against.
* **`superclusters`** — per smoothing level, the basin list with `voxels`,
  `sink`, `contains`, `published`, `name` and `color`. **This is the canonical
  palette.** New layers inherit these colors rather than defining their own:

  | Basin | Color |
  |---|---|
  | Laniakea (ours) | `#ffb347` |
  | Shapley | `#38d6c4` |
  | Perseus–Pisces | `#6ff0a4` |
  | Apus | `#4fb6ff` |
  | Hercules | `#ff8a9a` |
  | Lepus | `#e58cff` |
  | SDSS-1a | `#b18cff` |
  | SDSS-2a | `#9fe35a` |
  | SDSS-2b | `#ff6fae` |
  | Unnamed, runs past the map edge | `#8fa6ff` |

* **`object_basin`** — which basin index each named object falls in, per
  smoothing level. Note the indices differ between levels: Shapley is basin 5 at
  smoothing 0 and basin 1 at smoothing 10, because the Laniakea and Shapley
  basins merge under smoothing. `255` means unassigned.
* **`summary`** — per smoothing level: sink position, enclosed volume, implied
  mass in solar masses, bounding extent, and which landmarks are inside.
* **`marker_mass`**, **`mass_radius_mpch`** — mass within 10 Mpc/h of each marker.
* **`membership`** — landmark lists for the basin containing the Milky Way.

## External layer pairs

New layers are too large to keep inlining, so they are written as external
`<stem>.bin` + `<stem>.json` pairs with the **same** conventions — same
alignment, same dtypes, same position scale. The JSON mirrors `cf-meta`: an
`arrays` table plus whatever per-layer metadata the module needs.

External files require the page to be served over `http://`; a `file://` load
cannot `fetch` them. `tools/inline.py` folds the pairs back into base64
`<script>` blocks for a single-file build.

## API

```python
from tools import cfpack

meta, buf = cfpack.read_html("Universal Map.html")   # payload out of the page
arrays    = cfpack.unpack(meta, buf)                 # dict of numpy views

table, buf = cfpack.pack([("positions", q), ("color", c)])   # build a payload
cfpack.write_pair("data/stars", {"count": n}, [("pos", q)])  # external pair
meta, arrays = cfpack.read_pair("data/stars")

q = cfpack.quant_pos(xyz_mpch)      # float Mpc/h -> int16, raises on clip
xyz = cfpack.dequant_pos(q)         # back to float
```

Round-trip check:

```
$ python tools/cfpack.py verify "Universal Map · Skybird Science.html"
offset table reproduced : True
buffer byte-identical   : True (1,945,412 vs 1,945,412 bytes)
```
