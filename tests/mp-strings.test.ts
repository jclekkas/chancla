// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STRINGS, applyDom, hasKey, setLang, t, type Key } from '../src/fps/strings';

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const sources = ['main.ts', 'engine.ts', 'hud.ts'].map((f) => fs.readFileSync(path.resolve(__dirname, '../src/fps', f), 'utf8')).join('\n');

describe('shooter strings', () => {
  it('has every key in English and Spanish, none blank', () => {
    expect(Object.keys(STRINGS.es).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const k of Object.keys(STRINGS.en) as Key[]) {
      expect(STRINGS.en[k].trim(), k).not.toBe('');
      expect(STRINGS.es[k].trim(), k).not.toBe('');
    }
  });

  it('keeps the same {placeholders} in both languages', () => {
    for (const k of Object.keys(STRINGS.en) as Key[]) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(STRINGS.es[k]), k).toEqual(ph(STRINGS.en[k]));
    }
  });

  it('every data-t reference in index.html exists', () => {
    const refs = [...html.matchAll(/data-t(?:-aria|-ph|-alt)?="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(80);
    expect(refs.filter((r) => !hasKey(r))).toEqual([]);
  });

  it('every literal t() key used by the client exists', () => {
    const used = [...sources.matchAll(/\bt\('([a-zA-Z0-9.]+)'/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(40);
    expect(used.filter((k) => !hasKey(k))).toEqual([]);
  });

  it('has a message for every server error code and lost reason', () => {
    for (const c of ['version', 'bad_message', 'room_not_found', 'room_full', 'not_owner', 'not_ready', 'too_few', 'rate_limited', 'server_full', 'no_room', 'replaced', 'shutdown', 'team_full', 'expired']) expect(hasKey(`err.${c}`), c).toBe(true);
    for (const c of ['room_gone', 'timeout', 'unreachable', 'version', 'replaced']) expect(hasKey(`lost.${c}`), c).toBe(true);
  });

  it('translates the page in place', () => {
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    setLang('es');
    applyDom(document);
    expect(document.getElementById('btn-online')!.textContent).toBe(t('title.online'));
    expect(document.getElementById('btn-online')!.textContent).not.toBe(STRINGS.en['title.online']);
    setLang('en');
    applyDom(document);
    expect(document.getElementById('btn-online')!.textContent).toBe(STRINGS.en['title.online']);
  });
});
