// Minimal test-fixture reader: 8-bit noninterlaced RGB/RGBA PNGs only.
// Production image decoding uses the browser's native image decoder.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { PixelImage } from '../src/engine/index.ts';

export function readPng(path: URL): PixelImage {
  const png = readFileSync(path);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG.');
  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    const kind = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (data[8] !== 8 || data[12] !== 0 || !channels) throw new Error('Unsupported PNG fixture.');
    }
    if (kind === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = encoded[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= channels ? pixels[i - channels]! : 0;
      const up = y ? pixels[i - stride]! : 0;
      const corner = y && x >= channels ? pixels[i - stride - channels]! : 0;
      const predict = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up :
        filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : NaN;
      if (!Number.isFinite(predict)) throw new Error('Unsupported PNG filter.');
      pixels[i] = encoded[y * (stride + 1) + 1 + x]! + predict;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels]!;
    rgba[i * 4 + 1] = pixels[i * channels + 1]!;
    rgba[i * 4 + 2] = pixels[i * channels + 2]!;
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3]! : 255;
  }
  return { width, height, data: rgba };
}
