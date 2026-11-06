/**
 * loader.js - fetch and decode the Universal Map external layer pairs.
 *
 * Each layer ships as `<stem>.bin` + `<stem>.json`. The JSON mirrors the page's
 * own `cf-meta` block: an `arrays` table of {offset, dtype, length} plus whatever
 * per-layer metadata the module needs. Arrays are concatenated into the buffer in
 * table order, each starting at an offset aligned up to 8 bytes, little-endian.
 *
 * Views are created over the SAME ArrayBuffer - no copies - exactly as the inline
 * payload does with `atob`.
 *
 * NOTE: external files require the page to be served over http://. A file:// load
 * cannot fetch them; run tools/inline.py to fold the pairs back into base64
 * <script> blocks for a single-file build.
 */

const CTORS = {
  int8: Int8Array, uint8: Uint8Array,
  int16: Int16Array, uint16: Uint16Array,
  int32: Int32Array, uint32: Uint32Array,
  float32: Float32Array,
};

/** Create typed-array views described by `meta.arrays` over `buffer`. */
export function decodeArrays(meta, buffer) {
  const out = {};
  for (const [name, spec] of Object.entries(meta.arrays)) {
    const Ctor = CTORS[spec.dtype];
    if (!Ctor) throw new Error(`loader: unknown dtype "${spec.dtype}" for array "${name}"`);
    const bytes = spec.length * Ctor.BYTES_PER_ELEMENT;
    if (spec.offset + bytes > buffer.byteLength) {
      throw new Error(
        `loader: array "${name}" needs ${spec.offset + bytes} bytes, buffer has ${buffer.byteLength}`);
    }
    out[name] = new Ctor(buffer, spec.offset, spec.length);
  }
  return out;
}

/** Decode a base64 string to an ArrayBuffer (the inline-payload path). */
export function base64ToBuffer(b64) {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Load one layer.
 *
 * Resolution order, so the same module works in both builds:
 *   1. an inline <script id="<stem>-meta"> / <script id="<stem>-data"> pair, if present
 *   2. otherwise fetch `${baseUrl}/${stem}.json` and `${baseUrl}/${stem}.bin`
 *
 * @returns {Promise<{meta: object, arrays: object}>}
 */
export async function loadLayer(stem, { baseUrl = './data' } = {}) {
  const inlineMeta = typeof document !== 'undefined' && document.getElementById(`${stem}-meta`);
  const inlineData = typeof document !== 'undefined' && document.getElementById(`${stem}-data`);
  if (inlineMeta && inlineData) {
    const meta = JSON.parse(inlineMeta.textContent);
    return { meta, arrays: decodeArrays(meta, base64ToBuffer(inlineData.textContent)) };
  }
  const [meta, buffer] = await Promise.all([
    fetch(`${baseUrl}/${stem}.json`).then(r => {
      if (!r.ok) throw new Error(`loader: ${stem}.json -> HTTP ${r.status}`);
      return r.json();
    }),
    fetch(`${baseUrl}/${stem}.bin`).then(r => {
      if (!r.ok) throw new Error(`loader: ${stem}.bin -> HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  return { meta, arrays: decodeArrays(meta, buffer) };
}

/** Load a plain JSON layer (dipole, solarsystem). */
export async function loadJSON(stem, { baseUrl = './data' } = {}) {
  const inline = typeof document !== 'undefined' && document.getElementById(`${stem}-meta`);
  if (inline) return JSON.parse(inline.textContent);
  const r = await fetch(`${baseUrl}/${stem}.json`);
  if (!r.ok) throw new Error(`loader: ${stem}.json -> HTTP ${r.status}`);
  return r.json();
}

/** Dequantize an int16 position array to a Float32Array of world units. */
export function dequantize(q, scale) {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
  return out;
}

/** Parse "#rrggbb" to a normalized [r, g, b] triple. */
export function hexToRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
