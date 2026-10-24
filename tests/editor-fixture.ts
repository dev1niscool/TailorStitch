import type { PixelImage } from '../src/engine/index.ts';

/** Independent pixel charts: each source and row has a distinct fingerprint. */
export function editorImages(count = 3): PixelImage[] {
  return Array.from({ length: count }, (_, source) => {
    const width = 240;
    const height = 320;
    const data = new Uint8ClampedArray(width * height * 4);
    let state = 1021 + source * 9013;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const at = (y * width + x) * 4;
      data[at] = state >>> 24;
      data[at + 1] = (state >>> 16) & 255;
      data[at + 2] = (state >>> 8) & 255;
      data[at + 3] = 255;
    }
    return { width, height, data };
  });
}

/** Expected export from explicitly chosen source rows; no matcher dependency. */
export function stackRows(
  images: PixelImage[], rows: Array<{ source: number; start: number; end: number }>,
): PixelImage {
  const width = images[0]!.width;
  const height = rows.reduce((total, row) => total + row.end - row.start, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  let at = 0;
  for (const row of rows) {
    const pixels = images[row.source]!.data.subarray(row.start * width * 4, row.end * width * 4);
    data.set(pixels, at);
    at += pixels.length;
  }
  return { width, height, data };
}
