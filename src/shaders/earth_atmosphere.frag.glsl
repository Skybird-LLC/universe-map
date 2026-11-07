// ===========================================================================
// earth_atmosphere.frag.glsl - additive Rayleigh-style atmosphere shell.
//
// ONE shader, instantiated TWICE with different uniforms:
//
//   INNER DENSE SHELL   radius ~1.025 R   side: THREE.BackSide
//       We are outside the shell looking at the planet, so the fragments that
//       matter are the ones behind the globe silhouette plus the limb; drawing
//       back faces lets the shell hug the planet's edge without the near cap
//       washing the disc out. uRimPower ~ 3.0, uDensity ~ 1.0, uFaceSign = -1.0.
//
//   OUTER THIN HALO     radius ~1.09  R   side: THREE.FrontSide
//       A wide soft glow read from the front faces so it fades outward into
//       space. uRimPower ~ 6.0, uDensity ~ 0.35, uFaceSign = +1.0.
//
//   Both: blending THREE.AdditiveBlending, transparent true, depthWrite false,
//   depthTest true. Draw AFTER the surface and cloud passes. Output is HDR-ish
//   and is expected to be picked up by the scene's UnrealBloomPass.
//
// UNIFORMS
//   uSunDirection       vec3   world-space UNIT vector from the Earth toward the Sun
//   uSunColor           vec3   linear RGB Sun radiance
//   uSunIntensity       float  scalar on the scattered radiance
//   uFaceSign           float  +1.0 when rendering FrontSide, -1.0 when BackSide.
//                              Flips the interpolated normal so N always points at
//                              the viewer and the rim term keeps its meaning.
//   uWavelengthNm       vec3   RGB primary wavelengths in nm, e.g. vec3(680.0,550.0,440.0).
//                              Scattering is weighted by 1/lambda^4 (Rayleigh), normalised
//                              so the green channel is 1.0.
//   uTint               vec3   artistic multiplier on top of the Rayleigh weights
//   uDensity            float  optical-depth scale of this shell
//   uRimPower           float  exponent of the view-angle falloff; higher = thinner rim
//   uRimGain            float  multiplier on the rim term
//   uRimBias            float  constant floor added to the rim (faint full-disc glow)
//   uIntensity          float  final linear gain; this is the bloom-feeding knob
//   uNightGlow          float  fraction of the scattered colour surviving on the unlit
//                              side (0 = hard terminator, 0.05-0.15 reads well)
//   uTerminatorSoftness float  half-width in N.L of the day/night crossfade
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// `varying`, `texture2D`, `gl_FragColor`). This compiles unchanged on WebGL2:
// if the material is created with `glslVersion: THREE.GLSL3`, three.js r160
// prepends `#define varying in|out`, `#define texture2D texture` and
// `#define gl_FragColor pc_fragColor`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

precision highp float;

#define PI 3.141592653589793

uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uFaceSign;
uniform vec3  uWavelengthNm;
uniform vec3  uTint;
uniform float uDensity;
uniform float uRimPower;
uniform float uRimGain;
uniform float uRimBias;
uniform float uIntensity;
uniform float uNightGlow;
uniform float uTerminatorSoftness;

varying vec3 vPosW;
varying vec3 vNormalW;

void main() {
    // uFaceSign makes the shading independent of which face we rasterise.
    vec3 shellN = normalize( vNormalW ) * uFaceSign;
    vec3 viewV  = normalize( cameraPosition - vPosW );
    vec3 lightL = normalize( uSunDirection );

    // ---- Rayleigh wavelength weighting, beta ~ 1 / lambda^4 --------------
    vec3 lambdaUm = uWavelengthNm * 0.001;           // nm -> um, keeps the powers in range
    vec3 invL4 = 1.0 / ( lambdaUm * lambdaUm * lambdaUm * lambdaUm );
    vec3 betaR = invL4 / max( invL4.g, 1e-6 );       // normalise on green

    // ---- Rayleigh phase function, 3/(16 pi) (1 + cos^2 theta) ------------
    // theta is the angle between the incoming photon direction (-L) and the
    // outgoing direction (+V).
    float cosTheta = dot( -lightL, viewV );
    float phaseR = ( 3.0 / ( 16.0 * PI ) ) * ( 1.0 + cosTheta * cosTheta );

    // ---- view-angle rim falloff ------------------------------------------
    // 1 - N.V is 0 facing us and 1 at the silhouette, so a power of it is a
    // cheap stand-in for the longer optical path near the limb.
    float nDotV = clamp( dot( shellN, viewV ), 0.0, 1.0 );
    float rim = pow( 1.0 - nDotV, max( uRimPower, 0.01 ) ) * uRimGain + uRimBias;

    // ---- day/night gate ---------------------------------------------------
    float nDotL = dot( shellN, lightL );
    float dayMask = smoothstep( -uTerminatorSoftness, uTerminatorSoftness, nDotL );
    float sunGate = mix( uNightGlow, 1.0, dayMask );

    vec3 scattered = betaR * uTint * phaseR * rim * uDensity * sunGate
                   * uSunColor * uSunIntensity * uIntensity;

    // Additive blending in the usual (ONE, ONE) setup ignores alpha, but we
    // write a sensible value anyway so the material still behaves if the app
    // switches it to CustomBlending with SrcAlphaFactor.
    float alphaOut = clamp( max( scattered.r, max( scattered.g, scattered.b ) ), 0.0, 1.0 );

    gl_FragColor = vec4( max( scattered, vec3( 0.0 ) ), alphaOut );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
