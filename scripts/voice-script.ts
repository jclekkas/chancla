// Writes docs/VOICE_SCRIPT.md: every line, who says it, when it plays, and
// the file name a recording must use to replace the placeholder.
//   node --import tsx scripts/voice-script.ts
import fs from 'node:fs';
import { LINES, POOLS } from '../src/audio/lines';

const when: Record<string, string> = {};
for (const [pool, ids] of Object.entries(POOLS)) for (const id of ids) when[id] = when[id] ? `${when[id]}, ${pool}` : `reaction: ${pool}`;
const NAMES: Record<string, string> = { rosa: 'Doña Rosa', influ: 'El Influencer', bocinas: 'El Bocinas', soplador: 'El Soplador', cart: 'Express 3000 (wind-up toy cart)', rollcart: 'Serving trolley', pinata: 'Premium party system (robot announcer)', vecina: 'Neighbor' };
const out: string[] = [
  '# Voice recording script',
  '',
  'Every spoken line in the game. Delivery is Spanish; the English column is the subtitle, not a line to record.',
  '',
  'The current files in `public/voice/` are **temporary synthetic placeholders** (SVOX Pico and eSpeak NG), not performances. To replace them, record each line and export it as `public/voice/<id>.mp3`. A mono MP3 (or any format all target browsers decode) at -18 LUFS, trimmed tight, works. Then update its `ms` in `public/voice/manifest.json`, or rerun the measuring step in `scripts/make-voices.ts`, and set `quality` to `recorded`. The game reads clip lengths from the manifest, so subtitles stay in sync.',
  '',
  'Direction: Rosa is warm, quick and theatrical. She is never shrill and never a caricature. Her timing is dry; she has seen it all. The opponents are broad and comic. The party system is a cheerful, malfunctioning robot announcer. Do not imitate any real performer.',
  '',
];
for (const who of Object.keys(NAMES)) {
  const ls = LINES.filter((l) => l.who === who);
  if (!ls.length) continue;
  out.push(`## ${NAMES[who]} (${ls.length})`, '', '| File | Spanish (record this) | English subtitle | Plays |', '| --- | --- | --- | --- |');
  for (const l of ls) out.push(`| \`${l.id}.mp3\` | ${l.es} | ${l.en} | ${when[l.id] ?? (l.cat === 'story' ? 'scripted' : 'event')} |`);
  out.push('');
}
fs.writeFileSync(new URL('../docs/VOICE_SCRIPT.md', import.meta.url), out.join('\n'));
console.log(`${LINES.length} lines`);
