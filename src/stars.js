/**
 * stars.js - the local star layer.
 *
 * Two populations, kept separate on purpose:
 *   bubble - 24,704 HYG v4.2 stars within 100 pc at their TRUE 3-D positions
 *   shell  - 8,920 naked-eye stars (V <= 6.5) as DIRECTIONS ONLY, projected to a
 *            fixed radius so the familiar constellations are legible. These are
 *            not positions and must never be read as such.
 *
 * Positions arrive int16 at 0.005 pc per unit, in supergalactic axes. The scene's
 * own unit is Mpc/h, so `opts.unitsPerPc` converts; the default seats the bubble
 * in the same frame as the galaxy layer.
 *
 *   addTo(scene, opts) -> { bubble, shell, setVisible, setScale, setShellRadius,
 *                           dispose, counts }
 */

import * as THREE from 'three';
import { loadLayer } from './loader.js';

const PC_PER_MPCH = 1e6 * 0.75; // 1 Mpc/h = 1e6/h pc with h = 0.75

const VERT = /* glsl */`
  attribute vec3 starColor;
  attribute float mag;
  uniform float uSizeScale;
  uniform float uMagRef;
  varying vec3 vColor;
  void main() {
    vColor = starColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // brighter (smaller magnitude) -> larger point; 2.512^(-0.4 m) keeps the ladder photometric
    float lum = pow(2.512, (uMagRef - mag) * 0.4);
    gl_PointSize = clamp(uSizeScale * sqrt(lum) / max(-mv.z, 0.0001), 0.6, 42.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    // soft core + halo so bloom has something to grab
    float core = exp(-r2 * 26.0);
    float halo = exp(-r2 * 5.0) * 0.35;
    gl_FragColor = vec4(vColor * (core + halo), (core + halo) * uOpacity);
  }`;

function buildPoints(pos, rgb, mag, opts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('starColor', new THREE.BufferAttribute(rgb, 3, true));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  g.computeBoundingSphere();
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uSizeScale: { value: opts.sizeScale },
      uMagRef:    { value: opts.magRef },
      uOpacity:   { value: opts.opacity },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(g, m);
}

export async function addTo(scene, opts = {}) {
  const {
    baseUrl = './data',
    unitsPerPc = 1 / PC_PER_MPCH, // scene units per parsec; default = Mpc/h
    shellRadius = 90,             // in scene units, where the naked-eye shell is drawn
    sizeScale = 160,
    opacity = 1.0,
    visible = true,
  } = opts;

  const { meta, arrays } = await loadLayer('stars', { baseUrl });
  const posScale = meta.bubble.pos_scale * unitsPerPc;
  const magOff = meta.mag_offset, magScale = meta.mag_scale;

  // --- true-3D bubble ---
  const nB = meta.bubble.count;
  const bpos = new Float32Array(nB * 3);
  for (let i = 0; i < nB * 3; i++) bpos[i] = arrays.bub_pos[i] * posScale;
  const bmag = new Float32Array(nB);
  for (let i = 0; i < nB; i++) bmag[i] = magOff + arrays.bub_absmag[i] * magScale;
  const bubble = buildPoints(bpos, arrays.bub_rgb, bmag, { sizeScale, magRef: 5.0, opacity });
  bubble.name = 'stars.bubble';
  bubble.userData.kind = 'true-3d positions within 100 pc';

  // --- naked-eye direction shell ---
  const nS = meta.shell.count;
  const spos = new Float32Array(nS * 3);
  const sdir = new Float32Array(nS * 3);
  for (let i = 0; i < nS * 3; i++) sdir[i] = arrays.shl_dir[i] * meta.shell.dir_scale;
  for (let i = 0; i < nS * 3; i++) spos[i] = sdir[i] * shellRadius;
  const smag = new Float32Array(nS);
  for (let i = 0; i < nS; i++) smag[i] = magOff + arrays.shl_vmag[i] * magScale;
  const shell = buildPoints(spos, arrays.shl_rgb, smag, { sizeScale: sizeScale * 2.2, magRef: 6.5, opacity });
  shell.name = 'stars.shell';
  shell.userData.kind = 'DIRECTIONS ONLY, projected to a fixed radius - not positions';

  bubble.visible = visible;
  shell.visible = visible;
  scene.add(bubble, shell);

  return {
    bubble, shell, meta,
    counts: { bubble: nB, shell: nS },
    setVisible(v, which = 'both') {
      if (which !== 'shell') bubble.visible = v;
      if (which !== 'bubble') shell.visible = v;
    },
    setScale(unitsPerPcNew) {
      const s = meta.bubble.pos_scale * unitsPerPcNew;
      const a = bubble.geometry.attributes.position;
      for (let i = 0; i < a.array.length; i++) a.array[i] = arrays.bub_pos[i] * s;
      a.needsUpdate = true;
      bubble.geometry.computeBoundingSphere();
    },
    setShellRadius(rNew) {
      const a = shell.geometry.attributes.position;
      for (let i = 0; i < a.array.length; i++) a.array[i] = sdir[i] * rNew;
      a.needsUpdate = true;
      shell.geometry.computeBoundingSphere();
    },
    setSizeScale(s) {
      bubble.material.uniforms.uSizeScale.value = s;
      shell.material.uniforms.uSizeScale.value = s * 2.2;
    },
    dispose() {
      for (const o of [bubble, shell]) {
        scene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
    },
  };
}
