// ===========================================================================
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
