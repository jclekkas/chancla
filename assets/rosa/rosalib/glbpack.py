"""Repack the exported GLB compactly (stdlib + numpy, no Blender needed).

- COLOR_0: unsigned byte, normalized VEC4 (core glTF), snapped to the palette.
- WEIGHTS_0: unsigned byte, normalized VEC4 summing to exactly 255 (core glTF).
- JOINTS_0: unsigned byte VEC4.
- NORMAL: signed byte, normalized (KHR_mesh_quantization, read natively by three's GLTFLoader).
- POSITION, _INK, inverse bind matrices: float32. Indices: uint16.
Everything else in the JSON (nodes, skin, scene extras, empties) is kept.
"""
import json
import struct

import numpy as np

from . import palette

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]
    b = d[28 + jl:28 + jl + bl]
    return j, b


def accessor(j, b, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']])
    n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', dt.itemsize * n)
    raw = np.frombuffer(b, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=off)
    out = np.empty((a['count'], n), dtype=dt)
    for k in range(a['count']):
        out[k] = np.frombuffer(raw[k * stride:k * stride + dt.itemsize * n].tobytes(), dtype=dt)
    arr = out.astype(np.float64)
    if a.get('normalized'):
        arr /= {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}[CT[a['componentType']]]
        if CT[a['componentType']] in (np.int8, np.int16):
            arr = np.maximum(arr, -1.0)
    return arr


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def pack(path, out_path=None):
    j, b = read(path)
    prim = j['meshes'][0]['primitives'][0]
    at = prim['attributes']
    data = {k: accessor(j, b, v) for k, v in at.items()}
    idx = accessor(j, b, prim['indices'])[:, 0].astype(np.int64)
    skin = j['skins'][0]
    ibm = accessor(j, b, skin['inverseBindMatrices']).astype(np.float32)

    # Palette snap: COLOR_0 is linear; the palette is sRGB hex. Bytes hold linear values (glTF).
    names = sorted(palette.COLORS)
    pal_lin = srgb_to_linear(np.array([palette.rgb(n) for n in names]))
    col = data['COLOR_0'][:, :3]
    dist = ((col[:, None, :] - pal_lin[None, :, :]) ** 2).sum(-1)
    snap = pal_lin[dist.argmin(1)]
    worst = float(np.sqrt(dist.min(1)).max())
    if worst > 0.01:
        raise ValueError('a vertex colour is not from the palette (off by %.4f)' % worst)
    col8 = np.clip(np.round(snap * 255), 0, 255).astype(np.uint8)
    col8 = np.hstack([col8, np.full((len(col8), 1), 255, np.uint8)])

    w = data['WEIGHTS_0']
    w = w / w.sum(1, keepdims=True)
    w8 = np.floor(w * 255).astype(np.int64)
    rem = 255 - w8.sum(1)
    frac = w * 255 - w8
    for r in range(len(w8)):
        for k in np.argsort(-frac[r])[:rem[r]]:
            w8[r, k] += 1
    jt = data['JOINTS_0'].astype(np.uint8)
    # Zero-weight slots point at joint 0 (tidy).
    jt[w8 == 0] = 0
    w8 = w8.astype(np.uint8)

    nrm = data['NORMAL']
    nrm = nrm / np.maximum(1e-9, np.linalg.norm(nrm, axis=1, keepdims=True))
    n8 = np.clip(np.round(nrm * 127), -127, 127).astype(np.int8)
    n8 = np.hstack([n8, np.zeros((len(n8), 1), np.int8)])
    pos = data['POSITION'].astype(np.float32)
    ink = data['_INK'][:, 0].astype(np.float32)

    blob = bytearray()
    views, accs = [], []

    def add(arr, ctype, typ, count, target=None, normalized=False, stride=None, minmax=False):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        bts = np.ascontiguousarray(arr).tobytes()
        blob.extend(bts)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(bts)}
        if target:
            bv['target'] = target
        if stride:
            bv['byteStride'] = stride
        views.append(bv)
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': count, 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    n = len(pos)
    i_idx = add(idx.astype(np.uint16 if n < 65536 else np.uint32), 5123 if n < 65536 else 5125, 'SCALAR', len(idx), 34963)
    new_at = {
        'POSITION': add(pos, 5126, 'VEC3', n, 34962, minmax=True),
        'NORMAL': add(n8, 5120, 'VEC3', n, 34962, normalized=True, stride=4),
        'COLOR_0': add(col8, 5121, 'VEC4', n, 34962, normalized=True),
        'JOINTS_0': add(jt, 5121, 'VEC4', n, 34962),
        'WEIGHTS_0': add(w8, 5121, 'VEC4', n, 34962, normalized=True),
        '_INK': add(ink, 5126, 'SCALAR', n, 34962),
    }
    i_ibm = add(ibm, 5126, 'MAT4', len(ibm))
    prim['attributes'] = new_at
    prim['indices'] = i_idx
    skin['inverseBindMatrices'] = i_ibm
    j['accessors'] = accs
    j['bufferViews'] = views
    while len(blob) % 4:
        blob.append(0)
    j['buffers'] = [{'byteLength': len(blob)}]
    for k in ('KHR_mesh_quantization',):
        j.setdefault('extensionsUsed', [])
        j.setdefault('extensionsRequired', [])
        if k not in j['extensionsUsed']:
            j['extensionsUsed'].append(k)
        if k not in j['extensionsRequired']:
            j['extensionsRequired'].append(k)
    j['asset']['generator'] = j['asset'].get('generator', '') + ' + assets/rosa/rosalib/glbpack.py'
    js = json.dumps(j, separators=(',', ':'), sort_keys=True).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(out_path or path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A))
        fh.write(js)
        fh.write(struct.pack('<II', len(blob), 0x004E4942))
        fh.write(bytes(blob))
    return total
