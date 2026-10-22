// "How do I do this?" in words. The hint system (shared/campaign/hints.ts)
// already knows the next thing to do and where; this turns that hint into
// one concrete instruction for the objective panel and the stuck-tip, so
// the player never has to guess what a goal label like "Ingredient
// baskets" means or why a hit didn't count.
import type { MissionSim } from '../../shared/campaign/mission';
import type { MHint } from '../../shared/campaign/hints';
import type { ActorSpec, PickupSpec } from '../../shared/campaign/types';
import { t, hasKey, type Key } from '../fps/strings';

const tk = (k: string, vars?: Record<string, string | number>): string | null => (hasKey(k) ? t(k as Key, vars) : null);

/** One instruction for the current focus hint, or null when there is none. */
export function howText(sim: MissionSim, h: MHint | null): string | null {
  if (!h) return null;
  const m = sim.def.id;
  const st = sim.state;

  // Pinata parts are not entities: tips, decoys, the core, the tantrum.
  if (m === 'pinata') {
    if (h.id.startsWith('decoy:')) return t('how.pinata.decoy');
    if (h.id.startsWith('tip:')) return t('how.pinata.tip');
    if (h.id === 'core') return t(h.kind === 'shoot' ? 'how.pinata.coreOpen' : 'how.pinata.coreWait');
    return t('how.pinata.wait');
  }

  const actor = st.actors.find((a) => a.id === h.id);
  if (actor) {
    const spec = sim.spec<ActorSpec>(actor.id)!;
    const b = spec.behavior;
    const left = 'hits' in b ? Math.max(1, b.hits - actor.hits) : 1;
    return tk(`how.${m}.${h.id}.${h.kind}`, { n: left }) ?? tk(`how.${m}.${h.id}`, { n: left }) ?? t(h.kind === 'wait' ? 'how.wait' : 'how.shoot');
  }

  const pickup = st.pickups.find((p) => p.id === h.id);
  if (pickup && h.kind === 'pickup') {
    // An ingredient knocked off the shelf mid-cooking is a different job
    // from finding one in stage 1.
    if (h.goal === 'g3' && m === 'cocina') return t('how.cocina.dropped');
    const spec = sim.spec<PickupSpec>(pickup.id)!;
    return tk(`how.${m}.${h.id}`) ?? t(`how.pickup.${spec.item}` as Key);
  }

  if (h.kind === 'shoot' && h.open === false) return tk(`how.${m}.${h.id}.closed`) ?? t('how.wait');
  return tk(`how.${m}.${h.id}.${h.kind}`) ?? tk(`how.${m}.${h.id}`)
    ?? t(h.kind === 'go' ? 'how.go' : h.kind === 'stay' ? 'how.stay' : h.kind === 'wait' ? 'how.wait' : h.need === 'bank' ? 'tip.bank' : h.need === 'heavy' ? 'tip.heavy' : 'how.shoot');
}

/** Why a throw that connected did not count, in words. */
export function rejectText(why: string, id: string): string | null {
  return tk(`how.reject.${why}.${id}`) ?? tk(`how.reject.${why}`);
}
