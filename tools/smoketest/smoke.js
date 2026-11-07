/**
 * smoke.js - headless instantiation of every layer module against the real data
 * files, with a stubbed `three`. Asserts counts and buffer lengths.
 *
 * This proves the modules parse, load their payloads, and build the buffers they
 * claim. It does NOT render anything: no GPU, no DOM, no GLSL compilation.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bootstrap the three stub before anything imports `three`. Keeping it in git
// and installing it here means a stray `npm install` at the repo root cannot
// silently remove it.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const dest = resolve(here, '..', '..', 'node_modules', 'three');
  mkdirSync(dest, { recursive: true });
  {
    writeFileSync(resolve(dest, 'index.js'), readFileSync(resolve(here, 'three-stub.js')));
    writeFileSync(resolve(dest, 'package.json'), JSON.stringify(
      { name: 'three', version: '0.160.0-stub', type: 'module', main: 'index.js',
        exports: { '.': './index.js' } }));
    console.log('(installed the three stub into node_modules/three)');
  }
}
const THREE = await import('three');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const DATA = resolve(REPO, 'data');

// file:// shim for the modules' fetch() calls
globalThis.fetch = async (url) => {
  const p = url.startsWith('./data') ? resolve(DATA, url.replace('./data/', '')) : resolve(REPO, url);
  const buf = readFileSync(p);
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : `  (expected ${want})`}`);
}
function note(label, v) { console.log(`        ${label}: ${v}`); }

const scene = new THREE.Scene();

console.log('stars.js');
const stars = await (await import('../../src/stars.js')).addTo(scene, {});
check('bubble points', stars.bubble.geometry.attributes.position.count, 24704);
check('bubble colour triples', stars.bubble.geometry.attributes.starColor.count, 24704);
check('shell points', stars.shell.geometry.attributes.position.count, 8920);
check('counts.bubble', stars.counts.bubble, 24704);
note('bubble position bytes', stars.bubble.geometry.attributes.position.array.byteLength);

console.log('galaxies.js');
const gals = await (await import('../../src/galaxies.js')).addTo(scene, {});
check('galaxy points', gals.points.geometry.attributes.position.count, 287758);
check('colour triples', gals.points.geometry.attributes.gColor.count, 287758);
check('visibility flags', gals.points.geometry.attributes.gShown.count, 287758);
check('basin_s0 length', gals.arrays.basin_s0.length, 287758);
check('basin_s10 length', gals.arrays.basin_s10.length, 287758);
check('vpec length', gals.arrays.vpec.length, 287758);
note('provenance counts', JSON.stringify(gals.counts));
gals.setColorBy('provenance'); gals.setSmoothing('10'); gals.setColorBy('basin');
gals.setProvenanceVisible([true, true, false, false]);
let shownAllSky = 0;
for (let i = 0; i < 287758; i++) shownAllSky += gals.points.geometry.attributes.gShown.array[i];
check('all-sky-only toggle shows CF4+2MRS', shownAllSky, 55877 + 31881);
const vp = gals.peculiarVelocity(0);
note('peculiar velocity of point 0 (km/s)', vp);

console.log('dipole.js');
const dip = await (await import('../../src/dipole.js')).addTo(scene, {});
check('dipole vector nodes', dip.entries.length, 6);
check('markers', dip.markers.length, 5);
note('Shapley offset from the CMB dipole (deg)', dip.angles.shapley.fromCMB.toFixed(2));
note('Vela offset from the CMB dipole (deg)', dip.angles.vela.fromCMB.toFixed(2));
note('axis-assumed entries', dip.entries.filter(e => e.userData.axisAssumed).map(e => e.userData.key).join(', '));

console.log('solarsystem.js');
const ss = await (await import('../../src/solarsystem.js')).addTo(scene, {});
check('planets', Object.keys(ss.bodies).length, 8);
check('orbit polylines', Object.keys(ss.orbits).length, 8);
check('Earth orbit vertices (256 + closing point)', ss.orbits.Earth.geometry.attributes.position.count, 257);
check('Earth has 4 render layers', ss.bodies.Earth.node.children.length, 4);
check('Saturn has body + ring', ss.bodies.Saturn.node.children.length, 2);
const e0 = ss.bodies.Earth.node.position;
const r0 = Math.hypot(e0.x, e0.y, e0.z);
note('Earth heliocentric distance at T=0 (au)', r0.toFixed(6));
if (Math.abs(r0 - 0.983307) > 1e-4) { failures++; console.log('  FAIL  Earth distance drifted from the Python value'); }
else console.log('  PASS  Earth distance matches the Python computation to 1e-4 au');
check('Moon is on the solar group', ss.group.children.includes(ss.moon.anchor), true);
check('solar explore enlarges planets x360', ss.bodies.Earth.node.scale.x, 360);
check('solar explore enlarges the Sun x4', ss.sunRoot.scale.x, 4);
check('Moon hidden while planets are enlarged', ss.moon.anchor.visible, false);
check('Moon mesh is not enlarged in explore', ss.moon.mesh.scale.x, 1);
const moonP = ss.moon.pivot.position;
const moonRadii = Math.hypot(moonP.x, moonP.y, moonP.z) * ss.data.au_km / 6378.14 / ss.unitsPerAu;
note('Moon geocentric distance at T=0 (Earth equatorial radii)', moonRadii.toFixed(2));
if (moonRadii < 55 || moonRadii > 65) {
  failures++;
  console.log('  FAIL  Moon distance is outside 55-65 Earth equatorial radii');
} else console.log('  PASS  Moon distance is within 55-65 Earth equatorial radii');
const coronaWorld = ss.photosphereRadius * ss.sunRoot.scale.x * ss.group.scale.x * 1.6;
const mercuryOrbit = 0.387 * ss.unitsPerAu;
note('solar corona radius / Mercury orbit', (coronaWorld / mercuryOrbit).toFixed(3));
if (!(coronaWorld < mercuryOrbit)) {
  failures++;
  console.log('  FAIL  solar corona is not inside Mercury\'s orbit');
} else console.log('  PASS  solar corona stays inside Mercury\'s orbit');
ss.setViewMode('physical');
check('research solar uses true planet size', ss.bodies.Earth.node.scale.x, 1);
check('research solar uses true Sun size', ss.sunRoot.scale.x, 1);
check('research solar shows the Moon', ss.moon.anchor.visible, true);
check('research solar does not enlarge the Moon', ss.moon.anchor.scale.x, 1);
ss.setViewMode('cinematic');
check('explore hides the Moon again', ss.moon.anchor.visible, false);
ss.setScaleLevel('earth');
check('Earth view uses true planet size', ss.bodies.Earth.node.scale.x, 1);
check('Earth view uses true Sun size', ss.sunRoot.scale.x, 1);
check('Moon shown in the Earth view', ss.moon.anchor.visible, true);
check('heliocentric orbits hidden in the Earth view', ss.orbits.Earth.visible, false);
ss.update(1.0);
ss.setTime(0.25); ss.setScaleLevel('galaxy'); ss.setScaleLevel('solar');
check('heliocentric orbits return in the solar view', ss.orbits.Earth.visible, true);
ss.update(2.0);

console.log('milkyway.js');
const mw = await (await import('../../src/milkyway.js')).addTo(scene, {});
check('milky way points', mw.points.geometry.attributes.position.count, 186819);
check('colour triples', mw.points.geometry.attributes.mwColor.count, 186819);
check('sun marker at the scene origin',
      Math.hypot(mw.sunMarkerWorld().x, mw.sunMarkerWorld().y, mw.sunMarkerWorld().z), 0);
const gcW = mw.centreWorld();
const gcR = Math.hypot(gcW.x, gcW.y, gcW.z) / 20;   // default unitsPerKpc
note('galactic centre distance (kpc)', gcR.toFixed(3));
if (Math.abs(gcR - 8.178) > 2e-3) { failures++; console.log('  FAIL  galactic centre is not at R0'); }
else console.log('  PASS  galactic centre sits at R0 = 8.178 kpc from the Sun');
note('model', mw.meta.model.slice(0, 60) + '...');
const diskH = mw.disk.geometry.parameters
  ? mw.disk.geometry.parameters.height
  : mw.disk.geometry.params[2];
check('schematic disk is a thin cylinder', diskH, 0.018);

console.log('localgroup.js');
const lg = await (await import('../../src/localgroup.js')).addTo(scene, { unitsPerKpc: 1 });
check('named Local Group members', lg.members.length, 22);
const m31 = lg.members.find((m) => m.short === 'M31');
const m31r = Math.hypot(...m31.sg);
note('M31 distance (kpc)', m31r.toFixed(3));
if (Math.abs(m31r - 783) > 1e-6) { failures++; console.log('  FAIL  M31 is not at 783 kpc'); }
else console.log('  PASS  M31 sits at 783 kpc');
check('M31 isophotal radius (kpc)', m31.radius_kpc, 21.705);
check('LMC has no invented radius', lg.members.find((m) => m.short === 'LMC').radius_kpc, null);
const gcDist = Math.hypot(8.178, 0.02);
const gcB = Math.asin(-0.02 / gcDist) * 180 / Math.PI;
const gcSg = (await import('../../src/localgroup.js')).galacticToSg(0, gcB, gcDist, lg.meta.galactic_to_sg);
const gcFile = mw.meta.galactic_centre_sg_kpc;
const gcErr = Math.hypot(gcSg[0] - gcFile[0], gcSg[1] - gcFile[1], gcSg[2] - gcFile[2]);
note('matrix vs galactic centre (kpc)', gcErr.toFixed(6));
if (gcErr > 0.001) { failures++; console.log('  FAIL  supergalactic matrix misses the galactic centre'); }
else console.log('  PASS  supergalactic matrix matches the galactic centre');

console.log('superclusters.js');
const sc = await import('../../src/superclusters.js');
const pageMeta = JSON.parse(readFileSync(resolve(DATA, 'cf-meta-extract.json'), 'utf8'));
const scApi = sc.attach(scene, { meta: pageMeta });
check('basins at smoothing 0', Object.keys(scApi.palette('0')).length, 10);
check('basins at smoothing 10', Object.keys(scApi.palette('10')).length, 7);
check('Milky Way basin at smoothing 0', scApi.basinOf('Milky Way', '0'), 9);
check('Milky Way basin at smoothing 10', scApi.basinOf('Milky Way', '10'), 1);
note('basin 9 at smoothing 0', scApi.basinName(9, '0'));

console.log('tour.js');
const tourMod = await import('../../src/tour.js');
check('exports install', typeof tourMod.install, 'function');
check('install returns null without a #tour element', tourMod.install({}), null);
note('DOM-dependent behaviour', 'not exercised here - no document in Node');

console.log('\ndisposal');
stars.dispose(); gals.dispose(); dip.dispose(); ss.dispose(); mw.dispose();
console.log('  PASS  all five layers disposed without throwing');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
console.log('NOT verified here: GLSL compilation, rendering, visual correctness - no GPU, no browser.');
process.exit(failures === 0 ? 0 : 1);
