# Objective seam check on the prepared files (not a substitute for listening).
#
#   python3 scripts/music/check-seams.py
#
# Plays each loop the way the browser does (start -> loopEnd, jump to
# loopStart, around again) and measures, at the jump and at every other point
# of the loop:
#   novelty  how abruptly the sound changes (timbre and harmony, a 1.5 s
#            checkerboard kernel over a self-similarity matrix)
#   beat     how well the beat grid continues (onset autocorrelation at the
#            beat period, across a window centred on the point)
# A seam that ranks like an ordinary moment of the song should not stand out.
# The percentiles say where the seam window falls among same-width windows
# anywhere in the loop (novelty: higher is more abrupt; beat: lower is worse).
import json, re, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
from features import stft_mag, features
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SR = 44100


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def tracks():
    src = (ROOT / 'src/audio/soundtrack.ts').read_text()
    body = src.split('RECORDED: readonly RecordedTrack[] = ')[1].split('];')[0] + ']'
    return json.loads(body)


def main():
    out = []
    for t in tracks():
        x = decode(ROOT / 'public' / t['file'])
        s, e = int(t['loopStart'] * SR), int(t['loopEnd'] * SR)
        play = np.concatenate([x[s:e], x[s:e]])  # loop body twice: the jump sits at len(body)
        seam = e - s
        m, hop = stft_mag(play, 2048, 512)
        chroma, bands = features(m, 2048)
        F = np.concatenate([chroma / (np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-9), (bands - bands.mean(0)) / (bands.std(0) + 1e-9) / 5], 1)
        F = F / (np.linalg.norm(F, axis=1, keepdims=True) + 1e-9)
        K = int(1.5 * SR / hop)
        n = len(F)
        nov = np.full(n, np.nan)
        for i in range(K, n - K, 2):
            a, b = F[i - K:i], F[i:i + K]
            within = 0.5 * ((a @ a.T).mean() + (b @ b.T).mean())
            nov[i] = within - (a @ b.T).mean()
        # beat continuity: onset envelope correlation one beat apart, across the point
        lm = np.log1p(100 * m)
        env = np.concatenate([[0], np.maximum(0, np.diff(lm, axis=0)).sum(1)])
        P = int(round(60 / t['bpm'] * SR / hop))
        W = 4 * P
        bc = np.full(n, np.nan)
        for i in range(W, n - W - P, 2):
            u, v = env[i - W:i + W], env[i - W + P:i + W + P]
            bc[i] = np.corrcoef(u, v)[0, 1]
        si = seam // hop
        si = si - si % 2
        ok = ~np.isnan(nov)
        okb = ~np.isnan(bc)
        # the seam is spread over the baked crossfade, so take the worst moment
        # from 1 s before the crossfade starts to 1 s after the jump
        xf = int((2 * 60 / t['bpm'] + 1.1) * SR / hop)
        lo, hi = si - xf, si + int(1.0 * SR / hop)
        nv = np.nanmax(nov[lo:hi])
        bv = np.nanmin(bc[lo:hi])
        # compare with the same-width window everywhere else in the loop
        width = hi - lo
        ref_n = np.array([np.nanmax(nov[i:i + width]) for i in range(0, n - width, 8) if not np.isnan(nov[i:i + width]).all()])
        ref_b = np.array([np.nanmin(bc[i:i + width]) for i in range(0, n - width, 8) if not np.isnan(bc[i:i + width]).all()])
        nov_pct = float((ref_n < nv).mean())
        beat_pct = float((ref_b < bv).mean())
        r = {'id': t['id'], 'noveltyAtSeamPct': round(nov_pct, 3), 'beatContinuityAtSeamPct': round(beat_pct, 3),
             'verdict': 'blends in' if nov_pct < 0.9 and beat_pct > 0.1 else 'may stand out: listen'}
        out.append(r)
        print(json.dumps(r))
    (ROOT / 'docs/evidence/music/seam-check.json').write_text(json.dumps(out, indent=2) + '\n')


main()
