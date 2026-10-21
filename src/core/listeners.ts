// Tracks DOM listeners so they can be removed as a group, and keeps a global
// count that the verification hooks use to detect leaks across restarts.
let live = 0;

export function liveListenerCount(): number {
  return live;
}

export class ListenerBag {
  private disposers: Array<() => void> = [];

  on<E extends Event = Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    opts?: AddEventListenerOptions | boolean,
  ): void {
    const listener = fn as unknown as EventListener;
    target.addEventListener(type, listener, opts);
    live++;
    this.disposers.push(() => {
      target.removeEventListener(type, listener, opts);
      live--;
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  get size(): number {
    return this.disposers.length;
  }
}
