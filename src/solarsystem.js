/**
 * solarsystem.js - the solar-system scale: true orbital planes, textured planets,
 * a multi-layer Earth and a fiery Sun.
 *
 * Orbits come from the JPL/Standish Keplerian element table (valid 1800-2050) and
 * are drawn with their real inclinations and node orientations, so the planes are
 * genuinely tilted rather than coplanar. The whole system is rotated by the
 * ecliptic -> supergalactic matrix carried in the data file, which seats it in
 * the same frame as the star bubble and the galaxy field.
 *
 * Scale: astronomical units and megaparsecs differ by about eleven orders of
 * magnitude, so the planets are NOT drawn at the galaxy scale. `setScaleLevel`
 * meshes them only for the 'earth' and 'solar' steps; at coarser steps the
 * whole group is a single point of light.
 *
 * Two presentations of this one layer, because a single radius boost cannot
 * show both a planet and its moons:
 *   'earth'  true radii. The Moon sits ~60 Earth radii out. Heliocentric orbit
 *            lines are hidden (each one passes through its planet).
 *   'solar'  Explore draws a cinematic enlargement (planets ×360, Sun ×4) so the
 *            bodies stay visible while the orbits stay the real ones. Research
 *            draws true radii, including the Moon at its real size and orbit.
 *            Explore hides the Moon, because it would sit inside the enlarged Earth.
 *
 *   addTo(scene, opts) -> { group, setVisible, setScaleLevel, setTime, setScale,
 *                           update, bodies, moon, dispose }
 */

import * as THREE from 'three';
import { loadJSON } from './loader.js';
import { SHADERS, DEFAULTS } from './shaders/index.js';

const TEX = {
  Mercury: 'mercury_2k.jpg', Venus: 'venus_atmosphere_2k.jpg', Mars: 'mars_2k.jpg',
  Jupiter: 'jupiter_2k.jpg', Saturn: 'saturn_2k.jpg', Uranus: 'uranus_2k.jpg',
  Neptune: 'neptune_2k.jpg', Moon: 'moon_2k.jpg',
};
// Explore, on the solar-system step only. Distances stay true; these factors are
// stated in the scale note. Research uses 1, so a radius is never enlarged there.
const CINEMATIC_PLANET_BOOST = 360;
const CINEMATIC_SUN_BOOST = 4;
const PLANET_AMBIENT = 0.22;
// Paul Schlyter's lunar theory quotes distance in Earth equatorial radii.
const EARTH_EQ_KM = 6378.14;
const MOON_RADIUS_KM = 1737.4;
const MOON_MEAN_A = 60.2666;
const ORBIT_COLOR = {
  Mercury: 0xb0a9a0, Venus: 0xe8c37a, Earth: 0x4fb6ff, Mars: 0xe06a4a,
  Jupiter: 0xd8b48a, Saturn: 0xe3d2a0, Uranus: 0x8fe3e8, Neptune: 0x5f7fe0,
};

const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
const col = a => new THREE.Color(a[0], a[1], a[2]);

// Lambert planet. GLSL 1 dialect, same as the Earth shaders: three r160 rewrites
// varying / texture2D / gl_FragColor. The sRGB map is already linear in the shader.
const PLANET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosW = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;
const PLANET_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec3 uSunPosition;
uniform float uAmbient;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPosition - vPosW);
  float lambert = max(dot(N, L), 0.0);
  // Ambient on the night side, full sun on the day side, then held to 0.4.
  // This page blooms anything above about half intensity, and the gas-giant
  // maps are pale, so an unscaled day side becomes a white orb.
  float light = (uAmbient + (1.0 - uAmbient) * lambert) * 0.4;
  vec3 albedo = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(albedo * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
// Same lighting model, plus a tangent-space normal from the LOLA displacement.
// The sphere radius stays the mean lunar radius; relief is shading, not a
// vertex offset, because a 4 pixel/degree map is far finer than the mesh.
const MOON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vTangentW;
varying vec3 vBitangentW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec3 objN = normalize(position);
  vec3 up = abs(objN.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 objT = normalize(cross(up, objN));
  vec3 objB = normalize(cross(objN, objT));
  mat3 M = mat3(modelMatrix);
  vNormalW = normalize(M * objN);
  vTangentW = normalize(M * objT);
  vBitangentW = normalize(M * objB);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosW = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;
const MOON_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform sampler2D uNormal;
uniform vec3 uSunPosition;
uniform float uAmbient;
uniform float uNormalScale;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vTangentW;
varying vec3 vBitangentW;
varying vec3 vPosW;
void main() {
  vec3 nTex = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  nTex.xy *= uNormalScale;
  vec3 N = normalize(vTangentW * nTex.x + vBitangentW * nTex.y + vNormalW * nTex.z);
  vec3 L = normalize(uSunPosition - vPosW);
  float lambert = max(dot(N, L), 0.0);
  float light = uAmbient + (1.0 - uAmbient) * lambert;
  vec3 albedo = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(albedo * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const rad = (d) => d * Math.PI / 180;

/**
 * Geocentric ecliptic Moon position in Earth equatorial radii.
 * Paul Schlyter, stjarnhimlen.se/comp/ppcomp.html (van Flandern & Pulkkinen 1980).
 * d is days from 1999 Dec 31 0h UT (JD 2451543.5). The page's T is Julian
 * centuries from J2000.0 (JD 2451545.0), so d = T*36525 + 1.5.
 * Longitude: evection, variation, yearly equation. Latitude: the largest term.
 * Distance: the two largest terms. Then xh, yh, zh as on that page.
 */
function moonGeocentric(T) {
  const d = T * 36525 + 1.5;
  const N = 125.1228 - 0.0529538083 * d;
  const inc = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = MOON_MEAN_A;
  const e = 0.054900;
  const M = 115.3654 + 13.0649929509 * d;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = 356.0470 + 0.9856002585 * d;

  const Mr = rad(M);
  let E = Mr + e * Math.sin(Mr) * (1 + e * Math.cos(Mr));
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  let r = Math.hypot(xv, yv);

  const Nr = rad(N), ir = rad(inc), vw = v + rad(w);
  const cN = Math.cos(Nr), sN = Math.sin(Nr), cI = Math.cos(ir), sI = Math.sin(ir);
  const cv = Math.cos(vw), sv = Math.sin(vw);
  const xh = r * (cN * cv - sN * sv * cI);
  const yh = r * (sN * cv + cN * sv * cI);
  const zh = r * (sv * sI);
  let lon = Math.atan2(yh, xh);
  let lat = Math.atan2(zh, Math.hypot(xh, yh));

  const Lm = M + w + N;
  const D = Lm - (Ms + ws);
  const F = Lm - N;
  const sin = (deg) => Math.sin(rad(deg));
  const cos = (deg) => Math.cos(rad(deg));
  lon += rad(-1.274 * sin(M - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms));
  lat += rad(-0.173 * sin(F - 2 * D));
  r += -0.58 * cos(M - 2 * D) - 0.46 * cos(2 * D);
  return {
    x: r * Math.cos(lon) * Math.cos(lat),
    y: r * Math.sin(lon) * Math.cos(lat),
    z: r * Math.sin(lat),
    r,
  };
}

/** Build a THREE.Matrix4 from the data file's row-major 3x3. */
function mat3to4(m) {
  return new THREE.Matrix4().set(
    m[0][0], m[0][1], m[0][2], 0,
    m[1][0], m[1][1], m[1][2], 0,
    m[2][0], m[2][1], m[2][2], 0,
    0, 0, 0, 1);
}

/** Solve Kepler's equation; returns the heliocentric ecliptic position in au. */
function positionAt(p, T) {
  const e0 = p.elements_j2000, rt = p.rates_per_century;
  const a = e0.a_au + rt.a_au * T;
  const e = e0.e + rt.e * T;
  const I = (e0.I_deg + rt.I_deg * T) * Math.PI / 180;
  const L = e0.L_deg + rt.L_deg * T;
  const lp = e0.long_peri_deg + rt.long_peri_deg * T;
  const node = (e0.long_node_deg + rt.long_node_deg * T) * Math.PI / 180;
  const w = (lp - (e0.long_node_deg + rt.long_node_deg * T)) * Math.PI / 180;
  let M = ((L - lp + 180) % 360 + 360) % 360 - 180;
  M *= Math.PI / 180;
  let E = M;
  for (let i = 0; i < 40; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cI = Math.cos(I), sI = Math.sin(I);
  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(node), sO = Math.sin(node);
  return new THREE.Vector3(
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp);
}

function uniformsFrom(defaults, maps = {}) {
  const u = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (Array.isArray(v)) {
      u[k] = { value: v.length === 2 ? new THREE.Vector2(v[0], v[1]) : new THREE.Vector3(v[0], v[1], v[2]) };
    } else {
      u[k] = { value: v };
    }
  }
  for (const [k, v] of Object.entries(maps)) u[k] = { value: v };
  return u;
}

export async function addTo(scene, opts = {}) {
  const {
    baseUrl = './data',
    textureUrl = './textures',
    unitsPerAu = 1,
    orbitOpacity = 0.55,
    visible = true,
    scaleLevel = 'solar',      // 'solar' meshes bodies; anything else collapses them
    renderer = null,           // pass the WebGLRenderer to get anisotropic filtering
  } = opts;

  const data = await loadJSON('solarsystem', { baseUrl });
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;

  // tools/inline.py populates globalThis.__UM_TEXTURES with data: URLs for a
  // single-file build; otherwise the textures are fetched from textureUrl.
  function texURL(file) {
    const inlined = globalThis.__UM_TEXTURES;
    return (inlined && inlined[file]) ? inlined[file] : `${textureUrl}/${file}`;
  }

  function tex(file, srgb = true) {
    const t = loader.load(texURL(file));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = maxAniso;
    return t;
  }

  const group = new THREE.Group();
  group.name = 'solarsystem';
  // seat the ecliptic frame inside the supergalactic one
  group.applyMatrix4(mat3to4(data.frames.ecliptic_to_supergalactic));

  const AU = unitsPerAu;
  const KM_TO_AU = 1 / data.au_km;
  // Scene units per Earth equatorial radius. The Moon's theory is in these radii.
  const radiiToScene = EARTH_EQ_KM * KM_TO_AU * AU;

  const litMaterials = [];
  function planetMaterial(map) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uSunPosition: { value: new THREE.Vector3() },
        uAmbient: { value: PLANET_AMBIENT },
      },
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
    });
    litMaterials.push(mat);
    return mat;
  }
  function moonMaterial(map, normalMap) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uNormal: { value: normalMap },
        uSunPosition: { value: new THREE.Vector3() },
        uAmbient: { value: 0.06 },
        uNormalScale: { value: 1.0 },
      },
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
    });
    litMaterials.push(mat);
    return mat;
  }

  // ---- Sun: photosphere + corona, built at true size and scaled per view ----
  const photosphereRadius = data.sun.radius_km * KM_TO_AU * AU;
  const sunRoot = new THREE.Group();
  sunRoot.name = 'solarsystem.sunRoot';
  const sunMat = new THREE.ShaderMaterial({
    uniforms: uniformsFrom(DEFAULTS.sunPhotosphere, { uMapSun: tex('sun_2k.jpg') }),
    vertexShader: SHADERS.sunPhotosphere.vert,
    fragmentShader: SHADERS.sunPhotosphere.frag,
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(photosphereRadius, 64, 48), sunMat);
  sun.name = 'solarsystem.sun';

  const coronaU = uniformsFrom(DEFAULTS.sunCorona);
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(photosphereRadius * DEFAULTS.sunCorona.uShellRadius, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: coronaU,
      vertexShader: SHADERS.sunCorona.vert,
      fragmentShader: SHADERS.sunCorona.frag,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.BackSide,
    }));
  corona.name = 'solarsystem.corona';
  sunRoot.add(sun, corona);
  group.add(sunRoot);

  // ---- orbits ----
  const orbits = {};
  for (const [name, p] of Object.entries(data.planets)) {
    const pts = p.orbit_ecliptic_au.map(q => new THREE.Vector3(q[0] * AU, q[1] * AU, q[2] * AU));
    pts.push(pts[0].clone());
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: ORBIT_COLOR[name] ?? 0xffffff,
                                    transparent: true, opacity: orbitOpacity }));
    line.name = `solarsystem.orbit.${name}`;
    orbits[name] = line;
    group.add(line);
  }

  // ---- planets (geometry is true size; the view scales the node) ----
  const bodies = {};
  const earthLayers = {};
  for (const [name, p] of Object.entries(data.planets)) {
    const R = p.radius_km * KM_TO_AU * AU;
    const node = new THREE.Group();
    node.name = `solarsystem.${name}`;
    node.rotation.z = THREE.MathUtils.degToRad(p.axial_tilt_deg);

    if (name === 'Earth') {
      const maps = {
        uMapDay:        tex('earth_day_4k.jpg'),
        uMapNight:      tex('earth_night_4k.jpg'),
        uMapNormal:     tex('earth_normal_2k.png', false),
        uMapSpecular:   tex('earth_specular_2k.jpg', false),
        uMapCloudAlpha: tex('earth_clouds_alpha_4k.jpg', false),
      };
      const surf = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64),
        new THREE.ShaderMaterial({
          uniforms: uniformsFrom(DEFAULTS.earthSurface, maps),
          vertexShader: SHADERS.earthSurface.vert,
          fragmentShader: SHADERS.earthSurface.frag,
        }));
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(R * (1 + DEFAULTS.earthSurface.uCloudShellHeight), 96, 64),
        new THREE.ShaderMaterial({
          uniforms: uniformsFrom(DEFAULTS.earthClouds, {
            uMapClouds: tex('earth_clouds_4k.jpg'),
            uMapCloudAlpha: maps.uMapCloudAlpha,
          }),
          vertexShader: SHADERS.earthClouds.vert,
          fragmentShader: SHADERS.earthClouds.frag,
          transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
        }));
      const mkAtmo = (defs, radius, side) => new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 48),
        new THREE.ShaderMaterial({
          uniforms: uniformsFrom(defs),
          vertexShader: SHADERS.earthAtmosphere.vert,
          fragmentShader: SHADERS.earthAtmosphere.frag,
          transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, side,
        }));
      const inner = mkAtmo(DEFAULTS.earthAtmosphereInner, R * 1.025, THREE.BackSide);
      const outer = mkAtmo(DEFAULTS.earthAtmosphereOuter, R * 1.09, THREE.FrontSide);
      node.add(surf, clouds, inner, outer);
      // The published atmosphere gains plus the page bloom turn the limb into a
      // halo and make the day side flicker as bright pixels cross the threshold.
      if (surf.material.uniforms.uNightIntensity) surf.material.uniforms.uNightIntensity.value = 0.55;
      if (inner.material.uniforms.uIntensity) inner.material.uniforms.uIntensity.value = 0.45;
      if (outer.material.uniforms.uIntensity) outer.material.uniforms.uIntensity.value = 0.28;
      if (outer.material.uniforms.uRimGain) outer.material.uniforms.uRimGain.value = 0.45;
      earthLayers.surface = surf; earthLayers.clouds = clouds;
      earthLayers.atmoInner = inner; earthLayers.atmoOuter = outer;
    } else {
      const m = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), planetMaterial(tex(TEX[name])));
      node.add(m);
      if (name === 'Saturn' && p.ring_radii_km) {
        const [ri, ro] = p.ring_radii_km.map(k => k * KM_TO_AU * AU);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(ri, ro, 128),
          new THREE.MeshBasicMaterial({ map: tex('saturn_ring_alpha_1k.png'),
                                        transparent: true, side: THREE.DoubleSide,
                                        depthWrite: false }));
        ring.rotation.x = Math.PI / 2;
        node.add(ring);
      }
    }
    bodies[name] = { node, radius: R, data: p };
    group.add(node);
  }

  // The Moon is not one of the eight planets and is not a child of Earth's node:
  // Earth's axial tilt and daily spin would drag it. The SVS color map is
  // centered on 0° longitude, which is the near side. SphereGeometry u=0.5
  // faces +X. three r160 Object3D.lookAt points a mesh's +Z at the target, and
  // a yaw of -pi/2 carries the mesh's +X onto that +Z, so the near side faces
  // Earth. lookAt is guarded because the Node stub's Object3D has none.
  const moonAnchor = new THREE.Group();
  moonAnchor.name = 'solarsystem.moonAnchor';
  const ringPts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * MOON_MEAN_A * radiiToScene,
                                    Math.sin(a) * MOON_MEAN_A * radiiToScene, 0));
  }
  const moonOrbit = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0xc8c2b4, transparent: true, opacity: 0.45 }));
  moonOrbit.name = 'solarsystem.moonOrbit';
  const moonPivot = new THREE.Group();
  moonPivot.name = 'solarsystem.moonPivot';
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS_KM * KM_TO_AU * AU, 96, 64),
    moonMaterial(tex(TEX.Moon), tex('moon_normal.png', false)));
  moonMesh.name = 'solarsystem.moon';
  moonMesh.rotation.y = -Math.PI / 2;
  moonPivot.add(moonMesh);
  moonAnchor.add(moonOrbit, moonPivot);
  group.add(moonAnchor);
  const moon = { anchor: moonAnchor, pivot: moonPivot, mesh: moonMesh, orbit: moonOrbit, geocentricRadii: 0 };

  const _sunW = new THREE.Vector3();
  const _earthW = new THREE.Vector3();
  const _sunDir = new THREE.Vector3();

  group.visible = visible;
  scene.add(group);

  let _T = 0;        // Julian centuries from J2000
  let _level = scaleLevel;
  let _viewMode = 'cinematic';

  function place(T) {
    for (const [name, b] of Object.entries(bodies)) {
      b.node.position.copy(positionAt(b.data, T).multiplyScalar(AU));
      const hours = b.data.rotation_period_hours;
      if (hours) b.node.children[0].rotation.y = (T * 36525 * 24 / hours) * Math.PI * 2;
    }
    const geo = moonGeocentric(T);
    moon.geocentricRadii = geo.r;
    moonAnchor.position.copy(bodies.Earth.node.position);
    moonPivot.position.set(geo.x * radiiToScene, geo.y * radiiToScene, geo.z * radiiToScene);
    orientMoon();
  }
  function orientMoon() {
    // The Node stub's Object3D has no lookAt and its Vector3 has no quaternion.
    if (typeof moonPivot.lookAt !== 'function') return;
    if (typeof group.updateMatrixWorld === 'function') group.updateMatrixWorld(true);
    bodies.Earth.node.getWorldPosition(_earthW);
    moonPivot.lookAt(_earthW);
  }
  function syncCoronaScale() {
    const world = photosphereRadius * sunRoot.scale.x * group.scale.x;
    coronaU.uPhotosphereRadius.value = world;
    coronaU.uShellRadius.value = world * DEFAULTS.sunCorona.uShellRadius;
  }
  function applyLevel(level) {
    _level = level;
    const earthView = level === 'earth';
    const solarView = level === 'solar';
    const meshed = earthView || solarView;
    const cinematic = solarView && _viewMode !== 'physical';
    const planetBoost = cinematic ? CINEMATIC_PLANET_BOOST : 1;
    const sunBoost = cinematic ? CINEMATIC_SUN_BOOST : 1;
    for (const b of Object.values(bodies)) {
      b.node.visible = meshed;
      b.node.scale.setScalar(planetBoost);
    }
    sunRoot.scale.setScalar(sunBoost);
    corona.visible = meshed && sunBoost > 1;
    sun.visible = meshed;
    for (const o of Object.values(orbits)) o.visible = solarView;
    // True lunar radius and geocentric orbit. Explore hides it; Research keeps it.
    moonAnchor.visible = earthView || (solarView && !cinematic);
    moonAnchor.scale.setScalar(1);
    // The mean-orbit ring is a line through the Earth when the camera is close.
    // The Earth step turns it on only after you scroll out toward the Moon.
    moon.orbit.visible = solarView && _viewMode === 'physical';
    syncCoronaScale();
    orientMoon();
  }
  /** World-space radius of the Earth mesh in the current presentation. */
  function earthSceneRadius() {
    return bodies.Earth.radius * bodies.Earth.node.scale.x * group.scale.x;
  }
  function setSunDirection(worldDir) {
    const d = worldDir.clone().normalize();
    for (const m of [earthLayers.surface, earthLayers.clouds,
                     earthLayers.atmoInner, earthLayers.atmoOuter]) {
      if (m && m.material.uniforms.uSunDirection) m.material.uniforms.uSunDirection.value.copy(d);
    }
  }
  function syncLighting() {
    if (typeof group.updateMatrixWorld === 'function') group.updateMatrixWorld(true);
    sun.getWorldPosition(_sunW);
    for (const m of litMaterials) m.uniforms.uSunPosition.value.copy(_sunW);
    bodies.Earth.node.getWorldPosition(_earthW);
    _sunDir.copy(_sunW).sub(_earthW);
    if (_sunDir.length() < 1e-12) _sunDir.set(1, 0, 0);
    else _sunDir.normalize();
    setSunDirection(_sunDir);
    orientMoon();
  }
  place(0);
  applyLevel(_level);
  syncLighting();

  return {
    group, bodies, orbits, sun, corona, sunRoot, earthLayers, data, moon,
    unitsPerAu, photosphereRadius,
    setVisible(v) { group.visible = v; },
    /** 'cinematic' enlarges the solar step. 'physical' keeps true radii. */
    setViewMode(mode) {
      _viewMode = mode === 'physical' ? 'physical' : 'cinematic';
      applyLevel(_level);
    },
    viewMode() { return _viewMode; },
    /** 'earth' or 'solar' mesh the bodies; any other level hides them. */
    setScaleLevel(level) { applyLevel(level); },
    /** T in Julian centuries from J2000; 0.01 = one year. */
    setTime(T) { _T = T; place(T); syncLighting(); },
    /** Drive the animated shaders. `seconds` is wall-clock, not simulation time. */
    update(seconds) {
      sunMat.uniforms.uTime.value = seconds;
      coronaU.uTime.value = seconds;
      if (earthLayers.clouds) {
        const r = (seconds * 0.004) % (Math.PI * 2);
        earthLayers.clouds.material.uniforms.uCloudRotation.value = r;
        earthLayers.surface.material.uniforms.uCloudRotation.value = r;
      }
      syncLighting();
    },
    /** World-space unit vector from the Earth toward the Sun. */
    setSunDirection,
    earthSceneRadius,
    setScale(unitsPerAuNew) {
      group.scale.setScalar(unitsPerAuNew / unitsPerAu);
      syncCoronaScale();
      orientMoon();
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const k of Object.keys(o.material.uniforms || {})) {
            const v = o.material.uniforms[k].value;
            if (v && v.isTexture) v.dispose();
          }
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    },
  };
}
