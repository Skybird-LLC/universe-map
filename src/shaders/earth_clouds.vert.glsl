// ===========================================================================
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
