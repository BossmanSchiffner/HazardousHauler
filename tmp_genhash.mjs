import {createTrackStream} from './src/game/core/trackGenerator.js';
import {METERS_PER_PIXEL} from './src/game/core/economy.js';
import {createHash} from 'node:crypto';
const cases = [[1,'level1','normal'],[153,'level1','normal'],[7,'level2','normal'],[22,'level2','normal'],[33,'level1','continuous'],[9001,'level1','continuous']];
const rowsPer = Number(process.argv[2] ?? 70);
const out = {}; let total = 0;
for (const [seed, level, mode] of cases) {
  const s = createTrackStream(seed, level, mode);
  const h = createHash('sha256'); let d = 0; const t0 = performance.now();
  for (let i = 0; i < rowsPer; i++) {
    if (i === Math.floor(rowsPer * 0.6)) s.resetAfterDepot(d);
    const row = s.nextRow(d, {});
    h.update(JSON.stringify(row));
    d = row.plannedDistance + row.spacingPx * METERS_PER_PIXEL;
  }
  const ms = performance.now() - t0; total += ms;
  out[`${seed}-${level}-${mode}`] = {hash: h.digest('hex').slice(0, 16), dist: Math.round(d), ms: Math.round(ms)};
}
console.log(JSON.stringify(out, null, 1)); console.log('total ms', Math.round(total));

