"""Prepares El Patio's sourced surface textures (Poly Haven, CC0) for the runtime.

    python3 -I scripts/patio-textures.py <riposte-source-root>

Reads the three Poly Haven sets as mirrored in the Riposte repo
(assets/tex/<key>/{map,normal,rough}.webp), and writes compressed webp into
public/textures/patio/ at 512 px (High and Medium) and 256 px (Low):

  <name>-map-<size>.webp     colour, sRGB
  <name>-normal-<size>.webp  tangent-space normal, OpenGL (+Y up), linear

Colour grading happens in linear light. Plaster and wood become neutral grey
multipliers (the runtime divides by MEAN below, so the kit's vertex paint and
the wood tint stay the colour); the cobbles are pulled from blue-grey to a warm
grey and keep their own colour. Roughness is not shipped: its remapped (0.85..1) mean is printed for the runtime's constant.
Normals are re-centred (their mean tilt removed) and renormalised. Resizing
wraps at the edges so the textures still tile.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'textures' / 'patio'
SIZES = (512, 256)

# name, Riposte folder, grading
SETS = {
    # Plaster: the low band (trowel sweeps and patches, wider than ~2 cm) lifted to about +/-9 %
    # (p5..p95), the fine grain eased, so it reads hand-trowelled and never as speckle.
    'plaster': {'src': 'plaster2', 'mode': 'neutral', 'contrast': 0.8, 'low': {'sigma': 8, 'target': 0.09}, 'mean': 0.8},
    'cobble': {'src': 'cobble', 'mode': 'warm', 'contrast': 0.8, 'chroma': 0.3, 'target': (148, 141, 130)},
    'wood': {'src': 'timber', 'mode': 'neutral', 'contrast': 0.7, 'mean': None},
}


def s2l(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def l2s(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def load(p, mode='RGB'):
    return np.asarray(Image.open(p).convert(mode)).astype(np.float64) / 255.0


def resize_wrap(a, size):
    """Lanczos resize of a tiling image: resized as a 3x3 tiling, the centre kept."""
    h, w = a.shape[:2]
    tiled = np.tile(a, (3, 3, 1) if a.ndim == 3 else (3, 3))
    chans = [tiled[..., c] for c in range(a.shape[2])] if a.ndim == 3 else [tiled]
    out = []
    for ch in chans:
        im = Image.fromarray(ch.astype(np.float32), mode='F').resize((size * 3, size * 3), Image.LANCZOS)
        out.append(np.asarray(im)[size:2 * size, size:2 * size])
    return np.stack(out, -1) if a.ndim == 3 else out[0]


LUM = np.array([0.2126, 0.7152, 0.0722])


def blur(x, sigma):
    """Gaussian blur that wraps (FFT), sigma in pixels."""
    h, w = x.shape
    fy, fx = np.fft.fftfreq(h), np.fft.fftfreq(w)
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fy[:, None] ** 2 + fx[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(x) * k))


def grade(name, cfg, rgb):
    lin = s2l(rgb)
    if cfg['mode'] == 'neutral':
        # Neutral grey around 1 (channel means divided out), contrast eased, then
        # placed at a mean with headroom for the brighter grain.
        n = lin / lin.reshape(-1, 3).mean(0)
        g = n @ LUM
        g = g / g.mean()
        info = {}
        if 'low' in cfg:
            lo = blur(g, cfg['low']['sigma'])
            p5, p95 = np.percentile(lo, [5, 95])
            gain = cfg['low']['target'] / ((p95 - p5) / 2)
            g = 1 + (lo - 1) * gain + (g - lo) * cfg['contrast']
            info['lowGain'] = round(float(gain), 3)
        else:
            g = 1 + (g - 1) * cfg['contrast']
        lo = blur(g, 8)
        info['lowP5P95'] = [round(float(v), 3) for v in np.percentile(lo, [5, 95])]
        mean = cfg['mean'] or min(0.8, 0.98 / float(np.percentile(g, 99.7)))
        g = np.clip(g * mean, 0, 1)
        return np.repeat(g[..., None], 3, -1), {'linearMean': round(float(g.mean()), 4), **info}
    # Warm grey: chroma reduced, contrast eased, mean moved to the target colour.
    L = lin @ LUM
    c = lin - L[..., None]
    Lm = L.mean()
    L2 = Lm + (L - Lm) * cfg['contrast']
    out = L2[..., None] + c * cfg['chroma']
    target = s2l(np.array(cfg['target']) / 255.0)
    out = out * (target / out.reshape(-1, 3).mean(0))
    return np.clip(out, 0, 1), {'linearMean': [round(float(v), 4) for v in out.reshape(-1, 3).mean(0)]}


def normals(rgb):
    n = rgb * 2 - 1
    n[..., :2] -= n[..., :2].reshape(-1, 2).mean(0)  # remove the map's mean tilt (the cobble set leans ~12 degrees)
    n[..., 2] = np.maximum(n[..., 2], 0.05)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def save(a, path, q, lossless=False):
    im = Image.fromarray(np.round(np.clip(a, 0, 1) * 255).astype(np.uint8))
    im.save(path, 'WEBP', quality=q, method=6, lossless=lossless)
    return path.stat().st_size


def main():
    src = Path(sys.argv[1]) / 'assets' / 'tex'
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    for name, cfg in SETS.items():
        d = src / cfg['src']
        col, info = grade(name, cfg, load(d / 'map.webp'))
        nrm = normals(load(d / 'normal.webp'))
        # Roughness maps are not shipped (no visible difference at 0.85..1): the runtime uses
        # their remapped mean as a constant.
        rough = 0.85 + 0.15 * load(d / 'rough.webp', 'L')
        report[name] = {'source': cfg['src'], **info, 'roughMean': round(float(rough.mean()), 3), 'files': {}}
        for size in SIZES:
            c = l2s(resize_wrap(col, size))
            nn = resize_wrap(nrm, size)
            nn = nn / np.linalg.norm(nn, axis=-1, keepdims=True)
            for kind, arr, q in (('map', c, 90 if name == 'plaster' else 86), ('normal', nn * 0.5 + 0.5, 90)):
                p = OUT / f'{name}-{kind}-{size}.webp'
                report[name]['files'][p.name] = save(arr, p, q)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
