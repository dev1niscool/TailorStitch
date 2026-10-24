import { test, expect, type Locator, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { editorImages, stackRows } from '../editor-fixture';
import { readPng } from '../png-fixture';
import type { PixelImage } from '../../src/engine/index.ts';
import { applyVisualJoin, expectDownloadedPixels, expectFinished, expectOutput,
  openVisualJoin, selectPixelFixture, useDemo } from './helpers';

const demoPath = (name: string) => path.resolve('public/demo', name);
const demoExpected = readPng(pathToFileURL(path.resolve('tests/fixtures/demo-expected.png')));

async function prepareCharts(page: Page, count = 2) {
  const images = editorImages(count);
  await page.locator('#auto-order').uncheck();
  await page.locator('#trim-bars').uncheck();
  await selectPixelFixture(page, images);
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG', exact: true })).toBeDisabled();
  return images;
}

async function rangeByKeyboard(range: Locator, value: number) {
  const min = Number(await range.getAttribute('min'));
  const max = Number(await range.getAttribute('max'));
  const start = value - min < max - value ? min : max;
  await range.focus();
  await range.press(start === min ? 'Home' : 'End');
  const direction = value >= start ? 'ArrowRight' : 'ArrowLeft';
  const distance = Math.abs(value - start);
  for (let i = 0; i < Math.floor(distance / 10); i++) await range.press(`Shift+${direction}`);
  for (let i = 0; i < distance % 10; i++) await range.press(direction);
  await expect(range).toHaveValue(String(value));
}

async function pointerPath(page: Page, selector: string, sourceRows: number, sourceWidth: number) {
  const surface = await page.locator(selector).boundingBox();
  const stage = await page.locator('#join-editor-stage').boundingBox();
  if (!surface || !stage) throw new Error('The join controls are not visible.');
  const scale = surface.width / sourceWidth;
  const x = surface.x + surface.width / 2;
  const y = selector === '#join-trim-handle' ? surface.y + surface.height / 2 :
    Math.max(stage.y + 25, Math.min(surface.y + surface.height - 40, stage.y + stage.height * .45));
  return { x, y, endY: y + sourceRows * scale };
}

async function mouseDragRows(page: Page, selector: string, rows: number, width: number) {
  const { x, y, endY } = await pointerPath(page, selector, rows, width);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 8 });
  await page.mouse.up();
}

/** Compare the visible cut to an independently composed image, away from resampling at the seam. */
async function expectCutPreview(page: Page, expected: PixelImage, seamRow: number) {
  await page.getByRole('button', { name: 'Show cut result', exact: true }).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const comparison = await page.evaluate(({ width, height, base64, seamRow }) => {
    const preview = document.querySelector<HTMLCanvasElement>('#join-editor-canvas')!;
    const guide = document.querySelector<HTMLElement>('#join-cut-guide')!;
    const bounds = preview.getBoundingClientRect(), line = guide.getBoundingClientRect();
    const dpr = preview.width / bounds.width;
    const scale = line.width / width;
    const left = line.left - bounds.left, seamY = line.top - bounds.top;
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    source.getContext('2d')!.putImageData(new ImageData(
      Uint8ClampedArray.from(atob(base64), byte => byte.charCodeAt(0)), width, height), 0, 0);
    const reference = document.createElement('canvas'); reference.width = preview.width; reference.height = preview.height;
    const ctx = reference.getContext('2d')!; ctx.scale(dpr, dpr);
    ctx.drawImage(source, left, seamY - seamRow * scale, width * scale, height * scale);
    const actual = preview.getContext('2d')!.getImageData(0, 0, preview.width, preview.height).data;
    const desired = reference.getContext('2d')!.getImageData(0, 0, reference.width, reference.height).data;
    let different = 0, samples = 0, maximumDifference = 0, totalDifference = 0;
    for (const side of [-1, 1]) for (let dy = 8; dy < 35; dy++) {
      const y = Math.floor((seamY + side * dy) * dpr);
      if (y < 0 || y >= preview.height) continue;
      for (let dx = width * .3; dx < width * .7; dx += 3) {
        const x = Math.floor((left + dx * scale) * dpr), at = (y * preview.width + x) * 4;
        for (let c = 0; c < 4; c++) {
          samples++;
          const difference = Math.abs(actual[at + c]! - desired[at + c]!);
          totalDifference += difference;
          maximumDifference = Math.max(maximumDifference, difference);
          if (difference > 2) different++;
        }
      }
    }
    return { different, samples, maximumDifference, meanDifference: totalDifference / samples };
  }, { width: expected.width, height: expected.height, base64: Buffer.from(expected.data).toString('base64'), seamRow });
  expect(comparison.samples).toBeGreaterThan(100);
  // Canvas rasterizers round a scaled source subrectangle slightly differently
  // from a precomposed bitmap. Full-resolution exports below remain byte-exact.
  expect(comparison.meanDifference, JSON.stringify(comparison)).toBeLessThan(1);
  expect(comparison.different / comparison.samples).toBeLessThan(.02);
  expect(comparison.maximumDifference).toBeLessThanOrEqual(16);
}

test.beforeEach(async ({ page }) => { await page.goto('./'); });

test('automatic visual preview is unchanged by OK, Cancel, Escape, or reopening', async ({ page }) => {
  await page.locator('#file-input').setInputFiles([demoPath('03.png'), demoPath('01.png'), demoPath('02.png')]);
  await expectOutput(page, demoExpected);
  await openVisualJoin(page);
  const upperEnd = Number(await page.locator('#join-trim-range').inputValue());
  const lowerStart = Number(await page.locator('#join-overlap-range').inputValue());
  await page.getByRole('button', { name: 'Next: align', exact: true }).click();
  const upper = readPng(pathToFileURL(demoPath('01.png'))), lower = readPng(pathToFileURL(demoPath('02.png')));
  await expectCutPreview(page, stackRows([upper, lower], [
    { source: 0, start: 0, end: upperEnd }, { source: 1, start: lowerStart, end: lower.height },
  ]), upperEnd);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#auto-order')).toBeChecked();
  await expect(page.locator('.image-row-info strong').first()).toContainText('03.png');
  await expectOutput(page, demoExpected);

  await openVisualJoin(page);
  await applyVisualJoin(page);
  await expectOutput(page, demoExpected);
  await expect(page.locator('#auto-order')).not.toBeChecked();
  await expect(page.locator('.image-row-info strong').first()).toContainText('01.png');
  await page.locator('#stitch-button').click();
  await expectOutput(page, demoExpected);
  await openVisualJoin(page);
  await expect(page.locator('#join-trim-range')).toHaveValue(String(upperEnd));
  await rangeByKeyboard(page.locator('#join-trim-range'), upperEnd - 10);
  await page.getByRole('button', { name: 'Reset changes', exact: true }).click();
  await expect(page.locator('#join-trim-range')).toHaveValue(String(upperEnd));
  await expect(page.locator('#join-overlap-range')).toHaveValue(String(lowerStart));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Adjust join', exact: true })).toBeHidden();
  await expectOutput(page, demoExpected);
});

test('dragging trims the upper bottom then moves the upper photo down over the lower', async ({ page, isMobile }) => {
  const images = await prepareCharts(page);
  await openVisualJoin(page, 0, isMobile);
  await expect(page.locator('#join-cut-guide')).toHaveCSS('border-top-style', 'dashed');
  await page.locator('#join-editor-zoom-in').click();
  await expect(page.locator('#join-editor-fit')).toHaveText('150%');
  await mouseDragRows(page, '#join-trim-handle', -40, images[0]!.width);
  await expect(page.locator('#join-trim-range')).toHaveValue('280');
  await page.getByRole('button', { name: 'Fit photos to width', exact: true }).click();
  await expect(page.locator('#join-trim-range')).toHaveValue('280');
  await page.getByRole('button', { name: 'Next: align', exact: true }).click();
  await mouseDragRows(page, '#join-upper-drag', 50, images[0]!.width);
  await expect(page.locator('#join-overlap-range')).toHaveValue('50');
  const expected = stackRows(images, [{ source: 0, start: 0, end: 280 }, { source: 1, start: 50, end: 320 }]);
  await expectCutPreview(page, expected, 280);
  await applyVisualJoin(page);
  await expectOutput(page, expected);
  await expectDownloadedPixels(page, expected);
  await openVisualJoin(page);
  await expect(page.locator('#join-trim-range')).toHaveValue('280');
  await expect(page.locator('#join-overlap-range')).toHaveValue('50');
  await rangeByKeyboard(page.locator('#join-trim-range'), 260);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectOutput(page, expected);
});

test('keyboard edits respect adjacent cuts, and resetting restores all source rows', async ({ page }) => {
  const images = await prepareCharts(page, 3);
  await openVisualJoin(page);
  await rangeByKeyboard(page.locator('#join-trim-range'), 280);
  await page.getByRole('button', { name: 'Next: align', exact: true }).click();
  await rangeByKeyboard(page.locator('#join-overlap-range'), 50);
  await applyVisualJoin(page);
  await expect(page.getByRole('button', { name: 'Save PNG', exact: true })).toBeDisabled();
  await openVisualJoin(page, 1);
  await expect(page.locator('#join-trim-range')).toHaveAttribute('min', '51');
  await rangeByKeyboard(page.locator('#join-trim-range'), 200);
  await page.getByRole('button', { name: 'Next: align', exact: true }).click();
  await rangeByKeyboard(page.locator('#join-overlap-range'), 70);
  await applyVisualJoin(page);
  const rows = [{ source: 0, start: 0, end: 280 }, { source: 1, start: 50, end: 200 }, { source: 2, start: 70, end: 320 }];
  await expectOutput(page, stackRows(images, rows));
  await openVisualJoin(page);
  await page.getByRole('button', { name: 'Next: align', exact: true }).click();
  await expect(page.locator('#join-overlap-range')).toHaveAttribute('max', '199');
  await rangeByKeyboard(page.locator('#join-overlap-range'), 199);
  await applyVisualJoin(page);
  rows[1]!.start = 199;
  const expected = stackRows(images, rows);
  await expectOutput(page, expected);
  await expectDownloadedPixels(page, expected);
  await openVisualJoin(page, 1);
  await expect(page.locator('#join-trim-range')).toHaveAttribute('min', '200');
  await page.locator('#join-trim-range').press('Shift+ArrowLeft');
  await expect(page.locator('#join-trim-range')).toHaveValue('200');
  await page.keyboard.press('Escape');
  await expectOutput(page, expected);
  await page.getByRole('button', { name: 'Reset manual adjustments', exact: true }).click();
  await expectOutput(page, stackRows(images, images.map((_, source) => ({ source, start: 0, end: 320 }))));
  await expect(page.getByRole('button', { name: 'Save PNG', exact: true })).toBeDisabled();
  await expect(page.locator('.join-status')).toHaveText(['Review', 'Review']);
});

test('changing source crops or order clears visual adjustments', async ({ page }) => {
  await useDemo(page);
  await openVisualJoin(page);
  await page.getByRole('button', { name: 'Next: align', exact: true }).click();
  const lowerStart = Number(await page.locator('#join-overlap-range').inputValue());
  await rangeByKeyboard(page.locator('#join-overlap-range'), lowerStart + 10);
  await applyVisualJoin(page);
  await expect(page.locator('.join-status').first()).toHaveText('Manual');
  await page.getByText('Fine-tune crops', { exact: true }).click();
  await page.locator('#crop-top').fill('74'); await page.locator('#crop-top').press('Tab');
  await expectFinished(page);
  await page.locator('#crop-bottom').fill('36'); await page.locator('#crop-bottom').press('Tab');
  const cropped: PixelImage = { width: demoExpected.width, height: demoExpected.height - 110,
    data: demoExpected.data.slice(74 * demoExpected.width * 4, (demoExpected.height - 36) * demoExpected.width * 4) };
  await expectOutput(page, cropped);
  await expect(page.locator('.join-status')).toHaveText(['Matched', 'Matched']);
  await openVisualJoin(page); await applyVisualJoin(page);
  await expect(page.locator('.join-status').first()).toHaveText('Manual');
  await page.getByRole('button', { name: 'Move screenshot 2 up', exact: true }).click();
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Reset manual adjustments', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Move screenshot 1 down', exact: true }).click();
  await expectOutput(page, cropped);
  await expect(page.locator('.join-status')).toHaveText(['Matched', 'Matched']);
});

test.describe('touch gestures', () => {
  test.use({ hasTouch: true });
  test('trusted touch dragging uses the same source cuts and does not scroll the stage', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit exposes native taps but no touch-move automation API; its pointer and keyboard paths run above.');
    const images = await prepareCharts(page);
    await openVisualJoin(page, 0, true);
    const session = await context.newCDPSession(page);
    await page.evaluate(() => {
      (window as unknown as { touchEvidence: Array<{ type: string; trusted: boolean }> }).touchEvidence = [];
      document.addEventListener('pointerdown', event => {
        (window as unknown as { touchEvidence: Array<{ type: string; trusted: boolean }> }).touchEvidence.push({ type: event.pointerType, trusted: event.isTrusted });
      });
    });
    const drag = async (selector: string, rows: number) => {
      const { x, y, endY } = await pointerPath(page, selector, rows, images[0]!.width);
      const scroll = await page.locator('#join-editor-stage').evaluate(el => el.scrollTop);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let i = 1; i <= 8; i++) await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: y + (endY - y) * i / 8, id: 1 }],
      });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      expect(await page.locator('#join-editor-stage').evaluate(el => el.scrollTop)).toBe(scroll);
    };
    await drag('#join-trim-handle', -30);
    await expect(page.locator('#join-trim-range')).toHaveValue('290');
    await page.getByRole('button', { name: 'Next: align', exact: true }).tap();
    await drag('#join-upper-drag', 40);
    await expect(page.locator('#join-overlap-range')).toHaveValue('40');
    await applyVisualJoin(page);
    await expectOutput(page, stackRows(images, [{ source: 0, start: 0, end: 290 }, { source: 1, start: 40, end: 320 }]));
    const evidence = await page.evaluate(() => (window as unknown as { touchEvidence: Array<{ type: string; trusted: boolean }> }).touchEvidence);
    expect(evidence.filter(event => event.type === 'touch' && event.trusted).length).toBeGreaterThanOrEqual(2);
  });
});
