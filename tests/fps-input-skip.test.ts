// @vitest-environment jsdom
// The Space press that skips an elimination replay is used up whole: its
// auto-repeat must not become a held jump (Space held through respawn does
// not jump), while the next real press still jumps. Menu typing is untouched.
import { beforeEach, describe, expect, it } from 'vitest';
import { FpsInput } from '../src/fps/input';

function key(type: 'keydown' | 'keyup', code: string, repeat = false, target: EventTarget = window): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe('Space that skips a replay', () => {
  let input: FpsInput;
  let replay: boolean;
  let skips: number;
  beforeEach(() => {
    input?.dispose();
    document.body.innerHTML = '<div id="stage"></div><input id="field" />';
    input = new FpsInput(document.getElementById('stage')!);
    input.enabled = true;
    replay = true;
    skips = 0;
    // What the engine does: skip (and release held input) while a replay shows.
    input.onSkip = () => { if (!replay) return false; replay = false; skips++; input.release('replay ended'); return true; };
  });

  it('the reported sequence: the skip, then its auto-repeat, then keyup: never a jump', () => {
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(skips).toBe(1);
    expect(input.sample().jump).toBe(false);
    for (let i = 0; i < 30; i++) {
      expect(key('keydown', 'Space', true).defaultPrevented).toBe(true);
      expect(input.sample().jump).toBe(false); // held through the death screen and respawn
    }
    expect(input.heldCount).toBe(0);
    key('keyup', 'Space');
    expect(input.sample().jump).toBe(false);
  });

  it('a fresh press after the release jumps', () => {
    key('keydown', 'Space');
    key('keydown', 'Space', true);
    key('keyup', 'Space');
    key('keydown', 'Space');
    expect(skips).toBe(1);
    expect(input.sample().jump).toBe(true);
    key('keyup', 'Space');
    expect(input.sample().jump).toBe(false);
  });

  it('a keyup lost to a focus change does not block the next real press', () => {
    key('keydown', 'Space');
    window.dispatchEvent(new Event('blur')); // the keyup never arrives
    key('keydown', 'Space'); // a new press (not a repeat)
    expect(input.sample().jump).toBe(true);
  });

  it('without a replay, Space and its repeat jump as before', () => {
    replay = false;
    key('keydown', 'Space');
    expect(input.sample().jump).toBe(true);
    key('keydown', 'Space', true);
    expect(input.sample().jump).toBe(true);
    key('keyup', 'Space');
    expect(input.sample().jump).toBe(false);
    expect(skips).toBe(0);
  });

  it('menus: with play input off, Space in a text field is left alone and skips nothing', () => {
    input.enabled = false;
    const e = key('keydown', 'Space', false, document.getElementById('field')!);
    expect(e.defaultPrevented).toBe(false);
    expect(skips).toBe(0);
  });
});
