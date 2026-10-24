import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { PixelImage } from '../../src/engine/index.ts';
import { readPng } from '../png-fixture';

export function pixelHash(image: PixelImage) {
  return createHash('sha256').update(image.data).digest('hex');
}

export async function outputHash(page: Page) {
  return page.locator('#output-canvas').evaluate(async element => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  });
}

export async function expectFinished(page: Page) {
  await expect(page.locator('#busy-overlay')).toBeHidden();
  await expect(page.locator('#output-canvas')).toBeVisible();
}

export async function useDemo(page: Page) {
  await page.getByRole('button', { name: /Try it with an example/ }).click();
  await expect(page.locator('#image-count')).toHaveText('3');
  await expectFinished(page);
  await expect(page.getByRole('button', { name: 'Save PNG' })).toBeEnabled();
}

export async function selectPixelFixture(page: Page, images: PixelImage[]) {
  const pngs = await page.evaluate(images => images.map(image => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels = Uint8ClampedArray.from(atob(image.base64), byte => byte.charCodeAt(0));
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }), images.map(image => ({ width: image.width, height: image.height,
    base64: Buffer.from(image.data).toString('base64') })));
  await page.locator('#file-input').setInputFiles(pngs.map((png, i) => ({
    name: `fictional-chart-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })));
}

export async function expectOutput(page: Page, expected: PixelImage) {
  await expectFinished(page);
  await expect(page.locator('#output-canvas')).toHaveAttribute('width', String(expected.width));
  await expect(page.locator('#output-canvas')).toHaveAttribute('height', String(expected.height));
  expect(await outputHash(page)).toBe(pixelHash(expected));
}

export async function expectDownloadedPixels(page: Page, expected: PixelImage) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG', exact: true }).click();
  const download = await pending;
  const saved = readPng(pathToFileURL((await download.path())!));
  expect(saved.width).toBe(expected.width);
  expect(saved.height).toBe(expected.height);
  expect(pixelHash(saved)).toBe(pixelHash(expected));
}

export async function openVisualJoin(page: Page, index = 0, touch = false) {
  const button = page.getByRole('button', { name: `Adjust visually, join ${index + 1}`, exact: true });
  if (!await button.isVisible()) await page.locator('#toggle-joins').click();
  if (touch) await button.tap();
  else await button.click();
  await expect(page.getByRole('dialog', { name: 'Adjust join', exact: true })).toBeVisible();
}

export async function applyVisualJoin(page: Page) {
  const next = page.getByRole('button', { name: 'Next: align', exact: true });
  if (await next.isVisible()) await next.click();
  await page.getByRole('button', { name: 'OK — apply join', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust join', exact: true })).toBeHidden();
  await expectFinished(page);
}
