// ===========================================================================
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
