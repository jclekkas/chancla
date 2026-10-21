# Builds the browser soundtrack from the untouched Suno originals.
#
#   python3 scripts/music/prepare.py
#
# For each track in assets/music/loops.json:
#   1. decodes the original (assets/music/originals, never modified) at 48 kHz
#   2. refines the chosen loop end so the loop is an exact number of beats
#   3. bakes the loop seam: the last beats before loopEnd crossfade into the
#      audio just before loopStart, and the file continues past loopEnd with
#      the audio after loopStart. Jumping loopEnd -> loopStart is then
#      continuous even if a browser's MP3 decoder is off by a few milliseconds.
#   4. drops the song's ending (never heard: the loop takes over first)
#   5. matches loudness (-16 LUFS integrated, -1.5 dBTP) and encodes MP3
#   6. writes src/audio/soundtrack.ts (loop points, keys, levels) and
#      seam-check clips for listening in docs/evidence/music/
#
# Needs ffmpeg (with libmp3lame) and numpy.
import json, subprocess, sys, hashlib
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets/music/originals'
OUT = ROOT / 'public/music'
EVID = ROOT / 'docs/evidence/music'
SR = 48000
TARGET_LUFS = -16.0
PAD = 0.06    # seconds: the seam is fully crossfaded this long before loopEnd
TAIL = 0.5    # seconds of post-loopStart audio kept after loopEnd


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def onset_hr(mono, hop=96, n=1024):
    w = np.hanning(n).astype(np.float32)
    frames = 1 + (len(mono) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    m = np.abs(np.fft.rfft(mono[idx] * w, axis=1))
    f = np.maximum(0, np.diff(np.log1p(100 * m), axis=0)).sum(1)
    return np.concatenate([[0], f]), hop


def refine_end(x, s, e, beat):
    """Shift e (samples) by up to 30 ms so the onsets after e line up with those after s."""
    env, hop = onset_hr(x.mean(1))
    span = int(4 * beat * SR / hop)  # four beats either side
    si, ei, r = s // hop, e // hop, int(0.03 * SR / hop)
    ref = env[si - span:si + span]
    best = (-1e9, 0)
    for k in range(-r, r + 1):
        seg = env[ei + k - span:ei + k + span]
        c = float(np.dot(ref - ref.mean(), seg - seg.mean()) / (np.linalg.norm(ref - ref.mean()) * np.linalg.norm(seg - seg.mean()) + 1e-9))
        if c > best[0]: best = (c, k)
    return e + best[1] * hop, best[0], best[1] * hop / SR


def bake(x, s, e, xfade):
    """Returns the loop-ready signal (original up to e + TAIL, with the seam baked)."""
    X, P, T = int(xfade * SR), int(PAD * SR), int(TAIL * SR)
    y = x[:e + T].copy()
    a0, a1 = e - P - X, e - P            # crossfade region (before the seam)
    b0 = s - P - X                       # matching region before loopStart
    t = np.linspace(0, 1, X, dtype=np.float32)[:, None]
    fo, fi = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)  # equal power
    y[a0:a1] = x[a0:a1] * fo + x[b0:b0 + X] * fi
    y[a1:e] = x[s - P:s]                 # last PAD before the seam = audio just before loopStart
    y[e:e + T] = x[s:s + T]              # past the seam = audio just after loopStart
    return y


def lufs(path):
    out = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    tail = out[out.rfind('Summary:'):]
    i = float(tail.split('I:')[1].split('LUFS')[0])
    pk = float(tail.split('Peak:')[1].split('dBFS')[0])
    return i, pk


def encode(y, path, gain_db, extra_af=''):
    af = f'volume={gain_db:.2f}dB,alimiter=limit=0.84:attack=2:release=60:level=disabled' + extra_af
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-af', af,
                        '-c:a', 'libmp3lame', '-q:a', '4', '-map_metadata', '-1', str(path)], input=y.astype(np.float32).tobytes())
    if p.returncode: sys.exit(f'encode failed: {path}')


def seam_metrics(y, e, s):
    """Sample-level continuity at the loop jump, compared with ordinary sample steps."""
    steps = np.abs(np.diff(y[:e].mean(1)))
    jump = float(np.abs(y[e - 1].mean() - y[s].mean()))
    return {'jump': round(jump, 5), 'typicalStep95': round(float(np.percentile(steps, 95)), 5)}


def main():
    cfg = json.loads((ROOT / 'assets/music/loops.json').read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    EVID.mkdir(parents=True, exist_ok=True)
    tracks = []
    report = []
    for t in cfg['tracks']:
        src = SRC / t['source']
        x = decode(src)
        beat = 60.0 / t['bpm']
        s = int(round(t['loopStart'] * SR))
        e0 = int(round(t['loopEnd'] * SR))
        e, corr, shift = refine_end(x, s, e0, beat)
        y = bake(x, s, e, t.get('crossfadeBeats', 2) * beat)
        # loudness from the baked signal
        tmp = OUT / f".{t['id']}.wav"
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', str(tmp)], input=y.tobytes(), check=True)
        i0, _ = lufs(tmp)
        tmp.unlink()
        gain = TARGET_LUFS - i0
        mp3 = OUT / f"{t['id']}.mp3"
        encode(y, mp3, gain)
        i1, pk1 = lufs(mp3)
        # what the browser will decode, to check length and the seam
        dec = decode(mp3)
        m = seam_metrics(dec, e, s)
        # seam clip: 6 s before the jump, then 6 s after loopStart, as the loop plays it
        clip = np.concatenate([dec[e - 6 * SR:e], dec[s:s + 6 * SR]])
        encode(clip, EVID / f"{t['id']}-seam.mp3", 0)
        tracks.append({
            'id': t['id'], 'file': f"music/{t['id']}.mp3", 'title': t['title'],
            'loopStart': round(s / SR, 6), 'loopEnd': round(e / SR, 6), 'samples': int(len(y)),
            'bpm': t['bpm'], 'key': t['key'], 'gainDb': t.get('gainDb', 0),
        })
        report.append({
            'id': t['id'], 'source': t['source'], 'sourceSha256': hashlib.sha256(src.read_bytes()).hexdigest(),
            'loopStart': round(s / SR, 3), 'loopEnd': round(e / SR, 3), 'loopSeconds': round((e - s) / SR, 2),
            'endShiftMs': round(shift * 1000, 1), 'onsetCorr': round(corr, 3),
            'fileSeconds': round(len(y) / SR, 2), 'decodedSamples': int(len(dec)), 'expectedSamples': int(len(y)),
            'lufs': i1, 'peakDb': pk1, 'kb': mp3.stat().st_size // 1024, 'seam': m, 'seamSimilarityPct': t.get('seamPct'),
        })
        print(json.dumps(report[-1]))
    ts = ['// Generated by scripts/music/prepare.py from assets/music/loops.json. Do not edit by hand.',
          '// The recorded soundtrack (Suno, see docs/ASSETS.md). Times are seconds in the prepared files.',
          'export interface RecordedTrack { id: string; file: string; title: string; loopStart: number; loopEnd: number; samples: number; bpm: number; key: { root: number; minor: boolean }; gainDb: number }',
          f"export const RECORDED: readonly RecordedTrack[] = {json.dumps(tracks, indent=2, ensure_ascii=False)};",
          f"/** Which recording plays for each music cue. Cues not listed keep the synthesized score. */",
          f"export const ASSIGN: Readonly<Record<string, string>> = {json.dumps(cfg['assign'], indent=2)};", '']
    (ROOT / 'src/audio/soundtrack.ts').write_text('\n'.join(ts))
    (EVID / 'prepare-report.json').write_text(json.dumps(report, indent=2) + '\n')


main()
