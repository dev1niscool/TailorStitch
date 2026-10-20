import assert from 'node:assert/strict';
import test from 'node:test';
import { planStitch } from '../src/engine/index.ts';
import { centralPixels, darkChatFixture, renderPlan, resizeImage } from './chat-fixture.ts';

test('dark chat with a sparse attachment and changing controls stays one thread', () => {
  const { images, expected, header, footer } = darkChatFixture(false);
  const plan = planStitch(images, { autoOrder: true });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(plan.order, [0, 1, 2]);
  assert.equal(plan.height, expected.height);
  assert.deepEqual(
    centralPixels(renderPlan(images, plan), header, plan.height - footer),
    centralPixels(expected, header, expected.height - footer),
  );
});

test('internal seams avoid composer overlays instead of cutting at the viewport edge', () => {
  const { images, expected, header, footer } = darkChatFixture();
  const plan = planStitch(images, { autoOrder: true });
  assert.equal(plan.needsReview, false);
  assert.deepEqual(plan.order, [0, 1, 2]);
  assert.equal(plan.height, expected.height);
  // The last screenshot's composer is retained. Only internal seams must omit
  // its blended edge; every original content row before that must survive.
  const end = plan.height - footer - 5;
  assert.deepEqual(
    centralPixels(renderPlan(images, plan), header, end),
    centralPixels(expected, header, end),
  );
});

test('resized chat screenshots match when the scroll offset falls between pixels', () => {
  const { images, starts } = darkChatFixture(false);
  for (const width of [160, 230, 240, 390]) {
    const resized = images.map(image => resizeImage(image, width));
    const plan = planStitch(resized);
    assert.equal(plan.needsReview, false, `${width}px screenshots should form a coherent thread`);
    assert.deepEqual(plan.order, [0, 1, 2]);
    const scale = resized[0]!.height / images[0]!.height;
    assert.ok(Math.abs(plan.height - (resized[0]!.height + starts.at(-1)! * scale)) <= 1,
      'rounding may move a seam by one pixel, but cannot duplicate or omit a message');
    for (const placement of plan.placements) {
      assert.ok(Math.abs(placement.dy - placement.sy - starts[placement.imageIndex]! * scale) <= 1,
        'each retained region must map to its original location in the continuous thread');
    }
  }
});
