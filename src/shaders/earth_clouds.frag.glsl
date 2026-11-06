// ===========================================================================
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
