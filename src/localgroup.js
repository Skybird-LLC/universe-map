/**
 * localgroup.js - named Local Group galaxies at published distances.
 *
 * The redshift catalog is the wrong layer here. It has no names, and inside a
 * few megaparsecs a redshift is not a position. Members below are placed from
 * Galactic longitude, latitude and distance in data/localgroup.json, rotated
 * with the project's supergalactic matrix. The Sun is the origin.
 *
 * A circle's radius is the published half-light or isophotal radius carried on
 * that member. LMC and SMC have no half-light radius in the source table, so
 * they get a position cross of fixed display size, not a pretend disk.
 * Every circle is drawn in the Milky Way's disk plane. That is so the opening
 * view can show the radii together. It is not a measured inclination.
 *
 *   addTo(scene, opts) -> { group, members, meta, frame, setVisible, setScale }
 */

import * as THREE from 'three';
import { loadJSON } from './loader.js';

export function galacticToSg(lDeg, bDeg, distKpc, M) {
  const l = lDeg * Math.PI / 180;
  const b = bDeg * Math.PI / 180;
  const cb = Math.cos(b);
  const g0 = distKpc * cb * Math.cos(l);
  const g1 = distKpc * cb * Math.sin(l);
  const g2 = distKpc * Math.sin(b);
  return [
    M[0][0] * g0 + M[0][1] * g1 + M[0][2] * g2,
    M[1][0] * g0 + M[1][1] * g1 + M[1][2] * g2,
    M[2][0] * g0 + M[2][1] * g1 + M[2][2] * g2,
  ];
}

export async function addTo(scene, opts = {}) {
  const { baseUrl = './data', unitsPerKpc = 1, visible = false } = opts;
  const meta = await loadJSON('localgroup', { baseUrl });
  const group = new THREE.Group();
  group.name = 'localgroup';

  const nrm = new THREE.Vector3(...meta.display_plane_normal_sg).normalize();
  const mark = meta.display_mark_kpc;
  const members = [];

  // The Milky Way schematic on this step is a circle of the same 15 kpc cutoff
  // used on the Milky Way step, not an isophotal diameter. The soft cylinder
  // from that step is hidden here so it does not shrink to a haze.
  const mwDisk = new THREE.Mesh(
    new THREE.RingGeometry(0, 15 * unitsPerKpc, 96),
    new THREE.MeshBasicMaterial({
      color: 0xc2b7a4, transparent: true, opacity: 0.78,
      side: THREE.DoubleSide, depthWrite: false,
    }));
  mwDisk.name = 'localgroup.milkyway';
  if (mwDisk.quaternion && typeof mwDisk.quaternion.setFromUnitVectors === 'function') {
    mwDisk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
  }
  group.add(mwDisk);

  for (const row of meta.members) {
    const sg = galacticToSg(row.l_deg, row.b_deg, row.distance_kpc, meta.galactic_to_sg);
    const node = new THREE.Group();
    node.name = `localgroup.${row.short}`;
    node.position.set(sg[0] * unitsPerKpc, sg[1] * unitsPerKpc, sg[2] * unitsPerKpc);
    node.userData = { ...row, sgKpc: sg };

    if (row.radius_kpc > 0) {
      const radius = row.radius_kpc * unitsPerKpc;
      const spiral = row.radius_kind === 'isophotal';
      const disk = new THREE.Mesh(
        new THREE.RingGeometry(0, radius, spiral ? 96 : 40),
        new THREE.MeshBasicMaterial({
          color: spiral ? 0xc2b7a4 : 0x8e98a8,
          transparent: true,
          opacity: spiral ? 0.78 : 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        }));
      disk.name = `localgroup.${row.short}.disk`;
      if (disk.quaternion && typeof disk.quaternion.setFromUnitVectors === 'function') {
        disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      }
      node.add(disk);
    } else {
      // Position flag only. Arm length is display_mark_kpc, not a radius.
      const arm = mark * unitsPerKpc;
      const u = new THREE.Vector3(1, 0, 0);
      if (Math.abs(nrm.dot(u)) > 0.9) u.set(0, 0, 1);
      const e1 = new THREE.Vector3().crossVectors(nrm, u).normalize();
      const e2 = new THREE.Vector3().crossVectors(nrm, e1).normalize();
      const cross = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          e1.clone().multiplyScalar(-arm), e1.clone().multiplyScalar(arm),
          e2.clone().multiplyScalar(-arm), e2.clone().multiplyScalar(arm),
        ]),
        new THREE.LineBasicMaterial({ color: 0xd7dde8 }));
      cross.name = `localgroup.${row.short}.mark`;
      node.add(cross);
    }
    group.add(node);
    members.push({ ...row, sg, node });
  }

  // 200 kpc bar through the MW–M31 midpoint, along supergalactic X, lifted
  // slightly along the disk pole so it does not hide either galaxy.
  const m31 = members.find((m) => m.short === 'M31');
  const mid = m31.sg.map((v) => v * 0.5);
  const half = 100 * unitsPerKpc;
  const lift = nrm.clone().multiplyScalar(40 * unitsPerKpc);
  const ruler = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(mid[0] * unitsPerKpc - half, mid[1] * unitsPerKpc, mid[2] * unitsPerKpc).add(lift),
      new THREE.Vector3(mid[0] * unitsPerKpc + half, mid[1] * unitsPerKpc, mid[2] * unitsPerKpc).add(lift),
    ]),
    new THREE.LineBasicMaterial({ color: 0xd5dbe6, transparent: true, opacity: 0.85 }));
  ruler.name = 'localgroup.ruler200kpc';
  ruler.userData = { lengthKpc: 200 };
  group.add(ruler);

  group.visible = visible;
  scene.add(group);

  let _upk = unitsPerKpc;
  return {
    group, members, meta, ruler,
    /** Camera frame that fits the Sun and Andromeda at true relative size. */
    frame() {
      if (group.updateMatrixWorld) group.updateMatrixWorld(true);
      const p = m31.node.getWorldPosition(new THREE.Vector3());
      const target = p.clone().multiplyScalar(0.5);
      const sep = p.clone().normalize();
      const pole = nrm.clone();
      const side = new THREE.Vector3().crossVectors(sep, pole).normalize();
      const direction = pole.multiplyScalar(0.72)
        .add(side.multiplyScalar(0.55))
        .add(sep.multiplyScalar(0.25))
        .normalize();
      // 1500 kpc from the midpoint keeps a 783 kpc pair inside a 42° view
      // with room for the labels above the bottom bar.
      // The up vector is the MW–M31 separation, so that line stands vertical
      // and both galaxies stay in the open part of the window.
      const distance = p.length() * (1500 / m31.distance_kpc);
      const along = p.clone().sub(target);
      const up = along.addScaledVector(direction, -along.dot(direction));
      if (up.length() < 1e-8) up.set(0, 1, 0);
      else up.normalize();
      return { target: target.toArray(), distance, direction: direction.toArray(), up: up.toArray() };
    },
    setVisible(v) { group.visible = v; },
    setScale(unitsPerKpcNew) {
      const k = unitsPerKpcNew / _upk;
      _upk = unitsPerKpcNew;
      group.scale.setScalar(group.scale.x * k);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
