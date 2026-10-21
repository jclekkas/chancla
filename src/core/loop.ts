import { MAX_FRAME_DT, MAX_STEPS_PER_FRAME, SIM_DT } from '../config';

// Fixed-timestep loop with a capped accumulator. Only one animation frame
// request is ever outstanding, so start() can be called repeatedly safely.
let activeLoops = 0;

export function activeLoopCount(): number {
  return activeLoops;
}

export interface LoopCallbacks {
  begin?(frameDt: number): void;
  step(dt: number, firstStep: boolean): void;
  render(frameDt: number, alpha: number): void;
}

export class FixedLoop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private cb: LoopCallbacks;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  frameTimes: number[] = [];

  constructor(cb: LoopCallbacks) {
    this.cb = cb;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    activeLoops++;
    this.last = performance.now();
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    activeLoops--;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (!(frameDt > 0)) frameDt = 0;
    // Measure real frame time before clamping the simulation step.
    this.fpsAcc += frameDt;
    this.fpsFrames++;
    if (this.frameTimes.length < 600) this.frameTimes.push(frameDt * 1000);
    if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;

    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this.cb.begin?.(frameDt);
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      this.cb.step(SIM_DT, steps === 0);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    this.cb.render(frameDt, this.acc / SIM_DT);
  };
}
