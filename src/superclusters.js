/**
 * superclusters.js - a thin handle over the basin meshes ALREADY in the page.
 *
 * This module deliberately does not rebuild the supercluster layer. The page
 * ships ten named, coloured basins at smoothing 0 and seven at smoothing 10,
 * matched to the Dupuy & Courtois (2023) attractors, inside its inline cf-data
 * payload. Rebuilding them would fork the palette and the naming.
 *
 * What this adds is a uniform handle so the new layers and the scale ladder can
 * drive the existing meshes the same way they drive everything else, plus the
 * palette lookup the galaxy layer colours itself from.
 *
 *   attach(scene, opts) -> { setVisible, setSmoothing, palette, basinName,
 *                            sinkOf, dispose }
 */

import * as THREE from 'three';
import { hexToRGB } from './loader.js';

/** Read the page's own cf-meta block. Returns null when it is absent. */
export function readPageMeta(id = 'cf-meta') {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(id);
  return el ? JSON.parse(el.textContent) : null;
}

export function attach(scene, opts = {}) {
  const {
    meta = readPageMeta(),
    smoothing = '0',
    objectNames = ['basin_s0', 'basin_s10'],  // names the page gives its basin meshes
  } = opts;

  if (!meta) throw new Error('superclusters: no cf-meta block found and none supplied');

  const objects = {};
  for (const nm of objectNames) {
    const o = scene.getObjectByName(nm);
    if (o) objects[nm] = o;
  }

  let _sm = String(smoothing);

  const api = {
    meta, objects,
    /** The canonical palette: { id: {name, color, rgb} } for a smoothing level. */
    palette(sm = _sm) {
      const list = meta.superclusters[String(sm)] || [];
      return Object.fromEntries(list.map((d, i) => [i, {
        name: d.name, color: d.color, rgb: hexToRGB(d.color),
        voxels: d.voxels, sink: d.sink, published: d.published,
      }]));
    },
    basinName(id, sm = _sm) {
      const list = meta.superclusters[String(sm)] || [];
      return id === 255 ? 'unassigned' : (list[id] ? list[id].name : `basin ${id}`);
    },
    /** Which basin a named object falls in, from cf-meta.object_basin. */
    basinOf(objectName, sm = _sm) {
      const t = meta.object_basin[String(sm)];
      return t ? t[objectName] : undefined;
    },
    /** Sink position (supergalactic Mpc/h) of a basin, or of the whole level. */
    sinkOf(id, sm = _sm) {
      if (id === undefined) return meta.summary[String(sm)].sink;
      const d = (meta.superclusters[String(sm)] || [])[id];
      return d ? d.sink : null;
    },
    setSmoothing(sm) {
      _sm = String(sm);
      if (objects.basin_s0)  objects.basin_s0.visible  = (_sm === '0');
      if (objects.basin_s10) objects.basin_s10.visible = (_sm === '10');
    },
    setVisible(v) { for (const o of Object.values(objects)) o.visible = v && true; },
    dispose() { /* the page owns these meshes; nothing to release */ },
  };
  api.setSmoothing(_sm);
  return api;
}
