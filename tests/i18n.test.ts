// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS, QUIPS } from '../src/i18n/strings';
import { applyDom, hasKey, quip, setLang, t } from '../src/i18n/i18n';

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

describe('i18n', () => {
  it('has every key in both languages, with no blanks', () => {
    const en = Object.keys(STRINGS.en).sort();
    const es = Object.keys(STRINGS.es).sort();
    expect(es).toEqual(en);
    for (const k of en) {
      if (k === 'brand.taglineTr') continue;
      expect(STRINGS.en[k as keyof typeof STRINGS.en].trim(), k).not.toBe('');
      expect(STRINGS.es[k as keyof typeof STRINGS.es].trim(), k).not.toBe('');
    }
  });

  it('every data-i18n reference in the page exists', () => {
    const refs = [...html.matchAll(/data-i18n(?:-aria|-alt|-title)?="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(50);
    const missing = refs.filter((r) => !hasKey(r));
    expect(missing).toEqual([]);
  });

  it('switches text, aria labels and the document language together', () => {
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    setLang('en');
    applyDom(document);
    const play = document.querySelector('#btn-play span')!;
    const pause = document.getElementById('btn-pause')!;
    expect(play.textContent).toBe('Play');
    expect(pause.getAttribute('aria-label')).toBe('Pause');
    expect(document.documentElement.lang).toBe('en');
    setLang('es');
    applyDom(document);
    expect(play.textContent).toBe('Jugar');
    expect(pause.getAttribute('aria-label')).toBe('Pausa');
    expect(document.getElementById('btn-restart')!.textContent).toBe('Reiniciar partida');
    expect(document.documentElement.lang).toBe('es');
    // No untranslated placeholders remain.
    const empty = [...document.querySelectorAll<HTMLElement>('[data-i18n]')].filter((e) => !e.textContent && e.dataset.i18n !== 'brand.taglineTr');
    expect(empty.map((e) => e.dataset.i18n)).toEqual([]);
  });

  it('interpolates parameters and subtitles quips only in English', () => {
    setLang('en');
    expect(t('hud.wave', { n: 2 })).toBe('Wave 2/3');
    expect(quip('noFalla')).toEqual({ es: 'La chancla no falla.', sub: 'The chancla never misses.' });
    setLang('es');
    expect(t('hud.wave', { n: 2 })).toBe('Oleada 2/3');
    expect(quip('noFalla').sub).toBe('');
    expect(Object.values(QUIPS).map((q) => q.es)).toEqual(expect.arrayContaining(['La chancla no falla.', 'Te lo advertí.', 'Aquí se respeta.', 'Ahora sí: paz y cafecito.']));
  });
});
