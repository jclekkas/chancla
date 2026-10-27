// Generates the TEMPORARY voice pack (public/voice/) from src/audio/lines.ts
// at production time. No network, no runtime generation, no paid service.
//
//   node --import tsx scripts/make-voices.ts
//   ONLY=rulero1 node --import tsx scripts/make-voices.ts   (just these lines,
//   merged into the existing manifest; the other files are left as they are)
//
// Engines (installed from Ubuntu packages):
//   SVOX Pico 1.0, es-ES voice  (Apache-2.0; language data redistributable)
//   eSpeak NG 1.51, es-419       (GPL-3.0 engine; its audio output is not covered by the GPL)
// Rosa and the human NPCs use Pico with per-character pitch and tempo; the
// wind-up cart, serving trolley and the piñata's "party system" are machines
// and use eSpeak NG on purpose.
//
// This is a placeholder pack: clearly synthetic, Castilian Spanish rather
// than Rosa's intended voice. docs/VOICE_SCRIPT.md lists every line for a
// real recording session; recorded files with the same names replace these.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { LINES, type Speaker } from '../src/audio/lines';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'public/voice');
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voices-'));

// Character treatment: engine, then ffmpeg filters (pitch via sample-rate
// change compensated by atempo, plus EQ and light effects).
const VOICE: Record<Speaker, { engine: 'pico' | 'espeak'; pitch: number; tempo: number; extra?: string; espeak?: string[] }> = {
  rosa: { engine: 'pico', pitch: 0.97, tempo: 1.0, extra: 'equalizer=f=220:t=q:w=1:g=2,equalizer=f=3200:t=q:w=1:g=2' },
  vecina: { engine: 'pico', pitch: 1.05, tempo: 1.0 },
  influ: { engine: 'pico', pitch: 1.16, tempo: 1.12, extra: 'equalizer=f=4000:t=q:w=1:g=3' },
  bocinas: { engine: 'pico', pitch: 0.8, tempo: 1.04, extra: 'equalizer=f=120:t=q:w=1:g=5' },
  soplador: { engine: 'pico', pitch: 0.76, tempo: 0.96 },
  cart: { engine: 'espeak', pitch: 1, tempo: 1, espeak: ['-v', 'es-419', '-p', '85', '-s', '185'], extra: 'aecho=0.6:0.5:12:0.4' },
  rollcart: { engine: 'espeak', pitch: 1, tempo: 1, espeak: ['-v', 'es-419', '-p', '95', '-s', '200'] },
  pinata: { engine: 'espeak', pitch: 1, tempo: 1, espeak: ['-v', 'es-419', '-p', '35', '-s', '150'], extra: 'flanger=delay=2:depth=3:speed=0.6,aecho=0.7:0.6:40:0.3' },
};

function render(id: string, who: Speaker, text: string): { file: string; ms: number } {
  const v = VOICE[who];
  const raw = path.join(tmp, `${id}.wav`);
  if (v.engine === 'pico') execFileSync('pico2wave', ['-l', 'es-ES', '-w', raw, text]);
  else execFileSync('espeak-ng', [...(v.espeak ?? []), '-w', raw, text]);
  const filters = [
    v.pitch !== 1 ? `asetrate=16000*${v.pitch},aresample=24000,atempo=${(v.tempo / v.pitch).toFixed(4)}` : `aresample=24000${v.tempo !== 1 ? `,atempo=${v.tempo}` : ''}`,
    v.extra,
    'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    'loudnorm=I=-18:TP=-2:LRA=7',
  ].filter(Boolean).join(',');
  const file = `${id}.mp3`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', filters, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k', path.join(OUT, file)]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(OUT, file)]).toString().trim());
  return { file, ms: Math.round(dur * 1000) };
}

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const previous = ONLY ? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as { lines: Record<string, { file: string; ms: number; who: Speaker }>; generated: string } : null;
const manifest = {
  version: 1,
  quality: 'placeholder-tts',
  note: 'Synthetic placeholder voices (SVOX Pico es-ES, eSpeak NG es-419). Replace with recorded performances; see docs/VOICE_SCRIPT.md.',
  generated: previous?.generated ?? new Date().toISOString().slice(0, 10),
  lines: { ...(previous?.lines ?? {}) } as Record<string, { file: string; ms: number; who: Speaker }>,
};
let total = 0;
for (const l of LINES) {
  if (ONLY && !ONLY.has(l.id)) continue;
  const r = render(l.id, l.who, l.es);
  manifest.lines[l.id] = { ...r, who: l.who };
  total += fs.statSync(path.join(OUT, r.file)).size;
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${LINES.length} lines, ${(total / 1024).toFixed(0)} KB`);
