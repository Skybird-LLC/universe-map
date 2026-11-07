/**
 * milkyway.js - the missing middle step: our own galaxy, with the Sun in it.
 *
 * Between the 100 pc star bubble and the 300 Mpc/h galaxy field there is a gap
 * of five orders of magnitude where nothing was drawn. This layer fills it, and
 * it is what makes the zoom chain readable: you see where the Sun sits in the
 * disk before descending to the solar system.
 *
 * HONESTY NOTE, carried in the data file too: this is a SCHEMATIC. We observe
 * the Milky Way from inside it, so its spiral pattern is not directly mapped.
 * The global parameters are real - R0 = 8.178 kpc (GRAVITY 2019), the Sun 20 pc
 * above the plane, a 2.6 kpc disk scale length, a 3 kpc bar at 25 deg to the
 * Sun-centre line - but the four arms are an idealised logarithmic spiral at
 * 12.5 deg pitch, not a fitted map.
 *
 * Positions are stored already rotated into supergalactic axes with the Sun at
 * the origin, so they drop into the same frame as every other layer.
 *
 *   addTo(scene, opts) -> { group, points, sun, setVisible, setScale,
 *                           sunMarkerWorld, dispose, meta }
 */

import * as THREE from 'three';
import { loadLayer } from './loader.js';

const VERT = /* glsl */`
  attribute vec3 mwColor;
  uniform float uSize;
  varying vec3 vColor;
  void main() {
    vColor = mwColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uSize / max(-mv.z, 0.0001), 0.7, 7.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float a = exp(-r2 * 9.0);
    gl_FragColor = vec4(vColor, a * uOpacity);
  }`;

export async function addTo(scene, opts = {}) {
  const {
    baseUrl = './data',
    unitsPerKpc = 20,
    size = 260,
    opacity = 0.85,
    visible = false,
    sunMarkerColor = 0xffc35e,
    centreMarkerColor = 0xff7a22,
  } = opts;

  const { meta, arrays } = await loadLayer('milkyway', { baseUrl });
  const n = meta.count;
  const group = new THREE.Group();
  group.name = 'milkyway';

  const pos = new Float32Array(n * 3);
  const s = meta.pos_scale * unitsPerKpc;
  for (let i = 0; i < n * 3; i++) pos[i] = arrays.pos[i] * s;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('mwColor', new THREE.BufferAttribute(arrays.rgb, 3, true));
  geom.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, uOpacity: { value: opacity } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geom, mat);
  points.name = 'milkyway.stars';
  points.frustumCulled = false;
  group.add(points);

  // Markers are locators, not light sources. Bloom is off on this step; these
  // stay small so they cannot read as the bulge.
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.012 * unitsPerKpc, 16, 12),
    new THREE.MeshBasicMaterial({ color: sunMarkerColor }));
  sun.name = 'milkyway.sun';
  sun.userData = { label: 'The Sun', zoomTo: 'solar' };

  // a ring at the 100 pc star-bubble radius, so the previous step is visible here
  const bubble = new THREE.Mesh(
    new THREE.RingGeometry(meta.star_bubble_radius_kpc * unitsPerKpc * 0.98,
                           meta.star_bubble_radius_kpc * unitsPerKpc, 64),
    new THREE.MeshBasicMaterial({ color: 0x9aabcc, transparent: true, opacity: 0.28,
                                  side: THREE.DoubleSide, depthWrite: false }));
  bubble.name = 'milkyway.starBubble';

  // --- the galactic centre ---
  const gc = meta.galactic_centre_sg_kpc;
  const centre = new THREE.Mesh(
    new THREE.SphereGeometry(0.02 * unitsPerKpc, 16, 12),
    new THREE.MeshBasicMaterial({ color: centreMarkerColor, transparent: true, opacity: 0.8 }));
  centre.position.set(gc[0] * unitsPerKpc, gc[1] * unitsPerKpc, gc[2] * unitsPerKpc);
  centre.name = 'milkyway.centre';
  centre.userData = { label: 'Galactic centre (Sgr A*)' };

  // --- the Sun's orbit about the centre, in the disk plane ---
  // The disk normal is the galactic pole carried in the data file; deriving it
  // from the point cloud would be guesswork when it is already known exactly.
  const dn = meta.disk_normal_sg;
  const nrm = new THREE.Vector3(dn[0], dn[1], dn[2]).normalize();
  const R = Math.hypot(gc[0], gc[1], gc[2]) * unitsPerKpc;
  const e1 = new THREE.Vector3(-gc[0], -gc[1], -gc[2]).normalize();
  const e2 = new THREE.Vector3().crossVectors(nrm, e1).normalize();
  const orbitPts = [];
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    orbitPts.push(new THREE.Vector3()
      .addScaledVector(e1, Math.cos(t) * R)
      .addScaledVector(e2, Math.sin(t) * R)
      .add(centre.position));
  }
  const orbit = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0x6e6248, transparent: true, opacity: 0.16 }));
  orbit.name = 'milkyway.sunOrbit';

  group.add(sun, bubble, centre, orbit);

  // Thin disk. The previous shape was a flattened sphere shaded as
  // `color * light`, which bloomed into a hard-edged white oval. This cylinder
  // is 0.018 radii thick (about 0.27 kpc at the 15 kpc cutoff). The bulge sits
  // on the galactic centre, 8.178 kpc from the Sun, and the colour is tone-mapped
  // so the integrated disk cannot go white. It is a light model of a schematic
  // disk, not a star-by-star reconstruction and not Xu et al. 2023's arm map.
  const DISK_VERT = /* glsl */`
    varying vec3 vPos;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    void main() {
      vPos = position;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const DISK_FRAG = /* glsl */`
    uniform vec2 uCentre;
    varying vec3 vPos;
    varying vec3 vWorld;
    varying vec3 vNormalW;
    void main() {
      float r = length(vPos.xz);
      vec2 d = vPos.xz - uCentre;
      float bulge = exp(-dot(d, d) * 28.0);
      float body = exp(-r * 3.4);
      // Fall off across the outer half. A cutoff at r = 1 was the hard oval.
      float fade = smoothstep(1.0, 0.42, r);
      vec3 viewDir = normalize(cameraPosition - vWorld);
      float ndv = abs(dot(normalize(vNormalW), viewDir));
      float dust = (1.0 - smoothstep(0.02, 0.28, ndv)) * smoothstep(0.05, 0.35, r);
      vec3 col = mix(vec3(0.34, 0.37, 0.44), vec3(0.62, 0.52, 0.34), clamp(bulge, 0.0, 1.0));
      col *= 0.22 + 0.7 * bulge + 0.15 * body;
      col = mix(col, col * vec3(0.12, 0.09, 0.07), clamp(dust, 0.0, 1.0));
      col = col / (1.0 + col);
      float alpha = fade * (0.015 + 0.22 * body + 0.5 * bulge);
      alpha *= 1.0 - 0.2 * dust;
      if (alpha < 0.012) discard;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.62));
    }`;
  const diskRadius = 15 * unitsPerKpc;
  const disk = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.018, 96, 1, false),
    new THREE.ShaderMaterial({
      uniforms: { uCentre: { value: new THREE.Vector2(8.178 / 15, 0) } },
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
  disk.scale.set(diskRadius, diskRadius, diskRadius);
  disk.name = 'milkyway.schematicDisk';
  disk.frustumCulled = false;
  // Local +Y is the cylinder axis. Lay that on the galactic pole, and local +X
  // on the Sun–centre line, so the bulge uniform lands on the centre.
  const toGc = centre.position.clone().addScaledVector(nrm, -centre.position.dot(nrm));
  if (toGc.length() < 1e-8) toGc.set(1, 0, 0);
  toGc.normalize();
  const zAxis = new THREE.Vector3().crossVectors(toGc, nrm);
  if (zAxis.length() < 1e-8) zAxis.set(0, 0, 1);
  zAxis.normalize();
  if (disk.quaternion && typeof disk.quaternion.setFromRotationMatrix === 'function'
      && typeof THREE.Matrix4 === 'function') {
    const basis = new THREE.Matrix4();
    if (typeof basis.makeBasis === 'function') {
      basis.makeBasis(toGc, nrm, zAxis);
      disk.quaternion.setFromRotationMatrix(basis);
    }
  }
  // 5 kpc bar lifted off the plane so it reads as a scale, not another ring in the disk.
  const rulerLen = 5 * unitsPerKpc;
  const rulerLift = nrm.clone().multiplyScalar(6 * unitsPerKpc);
  const ruler = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3().addScaledVector(e2, -rulerLen / 2).add(rulerLift),
      new THREE.Vector3().addScaledVector(e2, rulerLen / 2).add(rulerLift),
    ]),
    new THREE.LineBasicMaterial({ color: 0xd5dbe6, transparent: true, opacity: 0.8 }));
  ruler.name = 'milkyway.ruler5kpc';
  ruler.userData = { lengthKpc: 5 };
  group.add(disk, ruler);

  group.visible = visible;
  scene.add(group);

  let _upk = unitsPerKpc;
  return {
    group, points, sun, centre, orbit, disk, ruler, meta,
    count: n,
    /** World position of the Sun marker - the anchor for the next zoom step. */
    sunMarkerWorld() { return sun.getWorldPosition(new THREE.Vector3()); },
    /** World position of the galactic centre. */
    centreWorld() { return centre.getWorldPosition(new THREE.Vector3()); },
    setVisible(v) { group.visible = v; },
    setSize(v) { mat.uniforms.uSize.value = v; },
    /** 'galaxy' shows the star sample with the disk. 'group' hides both:
     *  the points collapse into one blob at that distance, and the soft disk
     *  shrinks to a haze. The Local Group step draws its own 15 kpc circle. */
    setReadout(mode) {
      const groupView = mode === 'group';
      points.visible = !groupView;
      if (disk) disk.visible = !groupView;
      if (ruler) ruler.visible = !groupView;
      mat.uniforms.uOpacity.value = groupView ? 0 : 0.18;
      mat.uniforms.uSize.value = groupView ? 40 : 42;
      mat.blending = groupView ? THREE.NormalBlending : THREE.NormalBlending;
    },
    setScale(unitsPerKpcNew) {
      const k = unitsPerKpcNew / _upk;
      _upk = unitsPerKpcNew;
      group.scale.setScalar(group.scale.x * k);
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
