"""
cfpack.py - pack/unpack for the Universal Map binary payload.

The viewer page carries its geometry as a single base64 blob in
<script id="cf-data"> with a JSON offset table in <script id="cf-meta">.
This module reads and writes that pair, and builds new payloads for the
star / galaxy / dipole layers in the same convention.

Layout rules (reverse-engineered from the shipped page and verified by a
byte-identical repack of the original 1,945,412-byte buffer):

  * arrays are concatenated in the order they appear in meta["arrays"]
  * every array starts at an offset aligned UP to 8 bytes
  * the buffer ends at the end of the last array (no trailing padding)
  * all integers are little-endian

Quantization used by the shipped layers:

  positions   int16, world = value * 0.02           Mpc/h   (meta line_point_scale)
  normals     int8,  unit  = value / 127
  line speed  uint8, km/s  = value * 4.0            (meta line_speed_scale)
  indices     uint32
  basin ids   uint8, 255 = unassigned

Axes are supergalactic cartesian SGX/SGY/SGZ in Mpc/h with h = 0.75.
"""

from __future__ import annotations

import base64
import json
import re
from typing import Dict, Iterable, Mapping, Sequence, Tuple

import numpy as np

ALIGN = 8

DTYPES: Dict[str, np.dtype] = {
    "int8": np.dtype("<i1"),
    "uint8": np.dtype("<u1"),
    "int16": np.dtype("<i2"),
    "uint16": np.dtype("<u2"),
    "int32": np.dtype("<i4"),
    "uint32": np.dtype("<u4"),
    "float32": np.dtype("<f4"),
}

POS_SCALE = 0.02    # Mpc/h per int16 unit
NRM_SCALE = 1 / 127
SPEED_SCALE = 4.0   # km/s per uint8 unit

META_RE = re.compile(r'(<script id="cf-meta"[^>]*>)(.*?)(</script>)', re.S)
DATA_RE = re.compile(r'(<script id="cf-data"[^>]*>)(.*?)(</script>)', re.S)


# --------------------------------------------------------------------------- #
# core pack / unpack
# --------------------------------------------------------------------------- #
def unpack(meta: Mapping, buf: bytes) -> Dict[str, np.ndarray]:
    """Return a dict of numpy views over *buf* described by meta["arrays"]."""
    out: Dict[str, np.ndarray] = {}
    for name, spec in meta["arrays"].items():
        dt = DTYPES[spec["dtype"]]
        start = spec["offset"]
        stop = start + spec["length"] * dt.itemsize
        if stop > len(buf):
            raise ValueError(f"{name}: needs {stop} bytes, buffer has {len(buf)}")
        out[name] = np.frombuffer(buf[start:stop], dtype=dt)
    return out


def pack(arrays: "Sequence[Tuple[str, np.ndarray]] | Mapping[str, np.ndarray]"
         ) -> Tuple[Dict[str, dict], bytes]:
    """Concatenate arrays with 8-byte alignment.

    Returns (table, buffer) where *table* is the meta["arrays"] mapping.
    Insertion order of *arrays* is the buffer order.
    """
    items = list(arrays.items()) if isinstance(arrays, Mapping) else list(arrays)
    table: Dict[str, dict] = {}
    chunks: list[bytes] = []
    off = 0
    for name, arr in items:
        arr = np.ascontiguousarray(arr)
        key = arr.dtype.name
        if key not in DTYPES:
            raise ValueError(f"{name}: unsupported dtype {arr.dtype}")
        pad = (-off) % ALIGN
        if pad:
            chunks.append(b"\x00" * pad)
            off += pad
        table[name] = {"offset": off, "dtype": key, "length": int(arr.size)}
        raw = arr.astype(DTYPES[key], copy=False).tobytes()
        chunks.append(raw)
        off += len(raw)
    return table, b"".join(chunks)


# --------------------------------------------------------------------------- #
# quantization helpers
# --------------------------------------------------------------------------- #
def quant_pos(xyz: np.ndarray, scale: float = POS_SCALE) -> np.ndarray:
    """Mpc/h float -> int16, flattened. Raises if the value would clip."""
    q = np.rint(np.asarray(xyz, dtype=np.float64) / scale)
    lo, hi = q.min(), q.max()
    if lo < -32768 or hi > 32767:
        raise ValueError(
            f"position out of int16 range at scale {scale}: [{lo}, {hi}] "
            f"(max |value| = {32767 * scale:g} Mpc/h)"
        )
    return q.astype(np.int16).ravel()


def dequant_pos(q: np.ndarray, scale: float = POS_SCALE) -> np.ndarray:
    return np.asarray(q, dtype=np.float32) * scale


def quant_nrm(n: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(np.asarray(n) * 127), -127, 127).astype(np.int8).ravel()


def quant_speed(v: np.ndarray, scale: float = SPEED_SCALE) -> np.ndarray:
    return np.clip(np.rint(np.asarray(v) / scale), 0, 255).astype(np.uint8).ravel()


# --------------------------------------------------------------------------- #
# HTML payload I/O
# --------------------------------------------------------------------------- #
def read_html(path: str) -> Tuple[dict, bytes]:
    """Extract (meta, buffer) from a viewer HTML file."""
    with open(path, encoding="utf-8") as fh:
        html = fh.read()
    m_meta = META_RE.search(html)
    m_data = DATA_RE.search(html)
    if not (m_meta and m_data):
        raise ValueError(f"{path}: cf-meta / cf-data scripts not found")
    return json.loads(m_meta.group(2).strip()), base64.b64decode(m_data.group(2).strip())


def write_html(src: str, dst: str, meta: Mapping, buf: bytes) -> None:
    """Copy *src* to *dst*, replacing the cf-meta / cf-data payload."""
    with open(src, encoding="utf-8") as fh:
        html = fh.read()
    meta_txt = json.dumps(meta, separators=(",", ":"))
    data_txt = base64.b64encode(buf).decode("ascii")
    html = META_RE.sub(lambda m: m.group(1) + meta_txt + m.group(3), html, count=1)
    html = DATA_RE.sub(lambda m: m.group(1) + data_txt + m.group(3), html, count=1)
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(html)


def write_pair(stem: str, meta_extra: Mapping, arrays) -> Tuple[dict, int]:
    """Write an external <stem>.bin + <stem>.json layer pair.

    The JSON mirrors cf-meta: {"arrays": {...}, **meta_extra}.
    Returns (meta, byte length).
    """
    table, buf = pack(arrays)
    meta = dict(meta_extra)
    meta["arrays"] = table
    meta["bytes"] = len(buf)
    with open(stem + ".bin", "wb") as fh:
        fh.write(buf)
    with open(stem + ".json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    return meta, len(buf)


def read_pair(stem: str) -> Tuple[dict, Dict[str, np.ndarray]]:
    with open(stem + ".json", encoding="utf-8") as fh:
        meta = json.load(fh)
    with open(stem + ".bin", "rb") as fh:
        buf = fh.read()
    return meta, unpack(meta, buf)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _info(path: str) -> None:
    meta, buf = read_html(path)
    print(f"{path}\n  buffer {len(buf):,} bytes, {len(meta['arrays'])} arrays, "
          f"units {meta.get('units')} axes {meta.get('axes')}")
    for name, spec in meta["arrays"].items():
        n = spec["length"] * DTYPES[spec["dtype"]].itemsize
        print(f"    {name:<16} {spec['dtype']:>7} x {spec['length']:>8,}  "
              f"@{spec['offset']:>9,}  {n:>10,} B")


def _verify(path: str) -> int:
    """Repack the shipped payload and assert it is byte-identical."""
    meta, buf = read_html(path)
    arrs = unpack(meta, buf)
    table, rebuilt = pack(list(arrs.items()))
    same_tbl = table == meta["arrays"]
    same_buf = rebuilt == buf
    print(f"offset table reproduced : {same_tbl}")
    print(f"buffer byte-identical   : {same_buf} ({len(rebuilt):,} vs {len(buf):,} bytes)")
    return 0 if (same_tbl and same_buf) else 1


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3 or sys.argv[1] not in ("info", "verify"):
        print("usage: cfpack.py {info|verify} <viewer.html>")
        raise SystemExit(2)
    if sys.argv[1] == "info":
        _info(sys.argv[2]); raise SystemExit(0)
    raise SystemExit(_verify(sys.argv[2]))
