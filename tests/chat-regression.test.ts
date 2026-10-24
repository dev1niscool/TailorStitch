import assert from 'node:assert/strict';
import test from 'node:test';
import { planStitch } from '../src/engine/index.ts';
import { centralPixels, darkChatFixture, glassHeaderFixture, headerCropTrapFixture, periodicStickerFixture,
  renderPlan, resizeImage, sharedStickerOnlyFixture, tintedChatFixture } from './chat-fixture.ts';

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

test('viewport-relative bubble gradients preserve one continuous four-screenshot thread', () => {
  for (const gradient of [70, 110]) {
    const { images, starts, height } = tintedChatFixture(false, false, { gradient });
    const plan = planStitch(images, { autoOrder: true });
    assert.equal(plan.needsReview, false);
    assert.deepEqual(plan.order, [0, 1, 2, 3]);
    assert.equal(plan.height, height);
    for (const placement of plan.placements) {
      assert.equal(placement.dy - placement.sy, starts[placement.imageIndex],
        'every rendered region must retain its exact position in the source thread');
    }
  }
});

test('matching bright bubble shapes with different message text still require review', () => {
  const { images } = tintedChatFixture(true);
  const plan = planStitch(images.slice(0, 2));
  assert.equal(plan.needsReview, true);
  assert.equal(plan.joins[0]!.appliedOverlap, 0);
  assert.equal(plan.height, images[0]!.height + images[1]!.height);
});

test('bright bubble outlines cannot vouch for different sparse short messages', () => {
  const { images } = tintedChatFixture(true, true);
  const plan = planStitch(images.slice(0, 2));
  assert.equal(plan.needsReview, true);
  assert.equal(plan.joins[0]!.appliedOverlap, 0);
  assert.equal(plan.height, images[0]!.height + images[1]!.height);
});

test('recolored bubble outlines alone are insufficient evidence to remove content', () => {
  for (const rounded of [false, true]) {
    const { images } = tintedChatFixture(false, false, { drawText: false, rounded });
    const plan = planStitch(images.slice(0, 2));
    assert.equal(plan.needsReview, true, `${rounded ? 'rounded' : 'rectangular'} outlines need interior evidence`);
    assert.equal(plan.joins[0]!.appliedOverlap, 0);
    assert.equal(plan.height, images[0]!.height + images[1]!.height);
  }
});

test('a subtly tinted fixed header does not enter the conversation or hide a real overlap', () => {
  const fixture = glassHeaderFixture();
  for (const selection of [[0, 1, 2, 3], [2, 0, 3, 1]]) {
    const images = selection.map(index => fixture.images[index]!);
    const plan = planStitch(images, { autoOrder: true });
    assert.equal(plan.needsReview, false);
    assert.deepEqual(plan.order.map(index => selection[index]), [0, 1, 2, 3]);
    assert.equal(plan.height, fixture.height);
    for (const placement of plan.placements) {
      assert.equal(placement.dy - placement.sy, fixture.starts[selection[placement.imageIndex]!],
        'retained content must stay in its exact position in the full thread');
    }
    assert.deepEqual(
      centralPixels(renderPlan(images, plan), fixture.header, plan.height - fixture.footer),
      centralPixels(fixture.source, 0, fixture.source.height),
      'every message and repeated sticker must appear once, with no internal contact header',
    );
  }
});

test('detailed repeated stickers require review when the scroll offset is ambiguous', () => {
  const images = periodicStickerFixture();
  const plan = planStitch(images);
  assert.equal(plan.needsReview, true);
  assert.equal(plan.joins[0]!.appliedOverlap, 0);
  assert.equal(plan.height, images[0]!.height + images[1]!.height);
});

test('a common sticker and tinted header cannot hide different surrounding messages', () => {
  const images = sharedStickerOnlyFixture();
  const plan = planStitch(images);
  assert.equal(plan.needsReview, true);
  assert.equal(plan.joins[0]!.appliedOverlap, 0);
  assert.equal(plan.height, images[0]!.height + images[1]!.height);
});

test('header recovery cannot crop away contradictory messages to match a shared sticker', () => {
  const images = headerCropTrapFixture();
  const plan = planStitch(images);
  assert.equal(plan.needsReview, true);
  assert.equal(plan.joins[0]!.appliedOverlap, 0);
  assert.equal(plan.height, images[0]!.height + images[1]!.height);
});
