import { t, formatNumber, getLang } from '../i18n/i18n';
import type { RunResult } from '../game/game';
import { rosaSVG, chanclaSVG } from './art';

// Sharing: Web Share API where available, clipboard otherwise, plus a score
// card image drawn locally on a canvas.

export function shareUrl(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/^\.?\/?/, '/');
  return `${location.origin}${base}`;
}

export function shareText(r: RunResult): string {
  return t(r.victory ? 'share.text' : 'share.textLoss', { score: formatNumber(r.score) });
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'manual';

export async function shareScore(r: RunResult): Promise<ShareOutcome> {
  const text = shareText(r);
  const url = shareUrl();
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function') {
    const data: ShareData = { title: 'Chancla Warfare', text, url };
    try {
      if (!nav.canShare || nav.canShare(data)) {
        await nav.share(data);
        return 'shared';
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Fall through to copying.
    }
  }
  return copyText(`${text} ${url}`);
}

export async function copyText(text: string): Promise<'copied' | 'manual'> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* try the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return 'copied';
  } catch {
    /* manual fallback */
  }
  return 'manual';
}

function loadImage(svg: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function drawScoreCard(r: RunResult, best: number): Promise<HTMLCanvasElement> {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  try { await document.fonts.load('80px "Lilita One"'); } catch { /* system font fallback */ }
  const display = '"Lilita One", "Arial Black", sans-serif';

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f2a33a');
  g.addColorStop(0.55, '#c8553d');
  g.addColorStop(1, '#4b2a6b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(880, 330);
  ctx.fillStyle = 'rgba(244,230,200,0.14)';
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(900, -70);
    ctx.lineTo(900, 70);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const portrait = await loadImage(rosaSVG(r.victory ? 'happy' : 'smirk'));
  if (portrait) {
    ctx.save();
    ctx.translate(880, 330);
    ctx.rotate(0.05);
    ctx.fillStyle = '#f4e6c8';
    roundRect(ctx, -190, -240, 380, 470, 28);
    ctx.fill();
    ctx.drawImage(portrait, -175, -225, 350, 420);
    ctx.restore();
  }
  const chancla = await loadImage(chanclaSVG(-25));
  if (chancla) ctx.drawImage(chancla, 560, 40, 220, 147);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#4b2a6b';
  ctx.font = `110px ${display}`;
  ctx.fillText('CHANCLA', 62, 158);
  ctx.fillStyle = '#f4e6c8';
  ctx.fillText('CHANCLA', 56, 150);
  ctx.fillStyle = '#c8553d';
  roundRect(ctx, 60, 172, 330, 64, 10);
  ctx.fill();
  ctx.fillStyle = '#f4e6c8';
  ctx.font = `50px ${display}`;
  ctx.fillText('WARFARE', 88, 222);

  ctx.font = `44px ${display}`;
  ctx.fillStyle = r.victory ? '#fff3c4' : '#f4e6c8';
  ctx.fillText(t(r.victory ? 'card.victory' : 'card.defeat'), 60, 310);

  ctx.font = `bold 26px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(244,230,200,0.9)';
  ctx.fillText(t('card.score'), 60, 370);
  ctx.font = `120px ${display}`;
  ctx.fillStyle = '#f5c542';
  ctx.fillText(formatNumber(r.score), 56, 482);

  ctx.font = `bold 24px system-ui, sans-serif`;
  ctx.fillStyle = '#f4e6c8';
  ctx.fillText(`${t('card.combo')}: ${r.bestCombo}`, 60, 540);
  ctx.fillText(`${t('card.accuracy')}: ${Math.round(r.accuracy * 100)}%`, 360, 540);
  ctx.font = `20px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(244,230,200,0.85)';
  const bestLabel = getLang() === 'es' ? 'Mejor marca' : 'Personal best';
  ctx.fillText(`${bestLabel}: ${formatNumber(best)}   ·   ${shareUrl().replace(/^https?:\/\//, '')}`, 60, 590);
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function downloadScoreCard(r: RunResult, best: number): Promise<boolean> {
  const canvas = await drawScoreCard(r, best);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chancla-warfare-${Math.round(r.score)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
