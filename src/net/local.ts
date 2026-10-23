// Practice host: runs the real Hub and Room in the browser, with a virtual
// clock that stops while paused. The client talks to it through the same
// Transport interface as the online server, with messages round-tripped
// through JSON exactly as they would be on the wire.
import { Hub } from '../../shared/hub';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import type { Transport, TransportFactory } from './session';

export class LocalHost {
  readonly hub: Hub;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pausedAt = -1;
  private pausedTotal = 0;

  constructor() {
    this.hub = new Hub({ allowPractice: true, now: () => this.now() });
    this.timer = setInterval(() => { if (this.pausedAt < 0) this.hub.update(); }, 1000 / 120);
  }

  now(): number {
    const real = performance.now();
    return (this.pausedAt >= 0 ? this.pausedAt : real) - this.pausedTotal;
  }

  get paused(): boolean { return this.pausedAt >= 0; }

  pause(): void { if (this.pausedAt < 0) this.pausedAt = performance.now(); }

  /** Uses up every input already sent before a pause (see Room.drainInputs). Returns the ticks run. */
  settle(): number {
    let n = 0;
    for (const room of this.hub.rooms.values()) n += room.drainInputs();
    return n;
  }

  resume(): void {
    if (this.pausedAt < 0) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = -1;
  }

  transport(): TransportFactory {
    return () => {
      let open = true;
      const t: Transport = {
        onMessage: null, onClose: null, onOpen: null,
        send: (m: ClientMsg) => { if (open) this.hub.message(session, JSON.parse(JSON.stringify(m))); },
        close: () => { if (!open) return; open = false; this.hub.closed(session); queueMicrotask(() => t.onClose?.(1000)); },
      };
      const session = this.hub.open({
        send: (m: ServerMsg) => { if (!open) return; const s = JSON.stringify(m); queueMicrotask(() => { if (open) t.onMessage?.(JSON.parse(s)); }); },
        close: () => { if (!open) return; open = false; queueMicrotask(() => t.onClose?.(1000)); },
      });
      queueMicrotask(() => t.onOpen?.());
      return t;
    };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hub.shutdown();
  }
}
