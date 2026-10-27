// Doña Rosa, the player character: the avatar the engine and the campaign
// place in the world. The model (rosa-model.ts) and the animation
// (rosa-anim.ts) meet through the joints in rosa-rig.ts; this class keeps
// the game-facing state: which ruleros are on her head and where they are.
import * as THREE from 'three';
import type { WeaponId } from '../../../shared/config';
import type { Team } from '../../../shared/map';
import type { Quality } from '../settings';
import { RosaAnimator } from './rosa-anim';
import { buildRosaModel, type RosaModel } from './rosa-model';
import { buildRosaCandidate, candidateReady } from './rosa-candidate';
import type { AvatarState } from './rosa-rig';

export type { AvatarState } from './rosa-rig';
export { buildPesada } from './pesada';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Avatar {
  readonly root: THREE.Group;
  readonly team: Team;
  readonly quality: Quality;
  private model: RosaModel;
  private anim: RosaAnimator;
  private rulMask = -1;
  /** True when she is the Blender-built candidate (rosa-candidate.ts), not the current model. */
  readonly isCandidate: boolean;

  // `home`: the campaign look (no hat or hood), so her ruleros show.
  // `candidate`: the Blender-built Sol (preview), for team 0 in the arena look
  // once its tier is loaded; anything else (or not loaded yet) is the current model.
  constructor(team: Team, opts: { home?: boolean; quality?: Quality; arena?: boolean; candidate?: boolean } = {}) {
    this.team = team;
    this.quality = opts.quality ?? 'high';
    this.isCandidate = !!opts.candidate && team === 0 && !!opts.arena && !opts.home && candidateReady(this.quality);
    this.model = this.isCandidate ? buildRosaCandidate(team, this.quality) : buildRosaModel(team, { home: opts.home, quality: this.quality, arena: opts.arena });
    this.root = this.model.root;
    this.anim = new RosaAnimator(this.model, { simple: this.quality === 'low' });
    if (this.model.rulMesh) {
      this.setRulerosMask((1 << this.model.rulPlace.length) - 1);
      // Bounds would come from the bare geometry, not the instances: never cull (four tiny pieces).
      this.model.rulMesh.frustumCulled = false;
      if (this.model.rulOutline) this.model.rulOutline.frustumCulled = false;
    }
  }

  /** Shows the match ruleros whose bit is set. */
  setRulerosMask(mask: number): void {
    const { rulMesh, rulOutline, rulPlace, rulOutlineScale } = this.model;
    if (mask === this.rulMask || !rulMesh) return;
    this.rulMask = mask;
    const outline = new THREE.Matrix4(), p = new THREE.Vector3(), r = new THREE.Quaternion(), sc = new THREE.Vector3();
    rulPlace.forEach((m, i) => {
      const on = (mask & (1 << i)) !== 0;
      rulMesh.setMatrixAt(i, on ? m : HIDDEN);
      if (rulOutline) {
        m.decompose(p, r, sc);
        rulOutline.setMatrixAt(i, on ? outline.compose(p, r, sc.multiplyScalar(rulOutlineScale)) : HIDDEN);
      }
    });
    rulMesh.instanceMatrix.needsUpdate = true;
    if (rulOutline) rulOutline.instanceMatrix.needsUpdate = true;
  }

  /** World position of roller i (where a flying one starts). */
  ruleroWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.model.rulPlace[i];
    this.root.updateMatrixWorld(true);
    if (!m) return this.model.head.getWorldPosition(out);
    return out.setFromMatrixPosition(m).applyMatrix4(this.model.head.matrixWorld);
  }

  /** Paving height under her (for a roller's bounce). */
  get groundY(): number { return this.root.position.y; }

  /**
   * A cartoon flinch from a melee hit: the head snaps aside and the upper
   * body twists, for a third of a second. `side`: +1 knocked to her left, -1 to her right.
   * `push`: the blow's travel toward her back (negative: from behind; see RosaAnimator.react).
   */
  react(head: boolean, side: number, push?: number): void { this.anim.react(head, side, push); }

  /** A confirmed throw hit: the chancla's travel (world x, z), so her recoil goes with it. */
  hitFrom(dx: number, dz: number): void { this.anim.hitFrom(dx, dz); }

  /**
   * Starts her motion afresh (smoothing, cloth, gait, reactions): for an
   * avatar reused for another character or moment, such as a replay's.
   */
  reset(): void { this.anim.reset(); }

  /** A confirmed miss: a short off-balance follow-through. */
  whiff(weapon: WeaponId): void { this.anim.whiff(weapon); }

  /**
   * How far she stands in the world's shade, 0 (sun) to 1 (fully shaded):
   * the arena look lifts her clothing's received shadow by this much of
   * ARENA_SKIN.bodyLift (rosa-materials.ts). Other looks ignore it.
   */
  setShade(k: number): void {
    for (const m of this.model.flashMats) { const u = m.userData.rosaShade as { value: number } | undefined; if (u) u.value = k; }
  }

  /** Shows the first `n` recovered ruleros on her head (campaign). */
  setRuleros(n: number): void {
    this.model.curlers.forEach((m, i) => (m.visible = i < n));
  }

  dispose(): void {
    for (const m of this.model.flashMats) m.dispose();
    this.model.rulMesh?.dispose();
    this.model.rulOutline?.dispose();
    (this.model.bubble.material as THREE.Material).dispose();
    // Geometry made for this avatar alone (skirt trim, apron, shawl, hair,
    // hat parts...). Shared geometry and cached materials stay. Missing this
    // left about 7-9 GPU buffers behind per avatar, every match (soak test).
    this.root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g && !g.userData.shared) g.dispose();
      // The candidate's skeleton owns its bone texture.
      (o as THREE.SkinnedMesh).skeleton?.dispose();
    });
  }

  update(s: AvatarState, dt: number, reducedMotion: boolean): void {
    this.anim.update(s, dt, reducedMotion);
    if (s.ruleros !== undefined) this.setRulerosMask(s.ruleros);
  }
}
