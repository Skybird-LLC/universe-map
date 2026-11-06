/**
 * src/shaders/index.js
 *
 * GENERATED from the sibling .glsl files - edit the .glsl, then regenerate.
 * Each shader is exported as a JS template string so the layer modules can
 * feed it straight to THREE.ShaderMaterial without a bundler GLSL plugin:
 *
 *   import { earthSurfaceVert, earthSurfaceFrag, DEFAULTS } from './shaders/index.js';
 *   const mat = new THREE.ShaderMaterial({
 *     vertexShader: earthSurfaceVert,
 *     fragmentShader: earthSurfaceFrag,
 *     uniforms: { ... }
 *   });
 *
 * Targets three.js r160. The sources are written in the ShaderMaterial GLSL
 * ES 1.00 dialect, which r160 also accepts under `glslVersion: THREE.GLSL3`
 * on WebGL2 via its own compatibility #defines. They use the three.js chunk
 * includes <tonemapping_fragment> and <colorspace_fragment>, which
 * ShaderMaterial resolves like any other material.
 *
 * Every uniform is documented in the header comment of its .glsl file; the
 * comments are preserved verbatim in these strings.
 */

export const earthSurfaceVert = /* glsl */ `// ===========================================================================
// earth_surface.vert.glsl - Universal Map / solar-system scale
//
// Vertex stage for the Earth surface pass. Builds a world-space TBN frame
// analytically from the sphere position (valid for an equirectangular
// SphereGeometry where +u runs east about the +Y axis), so no tangent
// attribute has to be generated on the CPU.
//
// UNIFORMS: none (uses only three.js built-ins).
//
// VARYINGS OUT
//   vUv          vec2  equirectangular texture coordinate
//   vPosW        vec3  world-space fragment position
//   vNormalW     vec3  world-space geometric normal
//   vTangentW    vec3  world-space tangent, pointing east (+u)
//   vBitangentW  vec3  world-space bitangent, = cross(N, T)
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vTangentW;
varying vec3 vBitangentW;

void main() {
    vUv = uv;

    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vPosW    = worldPos.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );

    // East-pointing tangent of a sphere of revolution about +Y.
    // Degenerates at the poles, where we fall back to +X.
    vec3 tObj = vec3( -position.z, 0.0, position.x );
    float tLen = length( tObj );
    tObj = ( tLen > 1e-5 ) ? ( tObj / tLen ) : vec3( 1.0, 0.0, 0.0 );

    vTangentW   = normalize( mat3( modelMatrix ) * tObj );
    // re-orthogonalise (Gram-Schmidt) so a non-uniform model scale cannot skew the frame
    vTangentW   = normalize( vTangentW - vNormalW * dot( vNormalW, vTangentW ) );
    vBitangentW = normalize( cross( vNormalW, vTangentW ) );

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const earthSurfaceFrag = /* glsl */ `// ===========================================================================
// earth_surface.frag.glsl - Universal Map / solar-system scale
//
// Multi-layer Earth SURFACE pass:
//   * day albedo
//   * tangent-space normal map
//   * GGX specular lobe gated by the ocean/specular mask (water only)
//   * night-lights emissive layer gated on the terminator (smooth N.L ramp)
//   * shadow cast onto the surface by the separately-rotating cloud shell
//
// Render as: THREE.ShaderMaterial, side: FrontSide, transparent: false.
// Pair with earth_surface.vert.glsl.
//
// UNIFORMS
//   uMapDay              sampler2D  earth_day_4k.jpg        sRGB albedo
//   uMapNight            sampler2D  earth_night_4k.jpg      sRGB city lights
//   uMapNormal           sampler2D  earth_normal_2k.png     NoColorSpace, tangent space
//   uMapSpecular         sampler2D  earth_specular_2k.jpg   NoColorSpace, .r = water mask
//   uMapCloudAlpha       sampler2D  earth_clouds_alpha_4k.jpg NoColorSpace, .r = cloud alpha
//   uSunDirection        vec3   world-space UNIT vector from the Earth toward the Sun
//   uSunColor            vec3   linear RGB radiance of the Sun (e.g. vec3(1.0,0.97,0.92))
//   uSunIntensity        float  scalar multiplier on direct lighting
//   uAmbient             float  flat ambient term added to the lit day side (0.01-0.06)
//   uNormalScale         vec2   XY strength of the tangent-space normal (e.g. vec2(0.85))
//   uSpecularStrength    float  overall specular gain (0 disables the lobe)
//   uRoughness           float  GGX roughness of water, 0.04-0.30; higher = broader sun glint
//   uWaterF0             float  Fresnel reflectance of water at normal incidence (~0.02)
//   uWaterMaskGamma      float  gamma applied to the mask to harden the land/sea edge (1-4)
//   uNightIntensity      float  emissive gain for the city lights
//   uNightTint           vec3   linear RGB tint for the city lights (warm sodium ~vec3(1.0,0.82,0.55))
//   uTerminatorSoftness  float  half-width in N.L of the day/night crossfade (0.02-0.25)
//   uCloudRotation       float  cloud-shell longitude offset, RADIANS (shared with the cloud pass)
//   uCloudShellHeight    float  cloud shell altitude as a fraction of the planet radius (~0.012)
//   uCloudShadowStrength float  0 = no cloud shadow, 1 = fully darkened under thick cloud
//   uCloudShadowUvScale  vec2   tangent-offset -> UV scale. Use vec2(1.0/(2.0*PI), -1.0/PI)
//                               for THREE.SphereGeometry; flip .y's sign if the shadow
//                               falls on the wrong side of the cloud in latitude.
//   uDayExposure         float  linear exposure on the day albedo before tone mapping
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

precision highp float;

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

uniform sampler2D uMapDay;
uniform sampler2D uMapNight;
uniform sampler2D uMapNormal;
uniform sampler2D uMapSpecular;
uniform sampler2D uMapCloudAlpha;

uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uAmbient;

uniform vec2  uNormalScale;
uniform float uSpecularStrength;
uniform float uRoughness;
uniform float uWaterF0;
uniform float uWaterMaskGamma;

uniform float uNightIntensity;
uniform vec3  uNightTint;
uniform float uTerminatorSoftness;

uniform float uCloudRotation;
uniform float uCloudShellHeight;
uniform float uCloudShadowStrength;
uniform vec2  uCloudShadowUvScale;

uniform float uDayExposure;

varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vTangentW;
varying vec3 vBitangentW;

// ---- GGX microfacet terms -------------------------------------------------
float distGGX( float nDotH, float a ) {
    float a2 = a * a;
    float d  = nDotH * nDotH * ( a2 - 1.0 ) + 1.0;
    return a2 / max( PI * d * d, 1e-7 );
}
// height-correlated Smith visibility (already contains the 1/(4 NoL NoV))
float visSmithGGX( float nDotV, float nDotL, float a ) {
    float a2 = a * a;
    float gv = nDotL * sqrt( nDotV * nDotV * ( 1.0 - a2 ) + a2 );
    float gl = nDotV * sqrt( nDotL * nDotL * ( 1.0 - a2 ) + a2 );
    return 0.5 / max( gv + gl, 1e-6 );
}
float fresnelSchlick( float vDotH, float f0 ) {
    return f0 + ( 1.0 - f0 ) * pow( clamp( 1.0 - vDotH, 0.0, 1.0 ), 5.0 );
}

void main() {
    // ---- frames ----------------------------------------------------------
    vec3 geoN = normalize( vNormalW );
    vec3 tanT = normalize( vTangentW );
    vec3 bitB = normalize( vBitangentW );
    mat3 tbn  = mat3( tanT, bitB, geoN );

    vec3 sampledN = texture2D( uMapNormal, vUv ).xyz * 2.0 - 1.0;
    sampledN.xy *= uNormalScale;
    vec3 shadeN   = normalize( tbn * normalize( sampledN ) );

    vec3 viewV = normalize( cameraPosition - vPosW );
    vec3 lightL = normalize( uSunDirection );
    vec3 halfH  = normalize( lightL + viewV );

    // Terminator is decided on the GEOMETRIC normal so that normal-map relief
    // cannot punch stray lit/unlit pixels through the day/night crossfade.
    float geoNdotL = dot( geoN, lightL );
    float nDotL    = max( dot( shadeN, lightL ), 0.0 );
    float nDotV    = max( dot( shadeN, viewV  ), 0.0 );
    float nDotH    = max( dot( shadeN, halfH  ), 0.0 );
    float vDotH    = max( dot( viewV,  halfH  ), 0.0 );

    // ---- cloud shadow ----------------------------------------------------
    // Look the cloud alpha up at the point where the sun ray entered the cloud
    // shell: shift the UV along the light direction expressed in tangent space,
    // by the shell height (a flat-slab parallax, cheap and good enough here).
    vec2 cloudUv = vec2( fract( vUv.x + uCloudRotation / TWO_PI ), vUv.y );
    vec3 lightT  = vec3( dot( lightL, tanT ), dot( lightL, bitB ), dot( lightL, geoN ) );
    vec2 shadowOffset = ( lightT.xy / max( lightT.z, 0.25 ) ) * uCloudShellHeight;
    float cloudAlpha  = texture2D( uMapCloudAlpha,
                                   cloudUv + shadowOffset * uCloudShadowUvScale ).r;
    // fade the shadow out at grazing sun angles where the parallax is meaningless
    float shadowFade  = smoothstep( 0.0, 0.25, geoNdotL );
    float cloudShadow = 1.0 - uCloudShadowStrength * cloudAlpha * shadowFade;

    // ---- day side --------------------------------------------------------
    vec3  dayAlbedo = texture2D( uMapDay, vUv ).rgb * uDayExposure;
    vec3  sunRad    = uSunColor * uSunIntensity;
    vec3  diffuse   = dayAlbedo * ( nDotL * cloudShadow + uAmbient );

    // ---- specular, water only -------------------------------------------
    float waterMask = texture2D( uMapSpecular, vUv ).r;
    waterMask = pow( clamp( waterMask, 0.0, 1.0 ), uWaterMaskGamma );
    float alphaR  = clamp( uRoughness, 0.02, 1.0 );
    alphaR = alphaR * alphaR;                       // perceptual -> GGX alpha
    float specD   = distGGX( nDotH, alphaR );
    float specV   = visSmithGGX( nDotV, nDotL, alphaR );
    float specF   = fresnelSchlick( vDotH, uWaterF0 );
    float specular = specD * specV * specF * nDotL * waterMask
                   * uSpecularStrength * cloudShadow;

    vec3 litColor = ( diffuse + vec3( specular ) ) * sunRad;

    // ---- night lights ----------------------------------------------------
    // Visible only where the GEOMETRIC normal faces away from the Sun, with a
    // soft band of half-width uTerminatorSoftness straddling N.L == 0.
    float dayMask   = smoothstep( -uTerminatorSoftness, uTerminatorSoftness, geoNdotL );
    float nightMask = 1.0 - dayMask;
    vec3  nightTex  = texture2D( uMapNight, vUv ).rgb;
    // squaring suppresses the low-level glow of the night map so only real
    // settlement lights survive, and clouds occlude them from above
    vec3  nightLights = nightTex * nightTex * uNightTint * uNightIntensity
                      * nightMask * ( 1.0 - 0.75 * cloudAlpha );

    vec3 outColor = litColor + nightLights;

    gl_FragColor = vec4( outColor, 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export const earthCloudsVert = /* glsl */ `// ===========================================================================
// earth_clouds.vert.glsl - rotating cloud shell (a sphere ~1.2% larger than
// the surface mesh). The shell rotates in the SHADER, not on the Object3D, so
// the surface pass can sample the same offset for its shadow term.
//
// UNIFORMS
//   uCloudRotation  float  longitude offset in RADIANS; the same value must be
//                          fed to earth_surface.frag.glsl.
//
// VARYINGS OUT
//   vUvCloud  vec2  UV already offset by uCloudRotation (wrapped into [0,1))
//   vPosW     vec3  world-space fragment position
//   vNormalW  vec3  world-space normal
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

#define TWO_PI 6.283185307179586

uniform float uCloudRotation;

varying vec2 vUvCloud;
varying vec3 vPosW;
varying vec3 vNormalW;

void main() {
    vUvCloud = vec2( fract( uv.x + uCloudRotation / TWO_PI ), uv.y );

    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vPosW    = worldPos.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const earthCloudsFrag = /* glsl */ `// ===========================================================================
// earth_clouds.frag.glsl - cloud shell for the multi-layer Earth.
//
// Render as: ShaderMaterial, transparent: true, depthWrite: false,
// side: FrontSide, blending: NormalBlending, renderOrder above the surface.
//
// UNIFORMS
//   uMapClouds          sampler2D  earth_clouds_4k.jpg        sRGB cloud colour
//   uMapCloudAlpha      sampler2D  earth_clouds_alpha_4k.jpg  NoColorSpace, .r = coverage
//   uSunDirection       vec3   world-space UNIT vector toward the Sun
//   uSunColor           vec3   linear RGB Sun radiance
//   uSunIntensity       float  scalar on direct lighting
//   (uCloudRotation is consumed by earth_clouds.vert.glsl, not here; the same value
//    must also reach earth_surface.frag.glsl so the cast shadow stays registered)
//   uCloudOpacity       float  master opacity of the shell (0-1)
//   uCloudBrightness    float  linear gain on the cloud colour
//   uTerminatorSoftness float  half-width in N.L of the day/night crossfade
//   uNightCloudTint     vec3   dim colour clouds keep on the unlit side (earthshine)
//   uForwardScatter     float  strength of the bright "silver lining" rim when the Sun is
//                              behind the cloud relative to the viewer (0-1)
//   uAmbient            float  flat ambient added to the lit cloud
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

precision highp float;

uniform sampler2D uMapClouds;
uniform sampler2D uMapCloudAlpha;

uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uCloudOpacity;
uniform float uCloudBrightness;
uniform float uTerminatorSoftness;
uniform vec3  uNightCloudTint;
uniform float uForwardScatter;
uniform float uAmbient;

varying vec2 vUvCloud;
varying vec3 vPosW;
varying vec3 vNormalW;

void main() {
    vec3 shellN = normalize( vNormalW );
    vec3 viewV  = normalize( cameraPosition - vPosW );
    vec3 lightL = normalize( uSunDirection );

    float nDotL = dot( shellN, lightL );
    float dayMask = smoothstep( -uTerminatorSoftness, uTerminatorSoftness, nDotL );

    float coverage = texture2D( uMapCloudAlpha, vUvCloud ).r;
    vec3  cloudRgb = texture2D( uMapClouds, vUvCloud ).rgb * uCloudBrightness;

    // Forward (Mie-like) scattering: the photon travels from the Sun along -L and
    // leaves toward the camera along +V, so forward scattering peaks at V ~ -L,
    // i.e. back-lit cloud. With dayMask this becomes the terminator silver lining.
    float forward = pow( clamp( -dot( viewV, lightL ), 0.0, 1.0 ), 8.0 ) * uForwardScatter;

    vec3 litCloud = cloudRgb * ( max( nDotL, 0.0 ) + uAmbient + forward )
                  * uSunColor * uSunIntensity;
    vec3 darkCloud = cloudRgb * uNightCloudTint;

    vec3 outColor = mix( darkCloud, litCloud, dayMask );

    // Clouds must not stay fully opaque on the night side or they read as a
    // grey disc; keep a little so they still occlude the city lights' halo.
    float alphaOut = coverage * uCloudOpacity * mix( 0.55, 1.0, dayMask );

    gl_FragColor = vec4( outColor, clamp( alphaOut, 0.0, 1.0 ) );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export const earthAtmosphereVert = /* glsl */ `// ===========================================================================
// earth_atmosphere.vert.glsl - shared vertex stage for BOTH additive
// atmosphere shells (inner dense shell and outer thin halo).
//
// UNIFORMS: none (uses only three.js built-ins).
//
// VARYINGS OUT
//   vPosW     vec3  world-space fragment position
//   vNormalW  vec3  world-space outward normal of the shell geometry
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

varying vec3 vPosW;
varying vec3 vNormalW;

void main() {
    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vPosW    = worldPos.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const earthAtmosphereFrag = /* glsl */ `// ===========================================================================
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
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
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
`;

export const sunPhotosphereVert = /* glsl */ `// ===========================================================================
// sun_photosphere.vert.glsl - vertex stage for the fiery Sun surface.
//
// Passes the OBJECT-space position through as well as the world-space one:
// the fBm field is evaluated in object space so the granulation rides with
// the Sun's own rotation instead of swimming when the object is moved.
//
// UNIFORMS: none (uses only three.js built-ins).
//
// VARYINGS OUT
//   vUv       vec2  equirectangular UV for uMapSun
//   vPosObj   vec3  object-space position (unit sphere -> unit direction)
//   vPosW     vec3  world-space position
//   vNormalW  vec3  world-space normal
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

varying vec2 vUv;
varying vec3 vPosObj;
varying vec3 vPosW;
varying vec3 vNormalW;

void main() {
    vUv     = uv;
    vPosObj = position;

    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vPosW    = worldPos.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const sunPhotosphereFrag = /* glsl */ `// ===========================================================================
// sun_photosphere.frag.glsl - fiery Sun photosphere.
//
//   * animated domain-warped fBm (written inline below, no library assumed)
//     modulating the sun_2k.jpg photosphere texture
//   * black-body colour ramp, so what reaches UnrealBloomPass is a plausible
//     hot colour rather than a flat orange
//   * limb darkening, I(mu)/I(0) = 1 - a1(1-mu) - a2(1-mu)^2
//
// Render as: ShaderMaterial, side: FrontSide, transparent: false,
// depthWrite: true, toneMapped as the app prefers. The output is deliberately
// > 1.0 so that the bloom pass has something to pick up.
//
// UNIFORMS
//   uMapSun              sampler2D  sun_2k.jpg, THREE.SRGBColorSpace
//   uTime                float  seconds; drives the convective animation
//   uActivity            float  0 = quiet Sun, 1 = very active. Raises the granulation
//                               contrast, the temperature spread and the spot depth.
//   uBloomGain           float  final linear multiplier; THIS is the knob that decides
//                               how hard the photosphere drives UnrealBloomPass.
//   uNoiseScale          float  spatial frequency of the first fBm octave (~3-8)
//   uFlowSpeed           float  animation rate of the convective field
//   uWarpStrength        float  domain-warp amount; 0 = plain fBm, 0.6-1.4 = churning
//   uGranulationContrast float  how strongly the noise modulates brightness (0-1)
//   uTextureMix          float  0 = pure procedural, 1 = pure uMapSun luminance
//   uTempBase            float  mean photospheric temperature in K (5778 for the Sun)
//   uTempSpread          float  +/- temperature excursion in K driven by the noise (~900)
//   uLimbDarkA1          float  linear limb-darkening coefficient (~0.30 at 550 nm)
//   uLimbDarkA2          float  quadratic limb-darkening coefficient (~0.23)
//   uSpotThreshold       float  noise value above which a dark "spot" forms (0.4-0.8)
//   uSpotDarkness        float  0 = no spots, 1 = spots go to the floor temperature
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

precision highp float;

uniform sampler2D uMapSun;
uniform float uTime;
uniform float uActivity;
uniform float uBloomGain;
uniform float uNoiseScale;
uniform float uFlowSpeed;
uniform float uWarpStrength;
uniform float uGranulationContrast;
uniform float uTextureMix;
uniform float uTempBase;
uniform float uTempSpread;
uniform float uLimbDarkA1;
uniform float uLimbDarkA2;
uniform float uSpotThreshold;
uniform float uSpotDarkness;

varying vec2 vUv;
varying vec3 vPosObj;
varying vec3 vPosW;
varying vec3 vNormalW;

// ---------------------------------------------------------------------------
// Inline 3D value noise + fBm. Written out in full on purpose: no GLSL noise
// library is assumed to be present. hash31 is a cheap integer-free hash; it is
// deterministic per lattice point, so the field is stable frame to frame and
// only moves because we move the sample point.
// ---------------------------------------------------------------------------
float hash31( vec3 p ) {
    p = fract( p * 0.1031 );
    p += dot( p, p.zyx + 31.32 );
    return fract( ( p.x + p.y ) * p.z );
}

float valueNoise3( vec3 p ) {
    vec3 iP = floor( p );
    vec3 fP = fract( p );
    vec3 wP = fP * fP * ( 3.0 - 2.0 * fP );          // smoothstep interpolant

    float n000 = hash31( iP + vec3( 0.0, 0.0, 0.0 ) );
    float n100 = hash31( iP + vec3( 1.0, 0.0, 0.0 ) );
    float n010 = hash31( iP + vec3( 0.0, 1.0, 0.0 ) );
    float n110 = hash31( iP + vec3( 1.0, 1.0, 0.0 ) );
    float n001 = hash31( iP + vec3( 0.0, 0.0, 1.0 ) );
    float n101 = hash31( iP + vec3( 1.0, 0.0, 1.0 ) );
    float n011 = hash31( iP + vec3( 0.0, 1.0, 1.0 ) );
    float n111 = hash31( iP + vec3( 1.0, 1.0, 1.0 ) );

    float nx00 = mix( n000, n100, wP.x );
    float nx10 = mix( n010, n110, wP.x );
    float nx01 = mix( n001, n101, wP.x );
    float nx11 = mix( n011, n111, wP.x );
    float nxy0 = mix( nx00, nx10, wP.y );
    float nxy1 = mix( nx01, nx11, wP.y );
    return mix( nxy0, nxy1, wP.z ) * 2.0 - 1.0;      // -> [-1,1]
}

// Per-octave rotation kills the axis-aligned grid artefacts of value noise.
const mat3 FBM_ROT = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64
);

#define FBM_OCTAVES 5

float fbm3( vec3 p ) {
    float amp = 0.5;
    float sum = 0.0;
    float norm = 0.0;
    for ( int i = 0; i < FBM_OCTAVES; i++ ) {
        sum  += amp * valueNoise3( p );
        norm += amp;
        p = FBM_ROT * p * 2.02;
        amp *= 0.5;
    }
    return sum / max( norm, 1e-6 );                   // -> about [-1,1]
}

// ---------------------------------------------------------------------------
// Planckian-locus approximation (Tanner Helland / Neil Bartlett form), valid
// for roughly 1000 K - 40000 K. It returns an *sRGB-encoded* colour, so we
// linearise it before it is used as radiance.
// ---------------------------------------------------------------------------
vec3 blackbodySRGB( float kelvin ) {
    float t = clamp( kelvin, 1000.0, 40000.0 ) / 100.0;
    float r, g, b;
    if ( t <= 66.0 ) {
        r = 1.0;
        g = 0.3900815788 * log( max( t, 1.0 ) ) - 0.6318414438;
    } else {
        r = 1.292936186 * pow( t - 60.0, -0.1332047592 );
        g = 1.129890861 * pow( t - 60.0, -0.0755148492 );
    }
    if ( t >= 66.0 ) {
        b = 1.0;
    } else if ( t <= 19.0 ) {
        b = 0.0;
    } else {
        b = 0.5432067891 * log( t - 10.0 ) - 1.19625408;
    }
    return clamp( vec3( r, g, b ), 0.0, 1.0 );
}

vec3 blackbodyLinear( float kelvin ) {
    vec3 c = blackbodySRGB( kelvin );
    return pow( c, vec3( 2.2 ) );                     // sRGB -> linear, approximate
}

void main() {
    vec3 dirObj = normalize( vPosObj );
    float tFlow = uTime * uFlowSpeed;

    // ---- domain-warped fBm ------------------------------------------------
    // First pass gives a slow, large-scale distortion field (supergranulation);
    // the second pass is sampled through it, which is what produces the
    // characteristic churning / boiling look.
    vec3 pBase = dirObj * uNoiseScale;
    vec3 warp = vec3(
        fbm3( pBase + vec3(  0.00,  0.00, tFlow        ) ),
        fbm3( pBase + vec3( 17.31,  4.77, tFlow * 1.13 ) ),
        fbm3( pBase + vec3(  9.42, 23.08, tFlow * 0.87 ) )
    );
    float granulation = fbm3( pBase + warp * uWarpStrength + vec3( 0.0, 0.0, tFlow * 0.5 ) );

    // activity widens the excursions without changing the mean
    float activity = clamp( uActivity, 0.0, 1.0 );
    float contrast = uGranulationContrast * mix( 0.6, 1.6, activity );
    float nSigned = clamp( granulation * contrast, -1.0, 1.0 );

    // ---- sunspots ---------------------------------------------------------
    // A second, lower-frequency field thresholded hard: where it is high we
    // pull the local temperature down toward the umbral floor.
    float spotField = fbm3( pBase * 0.45 + warp * 0.35 + vec3( 61.7, 11.3, tFlow * 0.25 ) );
    float spot = smoothstep( uSpotThreshold, uSpotThreshold + 0.18, spotField )
               * uSpotDarkness * mix( 0.25, 1.0, activity );

    // ---- temperature -> colour -------------------------------------------
    float kelvin = uTempBase + nSigned * uTempSpread * mix( 0.7, 1.5, activity );
    kelvin = mix( kelvin, uTempBase - 1800.0, spot );   // umbra is ~1500-2000 K cooler
    vec3 bodyColor = blackbodyLinear( kelvin );

    // ---- texture modulation ----------------------------------------------
    // The texture supplies real surface structure; the noise supplies motion.
    // We take the texture's LUMINANCE as a brightness field and let the
    // black-body ramp own the hue, otherwise the two fight each other.
    vec3 texRgb = texture2D( uMapSun, vUv ).rgb;
    float texLum = dot( texRgb, vec3( 0.2126, 0.7152, 0.0722 ) );
    float brightness = mix( 1.0, texLum * 1.8, clamp( uTextureMix, 0.0, 1.0 ) );
    brightness *= ( 1.0 + nSigned * 0.45 ) * ( 1.0 - 0.80 * spot );

    // ---- limb darkening ---------------------------------------------------
    // mu = cos of the angle between the surface normal and the line of sight.
    vec3 viewV = normalize( cameraPosition - vPosW );
    float mu = clamp( dot( normalize( vNormalW ), viewV ), 0.0, 1.0 );
    float oneMinusMu = 1.0 - mu;
    float limb = 1.0 - uLimbDarkA1 * oneMinusMu - uLimbDarkA2 * oneMinusMu * oneMinusMu;
    limb = max( limb, 0.0 );

    vec3 outColor = bodyColor * brightness * limb * uBloomGain;

    gl_FragColor = vec4( max( outColor, vec3( 0.0 ) ), 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export const sunCoronaVert = /* glsl */ `// ===========================================================================
// sun_corona.vert.glsl - vertex stage for the corona / chromosphere shell.
//
// Also forwards the Sun's world-space CENTRE, because three.js does not inject
// modelMatrix into fragment shaders - only into vertex shaders - and the
// fragment stage needs the centre to work out each view ray's impact parameter
// (its apparent distance from the Sun's centre on the sky).
//
// UNIFORMS: none (uses only three.js built-ins).
//
// VARYINGS OUT
//   vPosW     vec3  world-space fragment position
//   vNormalW  vec3  world-space shell normal
//   vCenterW  vec3  world-space position of the shell's local origin
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vCenterW;

void main() {
    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vPosW    = worldPos.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );
    vCenterW = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const sunCoronaFrag = /* glsl */ `// ===========================================================================
// sun_corona.frag.glsl - corona / chromosphere shell for the fiery Sun.
//
// A sphere a little larger than the photosphere (1.15 - 1.8 R works), drawn
// additively so it never occludes the disc. Structure is outward-FLOWING fBm:
// the noise is sampled at a radial coordinate that decreases with time, so
// features appear to stream away from the limb. The angular part of the field
// dominates, which is what makes the structures read as radial streamers.
//
// Render as: ShaderMaterial, side: THREE.BackSide, blending:
// THREE.AdditiveBlending, transparent: true, depthWrite: false,
// depthTest: true. Draw after the photosphere.
//
// UNIFORMS
//   uTime               float  seconds; drives the outward flow
//   uActivity           float  0 = quiet, 1 = active. Raises streamer contrast,
//                              extent and the chromospheric temperature.
//   uBloomGain          float  final linear multiplier; the knob that sets how much
//                              the corona contributes to UnrealBloomPass.
//   uPhotosphereRadius  float  WORLD-space radius of the photosphere sphere. Used to
//                              turn the view ray's impact parameter into an apparent
//                              altitude in solar radii.
//   uShellRadius        float  WORLD-space radius of THIS shell; the glow is faded out
//                              as the apparent altitude approaches it.
//   uNoiseScale         float  angular frequency of the streamer field (~2-6)
//   uFlowSpeed          float  outward flow rate, solar radii per second
//   uWarpStrength       float  domain-warp amount applied to the streamer field
//   uStreamerSharpness  float  exponent applied to the noise; higher = thin, hard rays
//   uFalloffPower       float  radial falloff exponent of the glow (2-5)
//   uChromoThickness    float  thickness in solar radii of the dense red chromospheric
//                              band hugging the limb (~0.03)
//   uChromoTempK        float  chromosphere temperature in K for the black-body ramp
//                              (~4400 reads as the familiar red rim)
//   uCoronaTempK        float  corona colour temperature in K (~9000-13000 reads as the
//                              pale blue-white outer glow). NOTE: this is a *colour*
//                              choice; the real corona's MK temperature is not what
//                              sets its visible colour.
//   uOpacity            float  master gain on the whole shell (0-1+)
// ===========================================================================
// ---------------------------------------------------------------------------
// Dialect: three.js r160 ShaderMaterial source dialect (GLSL ES 1.00 syntax:
// \`varying\`, \`texture2D\`, \`gl_FragColor\`). This compiles unchanged on WebGL2:
// if the material is created with \`glslVersion: THREE.GLSL3\`, three.js r160
// prepends \`#define varying in|out\`, \`#define texture2D texture\` and
// \`#define gl_FragColor pc_fragColor\`, so the same text is valid GLSL ES 3.00.
// Do NOT declare position / normal / uv / modelMatrix / modelViewMatrix /
// projectionMatrix / viewMatrix / normalMatrix / cameraPosition - three.js
// injects all of them.
// Colour-space note: textures tagged THREE.SRGBColorSpace are uploaded as
// SRGB8_ALPHA8, so texture2D() already returns LINEAR values. Data maps
// (normal / specular / cloud alpha) must be tagged THREE.NoColorSpace.
// ---------------------------------------------------------------------------

precision highp float;

uniform float uTime;
uniform float uActivity;
uniform float uBloomGain;
uniform float uPhotosphereRadius;
uniform float uShellRadius;
uniform float uNoiseScale;
uniform float uFlowSpeed;
uniform float uWarpStrength;
uniform float uStreamerSharpness;
uniform float uFalloffPower;
uniform float uChromoThickness;
uniform float uChromoTempK;
uniform float uCoronaTempK;
uniform float uOpacity;

varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vCenterW;

// ---------------------------------------------------------------------------
// Inline 3D value noise + fBm. Written out in full on purpose: no GLSL noise
// library is assumed to be present. hash31 is a cheap integer-free hash; it is
// deterministic per lattice point, so the field is stable frame to frame and
// only moves because we move the sample point.
// ---------------------------------------------------------------------------
float hash31( vec3 p ) {
    p = fract( p * 0.1031 );
    p += dot( p, p.zyx + 31.32 );
    return fract( ( p.x + p.y ) * p.z );
}

float valueNoise3( vec3 p ) {
    vec3 iP = floor( p );
    vec3 fP = fract( p );
    vec3 wP = fP * fP * ( 3.0 - 2.0 * fP );          // smoothstep interpolant

    float n000 = hash31( iP + vec3( 0.0, 0.0, 0.0 ) );
    float n100 = hash31( iP + vec3( 1.0, 0.0, 0.0 ) );
    float n010 = hash31( iP + vec3( 0.0, 1.0, 0.0 ) );
    float n110 = hash31( iP + vec3( 1.0, 1.0, 0.0 ) );
    float n001 = hash31( iP + vec3( 0.0, 0.0, 1.0 ) );
    float n101 = hash31( iP + vec3( 1.0, 0.0, 1.0 ) );
    float n011 = hash31( iP + vec3( 0.0, 1.0, 1.0 ) );
    float n111 = hash31( iP + vec3( 1.0, 1.0, 1.0 ) );

    float nx00 = mix( n000, n100, wP.x );
    float nx10 = mix( n010, n110, wP.x );
    float nx01 = mix( n001, n101, wP.x );
    float nx11 = mix( n011, n111, wP.x );
    float nxy0 = mix( nx00, nx10, wP.y );
    float nxy1 = mix( nx01, nx11, wP.y );
    return mix( nxy0, nxy1, wP.z ) * 2.0 - 1.0;      // -> [-1,1]
}

// Per-octave rotation kills the axis-aligned grid artefacts of value noise.
const mat3 FBM_ROT = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64
);

#define FBM_OCTAVES 5

float fbm3( vec3 p ) {
    float amp = 0.5;
    float sum = 0.0;
    float norm = 0.0;
    for ( int i = 0; i < FBM_OCTAVES; i++ ) {
        sum  += amp * valueNoise3( p );
        norm += amp;
        p = FBM_ROT * p * 2.02;
        amp *= 0.5;
    }
    return sum / max( norm, 1e-6 );                   // -> about [-1,1]
}

// ---------------------------------------------------------------------------
// Planckian-locus approximation (Tanner Helland / Neil Bartlett form), valid
// for roughly 1000 K - 40000 K. It returns an *sRGB-encoded* colour, so we
// linearise it before it is used as radiance.
// ---------------------------------------------------------------------------
vec3 blackbodySRGB( float kelvin ) {
    float t = clamp( kelvin, 1000.0, 40000.0 ) / 100.0;
    float r, g, b;
    if ( t <= 66.0 ) {
        r = 1.0;
        g = 0.3900815788 * log( max( t, 1.0 ) ) - 0.6318414438;
    } else {
        r = 1.292936186 * pow( t - 60.0, -0.1332047592 );
        g = 1.129890861 * pow( t - 60.0, -0.0755148492 );
    }
    if ( t >= 66.0 ) {
        b = 1.0;
    } else if ( t <= 19.0 ) {
        b = 0.0;
    } else {
        b = 0.5432067891 * log( t - 10.0 ) - 1.19625408;
    }
    return clamp( vec3( r, g, b ), 0.0, 1.0 );
}

vec3 blackbodyLinear( float kelvin ) {
    vec3 c = blackbodySRGB( kelvin );
    return pow( c, vec3( 2.2 ) );                     // sRGB -> linear, approximate
}

// Fixed axis along which the radial coordinate is injected into the 3D noise
// field. Using a constant direction keeps the angular structure (the streamers)
// stationary while the radial coordinate animates them outward.
const vec3 FLOW_AXIS = vec3( 0.3105, 0.5742, 0.7571 );

void main() {
    // ---- apparent altitude above the photosphere -------------------------
    // Impact parameter of this view ray with respect to the Sun's centre:
    // the perpendicular distance from the centre to the ray, i.e. how far from
    // the middle of the disc this pixel lands on the sky.
    vec3 rayDir = normalize( vPosW - cameraPosition );
    vec3 toCenter = vCenterW - cameraPosition;
    float impact = length( cross( toCenter, rayDir ) );
    float altR = impact / max( uPhotosphereRadius, 1e-6 );   // in photospheric radii

    // Inside the disc the photosphere pass owns the pixel; outside the shell
    // there is nothing left to draw.
    float shellR = uShellRadius / max( uPhotosphereRadius, 1e-6 );
    float inner = smoothstep( 0.96, 1.01, altR );
    float outer = 1.0 - smoothstep( shellR * 0.80, shellR, altR );
    float band = inner * outer;
    if ( band <= 0.0 ) { discard; }

    float activity = clamp( uActivity, 0.0, 1.0 );

    // ---- outward-flowing, domain-warped streamer field --------------------
    vec3 dirSky = normalize( vPosW - vCenterW );
    // radial coordinate marching inward over time == features moving outward
    float rCoord = altR - uTime * uFlowSpeed;
    vec3 pBase = dirSky * uNoiseScale + FLOW_AXIS * rCoord;

    vec3 warp = vec3(
        fbm3( pBase + vec3(  0.00,  0.00,  0.00 ) ),
        fbm3( pBase + vec3( 13.77,  5.91,  2.13 ) ),
        fbm3( pBase + vec3(  7.19, 19.42, 31.06 ) )
    );
    float streamer = fbm3( pBase + warp * uWarpStrength );
    streamer = pow( clamp( streamer * 0.5 + 0.5, 0.0, 1.0 ),
                    max( uStreamerSharpness, 0.01 ) );
    streamer = mix( 0.35, 1.0, streamer ) * mix( 0.75, 1.35, activity );

    // ---- radial falloff ---------------------------------------------------
    float height = max( altR - 1.0, 0.0 );
    float falloff = 1.0 / ( 1.0 + pow( height * 6.0, max( uFalloffPower, 0.1 ) ) );

    // ---- chromosphere band + corona ---------------------------------------
    float chromo = 1.0 - smoothstep( 0.0, max( uChromoThickness, 1e-4 ), height );
    vec3 chromoColor = blackbodyLinear( uChromoTempK );
    vec3 coronaColor = blackbodyLinear( uCoronaTempK );
    vec3 tint = mix( coronaColor, chromoColor, chromo );

    // The chromospheric band is dense and smooth; streamers belong to the corona.
    float structure = mix( streamer, 1.6, chromo );

    vec3 outColor = tint * structure * falloff * band * uOpacity * uBloomGain;

    float alphaOut = clamp( max( outColor.r, max( outColor.g, outColor.b ) ), 0.0, 1.0 );
    gl_FragColor = vec4( max( outColor, vec3( 0.0 ) ), alphaOut );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/** Convenience map: logical shader name -> { vert, frag }. */
export const SHADERS = {
  earthSurface:    { vert: earthSurfaceVert,    frag: earthSurfaceFrag },
  earthClouds:     { vert: earthCloudsVert,     frag: earthCloudsFrag },
  earthAtmosphere: { vert: earthAtmosphereVert, frag: earthAtmosphereFrag },
  sunPhotosphere:  { vert: sunPhotosphereVert,  frag: sunPhotosphereFrag },
  sunCorona:       { vert: sunCoronaVert,       frag: sunCoronaFrag }
};

/**
 * Starting scalar values for the uniforms, as plain JS. vec2/vec3 values are
 * given as arrays - wrap them in THREE.Vector2 / THREE.Vector3 / THREE.Color
 * (Color for anything that is a colour) when you build the uniforms object.
 * These are starting points, not calibrated values: nothing here has been
 * checked against a render.
 */
export const DEFAULTS = {
  earthSurface: {
    uSunDirection: [1, 0, 0], uSunColor: [1.0, 0.97, 0.92], uSunIntensity: 1.6,
    uAmbient: 0.03, uNormalScale: [0.85, 0.85],
    uSpecularStrength: 2.2, uRoughness: 0.12, uWaterF0: 0.02, uWaterMaskGamma: 2.0,
    uNightIntensity: 2.0, uNightTint: [1.0, 0.82, 0.55], uTerminatorSoftness: 0.09,
    uCloudRotation: 0.0, uCloudShellHeight: 0.012, uCloudShadowStrength: 0.55,
    uCloudShadowUvScale: [1.0 / (2.0 * Math.PI), -1.0 / Math.PI],
    uDayExposure: 1.0
  },
  earthClouds: {
    uSunDirection: [1, 0, 0], uSunColor: [1.0, 0.97, 0.92], uSunIntensity: 1.6,
    uCloudRotation: 0.0, uCloudOpacity: 0.9, uCloudBrightness: 1.1,
    uTerminatorSoftness: 0.09, uNightCloudTint: [0.03, 0.04, 0.06],
    uForwardScatter: 0.6, uAmbient: 0.04
  },
  // inner dense shell: radius ~1.025 R, THREE.BackSide, uFaceSign -1
  earthAtmosphereInner: {
    uSunDirection: [1, 0, 0], uSunColor: [1.0, 0.97, 0.92], uSunIntensity: 1.6,
    uFaceSign: -1.0, uWavelengthNm: [680, 550, 440], uTint: [0.55, 0.72, 1.0],
    uDensity: 1.0, uRimPower: 3.0, uRimGain: 1.0, uRimBias: 0.03,
    uIntensity: 1.5, uNightGlow: 0.08, uTerminatorSoftness: 0.12
  },
  // outer thin halo: radius ~1.09 R, THREE.FrontSide, uFaceSign +1
  earthAtmosphereOuter: {
    uSunDirection: [1, 0, 0], uSunColor: [1.0, 0.97, 0.92], uSunIntensity: 1.6,
    uFaceSign: 1.0, uWavelengthNm: [680, 550, 440], uTint: [0.45, 0.65, 1.0],
    uDensity: 0.35, uRimPower: 6.0, uRimGain: 1.0, uRimBias: 0.0,
    uIntensity: 2.2, uNightGlow: 0.04, uTerminatorSoftness: 0.16
  },
  sunPhotosphere: {
    uTime: 0.0, uActivity: 0.5, uBloomGain: 2.4,
    uNoiseScale: 5.0, uFlowSpeed: 0.05, uWarpStrength: 0.9,
    uGranulationContrast: 0.6, uTextureMix: 0.6,
    uTempBase: 5778.0, uTempSpread: 900.0,
    uLimbDarkA1: 0.30, uLimbDarkA2: 0.23,
    uSpotThreshold: 0.55, uSpotDarkness: 0.7
  },
  sunCorona: {
    uTime: 0.0, uActivity: 0.5, uBloomGain: 1.8,
    uPhotosphereRadius: 1.0, uShellRadius: 1.6,
    uNoiseScale: 3.5, uFlowSpeed: 0.02, uWarpStrength: 0.7,
    uStreamerSharpness: 2.2, uFalloffPower: 3.0,
    uChromoThickness: 0.03, uChromoTempK: 4400.0, uCoronaTempK: 11000.0,
    uOpacity: 0.9
  }
};
