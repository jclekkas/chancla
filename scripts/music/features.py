# Tempo, key and loop-point analysis for the Suno tracks (offline, numpy only).
import numpy as np, sys, json
SR = 44100
def load(p): return np.fromfile(p, dtype=np.float32).reshape(-1, 2)

def stft_mag(x, n=4096, hop=1024):
    w = np.hanning(n).astype(np.float32)
    frames = 1 + (len(x) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    return np.abs(np.fft.rfft(x[idx] * w, axis=1)).astype(np.float32), hop

def features(m, n=4096):
    freqs = np.fft.rfftfreq(n, 1 / SR)
    # chroma
    valid = (freqs > 60) & (freqs < 5000)
    pc = np.round(12 * np.log2(freqs[valid] / 440.0)).astype(int) % 12
    pw = m[:, valid] ** 2
    chroma = np.zeros((m.shape[0], 12), np.float32)
    for k in range(12): chroma[:, k] = pw[:, pc == k].sum(1)
    # log bands
    edges = np.geomspace(40, 16000, 25)
    bands = np.stack([np.log1p(10 * (m[:, (freqs >= a) & (freqs < b)] ** 2).sum(1)) for a, b in zip(edges[:-1], edges[1:])], 1)
    return chroma, bands

def onset_env(m):
    lm = np.log1p(100 * m)
    flux = np.maximum(0, np.diff(lm, axis=0)).sum(1)
    flux = np.concatenate([[0], flux])
    return flux - np.convolve(flux, np.ones(16) / 16, 'same')

def tempo(env, hop):
    fps = SR / hop
    e = env - env.mean()
    ac = np.correlate(e, e, 'full')[len(e) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    ok = (bpm > 70) & (bpm < 180)
    # weight toward ~110 bpm
    score = ac * ok * np.exp(-0.5 * (np.log2(bpm / 110) / 0.9) ** 2)
    L = int(np.argmax(score))
    # parabolic refine
    y0, y1, y2 = ac[L - 1], ac[L], ac[L + 1]
    Lr = L + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    return 60 * fps / Lr

KMAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KMIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']  # pitch class 0 = A (440)
def key(chroma):
    c = chroma.sum(0); c = c / c.sum()
    best = None
    for r in range(12):
        for prof, minor in ((KMAJ, False), (KMIN, True)):
            s = np.corrcoef(c, np.roll(prof, r))[0, 1]
            if best is None or s > best[0]: best = (s, r, minor)
    s, r, minor = best
    midi = 57 + r  # A3 = 57
    if midi > 62: midi -= 12
    return {'name': NAMES[r] + (' minor' if minor else ' major'), 'root': int(midi), 'minor': minor, 'conf': float(s)}

def norm(f):
    f = f - f.mean(0)
    return f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-9)

def loop_search(F, rms, hop, bpm, minS, maxE, minLen, maxLen, win_s=3.0):
    fps = SR / hop
    w = int(win_s * fps)
    bar = 4 * 60 / bpm * fps  # frames per bar
    best = []
    T = F.shape[0]
    for nb in range(int(np.ceil(minLen * fps / bar)), int(maxLen * fps / bar) + 1):
        for d in (-1, 0, 1):
            L = int(round(nb * bar)) + d
            if L >= T: continue
            sim = (F[:-L] * F[L:]).sum(1)
            lvl = -np.abs(rms[:-L] - rms[L:])
            k = np.ones(2 * w + 1) / (2 * w + 1)
            ss = np.convolve(sim, k, 'same') + 0.15 * np.convolve(lvl, k, 'same')
            lo = int(minS * fps); hi = min(len(ss), int(maxE * fps) - L)
            if hi <= lo: continue
            i = lo + int(np.argmax(ss[lo:hi]))
            best.append((float(ss[i]), i, L, nb))
    best.sort(reverse=True)
    return best

def refine(x, s, e, search=0.03, win=0.25):
    # sample-accurate: align waveform after e with waveform after s
    mono = x.mean(1)
    n = int(win * SR); r = int(search * SR)
    ref = mono[s:s + n]
    seg = mono[e - r:e + r + n]
    c = np.correlate(seg, ref, 'valid')
    c /= (np.sqrt(np.convolve(seg ** 2, np.ones(n), 'valid')) * np.linalg.norm(ref) + 1e-9)
    k = int(np.argmax(c))
    return e - r + k, float(c[k])

def main(path, name):
    x = load(path)
    mono = x.mean(1)
    m, hop = stft_mag(mono)
    chroma, bands = features(m)
    env = onset_env(m)
    bpm = tempo(env, hop)
    K = key(chroma)
    F = norm(np.concatenate([norm(chroma) * 0.8, norm(bands)], 1))
    rms = 10 * np.log10((m ** 2).sum(1) + 1e-9)
    dur = len(mono) / SR
    res = loop_search(F, rms, hop, bpm, minS=4.0, maxE=dur - 4.0, minLen=min(40, dur * 0.5), maxLen=dur - 8.0)
    out = {'name': name, 'dur': dur, 'bpm': round(bpm, 2), 'key': K, 'candidates': []}
    for score, i, L, nb in res[:6]:
        s = i * hop; e = (i + L) * hop
        e2, c = refine(x, s, e)
        out['candidates'].append({'score': round(score, 4), 'start': round(s / SR, 4), 'end': round(e2 / SR, 4), 'bars': nb, 'len': round((e2 - s) / SR, 3), 'xcorr': round(c, 3), 'startSample': int(s), 'endSample': int(e2)})
    print(json.dumps(out))

if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
