import assert from 'assert';
import { americanToProbRaw, devigTwoWay, linInterp, impliedMedianFromAlts } from '../compute.js';

// americanToProbRaw tests
assert.strictEqual(americanToProbRaw(-150), 0.6, 'americanToProbRaw -150');
assert.strictEqual(americanToProbRaw(200), 100 / 300, 'americanToProbRaw 200');

// devigTwoWay tests
let dv = devigTwoWay(0.55, 0.55);
assert.deepStrictEqual(dv, { pOver: 0.5, pUnder: 0.5 }, 'devig equal probabilities');

dv = devigTwoWay(0.6, 0.4);
assert.deepStrictEqual(dv, { pOver: 0.6, pUnder: 0.4 }, 'devig preserves proportions');

// linInterp tests
assert.strictEqual(linInterp(5, 0, 10, 0, 100), 50, 'linInterp basic');

// impliedMedianFromAlts tests
const alts = [
  { point: 8, over: -120, under: 100 },
  { point: 9, over: 100, under: -120 }
];
const median = impliedMedianFromAlts(alts);
assert.strictEqual(median, 8.5, 'median between alternating lines');

const outOfRange = [
  { point: 7, over: -150, under: 130 },
  { point: 8, over: -130, under: 110 }
];
assert.strictEqual(impliedMedianFromAlts(outOfRange), null, 'out-of-range median returns null');

console.log('All compute helper tests passed.');
