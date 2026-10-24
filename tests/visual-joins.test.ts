import assert from 'node:assert/strict';
import test from 'node:test';
import { planStitch, type ManualCut, type PixelImage, type StitchPlan } from '../src/engine/index.ts';
import { readPng } from './png-fixture.ts';

function image(seed: number, height = 300, width = 96): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    data.set([(x * 11 + y * 17 + seed) % 251, (x * 3 + y * 7 + seed * 13) % 253,
      (Math.floor(x / 7) * 19 + y * 23 + seed * 31) % 255, 255], at);
  }
  return { width, height, data };
}

function slice(source: PixelImage, start: number, height: number): PixelImage {
  return { width: source.width, height,
    data: source.data.slice(start * source.width * 4, (start + height) * source.width * 4) };
}

function render(images: PixelImage[], plan: StitchPlan): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(plan.width * plan.height * 4);
  for (const p of plan.placements) {
    const source = images[p.imageIndex]!;
    assert.ok(p.sh > 0 && p.sy >= 0 && p.sy + p.sh <= source.height);
    pixels.set(source.data.subarray(p.sy * source.width * 4, (p.sy + p.sh) * source.width * 4),
      p.dy * plan.width * 4);
  }
  return pixels;
}

function expected(images: PixelImage[], intervals: [number, number][]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(intervals.reduce((sum, [start, end]) => sum + end - start, 0) * images[0]!.width * 4);
  let cursor = 0;
  intervals.forEach(([start, end], i) => {
    const part = images[i]!.data.subarray(start * images[i]!.width * 4, end * images[i]!.width * 4);
    pixels.set(part, cursor); cursor += part.length;
  });
  return pixels;
}

test('visual source cuts reproduce the selected rows and supersede inferred matching and legacy overlap', () => {
  const images = [image(3), image(73)];
  const plan = planStitch(images, { cropTop: 10, cropBottom: 12,
    manualCuts: { 0: { upperEnd: 173, lowerStart: 89 } }, manualOverlaps: { 0: 999999 } });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(render(images, plan), expected(images, [[10, 173], [89, 288]]));
  assert.equal(plan.joins[0]!.upperEnd, 173);
  assert.equal(plan.joins[0]!.lowerStart, 89);
  assert.equal(plan.joins[0]!.manual, true);
  assert.equal(plan.joins[0]!.topTrim, 0);
  assert.equal(plan.joins[0]!.bottomTrim, 0);
});

test('opening and confirming unchanged automatic seams is pixel-identical', () => {
  const images = ['01', '02', '03'].map(name => readPng(new URL(`../public/demo/${name}.png`, import.meta.url)));
  const automatic = planStitch(images);
  const manualCuts: Record<number, ManualCut> = {};
  automatic.joins.forEach(({ upperEnd, lowerStart }, index) => { manualCuts[index] = { upperEnd, lowerStart }; });
  const confirmed = planStitch(images, { manualCuts });
  assert.equal(confirmed.height, automatic.height);
  assert.deepEqual(render(images, confirmed), render(images, automatic));
  for (let index = 0; index < automatic.joins.length; index++) {
    const upper = automatic.placements.find(p => p.imageIndex === index)!;
    const lower = automatic.placements.find(p => p.imageIndex === index + 1)!;
    assert.equal(automatic.joins[index]!.upperEnd, upper.sy + upper.sh);
    assert.equal(automatic.joins[index]!.lowerStart, lower.sy);
  }
});

test('three screenshots retain exactly their bounded visual intervals and reject overlapping cuts', () => {
  const images = [image(1), image(2), image(3)];
  const manualCuts = { 0: { upperEnd: 190, lowerStart: 71 }, 1: { upperEnd: 148, lowerStart: 92 } };
  const plan = planStitch(images, { manualCuts });
  assert.deepEqual(render(images, plan), expected(images, [[0, 190], [71, 148], [92, 300]]));
  assert.throws(() => planStitch(images, { manualCuts: {
    ...manualCuts, 1: { upperEnd: 70, lowerStart: 92 },
  } }), /joins 1 and 2 overlap/);
  assert.throws(() => planStitch(images, { manualCuts: {
    ...manualCuts, 1: { upperEnd: 71, lowerStart: 92 },
  } }), /keep at least one row/);
  const oneRow = planStitch(images, { manualCuts: {
    ...manualCuts, 1: { upperEnd: 72, lowerStart: 92 },
  } });
  assert.deepEqual(render(images, oneRow), expected(images, [[0, 190], [71, 72], [92, 300]]));
});

test('a later automatic seam cannot consume pixels before a confirmed incoming cut', () => {
  const source = image(23, 700);
  const images = [0, 80, 160].map(start => slice(source, start, 400));
  const plan = planStitch(images, { trimFixedBars: false,
    manualCuts: { 0: { upperEnd: 200, lowerStart: 370 } } });
  assert.equal(plan.joins[0]!.upperEnd, 200);
  assert.equal(plan.joins[0]!.lowerStart, 370);
  assert.ok(plan.joins[1]!.upperEnd > 370);
  assert.ok(plan.placements.some(p => p.imageIndex === 1 && p.sh >= 1));
  assert.equal(plan.joins[1]!.upperEnd - plan.joins[1]!.lowerStart, 80);
  assert.deepEqual(render(images, plan).subarray(0, 200 * source.width * 4), images[0]!.data.subarray(0, 200 * source.width * 4));
});

test('near-total automatic overlaps retain the complete document and expose monotone seams', () => {
  const source = image(37, 500);
  const images = [0, 8, 16].map(start => slice(source, start, 400));
  const plan = planStitch(images, { trimFixedBars: false });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(render(images, plan), slice(source, 0, 416).data);
  assert.ok(plan.joins[0]!.lowerStart <= plan.joins[1]!.upperEnd);
});

test('visual cut validation rejects stale indices, unfixed order, fractional rows, crops, and empty output', () => {
  const images = [image(1), image(2)];
  const valid = { 0: { upperEnd: 100, lowerStart: 50 } };
  assert.throws(() => planStitch(images, { autoOrder: true, manualCuts: valid }), /fixed screenshot order/);
  assert.throws(() => planStitch(images, { manualCuts: { 1: valid[0] } }), /no longer present/);
  assert.throws(() => planStitch(images, { manualCuts: { 0: { upperEnd: 100.5, lowerStart: 50 } } }), /whole source rows/);
  assert.throws(() => planStitch(images, { cropTop: 60, manualCuts: valid }), /within the cropped/);
  assert.throws(() => planStitch(images, { cropBottom: 220, manualCuts: valid }), /within the cropped/);
  assert.throws(() => planStitch(images, { manualCuts: { 0: { upperEnd: 0, lowerStart: 50 } } }), /at least one row/);
  assert.throws(() => planStitch(images, { manualCuts: { 0: { upperEnd: 100, lowerStart: 300 } } }), /at least one row/);
  assert.throws(() => planStitch([images[0]!, images[0]!], { manualCuts: valid }), /no longer present/);
});
