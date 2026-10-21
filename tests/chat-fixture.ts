import type { PixelImage, StitchPlan } from '../src/engine/index.ts';

const WIDTH = 320;
const HEADER = 96;
const FOOTER = 52;
const VIEWPORT = 520;

function canvas(height: number): PixelImage {
  const data = new Uint8ClampedArray(WIDTH * height * 4);
  for (let p = 3; p < data.length; p += 4) data[p] = 255;
  return { width: WIDTH, height, data };
}

function rect(image: PixelImage, x: number, y: number, w: number, h: number, rgb: number[]) {
  for (let row = Math.max(0, y); row < Math.min(image.height, y + h); row++) {
    for (let col = Math.max(0, x); col < Math.min(WIDTH, x + w); col++) {
      image.data.set([...rgb, 255], (row * WIDTH + col) * 4);
    }
  }
}

/** Fictional glyphs, deliberately independent of any user's conversation. */
function glyphs(image: PixelImage, x: number, y: number, count: number, seed: number) {
  let state = seed;
  for (let c = 0; c < count; c++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    for (let bit = 0; bit < 15; bit++) {
      if (state & (1 << bit)) {
        rect(image, x + c * 7 + bit % 3, y + Math.floor(bit / 3), 1, 1, [225, 225, 230]);
      }
    }
  }
}

function bars(body: PixelImage): PixelImage {
  const result = canvas(HEADER + body.height + FOOTER);
  result.data.set(body.data, HEADER * WIDTH * 4);
  rect(result, 136, 18, 48, 44, [64, 50, 81]);
  glyphs(result, 150, 35, 3, 20);
  rect(result, 116, 70, 88, 16, [25, 25, 26]);
  glyphs(result, 126, 75, 9, 80);
  rect(result, 22, 8, 31, 5, [220, 220, 220]);
  const y = HEADER + body.height;
  rect(result, 62, y + 7, 226, 27, [40, 40, 43]);
  rect(result, 64, y + 9, 222, 23, [19, 19, 20]);
  glyphs(result, 74, y + 17, 10, 19);
  rect(result, 24, y + 13, 20, 3, [210, 210, 210]);
  rect(result, 32, y + 5, 3, 20, [210, 210, 210]);
  return result;
}

/**
 * Dark chat, a sparse embedded image, changing side controls, and translucent
 * composer edges intruding into the scrolling viewport. The known source makes
 * content loss/duplication testable without publishing private screenshots.
 */
export function darkChatFixture(overlays = true) {
  const starts = [0, 331, 552];
  const source = canvas(starts.at(-1)! + VIEWPORT);
  for (const [index, y] of [16, 66, 128, 199, 262, 329, 392, 449, 730, 793, 855, 922, 1005].entries()) {
    const right = index % 3 === 1;
    const x = right ? 132 : 13;
    const width = right ? 172 : 202;
    rect(source, x, y, width, 35 + index % 2 * 10, right ? [9, 143, 249] : [39, 39, 43]);
    glyphs(source, x + 12, y + 11, 18, 1000 + index * 117);
    if (index % 2) glyphs(source, x + 12, y + 24, 11, 3000 + index * 99);
  }
  // An image attachment mostly containing black, with a small heading,
  // a central action icon and a button far below it.
  glyphs(source, 20, 503, 22, 600);
  glyphs(source, 20, 519, 13, 601);
  rect(source, 148, 582, 24, 24, [36, 36, 38]);
  rect(source, 158, 586, 4, 15, [10, 151, 251]);
  glyphs(source, 80, 689, 4, 700);
  rect(source, 18, 704, 141, 14, [240, 240, 240]);
  rect(source, 50, 709, 76, 3, [40, 40, 40]);

  const images = starts.map((start, index) => {
    const body: PixelImage = {
      width: WIDTH, height: VIEWPORT,
      data: source.data.slice(start * WIDTH * 4, (start + VIEWPORT) * WIDTH * 4),
    };
    const image = bars(body);
    // A changed clock and navigation badge do not change the center header.
    if (index === 2) {
      rect(image, 22, 8, 31, 5, [140, 140, 140]);
      // A navigation label can extend almost a quarter of the screen width.
      rect(image, 20, 29, 55, 13, [230, 230, 230]);
    }
    // The scrollbar is not content and shifts independently of the thread.
    rect(image, WIDTH - 4, 430 + index * 23, 2, 44, [95, 95, 95]);
    if (overlays) {
      // A composited control edge is only partly shared: the text/image beneath
      // it changes with scrolling, so an exact fixed-bar scan misses its top.
      for (let y = HEADER + VIEWPORT - 5; y < HEADER + VIEWPORT; y++) {
        for (let x = 62; x < 288; x++) {
          const p = (y * WIDTH + x) * 4;
          for (let c = 0; c < 3; c++) {
            image.data[p + c] = Math.round(image.data[p + c]! * 0.7 + 15 + index * 7);
          }
        }
      }
    }
    return image;
  });
  return { images, source, expected: bars(source), starts, header: HEADER, footer: FOOTER };
}

/** Blue message bubbles whose gradient is anchored to the viewport, not text. */
export function tintedChatFixture(
  differentText = false, sparseText = false,
  options: { gradient?: number; drawText?: boolean; rounded?: boolean } = {},
) {
  const starts = [0, 340, 675, 880];
  const makeSource = (seed: number) => {
    const source = canvas(starts.at(-1)! + VIEWPORT);
    for (const [index, y] of [12, 170, 345, 535, 705, 910, 1100, 1260].entries()) {
      if (options.rounded) {
        const radius = 30;
        for (let row = 0; row < 155; row++) {
          const distance = Math.max(0, radius - row - 0.5, row + 0.5 - (155 - radius));
          const inset = Math.ceil(radius - Math.sqrt(radius ** 2 - distance ** 2));
          rect(source, 60 + inset, y + row, 245 - inset * 2, 1, [9, 143, 249]);
        }
      } else {
        rect(source, 60, y, 245, 155, [9, 143, 249]);
      }
      for (let line = 0; options.drawText !== false && line < (sparseText ? 1 : 8); line++) {
        glyphs(source, 74, y + 13 + line * 17, sparseText ? 4 : 29,
          900 + seed + index * 117 + line * 7);
      }
    }
    return source;
  };
  const source = makeSource(0);
  const images = starts.map((start, index) => {
    const document = differentText ? makeSource(index * 10000) : source;
    const body: PixelImage = { width: WIDTH, height: VIEWPORT,
      data: document.data.slice(start * WIDTH * 4, (start + VIEWPORT) * WIDTH * 4) };
    for (let y = 0; y < VIEWPORT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const p = (y * WIDTH + x) * 4;
        if (body.data[p] === 9 && body.data[p + 1] === 143 && body.data[p + 2] === 249) {
          body.data[p] = Math.round((options.gradient ?? 70) * (1 - y / VIEWPORT));
        }
      }
    }
    return bars(body);
  });
  return { images, starts, height: source.height + HEADER + FOOTER };
}

export function renderPlan(images: PixelImage[], plan: StitchPlan): PixelImage {
  const image = canvas(plan.height);
  for (const p of plan.placements) {
    image.data.set(images[p.imageIndex]!.data.subarray(p.sy * WIDTH * 4, (p.sy + p.sh) * WIDTH * 4),
      p.dy * WIDTH * 4);
  }
  return image;
}

export function centralPixels(image: PixelImage, top: number, bottom: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray((bottom - top) * (WIDTH - 20) * 4);
  for (let y = top; y < bottom; y++) {
    pixels.set(image.data.subarray((y * WIDTH + 10) * 4, (y * WIDTH + WIDTH - 10) * 4),
      (y - top) * (WIDTH - 20) * 4);
  }
  return pixels;
}

/** Independent bilinear resize, like screenshots resized by a share sheet. */
export function resizeImage(image: PixelImage, width: number): PixelImage {
  const height = Math.round(image.height * width / image.width);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, (y + 0.5) * image.height / height - 0.5);
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, (x + 0.5) * image.width / width - 0.5);
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      for (let c = 0; c < 4; c++) {
        const a = image.data[(y0 * image.width + x0) * 4 + c]! * (1 - (sx - x0)) +
          image.data[(y0 * image.width + x1) * 4 + c]! * (sx - x0);
        const b = image.data[(y1 * image.width + x0) * 4 + c]! * (1 - (sx - x0)) +
          image.data[(y1 * image.width + x1) * 4 + c]! * (sx - x0);
        data[(y * width + x) * 4 + c] = Math.round(a * (1 - (sy - y0)) + b * (sy - y0));
      }
    }
  }
  return { width, height, data };
}
