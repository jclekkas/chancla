# Beat tracking and beat-synchronous loop search (numpy only).
import numpy as np, sys, json
sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
from features import load, stft_mag, features, key, SR

def onset(mono, n=2048, hop=441):
    m, _ = stft_mag(mono, n, hop)
    lm = np.log1p(100 * m)
    f = np.maximum(0, np.diff(lm, axis=0)).sum(1)
    f = np.concatenate([[0], f])
    f = f - np.convolve(f, np.ones(50) / 50, 'same')
    f = np.maximum(f, 0)
    return f / (f.std() + 1e-9), hop

def tempo_period(env, fps, lo=70, hi=190):
    e = env - env.mean()
    ac = np.fft.irfft(np.abs(np.fft.rfft(e, 2 * len(e))) ** 2)[:len(e)]
    best = None
    for L in range(int(60 * fps / hi), int(60 * fps / lo) + 1):
        # sum harmonics: L, 2L, 4L (beat, half, bar-ish) for robustness
        s = ac[L] + 0.5 * ac[2 * L] + 0.25 * ac[4 * L] + 0.5 * ac[L // 2] * 0
        w = np.exp(-0.5 * (np.log2((60 * fps / L) / 115) / 1.0) ** 2)
        if best is None or s * w > best[0]: best = (s * w, L)
    L = best[1]
    y0, y1, y2 = ac[L - 1], ac[L], ac[L + 1]
    return L + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)

def track(env, period, tight=100.0):
    n = len(env)
    score = env.copy().astype(np.float64)
    back = np.full(n, -1)
    lo, hi = int(round(period * 0.5)), int(round(period * 2))
    prev = np.arange(-hi, -lo + 1)
    pen = -tight * (np.log(-prev / period)) ** 2
    for t in range(hi, n):
        cand = score[t + prev] + pen
        k = int(np.argmax(cand))
        score[t] = env[t] + cand[k]
        back[t] = t + prev[k]
    t = int(np.argmax(score[-hi:])) + n - hi
    beats = [t]
    while back[t] >= 0: t = back[t]; beats.append(t)
    return np.array(beats[::-1])

def main(path, name):
    x = load(path); mono = x.mean(1); dur = len(mono) / SR
    env, hop = onset(mono)
    fps = SR / hop
    P = tempo_period(env, fps)
    bt = track(env, P)
    bs = bt * hop  # beat sample positions
    ibi = np.diff(bs) / SR
    bpm = 60 / np.median(ibi)
    # beat-synchronous features from the 4096/1024 stft
    m, h2 = stft_mag(mono)
    chroma, bands = features(m)
    fb = (bs / h2).astype(int)
    fb = fb[fb < len(chroma) - 1]
    C = np.stack([chroma[a:b].mean(0) for a, b in zip(fb[:-1], fb[1:])])
    B = np.stack([bands[a:b].mean(0) for a, b in zip(fb[:-1], fb[1:])])
    C = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-9)
    Bz = (B - B.mean(0)) / (B.std(0) + 1e-9)
    Bz = Bz / (np.linalg.norm(Bz, axis=1, keepdims=True) + 1e-9)
    nb = len(C)
    W = 8
    def seam(i, j):  # similarity of beats around i vs around j
        a = slice(i - W, i + W); b = slice(j - W, j + W)
        return float(0.5 * (C[a] * C[b]).sum(1).mean() + 0.5 * (Bz[a] * Bz[b]).sum(1).mean())
    # random baseline
    rng = np.random.default_rng(1)
    base = [seam(int(i), int(j)) for i, j in rng.integers(W, nb - W, (400, 2))]
    t_beat = bs[:nb + 1] / SR
    res = []
    minLen, intro, tail = (min(40.0, dur * 0.45), 6.0, 5.0)
    for i in range(W, nb - W):
        if t_beat[i] < intro: continue
        for L in range(16, nb, 16):
            j = i + L
            if j >= nb - W or t_beat[j] > dur - tail: break
            if t_beat[j] - t_beat[i] < minLen: continue
            res.append((seam(i, j), i, j))
    res.sort(reverse=True)
    pct = lambda s: float((np.array(base) < s).mean())
    picks = []
    for s, i, j in res:
        if any(abs(i - a) < 8 and abs(j - b) < 8 for _, a, b, *_ in picks): continue
        picks.append((s, i, j))
        if len(picks) == 8: break
    out = {'name': name, 'dur': dur, 'bpm': round(float(bpm), 2), 'ibiStd': round(float(ibi.std() * 1000), 1),
           'key': key(chroma), 'baseline': [round(float(np.percentile(base, p)), 3) for p in (50, 90, 99)],
           'candidates': [{'sim': round(s, 3), 'pct': pct(s), 'beatStart': int(i), 'beatEnd': int(j), 'bars': (j - i) // 4,
                           'start': round(float(bs[i] / SR), 4), 'end': round(float(bs[j] / SR), 4), 'startSample': int(bs[i]), 'endSample': int(bs[j])} for s, i, j in picks],
           'beats': [int(b) for b in bs]}
    print(json.dumps(out))
main(sys.argv[1], sys.argv[2])
