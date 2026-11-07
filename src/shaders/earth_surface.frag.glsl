// ===========================================================================
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
