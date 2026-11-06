// ===========================================================================
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
