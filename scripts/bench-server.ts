// Server simulation cost, measured: runs N full rooms (1 connected human
// slot plus 3 bots each, all in a live match) in one process for a fixed
// amount of simulated time and reports CPU time per room.
//
//   node --import tsx scripts/bench-server.ts [rooms=1,10,25,50] [seconds=20]
//
// Snapshots are serialized with JSON.stringify exactly as the server does,
// so encoding cost is included. Network I/O is not.
import { Room, type Conn } from '../shared/room';
import { NET } from '../shared/config';

const counts = (process.argv[2] || '1,10,25,50').split(',').map(Number);
const seconds = Number(process.argv[3] || 20);

function run(n: number): { msPerSimSecond: number; perRoomMs: number; bytesPerRoomPerSec: number; worstUpdateMs: number } {
  let bytes = 0;
  const conn: Conn = { send: (m) => { bytes += JSON.stringify(m).length; }, close: () => {} };
  let clock = 0;
  const rooms: Room[] = [];
  for (let i = 0; i < n; i++) {
    const r = new Room(`BENCH${i}`, clock, { practice: true, seed: i + 1 });
    r.addHuman(1, 'Bench', 'x'.repeat(24), conn, clock);
    r.addBot(0);
    r.addBot(1);
    r.addBot(1);
    r.handle(1, { t: 'start' }, clock);
    rooms.push(r);
  }
  // Warm up past the countdown, then measure.
  const step = 1000 / 120; // the server loop interval
  for (let t = 0; t < 4000; t += step) { clock += step; for (const r of rooms) r.update(clock); }
  bytes = 0;
  let worst = 0;
  const t0 = performance.now();
  for (let t = 0; t < seconds * 1000; t += step) {
    clock += step;
    const a = performance.now();
    for (const r of rooms) r.update(clock);
    worst = Math.max(worst, performance.now() - a);
  }
  const wall = performance.now() - t0;
  return { msPerSimSecond: wall / seconds, perRoomMs: wall / seconds / n, bytesPerRoomPerSec: bytes / seconds / n, worstUpdateMs: worst };
}

console.log(`node ${process.version}, tick ${NET.tickRate} Hz, snapshots ${NET.snapshotRate} Hz, ${seconds} s simulated per run`);
for (const n of counts) {
  const r = run(n);
  console.log(JSON.stringify({ rooms: n, cpuMsPerSecond: +r.msPerSimSecond.toFixed(1), cpuPercentOfOneCore: +(r.msPerSimSecond / 10).toFixed(1), perRoomMsPerSecond: +r.perRoomMs.toFixed(2), worstLoopMs: +r.worstUpdateMs.toFixed(2), snapshotBytesPerRoomPerSec: Math.round(r.bytesPerRoomPerSec) }));
}
