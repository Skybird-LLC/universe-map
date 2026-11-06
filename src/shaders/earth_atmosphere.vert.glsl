// ===========================================================================
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

varying vec3 vPosW;
varying vec3 vNormalW;

void main() {
    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vPosW    = worldPos.xyz;
    vNormalW = normalize( mat3( modelMatrix ) * normal );
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
