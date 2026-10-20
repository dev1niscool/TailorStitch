import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePair, planStitch, type PixelImage, type StitchPlan } from '../src/engine/index.ts';
import { readPng } from './png-fixture.ts';

function solid(width: number, height: number, color = 248): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color; data[i + 1] = color; data[i + 2] = color; data[i + 3] = 255;
  }
  return { width, height, data };
}

function rectangle(image: PixelImage, x: number, y: number, w: number, h: number, color: number[]): void {
  for (let row = y; row < Math.min(image.height, y + h); row++) {
    for (let column = x; column < Math.min(image.width, x + w); column++) {
      if (row < 0 || column < 0) continue;
      const at = (row * image.width + column) * 4;
      image.data.set([...color, 255], at);
    }
  }
}

/** A deterministic document with varied cards, text-like marks and white space. */
function documentImage(width = 192, height = 1200, seed = 17): PixelImage {
  const image = solid(width, height);
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let y = 0; y < height; y += 36) {
    const indent = Math.floor(random() * width * 0.15) + 8;
    const length = Math.floor(random() * width * 0.55) + Math.floor(width * 0.25);
    const color = Math.floor(random() * 160) + 20;
    rectangle(image, indent, y + 3, length, 9, [color, Math.max(0, color - 10), color + 15]);
    rectangle(image, indent, y + 18, Math.floor(length * (0.35 + random() * 0.5)), 5, [175, 177, 182]);
    for (let x = indent + 7; x < indent + length; x += 13) {
      rectangle(image, x, y + 3, 3, Math.floor(random() * 7) + 1, [248, 248, 248]);
    }
  }
  return image;
}

function slice(image: PixelImage, start: number, height: number): PixelImage {
  return { width: image.width, height,
    data: image.data.slice(start * image.width * 4, (start + height) * image.width * 4) };
}

function withChrome(image: PixelImage, header = 32, footer = 24): PixelImage {
  const result = solid(image.width, image.height + header + footer, 235);
  rectangle(result, 0, 0, image.width, header, [34, 42, 63]);
  rectangle(result, 16, 11, image.width - 32, 6, [222, 228, 250]);
  result.data.set(image.data, header * image.width * 4);
  rectangle(result, 20, result.height - 12, image.width - 40, 3, [72, 75, 92]);
  return result;
}

function render(images: PixelImage[], plan: StitchPlan): PixelImage {
  const result = solid(plan.width, plan.height, 255);
  for (const p of plan.placements) {
    const image = images[p.imageIndex]!;
    result.data.set(image.data.subarray(p.sy * image.width * 4, (p.sy + p.sh) * image.width * 4),
      p.dy * result.width * 4);
  }
  return result;
}

test('finds exact overlap and reconstructs the original document pixel-for-pixel', () => {
  const doc = documentImage();
  const images = [slice(doc, 0, 400), slice(doc, 247, 400), slice(doc, 516, 400)];
  const plan = planStitch(images, { trimFixedBars: false });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(plan.joins.map(join => join.overlap), [153, 131]);
  assert.deepEqual(render(images, plan), slice(doc, 0, 916));
});

test('removes repeated chrome and retains the first header and final footer', () => {
  const doc = documentImage();
  const images = [0, 203, 441].map(start => withChrome(slice(doc, start, 360)));
  const plan = planStitch(images);
  assert.equal(plan.needsReview, false);
  assert.ok(plan.joins.every(join => join.topTrim >= 32 && join.bottomTrim >= 24));
  assert.deepEqual(render(images, plan), withChrome(slice(doc, 0, 801)));
});

test('sorts an unambiguous chain, skipping exact duplicate selections', () => {
  const doc = documentImage();
  const first = withChrome(slice(doc, 0, 400));
  const middle = withChrome(slice(doc, 211, 400));
  const last = withChrome(slice(doc, 458, 400));
  const images = [last, first, middle, first];
  const plan = planStitch(images, { autoOrder: true });
  assert.deepEqual(plan.order, [1, 2, 0]);
  assert.deepEqual(plan.skipped, [3]);
  assert.deepEqual(render(images, plan), withChrome(slice(doc, 0, 858)));
});

test('unrelated screenshots are kept intact and explicitly require review', () => {
  const images = [documentImage(192, 300, 1), documentImage(192, 300, 99)];
  const plan = planStitch(images);
  assert.equal(plan.needsReview, true);
  assert.equal(plan.height, 600);
  assert.equal(plan.joins[0]!.appliedOverlap, 0);
  assert.deepEqual(render(images, plan).data.slice(0, images[0]!.data.length), images[0]!.data);
});

test('featureless screenshots do not produce a confident overlap', () => {
  const first = solid(128, 300, 255);
  const second = solid(128, 301, 255);
  assert.equal(analyzePair(first, second).status, 'unrelated');
});

test('periodic repeated content is flagged for review', () => {
  const doc = solid(192, 700);
  for (let y = 0; y < doc.height; y += 30) {
    rectangle(doc, 20, y + 4, 135, 8, [30, 50, 90]);
    rectangle(doc, 20, y + 18, 90, 5, [170, 175, 180]);
  }
  const result = analyzePair(slice(doc, 0, 300), slice(doc, 121, 300), { trimFixedBars: false });
  assert.equal(result.status, 'uncertain');
});

test('small compression-like noise still finds the correct overlap', () => {
  const doc = documentImage();
  const first = slice(doc, 0, 400);
  const second = slice(doc, 233, 400);
  for (let i = 0; i < second.data.length; i++) {
    if (i % 4 !== 3) second.data[i] = second.data[i]! + (i % 7 - 3);
  }
  const result = analyzePair(first, second, { trimFixedBars: false });
  assert.equal(result.status, 'matched');
  assert.equal(result.overlap, 167);
});

test('manual overlap resolves a join and explicit crops apply to every image', () => {
  const images = [documentImage(128, 250, 4), documentImage(128, 250, 33)];
  const plan = planStitch(images, { cropTop: 10, cropBottom: 12, trimFixedBars: false,
    manualOverlaps: { 0: 60 } });
  assert.equal(plan.needsReview, false);
  assert.equal(plan.height, 396);
  assert.equal(plan.placements[0]!.sy, 10);
  assert.equal(plan.placements[1]!.sy, 70);
  assert.equal(plan.joins[0]!.manual, true);
});

test('different screenshot heights still stitch without scaling', () => {
  const doc = documentImage();
  const images = [slice(doc, 0, 400), slice(doc, 237, 310)];
  const plan = planStitch(images, { trimFixedBars: false });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(render(images, plan), slice(doc, 0, 547));
});

test('rejects mismatched widths and invalid crops and overrides', () => {
  assert.throws(() => planStitch([solid(20, 30), solid(21, 30)]), /width/);
  assert.throws(() => planStitch([solid(20, 30)], { cropTop: 30 }), /crop/);
  assert.throws(() => planStitch([solid(20, 30), solid(20, 31)], {
    manualOverlaps: { 0: 200 },
  }), /overlap/);
});

test('single, empty and duplicate-only inputs have deterministic plans', () => {
  assert.equal(planStitch([]).height, 0);
  const image = documentImage(64, 80);
  assert.equal(planStitch([image], { cropTop: 2, cropBottom: 3 }).height, 75);
  const plan = planStitch([image, image, image], { autoOrder: true });
  assert.deepEqual(plan.order, [0]);
  assert.deepEqual(plan.skipped, [1, 2]);
  assert.equal(plan.height, 80);
});

test('wide screenshots and sub-stride offsets preserve exact pixels', () => {
  const doc = documentImage(1170, 2700);
  const images = [slice(doc, 0, 1800), slice(doc, 713, 1800)];
  const plan = planStitch(images, { trimFixedBars: false });
  assert.equal(plan.needsReview, false);
  assert.equal(plan.joins[0]!.overlap, 1087);
  assert.deepEqual(render(images, plan), slice(doc, 0, 2513));
});

test('bundled demo screenshots reproduce the independently generated full PNG exactly', () => {
  const images = ['01', '02', '03'].map(name =>
    readPng(new URL(`../public/demo/${name}.png`, import.meta.url)));
  const expected = readPng(new URL('./fixtures/demo-expected.png', import.meta.url));
  const plan = planStitch(images, { autoOrder: true });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(plan.joins.map(join => join.overlap), [270, 270]);
  assert.deepEqual(render(images, plan), expected);
});

test('a changing status clock does not prevent fixed-header removal', () => {
  const images = ['01', '02', '03'].map(name =>
    readPng(new URL(`../public/demo/${name}.png`, import.meta.url)));
  // A conspicuous changing clock area at 11–16% of the image width.
  rectangle(images[1]!, 48, 12, 18, 15, [255, 0, 0]);
  const plan = planStitch(images);
  const expected = readPng(new URL('./fixtures/demo-expected.png', import.meta.url));
  assert.equal(plan.needsReview, false);
  assert.deepEqual(render(images, plan), expected);
});

test('sparse real text with a short unique overlap aligns exactly', () => {
  const doc = readPng(new URL('./fixtures/demo-source.png', import.meta.url));
  const images = [slice(doc, 0, 670), slice(doc, 590, 670)];
  const plan = planStitch(images, { trimFixedBars: false });
  assert.equal(plan.needsReview, false);
  assert.equal(plan.joins[0]!.overlap, 80);
  assert.deepEqual(render(images, plan), slice(doc, 0, 1260));
});

test('similar chat layouts with different short messages never discard a screenshot', () => {
  const chat = (seed: number): PixelImage => {
    const image = solid(390, 700, 255);
    let state = seed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    let y = 25;
    for (let card = 0; card < 8; card++) {
      const lines = card % 3 + 1;
      const x = card % 2 ? 80 : 20;
      rectangle(image, x, y, card % 2 ? 280 : 300, lines * 15 + 20, [240, 240, 240]);
      rectangle(image, x + 10, y + 8, 18, 3, [70, 70, 70]);
      for (let line = 0; line < lines; line++) {
        for (let char = 0; char < 12; char++) {
          const bits = Math.floor(random() * 64);
          for (let bit = 0; bit < 6; bit++) {
            if (bits & (1 << bit)) rectangle(image, x + 10 + char * 8 + bit % 2 * 2,
              y + 15 + line * 15 + Math.floor(bit / 2) * 2, 2, 2, [60, 60, 60]);
          }
        }
      }
      y += lines * 15 + 32;
    }
    return image;
  };
  for (let seed = 1; seed <= 8; seed++) {
    const plan = planStitch([chat(seed), chat(seed + 99)]);
    assert.equal(plan.needsReview, true);
    assert.equal(plan.height, 1400);
    assert.equal(plan.joins[0]!.appliedOverlap, 0);
  }
});
