/**
 * addon.js - wires the new layers into the existing viewer.
 *
 * The page's own code is an ES module, so its `scene` / `camera` / `controls`
 * are private. tools/patch.py publishes them on `window.__UM` and fires
 * `universal-map:ready` once the original scene has finished building.
 *
 * THE SCALE LADDER
 * ----------------
 * Seven steps, from a true-size Earth to about 300 Mpc/h:
 *
 *   Earth  ->  solar system  ->  nearby stars  ->  Milky Way  ->
 *   Local Group  ->  galaxies  ->  superclusters
 *
 * They CANNOT share a coordinate system. The solar system is 3e-10 Mpc/h across;
 * drawn next to the galaxy field at any visible size it is ~1e11 times too big,
 * which is exactly what happens if a level change forgets to rescale it.
 *
 * So a level is AUTHORITATIVE. Entering one sets the scale AND the visibility of
 * every layer - the new ones, the page's own flow lines, isosurfaces and rings -
 * and the layer toggles only choose among what that level actually contains.
 * Toggles for layers that do not belong to the current level are disabled. There
 * is deliberately no way to have the solar system and the galaxy field on screen
 * at once, because there is no scale at which both are legible.
 *
 * Coarser levels put their content in the same comfortable 10-1000 scene-unit
 * band and retarget near/far around it. The Earth step is the exception: true
 * radii, so the camera sits a fraction of a scene unit out and near/far tighten
 * to match. The depth buffer never has to resolve one part in 1e11.
 */

import * as starsMod from './stars.js';
import * as galaxiesMod from './galaxies.js';
import * as dipoleMod from './dipole.js';
import * as solarMod from './solarsystem.js';
import * as milkywayMod from './milkyway.js';
import * as localgroupMod from './localgroup.js';
import * as scMod from './superclusters.js';
import * as tourMod from './tour.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const BASE = './universal-map/data';
const TEXBASE = './universal-map/textures';

export const ORDER = ['earth', 'solar', 'stars', 'milkyway', 'localgroup', 'galaxies', 'superclusters'];

const LEVELS = {
  earth: {
    button: 'zEarth', label: 'Earth',
    note: 'True size. Earth, the Moon and the Sun are at their real radii, and the view opens on the day side. The Moon is about 60 Earth radii out \u2014 scroll out to see it.',
    unitsPerAu: 2, near: 1e-5, far: 12, minDist: 1e-4, maxDist: 0.02, home: 5e-4,
    layers: ['solar'], presentation: 'earth',
  },
  solar: {
    button: 'zSolar', label: 'Solar system',
    note: 'Explore: the orbits are true. Planets are drawn \u00d7360 and the Sun \u00d74 so the bodies stay visible. The Moon is hidden on this step. Research draws every radius, including the Moon, at its real size.',
    unitsPerAu: 2, near: 0.05, far: 5000, minDist: 2, maxDist: 600, home: 8,
    layers: ['solar'], presentation: 'solar',
  },
  stars: {
    button: 'zStars', label: 'Nearby stars',
    note: '24,704 HYG v4.2 stars within 100 pc at true 3-D positions. The naked-eye shell behind them is directions only, projected to a fixed radius \u2014 not positions.',
    unitsPerPc: 2, near: 0.5, far: 20000, minDist: 5, maxDist: 2000, home: 320,
    layers: ['stars'],
  },
  milkyway: {
    button: 'zMW', label: 'Milky Way',
    note: 'Schematic disk, not a photograph. The Sun is the origin and the galactic centre is 8.178 kpc away (GRAVITY 2019); the disk is drawn to 15 kpc. The warmer patch is that centre, not another light. The short bar is 5 kpc. The points are an idealised four-arm sample; Xu et al. 2023, ApJ 947, 54, argue that morphology is wrong, and their arms are not invented here.',
    unitsPerKpc: 20, near: 1, far: 20000, minDist: 20, maxDist: 8000, home: 1600,
    layers: ['milkyway'],
  },
  localgroup: {
    button: 'zLG', label: 'Local Group',
    note: 'Milky Way, Andromeda (783 kpc) and the other named members use distances from McConnachie 2012, AJ 144, 4. Andromeda\u2019s circle is the RC3 D25 radius. The Milky Way circle is the 15 kpc schematic cutoff from the Milky Way step, not an isophotal diameter, so the two circles are not the same measurement. Both are drawn in our disk plane; inclinations are not applied. LMC and SMC are position marks: that table gives them no half-light radius. The bar is 200 kpc. The redshift catalog is not drawn on this step.',
    unitsPerKpc: 0.5, near: 0.2, far: 40000, minDist: 2, maxDist: 8000, home: 700,
    layers: ['milkyway', 'localgroup'],
  },
  galaxies: {
    button: 'zGal', label: 'Galaxies',
    note: '287,758 galaxies. The SDSS and DESI wedge covers the north galactic cap only and stops 22\u201326\u00b0 short of Shapley. At this scale the whole Milky Way is 0.02 Mpc/h across \u2014 one pixel.',
    unitsPerMpch: 1, near: 1, far: 5000, minDist: 60, maxDist: 1400, home: 512,
    layers: ['galaxies', 'dipole'], pageLayers: true,
  },
  superclusters: {
    button: 'zSuper', label: 'Superclusters',
    note: 'Basin watershed from Cosmicflows-4. Every dipole measurement points about 40\u00b0 away from Shapley.',
    unitsPerMpch: 1, near: 1, far: 12000, minDist: 100, maxDist: 3000, home: 900,
    layers: ['galaxies', 'dipole'], pageLayers: true,
  },
};

const TOGGLE = { stars: 'tStars', galaxies: 'tGalaxies', dipole: 'tDipole',
                 solar: 'tSolar', milkyway: 'tMW' };

async function boot() {
  const UM = window.__UM;
  if (!UM) { console.warn('addon: window.__UM missing; patch.py edit 1 did not apply'); return; }
  const { scene, camera, controls } = UM;
  const $ = (id) => document.getElementById(id);

  const layers = {};
  const failed = [];
  const attach = async (name, fn) => {
    try { layers[name] = await fn(); }
    catch (e) { failed.push(name); console.error(`addon: ${name} layer failed`, e); }
  };

  await Promise.all([
    attach('stars', () => starsMod.addTo(scene, { baseUrl: BASE, unitsPerPc: 2, shellRadius: 220, visible: false })),
    attach('galaxies', () => galaxiesMod.addTo(scene, { baseUrl: BASE, unitsPerMpch: 1, visible: false })),
    attach('dipole', () => dipoleMod.addTo(scene, { baseUrl: BASE, unitsPerMpch: 1, visible: false })),
    attach('milkyway', () => milkywayMod.addTo(scene, { baseUrl: BASE, unitsPerKpc: 20, visible: false })),
    attach('localgroup', () => localgroupMod.addTo(scene, { baseUrl: BASE, unitsPerKpc: 1, visible: false })),
    attach('solar', () => solarMod.addTo(scene, {
      baseUrl: BASE, textureUrl: TEXBASE, unitsPerAu: 2, visible: false,
      renderer: UM.renderer, scaleLevel: 'galaxy',
    })),
  ]);
  try { layers.superclusters = scMod.attach(scene, { meta: UM.meta }); } catch (e) { /* optional */ }

  if (failed.length) {
    console.warn(`addon: ${failed.join(', ')} unavailable. External .bin/.json files need the page served `
               + 'over http://; a file:// load cannot fetch them. Run tools/inline.py for a single-file build.');
  }

  // ---- the page's own cosmological layers, so a level can hide them --------
  const page = UM.page || {};
  const pageObjects = [page.oursObj, page.othersObj, page.densGroup, page.ringGroup]
    .concat(Object.values(page.shells || {}))
    .filter(Boolean);
  // The page's place-markers are sized for the galaxy view and parented to the
  // scene, not to those groups. The Milky Way glow sits at the origin, so on
  // the solar step it is drawn inside the Sun. Ring labels live under
  // ringGroup and stay with that toggle.
  const landmarkSprites = scene.children.filter((o) => o.isSprite);
  const landmarkLabels = scene.children.filter((o) => o.isCSS2DObject);
  const ringLabels = [];
  if (page.ringGroup && page.ringGroup.traverse) {
    page.ringGroup.traverse((o) => { if (o.isCSS2DObject) ringLabels.push(o); });
  }
  const cssLabels = [];
  function makeLabel(text, parent, position, levels) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'color:rgba(244,241,234,0.94);font:500 11px/1.2 sans-serif;'
      + 'letter-spacing:0.04em;white-space:nowrap;pointer-events:none;'
      + 'text-shadow:0 1px 2px rgba(0,0,0,0.9)';
    const obj = new CSS2DObject(el);
    if (obj.center && obj.center.set) obj.center.set(0, 1);
    obj.position.set(position[0], position[1], position[2]);
    parent.add(obj);
    cssLabels.push({ object: obj, levels, group: parent });
    return obj;
  }
  function lineMid(line) {
    const a = line.geometry.attributes.position.array;
    return [(a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2];
  }
  if (layers.milkyway && layers.milkyway.ruler) {
    makeLabel('5 kpc', layers.milkyway.group, lineMid(layers.milkyway.ruler), ['milkyway']);
  }
  if (layers.localgroup) {
    const pole = new (UM.THREE.Vector3)(0, 0.99392259, 0.110081262).normalize();
    const tangent = new (UM.THREE.Vector3)().crossVectors(pole, new (UM.THREE.Vector3)(1, 0, 0)).normalize();
    makeLabel('Milky Way', layers.localgroup.group, [pole.x * 18, pole.y * 18, pole.z * 18], ['localgroup']);
    let near = 0;
    for (const m of layers.localgroup.members) {
      if (!m.label) continue;
      let pos = [0, 0, 0];
      if (m.distance_kpc < 200) {
        const k = (near - 2) * 16;
        near += 1;
        pos = [tangent.x * k, tangent.y * k, tangent.z * k];
      }
      makeLabel(m.short, m.node, pos, ['localgroup']);
    }
    if (layers.localgroup.ruler) {
      makeLabel('200 kpc', layers.localgroup.group, lineMid(layers.localgroup.ruler), ['localgroup']);
    }
  }
  // The glow sprites are quads several scene-units across. On a cluster they
  // read as coloured blocks. The text labels carry the names instead.
  for (const o of landmarkSprites) {
    o.visible = false;
    if (o.scale && o.scale.setScalar) o.scale.setScalar(0);
  }
  const labelStyle = document.createElement('style');
  labelStyle.textContent = `
    #labels .pt { gap: 0; padding: 0; translate: 0 0; --mc: #f4f1ea; }
    #labels .pt-dot {
      width: 6px; height: 6px; margin: 0; border-radius: 50%;
      background: transparent; border: 1px solid rgba(255,255,255,0.92);
      box-shadow: none;
    }
    #labels .pt-name {
      margin-left: 16px; font: 500 11px/1.2 var(--font-body), sans-serif;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: rgba(244,241,234,0.94);
      text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    }
    #labels .pt { position: relative; }
    #labels .pt::after {
      content: ''; position: absolute; left: 7px; top: 50%;
      width: 14px; height: 1px; background: rgba(255,255,255,0.55);
      pointer-events: none;
    }
    #labels .pt:hover .pt-dot, #labels .pt.on .pt-dot { transform: none; box-shadow: none; }
  `;
  document.head.appendChild(labelStyle);
  const credits = document.querySelector('p.credits');
  if (credits && !credits.querySelector('[data-um-tex]')) {
    const extra = document.createElement('span');
    extra.dataset.umTex = '1';
    extra.textContent = ' Planet and starfield maps, except the Moon: Solar System Scope, CC BY 4.0. ';
    const moonA = document.createElement('a');
    moonA.href = 'https://svs.gsfc.nasa.gov/4720';
    moonA.target = '_blank';
    moonA.rel = 'noopener';
    moonA.textContent = 'Moon maps: NASA SVS CGI Moon Kit';
    const moonRest = document.createTextNode(' (public domain; LROC color and LOLA displacement).');
    credits.appendChild(extra);
    credits.appendChild(moonA);
    credits.appendChild(moonRest);
  }
  const labelsBox = $('tLabels');
  let labelsWere = labelsBox ? labelsBox.checked : false;

  function setPageVisible(v) {
    for (const o of pageObjects) o.visible = v;
    for (const o of landmarkSprites) {
      o.visible = false;
      if (o.scale && o.scale.setScalar) o.scale.setScalar(0);
      if (o.material) o.material.opacity = 0;
    }
    for (const o of landmarkLabels) o.visible = v;
    if (!v && page.ringGroup) {
      page.ringGroup.visible = false;
      for (const o of ringLabels) o.visible = false;
    }
    if (labelsBox) {
      if (!v && labelsBox.checked) { labelsWere = true; labelsBox.checked = false; labelsBox.dispatchEvent(new Event('change')); }
      else if (v && labelsWere && !labelsBox.checked) { labelsBox.checked = true; labelsBox.dispatchEvent(new Event('change')); }
    }
  }

  // The page turns the 100/200/300 Mpc/h rings and SG axes back on whenever
  // Research mode calls updateRings(), and CSS2DRenderer draws a label whose
  // own visible flag is true even if its parent is hidden. Off the cosmological
  // steps those overlays are the wrong units by about 10,000×, so they are
  // forced off every frame. The same pass keeps the landmark glow sprites at
  // zero: the page's setScale restores their size.
  function holdChrome() {
    const pageLevel = !!(LEVELS[level] && LEVELS[level].pageLayers);
    if (!pageLevel && page.ringGroup) {
      page.ringGroup.visible = false;
      const axes = page.ringGroup.getObjectByName && page.ringGroup.getObjectByName('axes');
      if (axes) axes.visible = false;
      for (const o of ringLabels) o.visible = false;
    }
    for (const o of landmarkSprites) {
      o.visible = false;
      if (o.scale && o.scale.setScalar) o.scale.setScalar(0);
      if (o.material) o.material.opacity = 0;
    }
    for (const lab of cssLabels) {
      const parentOn = !lab.group || lab.group.visible !== false;
      lab.object.visible = parentOn && lab.levels.includes(level);
    }
  }

  // ---- level machinery ----------------------------------------------------
  let level = 'earth';
  // Bumped on every setLevel so a late Earth-camera settle cannot clamp a
  // level the user has already left.
  let cameraSettle = 0;

  // The Earth step is inserted here, not in the original page.
  function ensureEarthButton() {
    if ($('zEarth')) return;
    const solarBtn = $('zSolar');
    if (!solarBtn || !solarBtn.parentNode) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'zEarth';
    b.setAttribute('aria-pressed', 'false');
    b.textContent = 'Earth';
    solarBtn.parentNode.insertBefore(b, solarBtn);
  }
  ensureEarthButton();

  function applyScales(L) {
    // EVERY layer is rescaled on EVERY level change. Skipping this is what made
    // the solar system render 261 Mly across.
    if (layers.solar) {
      const on = L.layers.includes('solar');
      layers.solar.setScaleLevel(on ? (L.presentation || 'solar') : 'galaxy');
      if (on && L.unitsPerAu) layers.solar.setScale(L.unitsPerAu);
      layers.solar.setVisible(on);
    }
    if (layers.stars) {
      const on = L.layers.includes('stars');
      if (on && L.unitsPerPc) {
        layers.stars.setScale(L.unitsPerPc);
        layers.stars.setShellRadius(L.unitsPerPc * 110);
      }
      layers.stars.setVisible(on);
    }
    if (layers.milkyway) {
      const on = L.layers.includes('milkyway');
      if (on && L.unitsPerKpc) layers.milkyway.setScale(L.unitsPerKpc);
      if (on && layers.milkyway.setReadout) {
        layers.milkyway.setReadout(L.button === 'zLG' ? 'group' : 'galaxy');
      }
      layers.milkyway.setVisible(on);
    }
    if (layers.localgroup) {
      const on = L.layers.includes('localgroup');
      if (on && L.unitsPerKpc) layers.localgroup.setScale(L.unitsPerKpc);
      layers.localgroup.setVisible(on);
    }
    if (layers.galaxies && layers.galaxies.setSize) {
      const close = L.button === 'zLG';
      layers.galaxies.setSize(close ? 42 : 320);
      if (layers.galaxies.setOpacity) layers.galaxies.setOpacity(close ? 0.8 : 0.9);
    }
    for (const k of ['galaxies', 'dipole']) {
      if (!layers[k]) continue;
      const on = L.layers.includes(k);
      if (on && L.unitsPerMpch) layers[k].setScale(L.unitsPerMpch);
      layers[k].setVisible(on);
    }
    setPageVisible(!!L.pageLayers);
    holdChrome();
  }

  function syncToggles(L) {
    for (const [k, id] of Object.entries(TOGGLE)) {
      const box = $(id);
      if (!box) continue;
      const belongs = L.layers.includes(k);
      box.checked = belongs && !!layers[k];
      box.disabled = !belongs || !layers[k];
      const row = box.closest('.toggle');
      if (row) row.style.opacity = box.disabled ? 0.38 : '';
    }
    const wedge = $('tWedge');
    if (wedge) {
      wedge.disabled = !L.layers.includes('galaxies');
      const row = wedge.closest('.toggle');
      if (row) row.style.opacity = wedge.disabled ? 0.38 : '';
    }
  }

  // Day-side Earth frame. R is the rendered Earth radius after the presentation
  // scale is applied. near ~0.08 R resolves the globe; far reaches the Sun
  // (~2 scene units). min stays outside the atmosphere; max reaches the Moon
  // (~60 Earth radii) without opening onto an empty void.
  function earthFrame() {
    const solar = layers.solar;
    if (!solar || typeof solar.earthSceneRadius !== 'function') return null;
    if (typeof solar.group.updateMatrixWorld === 'function') solar.group.updateMatrixWorld(true);
    const R = solar.earthSceneRadius();
    if (!(R > 0)) return null;
    const earthW = solar.bodies.Earth.node.getWorldPosition(new UM.THREE.Vector3());
    const sunW = solar.sun.getWorldPosition(new UM.THREE.Vector3());
    const day = sunW.sub(earthW);
    if (day.length() < 1e-12) day.set(1, 0, 0);
    else day.normalize();
    return {
      near: 0.12 * R, far: 900 * R,
      minDist: 1.8 * R, maxDist: 220 * R, distance: 5.5 * R,
      target: earthW, dir: day,
    };
  }

  function setLevel(next, { fly = true } = {}) {
    const L = LEVELS[next];
    if (!L) return;
    level = next;
    const settle = ++cameraSettle;
    for (const [k, def] of Object.entries(LEVELS)) {
      const b = $(def.button); if (b) b.setAttribute('aria-pressed', String(k === next));
    }
    const note = $('zoomNote');
    if (note) note.textContent = next === 'solar' ? solarNote() : L.note;
    if (layers.solar && layers.solar.setViewMode) {
      layers.solar.setViewMode(document.body.classList.contains('research') ? 'physical' : 'cinematic');
    }
    if (UM.bloom) {
      const bloomFor = {
        earth: [0, 1],
        solar: [0.22, 0.8],
        localgroup: [0, 1],
        milkyway: [0, 1],
      };
      const pair = bloomFor[next] || [0.4, 0.62];
      UM.bloom.strength = pair[0];
      UM.bloom.threshold = pair[1];
    }

    // Scales first, so the Earth radius the camera uses is the one on screen.
    applyScales(L);
    syncToggles(L);

    const framed = next === 'earth' ? earthFrame() : null;
    if (framed) {
      camera.near = framed.near; camera.far = framed.far;
      controls.minDistance = framed.minDist;
      // A tight max would clamp the flight from the cosmological view down to
      // a few Earth radii. Hold it open until the flight lands.
      controls.maxDistance = fly ? 8000 : framed.maxDist;
    } else {
      camera.near = L.near; camera.far = L.far;
      controls.minDistance = L.minDist; controls.maxDistance = L.maxDist;
    }
    camera.updateProjectionMatrix();

    const i = ORDER.indexOf(next);
    const zi = $('zIn'), zo = $('zOut');
    if (zi) { zi.disabled = (i === 0); zi.textContent = i === 0 ? 'Deepest view' : `Zoom in to ${LEVELS[ORDER[i - 1]].label} \u2192`; }
    if (zo) { zo.disabled = (i === ORDER.length - 1); zo.textContent = i === ORDER.length - 1 ? 'Widest view' : `\u2190 Zoom out to ${LEVELS[ORDER[i + 1]].label}`; }

    if (fly && UM.flyTo) {
      if (!(next === 'localgroup' && layers.localgroup && layers.localgroup.frame)) {
        camera.up.set(0, 1, 0);
      }
      if (framed) UM.flyTo(framed.target.toArray(), framed.distance, framed.dir.toArray());
      else if (next === 'milkyway') UM.flyTo([0, 0, 0], L.home, [0.2, -0.08, 0.98]);
      else if (next === 'localgroup' && layers.localgroup && layers.localgroup.frame) {
        const f = layers.localgroup.frame();
        if (f.up) camera.up.set(f.up[0], f.up[1], f.up[2]);
        UM.flyTo(f.target, f.distance, f.direction);
      }
      else if (L.pageLayers) UM.flyTo([-40, 12, 8], L.home);
      else UM.flyTo([0, 0, 0], L.home);
    }
    if (framed && fly) {
      setTimeout(() => {
        if (settle !== cameraSettle || level !== 'earth') return;
        const again = earthFrame();
        if (!again) return;
        controls.minDistance = again.minDist;
        controls.maxDistance = again.maxDist;
      }, 1850);
    }
    window.dispatchEvent(new CustomEvent('universal-map:level', { detail: { level: next } }));
  }

  const step = (d) => {
    const i = ORDER.indexOf(level) + d;
    if (i >= 0 && i < ORDER.length) setLevel(ORDER[i]);
  };

  for (const [k, def] of Object.entries(LEVELS)) {
    const b = $(def.button); if (b) b.addEventListener('click', () => setLevel(k));
  }
  if ($('zIn')) $('zIn').addEventListener('click', () => step(-1));
  if ($('zOut')) $('zOut').addEventListener('click', () => step(+1));

  // ---- layer toggles, within the current level only -----------------------
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', () => fn(el.checked)); };
  bind('tStars', v => layers.stars && layers.stars.setVisible(v));
  bind('tGalaxies', v => layers.galaxies && layers.galaxies.setVisible(v));
  bind('tDipole', v => layers.dipole && layers.dipole.setVisible(v));
  bind('tSolar', v => layers.solar && layers.solar.setVisible(v));
  bind('tMW', v => layers.milkyway && layers.milkyway.setVisible(v));
  bind('tWedge', v => layers.galaxies && layers.galaxies.setProvenanceVisible([true, true, v, v]));

  for (const id of ['scale0', 'scale10']) {
    const b = $(id);
    if (b) b.addEventListener('click', () => {
      const sm = id === 'scale10' ? '10' : '0';
      if (layers.galaxies) layers.galaxies.setSmoothing(sm);
      if (layers.superclusters) layers.superclusters.setSmoothing(sm);
    });
  }

  // ---- the zoom chain off the Milky Way card ------------------------------
  // The page opens its own info card; when that card is the Milky Way, offer the
  // descent. The card is the page's DOM, so this watches it rather than
  // reaching into the page's module scope.
  const card = $('info'), title = $('infoTitle'), acts = card && card.querySelector('.acts');
  if (card && title && acts) {
    const enter = document.createElement('button');
    enter.className = 'btn'; enter.type = 'button'; enter.id = 'umEnter';
    enter.textContent = 'Enter the galaxy \u2192';
    enter.hidden = true;
    enter.addEventListener('click', () => { setLevel('milkyway'); card.hidden = true; });
    acts.appendChild(enter);
    const watch = () => {
      const isMW = !card.hidden && /milky way/i.test(title.textContent || '');
      const want = !isMW || !layers.milkyway;
      // Assigning the same `hidden` value still notifies this observer in Chrome,
      // and the button lives inside the observed card, so an unconditional write
      // never returns to the event loop and every control dies.
      if (enter.hidden !== want) enter.hidden = want;
    };
    new MutationObserver(watch).observe(card, { attributes: true, childList: true, subtree: true,
                                                attributeFilter: ['hidden'] });
    watch();
  }

  // Clicking the Sun marker inside the Milky Way view descends again.
  if (layers.milkyway && UM.renderer) {
    const ray = new (UM.THREE.Raycaster)();
    const ndc = new (UM.THREE.Vector2)();
    UM.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (level !== 'milkyway') return;
      const r = UM.renderer.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(layers.milkyway.sun, false);
      if (hit.length) setLevel('stars');
    });
  }

  // ---- provenance note on the supercluster key ----------------------------
  if (layers.galaxies && layers.galaxies.meta.basins) {
    const v = layers.galaxies.meta.basins.validation['0'];
    const key = $('scKey');
    if (key && v) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'Galaxies are tagged by basin from a recomputed Cosmicflows-4 watershed, which '
        + `reproduces this page's own labelling at ${(v.seed_agreement * 100).toFixed(1)}% of `
        + `${v.n_seeds.toLocaleString()} streamline seeds.`;
      key.appendChild(p);
    }
  }

  // ---- animated shader uniforms ------------------------------------------
  if (layers.solar) {
    const t0 = performance.now();
    (function spin() {
      holdChrome();
      if (level === 'solar' || level === 'earth') layers.solar.update((performance.now() - t0) / 1000);
      if (level === 'earth') {
        const e = layers.solar.bodies.Earth.node.getWorldPosition(new UM.THREE.Vector3());
        const mpos = layers.solar.moon.mesh.getWorldPosition(new UM.THREE.Vector3());
        const distE = camera.position.distanceTo(e);
        const dist = Math.min(distE, camera.position.distanceTo(mpos));
        const R = layers.solar.earthSceneRadius();
        // Power-of-two bins. A continuous rewrite of near/far was moving the
        // projection every time the distance drifted by 8 percent, which reads
        // as flicker. A bin changes only when the camera distance changes by
        // about a factor of two.
        const near = Math.max(dist * 0.04, R * 0.1);
        const far = Math.max(distE * 30, dist * 20, R * 700);
        const qn = Math.pow(2, Math.round(Math.log2(near)));
        const qf = Math.pow(2, Math.round(Math.log2(Math.max(far, qn * 4))));
        if (qn > 0 && qf > qn && (camera.near !== qn || camera.far !== qf)) {
          camera.near = qn;
          camera.far = qf;
          camera.updateProjectionMatrix();
        }
        const showRing = distE > R * 25;
        if (layers.solar.moon.orbit.visible !== showRing) layers.solar.moon.orbit.visible = showRing;
      }
      requestAnimationFrame(spin);
    })();
  }

  // ---- the guided tour --------------------------------------------------
  // The page's 12 stops predate the scale ladder: stop 1 is about Earth and the
  // Sun but only flew to 70 Mpc/h, because there was no solar system to fly to.
  // Each stop now names the scale it is actually talking about.
  const STOP_LEVEL = [
    'earth',          //  1  You are here
    'milkyway',       //  2  Our galaxy, the Milky Way
    'localgroup',     //  3  Our neighborhood: the Local Group
    'galaxies',       //  4  How galaxies are organized
    'galaxies',       //  5  The Virgo Cluster
    'superclusters',  //  6  Laniakea: the watershed we live in
    'superclusters',  //  7  The low point: the Great Attractor
    'superclusters',  //  8  Not chaos: choreography
    'superclusters',  //  9  Like time-lapse traffic
    'superclusters',  // 10  A bigger river: Shapley
    'superclusters',  // 11  Our neighbors
    'galaxies',       // 12  Your turn
  ];
  const tour = tourMod.install({
    setLevel,
    levelForStop: (i) => STOP_LEVEL[i] || null,
    flyDurationMs: 1800,
  });

  // ---- Tour / Map mode control in the sidebar header ---------------------
  const mTour = $('umModeTour'), mMap = $('umModeMap');
  function syncMode() {
    const touring = document.body.classList.contains('touring');
    if (mTour) mTour.setAttribute('aria-pressed', String(touring));
    if (mMap) mMap.setAttribute('aria-pressed', String(!touring));
    if (mTour) mTour.lastChild.textContent = touring ? ' Touring\u2026' : ' Start Tour';
  }
  if (mTour) mTour.addEventListener('click', () => {
    const start = $('tourBtn') || $('dockTour');
    if (start && !document.body.classList.contains('touring')) start.click();
    setTimeout(syncMode, 0);
  });
  if (mMap) mMap.addEventListener('click', () => {
    const stop = $('tourClose');
    if (stop && document.body.classList.contains('touring')) stop.click();
    setTimeout(syncMode, 0);
  });
  new MutationObserver(syncMode).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncMode();

  function solarNote() {
    return document.body.classList.contains('research')
      ? 'Research: true radii and true orbits, including the Moon. A planet is smaller than a pixel from the overview, until you approach it. Nothing on this step is enlarged.'
      : 'Explore: orbits are true. Planets are drawn \u00d7360 and the Sun \u00d74 so the bodies stay visible. The Moon is hidden here. Research uses the real radii.';
  }
  new MutationObserver(() => {
    if (level !== 'solar') return;
    if (layers.solar && layers.solar.setViewMode) {
      layers.solar.setViewMode(document.body.classList.contains('research') ? 'physical' : 'cinematic');
    }
    const note = $('zoomNote');
    if (note) note.textContent = solarNote();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  setLevel('earth');
  UM.layers = layers;
  UM.setLevel = setLevel;
  UM.tour = tour;
  console.info('addon: layers attached -> ' + Object.keys(layers).join(', ')
    + (failed.length ? ` | unavailable: ${failed.join(', ')}` : ''));
}

if (window.__UM && window.__UM.meta) boot();
else window.addEventListener('universal-map:ready', boot, { once: true });
