// Replaces the original placeholder clips. Same line ids and timeline;
// new words, spoken in the browser. No paid voice and no original mp3s.
import { Dialogue } from '../../src/audio/dialogue';
import type { Line } from '../../src/audio/lines';
import { DUTY_LINES } from './voice-lines';

type D = {
  buffers: Map<string, AudioBuffer>;
  manifestTried: boolean;
  manifest: { version: number; quality: string; lines: Record<string, { file: string; ms: number }> } | null;
  voiceFailed: boolean;
  start: (line: Line, volume: number) => void;
  showSubtitle: (line: Line) => void;
};

function rewritten(line: Line): Line {
  const alt = DUTY_LINES[line.id];
  return alt ? { ...line, es: alt.es, en: alt.en } : line;
}

function speak(line: Line): void {
  if (typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(line.es);
  u.lang = 'es-MX';
  u.rate = line.who === 'pinata' ? 0.9 : line.who === 'rosa' ? 1.04 : 1;
  u.pitch = line.who === 'rosa' ? 1.18 : line.who === 'influ' ? 1.32 : line.who === 'bocinas' ? 0.72 : line.who === 'pinata' ? 0.62 : 1;
  const voices = speechSynthesis.getVoices();
  const es = voices.find((v) => v.lang.toLowerCase().startsWith('es'));
  if (es) u.voice = es;
  try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* autoplay or missing synth */ }
}

const origStart = (Dialogue.prototype as unknown as D).start;
(Dialogue.prototype as unknown as D).start = function (this: D, line: Line, volume: number) {
  const next = rewritten(line);
  this.buffers?.delete(line.id);
  origStart.call(this, next, volume);
  speak(next);
};

const origSub = (Dialogue.prototype as unknown as D).showSubtitle;
(Dialogue.prototype as unknown as D).showSubtitle = function (this: D, line: Line) {
  origSub.call(this, rewritten(line));
};

(Dialogue.prototype as unknown as { loadManifest: (base: string) => Promise<void> }).loadManifest = async function (this: D) {
  this.manifestTried = true;
  this.manifest = { version: 2, quality: 'duty-synth', lines: {} };
  this.voiceFailed = false;
};

(Dialogue.prototype as unknown as { preload: (ids: string[]) => Promise<void> }).preload = function () {
  return Promise.resolve();
};
