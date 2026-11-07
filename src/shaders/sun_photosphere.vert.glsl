// ===========================================================================
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
