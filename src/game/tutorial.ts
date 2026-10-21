// Interactive tutorial: each step completes when the player actually does
// the thing it asks for.
export type TutorialStep = 'move' | 'throw' | 'charge' | 'recall' | 'done';

export const TUTORIAL_ORDER: TutorialStep[] = ['move', 'throw', 'charge', 'recall', 'done'];

export class Tutorial {
  step: TutorialStep = 'move';
  t = 0;
  active = false;
  private moved = 0;
  private recallArmed = false;

  reset(): void {
    this.step = 'move';
    this.t = 0;
    this.active = false;
    this.moved = 0;
    this.recallArmed = false;
  }

  start(): void {
    this.reset();
    this.active = true;
  }

  private advance(): TutorialStep {
    const i = TUTORIAL_ORDER.indexOf(this.step);
    this.step = TUTORIAL_ORDER[Math.min(TUTORIAL_ORDER.length - 1, i + 1)]!;
    this.t = 0;
    return this.step;
  }

  // Each notifier returns the new step when the step changed, else null.
  noteMove(dist: number): TutorialStep | null {
    if (!this.active || this.step !== 'move') return null;
    this.moved += dist;
    return this.moved > 2.5 ? this.advance() : null;
  }

  noteDummyHit(charged: boolean): TutorialStep | null {
    if (!this.active) return null;
    if (this.step === 'throw') return this.advance();
    if (this.step === 'charge' && charged) return this.advance();
    return null;
  }

  noteThrow(): void {
    if (this.active && this.step === 'recall') this.recallArmed = true;
  }

  noteRecall(recalled: number): TutorialStep | null {
    if (!this.active || this.step !== 'recall') return null;
    if (recalled > 0 || this.recallArmed) return this.advance();
    return null;
  }

  update(dt: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    // The final message lingers briefly, then the tutorial finishes.
    if (this.step === 'done' && this.t > 2.6) {
      this.active = false;
      return true;
    }
    return false;
  }
}
