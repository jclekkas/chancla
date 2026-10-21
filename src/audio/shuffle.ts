// A shuffle bag: every item plays once before any repeats, and the first
// pick of a new round is never the item that ended the last one.
export class ShuffleBag<T> {
  private left: T[] = [];
  private last: T | null = null;

  constructor(private readonly items: readonly T[], private readonly rand: () => number = Math.random) {}

  /** The next item, refilling (and reshuffling) when the round is used up. */
  next(skip: (item: T) => boolean = () => false): T | null {
    for (let tries = 0; tries <= this.items.length * 2; tries++) {
      if (this.left.length === 0) this.refill();
      const item = this.left.shift();
      if (item === undefined) return null;
      if (skip(item)) continue; // unavailable (failed to load): drawn but not played
      this.last = item;
      return item;
    }
    return null;
  }

  /** Puts a drawn item back on top, so it is the next pick (a pick that was not played). */
  putBack(item: T): void {
    if (!this.left.includes(item)) this.left.unshift(item);
  }

  /** Starts the bag with `first`; the rest of that round follows in random order. */
  lead(first: T): void {
    this.refill(first);
    this.left = [first, ...this.left.filter((x) => x !== first)];
  }

  /** Items still to come in this round (tests and the debug API). */
  remaining(): readonly T[] { return this.left; }

  private refill(avoid: T | null = this.last): void {
    const a = [...this.items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    // No immediate repeat across the boundary between rounds.
    if (a.length > 1 && avoid !== null && a[0] === avoid) {
      const j = 1 + Math.floor(this.rand() * (a.length - 1));
      [a[0], a[j]] = [a[j]!, a[0]!];
    }
    this.left = a;
  }
}
