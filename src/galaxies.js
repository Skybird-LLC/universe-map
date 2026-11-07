/**
 * galaxies.js - the galaxy layer, 287,758 points in supergalactic Mpc/h.
 *
 * Every point carries a provenance code, because the catalogs are NOT equivalent:
 *   0 Cosmicflows-4  measured distances, all-sky, has a peculiar velocity
 *   1 2MRS           redshift distances, all-sky
 *   2 SDSS DR17      redshift distances, NORTH GALACTIC CAP ONLY
 *   3 DESI DR1 BGS   redshift distances, NORTH GALACTIC CAP ONLY
 *
 * Codes 2 and 3 are the "deep wedge". It does not reach Shapley - its nearest
 * object is ~22-26 deg away - so it is toggleable and visually distinct by
 * default. Conflating it with the all-sky sets would misrepresent the coverage.
 *
 * Colour comes from the basin tag (`basin_s0` / `basin_s10`) using the page's own
 * supercluster palette, or from provenance, depending on `colorBy`.
 *
 *   addTo(scene, opts) -> { points, setVisible, setColorBy, setSmoothing,
 *                           setProvenanceVisible, setScale, dispose, counts }
 */

import * as THREE from 'three';
import { loadLayer, hexToRGB } from './loader.js';

const VERT = /* glsl */`
  attribute vec3 gColor;
  attribute float gShown;
  uniform float uSize;
  varying vec3 vColor;
  varying float vShown;
  void main() {
    vColor = gColor;
    vShown = gShown;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uSize / max(-mv.z, 0.0001), 0.7, 9.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vShown;
  void main() {
    if (vShown < 0.5) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = exp(-r2 * 12.0);
    gl_FragColor = vec4(vColor, a * uOpacity);
  }`;

const PROV_FALLBACK = ['#38d6c4', '#ffb347', '#b18cff', '#6ff0a4'];

export async function addTo(scene, opts = {}) {
  const {
    baseUrl = './data',
    unitsPerMpch = 1,
    colorBy = 'basin',       // 'basin' | 'provenance'
    smoothing = '0',         // '0' | '10'  (which basin tagging to colour by)
    size = 320,
    opacity = 0.9,
    visible = true,
    showProvenance = [true, true, true, true],
  } = opts;

  const { meta, arrays } = await loadLayer('galaxies', { baseUrl });
  const n = meta.count;
  const s = meta.pos_scale * unitsPerMpch;

  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = arrays.pos[i] * s;

  const col = new Float32Array(n * 3);
  const shown = new Float32Array(n);

  // palettes, resolved once from the layer metadata
  const basinPal = {};
  for (const sm of ['0', '10']) {
    const p = meta.basins.palette[sm];
    basinPal[sm] = {};
    for (const [id, d] of Object.entries(p)) basinPal[sm][id] = hexToRGB(d.color);
  }
  const provPal = {};
  for (const [id, d] of Object.entries(meta.provenance)) {
    provPal[id] = hexToRGB(d.color || PROV_FALLBACK[Number(id)]);
  }
  const UNASSIGNED = [0.42, 0.44, 0.50];

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('gColor', new THREE.BufferAttribute(col, 3));
  geom.setAttribute('gShown', new THREE.BufferAttribute(shown, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, uOpacity: { value: opacity } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geom, mat);
  points.name = 'galaxies';
  points.frustumCulled = false;

  function paint(mode, sm) {
    const basins = sm === '10' ? arrays.basin_s10 : arrays.basin_s0;
    const pal = basinPal[sm];
    for (let i = 0; i < n; i++) {
      let c;
      if (mode === 'basin') {
        const b = basins[i];
        c = (b === 255) ? UNASSIGNED : (pal[b] || UNASSIGNED);
      } else {
        c = provPal[arrays.prov[i]] || UNASSIGNED;
      }
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geom.attributes.gColor.needsUpdate = true;
  }

  function applyProvenance(flags) {
    for (let i = 0; i < n; i++) shown[i] = flags[arrays.prov[i]] ? 1 : 0;
    geom.attributes.gShown.needsUpdate = true;
  }

  paint(colorBy, smoothing);
  applyProvenance(showProvenance);
  geom.computeBoundingSphere();
  points.visible = visible;
  scene.add(points);

  let _mode = colorBy, _sm = smoothing;
  return {
    points, meta, arrays,
    counts: Object.fromEntries(Object.entries(meta.provenance).map(([k, v]) => [v.name, v.n])),
    setVisible(v) { points.visible = v; },
    setColorBy(mode) { _mode = mode; paint(_mode, _sm); },
    setSmoothing(sm) { _sm = String(sm); paint(_mode, _sm); },
    setProvenanceVisible(flags) { applyProvenance(flags); },
    setSize(v) { mat.uniforms.uSize.value = v; },
    setOpacity(v) { mat.uniforms.uOpacity.value = v; },
    setScale(unitsPerMpchNew) {
      const k = meta.pos_scale * unitsPerMpchNew;
      const a = geom.attributes.position;
      for (let i = 0; i < a.array.length; i++) a.array[i] = arrays.pos[i] * k;
      a.needsUpdate = true;
      geom.computeBoundingSphere();
    },
    /** Peculiar velocity in km/s for point i, or null where the catalog has none. */
    peculiarVelocity(i) {
      const v = arrays.vpec[i];
      return v === meta.vpec_missing ? null : v;
    },
    dispose() { scene.remove(points); geom.dispose(); mat.dispose(); },
  };
}
