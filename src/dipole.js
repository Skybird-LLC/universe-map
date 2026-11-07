/**
 * dipole.js - the number-count dipole layer.
 *
 * Draws each published dipole measurement as an origin-anchored vector whose
 * length is the speed implied IF the whole excess were kinematic, with a 1-sigma
 * angular cone where the paper published direction errors. Alongside them it
 * marks Shapley, the Great Attractor, Vela, and the flow-field sink carried in
 * cf-meta - so the angular offset between "where the dipole points" and "where
 * the mass is" is read off the model instead of asserted.
 *
 * The measured directions all sit within ~20 deg of the CMB dipole. Shapley is
 * about 40 deg away from every one of them. That gap is the point of the layer.
 *
 * Entries without a published direction (Bohme's two-survey fit, Wagenveld,
 * both Secrest papers) are drawn along the CMB axis and flagged `axisAssumed`,
 * and their shafts are dashed so they are never read as independent directions.
 *
 *   addTo(scene, opts) -> { group, setVisible, setEntryVisible, setScale,
 *                           angles, dispose }
 */

import * as THREE from 'three';
import { loadJSON } from './loader.js';

const ENTRY_COLOR = {
  cmb: 0x111111, bohme25: 0xb3261e, bohme25_nr: 0xb3261e,
  wagenveld23: 0x7a7f8a, secrest21: 0x7a7f8a, secrest22: 0x7a7f8a, dam23: 0x1d6fb8,
};
const MARKER_COLOR = {
  shapley: 0x38d6c4, sink_s10: 0xffb347, sink_s0: 0xffb347,
  great_attractor: 0xff8a9a, vela: 0x9fe35a,
};

function vec(sg) { return new THREE.Vector3(sg[0], sg[1], sg[2]); }

/** A cone of half-angle `deg` about `dir`, as a wireframe ring at radius `len`. */
function coneRing(dir, deg, len, color, segments = 96) {
  const axis = dir.clone().normalize();
  const up = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(axis, up).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const half = THREE.MathUtils.degToRad(deg);
  const r = Math.sin(half) * len, h = Math.cos(half) * len;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(axis.clone().multiplyScalar(h)
      .addScaledVector(e1, Math.cos(t) * r)
      .addScaledVector(e2, Math.sin(t) * r));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
}

export async function addTo(scene, opts = {}) {
  const {
    baseUrl = './data',
    unitsPerMpch = 1,
    kmsPerUnit = 4.0,      // scene units per km/s of implied velocity
    visible = true,
    markerSize = 0.35,
  } = opts;

  const data = await loadJSON('dipole', { baseUrl });
  const group = new THREE.Group();
  group.name = 'dipole';

  const cmbEntry = data.entries.find(e => e.key === 'cmb');
  const cmbDir = vec(cmbEntry.direction.vec_sg).normalize();

  const entries = [];
  for (const e of data.entries) {
    if (e.implied_velocity_kms == null) continue;
    const axisAssumed = !e.direction;
    const dir = axisAssumed ? cmbDir.clone() : vec(e.direction.vec_sg).normalize();
    const len = e.implied_velocity_kms / kmsPerUnit;
    const color = ENTRY_COLOR[e.key] ?? 0x8fa6ff;

    const shaftGeom = new THREE.BufferGeometry()
      .setFromPoints([new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(len)]);
    const shaftMat = axisAssumed
      ? new THREE.LineDashedMaterial({ color, dashSize: len * 0.035, gapSize: len * 0.03 })
      : new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const shaft = new THREE.Line(shaftGeom, shaftMat);
    if (axisAssumed) shaft.computeLineDistances();
    shaft.name = `dipole.${e.key}.shaft`;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(markerSize * (e.key === 'cmb' ? 0.9 : 0.7), 16, 12),
      new THREE.MeshBasicMaterial({ color }));
    head.position.copy(dir).multiplyScalar(len);
    head.name = `dipole.${e.key}.head`;

    const node = new THREE.Group();
    node.add(shaft, head);
    if (e.direction && e.direction.err_deg) {
      node.add(coneRing(dir, e.direction.err_deg, len, color));
    }
    node.userData = { key: e.key, label: e.label, reference: e.reference,
                      sigma: e.significance_sigma, ratio: e.amplitude_ratio,
                      impliedKms: e.implied_velocity_kms, axisAssumed };
    node.visible = true;
    group.add(node);
    entries.push(node);
  }

  // mass concentrations and flow sinks
  const markers = [];
  for (const m of data.markers) {
    const p = vec(m.sg).multiplyScalar(unitsPerMpch);
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(markerSize * (m.kind.startsWith('flow') ? 0.8 : 1.3)),
      new THREE.MeshBasicMaterial({ color: MARKER_COLOR[m.key] ?? 0xffffff,
                                    wireframe: true }));
    mesh.position.copy(p);
    mesh.name = `dipole.marker.${m.key}`;
    mesh.userData = { ...m };
    group.add(mesh);
    markers.push(mesh);
  }

  group.visible = visible;
  scene.add(group);

  /** Angle in degrees between two unit-ish vectors. */
  const angleBetween = (a, b) =>
    THREE.MathUtils.radToDeg(a.clone().normalize().angleTo(b.clone().normalize()));

  return {
    group, data, entries, markers,
    /** Measured angular offsets, for labelling in the UI. */
    angles: Object.fromEntries(data.markers.map(m => [m.key, {
      fromCMB: angleBetween(cmbDir, vec(m.sg)),
      fromBohme: m.angle_from_bohme_deg,
    }])),
    setVisible(v) { group.visible = v; },
    setEntryVisible(key, v) {
      const n = entries.find(e => e.userData.key === key);
      if (n) n.visible = v;
    },
    setScale(unitsPerMpchNew) {
      for (const m of markers) {
        const d = m.userData.sg;
        m.position.set(d[0] * unitsPerMpchNew, d[1] * unitsPerMpchNew, d[2] * unitsPerMpchNew);
      }
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
}
