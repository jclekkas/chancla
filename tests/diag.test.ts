// @vitest-environment jsdom
// Diagnostics stay small, private and useful: bounded buffer, no room codes
// or invite links, a breadcrumb that survives a reload, and a copy that
// reports failure so the UI can fall back to a selectable box.
import { afterEach, describe, expect, it } from 'vitest';
import { diagCopy, diagError, diagLog, diagProvide, diagSnapshot, diagText, installDiag, resetDiag, sanitize } from '../src/diag';

afterEach(() => { resetDiag(); localStorage.clear(); });

describe('diagnostics', () => {
  it('removes room codes, invite fragments, tokens and full URLs', () => {
    const s = sanitize('join failed for https://chancla-git-multiplayer-jclekkas.vercel.app/#room=ABCD2345 code ABCDEFGH resume=xyz123&name=Rosa at https://x.vercel.app/assets/engine-BHT4zCxc.js:1:2');
    expect(s).not.toContain('ABCD2345');
    expect(s).not.toContain('ABCDEFGH');
    expect(s).not.toContain('xyz123');
    expect(s).not.toContain('Rosa');
    expect(s).not.toContain('vercel.app');
    expect(s).toContain('engine-BHT4zCxc.js');
  });

  it('keeps a bounded buffer of short entries', () => {
    for (let i = 0; i < 500; i++) diagLog('life', `event ${i} ${'x'.repeat(1000)}`);
    const lines = diagText().split('\n').filter((l) => /\blife\b/.test(l));
    expect(lines.length).toBeLessThanOrEqual(80);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThan(260);
    expect(lines.at(-1)).toContain('event 499');
  });

  it('reports state from providers, and survives a provider that throws', () => {
    diagProvide('game', () => ({ mode: 'online', conn: 'reconnecting' }));
    diagProvide('broken', () => { throw new Error('nope'); });
    const snap = diagSnapshot();
    expect(snap.game).toEqual({ mode: 'online', conn: 'reconnecting' });
    expect(String(snap.broken)).toContain('unavailable');
    expect(snap.build).toBeTruthy();
  });

  it('records errors with where they happened', () => {
    diagError('frame', new Error('boom'));
    expect(diagText()).toMatch(/error\s+frame: boom/);
    expect(diagSnapshot().errors).toBe(1);
  });

  it('a session that ended without a normal unload shows up after reload', () => {
    installDiag('shooter');
    diagProvide('game', () => ({ screen: 'none', mode: 'online', map: 'plaza', conn: 'online', input: 'touch', name: 'Secret' }));
    diagError('frame', new Error('boom'));
    const crumb = JSON.parse(localStorage.getItem('chancla.diag.v1')!);
    expect(crumb.clean).toBe(false);
    expect(crumb.game).toEqual({ screen: 'none', mode: 'online', map: 'plaza', conn: 'online', input: 'touch' }); // no name
    expect(JSON.stringify(crumb).length).toBeLessThan(1500);
    // "Reload": a new page reads it.
    resetDiag();
    installDiag('shooter');
    const prev = diagSnapshot().previousSession as Record<string, unknown>;
    expect(prev.clean).toBe(false);
    expect(prev.lastErrors).toHaveLength(1);
    expect(diagText()).toContain('previous session ended without a normal page unload');
  });

  it('a normal unload is not reported as a problem next time', () => {
    installDiag('shooter');
    window.dispatchEvent(new Event('pagehide'));
    resetDiag();
    installDiag('shooter');
    expect(diagSnapshot().previousSession).toBeUndefined();
  });

  it('copy reports failure when the clipboard is refused, so the UI can show the text', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    expect(await diagCopy()).toBe(false);
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (s: string) => { copied = s; return Promise.resolve(); } }, configurable: true });
    expect(await diagCopy()).toBe(true);
    expect(copied).toContain('Chancla Warfare diagnostics');
  });
});
