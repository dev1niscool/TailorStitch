import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readPng } from '../png-fixture';
import { glassHeaderFixture, tintedChatFixture } from '../chat-fixture';
import { applyVisualJoin, expectFinished, openVisualJoin, outputHash, selectPixelFixture, useDemo } from './helpers';

const fixture = (name: string) => path.resolve('public/demo', name);
const expected = readPng(pathToFileURL(path.resolve('tests/fixtures/demo-expected.png')));
const expectedHash = createHash('sha256').update(expected.data).digest('hex');

async function syntheticPng(page: Page, name: string, width: number, color: string) {
  const base64 = await page.evaluate(({ width, color }) => {
    const image = document.createElement('canvas');
    image.width = width;
    image.height = 300;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, 300);
    return image.toDataURL('image/png').split(',')[1]!;
  }, { width, color });
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('empty workspace is responsive and dialogs support keyboard dismissal', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'The whole picture.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Stitch screenshots/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your screenshots stay yours.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Get it on iPhone' }).click();
  await expect(page.getByRole('dialog')).toContainText('Add to Home Screen');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('demo creates pixel-perfect PNG without image upload and can be downloaded', async ({ page }) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  page.on('pageerror', error => errors.push(error.message));
  await useDemo(page);
  await expect(page.locator('#output-canvas')).toHaveAttribute('width', '420');
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', '1580');
  expect(await outputHash(page)).toBe(expectedHash);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^tailorstitch-\d{4}-\d{2}-\d{2}\.png$/);
  const saved = readPng(pathToFileURL((await download.path())!));
  expect(saved.width).toBe(420);
  expect(saved.height).toBe(1580);
  expect(createHash('sha256').update(saved.data).digest('hex')).toBe(expectedHash);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const clippedControls = await page.locator('#image-list').evaluate(list => {
    const bounds = list.getBoundingClientRect();
    return Array.from(list.querySelectorAll('button')).filter(button => {
      const box = button.getBoundingClientRect();
      return box.left < bounds.left - 1 || box.right > bounds.right + 1;
    }).map(button => button.getAttribute('aria-label'));
  });
  expect(clippedControls).toEqual([]);
});

test('automatic order repairs shuffled screenshot selection', async ({ page }) => {
  await page.locator('#file-input').setInputFiles([fixture('03.png'), fixture('01.png'), fixture('02.png')]);
  await expect(page.locator('#image-count')).toHaveText('3');
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
  expect(await outputHash(page)).toBe(expectedHash);
  await expect(page.locator('#notice')).toContainText('Detected order: 2 → 3 → 1');
});

test('viewport-relative chat bubble colors stitch without manual overlap adjustments', async ({ page }) => {
  const { images, height } = tintedChatFixture();
  await selectPixelFixture(page, images);
  await expect(page.locator('#image-count')).toHaveText('4');
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', String(height));
  await expect(page.locator('.join-status')).toHaveText(['Matched', 'Matched', 'Matched']);
});

test('changing fixed headers and repeated stickers preserve the complete conversation', async ({ page }) => {
  const { images, height } = glassHeaderFixture();
  await selectPixelFixture(page, [images[2]!, images[0]!, images[3]!, images[1]!]);
  await expect(page.locator('#image-count')).toHaveText('4');
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', String(height));
  await expect(page.locator('.join-status')).toHaveText(['Matched', 'Matched', 'Matched']);
  await expect(page.locator('#notice')).toContainText('Detected order: 2 → 4 → 1 → 3');
});

test('manual reordering takes precedence, removal and clear release results', async ({ page }) => {
  await useDemo(page);
  await page.getByRole('button', { name: 'Move screenshot 2 up', exact: true }).click();
  await expect(page.locator('#auto-order')).not.toBeChecked();
  await expectFinished(page);
  await expect(page.locator('.image-row-info strong').first()).toContainText('Copenhagen-2.png');
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move screenshot 1 down', exact: true }).click();
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
  expect(await outputHash(page)).toBe(expectedHash);
  await page.getByRole('button', { name: 'Remove screenshot 3', exact: true }).click();
  await expect(page.locator('#image-count')).toHaveText('2');
  await expectFinished(page);
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', '1180');
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.locator('#image-count')).toHaveText('0');
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeDisabled();
});

test('unrelated images require explicit visual confirmation before exporting', async ({ page }) => {
  const red = await syntheticPng(page, 'red.png', 240, '#b22');
  const blue = await syntheticPng(page, 'blue.png', 240, '#226');
  await page.locator('#file-input').setInputFiles([red, blue]);
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeDisabled();
  await expect(page.locator('#notice')).toContainText('Review the joins');
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', '600');
  await openVisualJoin(page);
  await applyVisualJoin(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', '600');
  await expect(page.locator('.join-status')).toHaveText('Manual');
});

test('rejects unsupported images and mixed screenshot widths without corrupting the batch', async ({ page }) => {
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('#notice')).toContainText('choose a PNG');
  await expect(page.locator('#image-count')).toHaveText('0');
  const otherWidth = await syntheticPng(page, 'small.png', 200, '#aaa');
  await page.locator('#file-input').setInputFiles([{ name: '01.png', mimeType: 'image/png', buffer: readFileSync(fixture('01.png')) }, otherWidth]);
  await expect(page.locator('#notice')).toContainText('different widths');
  await expect(page.locator('#image-count')).toHaveText('0');
  await page.locator('#file-input').setInputFiles([fixture('01.png'), fixture('02.png')]);
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
});

test('a single screenshot can be removed before stitching starts', async ({ page }) => {
  await page.locator('#file-input').setInputFiles(fixture('01.png'));
  await expect(page.locator('#image-count')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Remove screenshot 1', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove screenshot 1', exact: true }).click();
  await expect(page.locator('#image-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeDisabled();
});

test('installed web assets reload and stitch without a connection', async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await useDemo(page);
  expect(await outputHash(page)).toBe(expectedHash);
  await context.setOffline(false);
});

test('crops and zoom remain usable', async ({ page }) => {
  await useDemo(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#zoom-value')).not.toHaveText('Fit');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.locator('#zoom-value')).toHaveText('Fit');
  await page.getByText('Fine-tune crops', { exact: true }).click();
  await page.locator('#crop-top').fill('74');
  await page.locator('#crop-top').press('Tab');
  await expectFinished(page);
  await page.locator('#crop-bottom').fill('36');
  await page.locator('#crop-bottom').press('Tab');
  await expectFinished(page);
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', '1470');
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
});
