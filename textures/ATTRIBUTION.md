# Texture attribution

Planetary, solar and starfield textures shipped in this directory, **except the Moon**,
are **derivative works** of the *Solar System Textures* collection by **Solar System Scope**.
The Moon is the NASA SVS section below.

- Source: <https://www.solarsystemscope.com/textures/>
- Author: Solar System Scope (INOVE s.r.o.)
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)** —
  <https://creativecommons.org/licenses/by/4.0/>

## Modifications made

Every file listed below was **downsampled** from the original Solar System Scope image with a
LANCZOS filter and **re-encoded** for web delivery (progressive JPEG at quality 86, or optimized
PNG where lossless data was required). The two `.tif` sources were additionally converted to
PNG (normal map) and single-channel JPEG (specular mask). No colour grading, retouching,
reprojection or other geometric change was applied; the map projection and framing of each
original is preserved.

## Files derived from Solar System Scope

| Derivative shipped here | Original file | Size |
|---|---|---|
| `mercury_2k.jpg` | `8k_mercury.jpg` | 2048x1024 |
| `venus_surface_2k.jpg` | `8k_venus_surface.jpg` | 2048x1024 |
| `venus_atmosphere_2k.jpg` | `4k_venus_atmosphere.jpg` | 2048x1024 |
| `mars_2k.jpg` | `8k_mars.jpg` | 2048x1024 |
| `jupiter_2k.jpg` | `8k_jupiter.jpg` | 2048x1024 |
| `saturn_2k.jpg` | `8k_saturn.jpg` | 2048x1024 |
| `uranus_2k.jpg` | `2k_uranus.jpg` | 2048x1024 |
| `neptune_2k.jpg` | `2k_neptune.jpg` | 2048x1024 |
| `sun_2k.jpg` | `8k_sun.jpg` | 2048x1024 |
| `earth_day_4k.jpg` | `8k_earth_daymap.jpg` | 4096x2048 |
| `earth_night_4k.jpg` | `8k_earth_nightmap.jpg` | 4096x2048 |
| `earth_clouds_4k.jpg` | `8k_earth_clouds.jpg` | 4096x2048 |
| `earth_clouds_alpha_4k.jpg` | `8k_earth_clouds.jpg` | 4096x2048 |
| `earth_normal_2k.png` | `8k_earth_normal_map.tif` | 2048x1024 |
| `earth_specular_2k.jpg` | `8k_earth_specular_map.tif` | 2048x1024 |
| `saturn_ring_alpha_1k.png` | `8k_saturn_ring_alpha.png` | 1024x62 |
| `stars_milkyway_4k.jpg` | `8k_stars_milky_way.jpg` | 4096x2048 |
| `stars_4k.jpg` | `8k_stars.jpg` | 4096x2048 |

## Moon — NASA SVS CGI Moon Kit, not Solar System Scope

The lunar maps are **not** from Solar System Scope. They are derivatives of the
[CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (SVS id 4720), released 6 September 2019
and updated 9 January 2026.

SVS states that its content is in the public domain unless a page notes otherwise
(<https://svs.gsfc.nasa.gov/help/>). Page 4720 does not note an exception. It asks:
"Please give credit for this item to: NASA's Scientific Visualization Studio."
NASA's media guidelines
(<https://www.nasa.gov/nasa-brand-center/images-and-media/>, also linked from the
older guidelines URL on the SVS page) say NASA texture maps are generally not
subject to copyright in the United States and may be used in computer graphical
simulations and web pages, with NASA acknowledged as the source. Do not imply
NASA endorsement.

| Shipped file | Source file actually downloaded | What was done |
|---|---|---|
| `moon_2k.jpg` (2048×1024, sRGB JPEG, 697 KB) | `lroc_color_16bit_srgb_4k.tif` (4096×2048, 16-bit sRGB, 59.0 MB) from <https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif> | Downsampled to 2048×1024 and encoded as JPEG. SHA-256 of the TIFF: `9731fa8af425b6c2f88f277ecca82bf8c603f3743894f64ed7b25c5bfefa22ff`. SHA-256 of the JPEG: `2a46be2c45fb3541bf3879392d936a5ad5e807858065ef8da5643691d452f0a4`. |
| `moon_normal.png` (1440×720, 8-bit RGB, 1.5 MB) | `ldem_4_uint.tif` (1440×720, unsigned 16-bit, 2.0 MB) from <https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif> | Tangent-space normal map. SHA-256 of the TIFF: `e6668bec27fc9b8fbb02d198c7ddfb08eedeeb790167b494f95e6b34201da05e`. SHA-256 of the PNG: `5ceb9551e2333b08961583294f76e328f7ea3753cecae43b5a61b0309b99a5ca`. |

Color is the December 2025 map (the TIFF software tag is Adobe Photoshop, dated 2025-12-02), not the 2019 `lroc_color_poles` set. SVS built it from the LROC Hapke Normalized WAC mosaic (bands 643 nm, 566 nm, 415 nm; camera team at Arizona State University), with polar gaps filled from the LOLA albedo map. SVS says this color is adjusted for human vision and is optimized for aesthetics, not science. The map is centered on 0° longitude.

Displacement is the LOLA gridded elevation at 4 pixels per degree, the unsigned 16-bit form: half-meters relative to a radius of 1,737,400 m, offset by +20,000 so every value is positive. The file's own document name is `/svs/frames/etwright/moon3dkit/ldem_4_uint.tif`. Decoded range on this copy is 2,243…41,008, which is about −8.9 km to +10.5 km after removing that offset. The normal map uses those heights and the 1,737.4 km reference radius. Slopes are not exaggerated (`uNormalScale` 1). The globe radius stays 1,737.4 km; the height is not applied as vertex displacement, because the mesh is coarser than 4 pixels per degree and the relief is a fraction of a percent of the radius.

Credits on the SVS page: visualizer Ernie Wright (USRA); scientist Noah Petro (NASA/GSFC). Datasets named there: LRO LOLA DEM and the LROC WAC natural-color mosaic.

## Required notice

> Textures by [Solar System Scope](https://www.solarsystemscope.com/textures/),
> licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
> Downsampled and re-encoded for web use.

This notice must be reproduced in any shipped build of the Universal Map page (the page's
credits/attribution panel), not only in this repository.
