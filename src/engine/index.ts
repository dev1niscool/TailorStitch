/** Pixel-only stitching. This module runs unchanged in a browser worker or Node. */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface MatchOptions {
  /** Remove this many source pixels from the top/bottom of every screenshot. */
  cropTop?: number;
  cropBottom?: number;
  /** Remove repeated app chrome at internal joins; keep the first/last chrome. */
  trimFixedBars?: boolean;
  minOverlap?: number;
}

export interface PlanOptions extends MatchOptions {
  autoOrder?: boolean;
  /** Join positions in the final order, with overlaps in cropped content pixels. */
  manualOverlaps?: Record<number, number>;
}

export type MatchStatus = 'matched' | 'uncertain' | 'unrelated' | 'duplicate';

export interface PairMatch {
  overlap: number;
  confidence: number;
  status: MatchStatus;
  /** Additional fixed chrome after the explicit cropTop/cropBottom. */
  topTrim: number;
  bottomTrim: number;
  reason: string;
}

export interface JoinMatch extends PairMatch {
  fromIndex: number;
  toIndex: number;
  manual: boolean;
  /** Zero for an unresolved join: the preview never silently removes content. */
  appliedOverlap: number;
}

export interface Placement {
  imageIndex: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface StitchPlan {
  width: number;
  height: number;
  order: number[];
  skipped: number[];
  placements: Placement[];
  joins: JoinMatch[];
  warnings: string[];
  needsReview: boolean;
}

const COLUMNS = 32;
const CHANNELS = COLUMNS * 3;
const signatureCache = new WeakMap<PixelImage, Signature>();

interface Signature {
  height: number;
  values: Float32Array;
  smooth: Float32Array;
  energy: Float32Array;
}

interface Candidate {
  overlap: number;
  error: number;
  informative: number;
  samples: number;
  score: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validate(image: PixelImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 ||
      image.data.length !== image.width * image.height * 4) {
    throw new Error('An image has invalid dimensions or pixel data.');
  }
}

function crops(image: PixelImage, options: MatchOptions): [number, number] {
  const top = options.cropTop ?? 0;
  const bottom = options.cropBottom ?? 0;
  if (!Number.isInteger(top) || !Number.isInteger(bottom) || top < 0 || bottom < 0 ||
      top + bottom >= image.height) {
    throw new Error('Top and bottom crops must leave at least one image row.');
  }
  return [top, bottom];
}

/** Treat alpha as composited on white, as the final renderer does. */
function channel(image: PixelImage, x: number, y: number, c: number): number {
  const at = (y * image.width + x) * 4;
  const alpha = image.data[at + 3]! / 255;
  return image.data[at + c]! * alpha + 255 * (1 - alpha);
}

function signature(image: PixelImage): Signature {
  const cached = signatureCache.get(image);
  if (cached) return cached;
  const values = new Float32Array(image.height * CHANNELS);
  const smooth = new Float32Array(values.length);
  const energy = new Float32Array(image.height);
  const halfSample = Math.max(1, Math.round(image.width / 768));
  for (let y = 0; y < image.height; y++) {
    let horizontal = 0;
    let vertical = 0;
    for (let x = 0; x < COLUMNS; x++) {
      const center = Math.floor((0.025 + (x + 0.5) / COLUMNS * 0.95) * image.width);
      for (let c = 0; c < 3; c++) {
        const i = y * CHANNELS + x * 3 + c;
        values[i] = (
          channel(image, clamp(center - halfSample, 0, image.width - 1), y, c) +
          channel(image, clamp(center, 0, image.width - 1), y, c) +
          channel(image, clamp(center + halfSample, 0, image.width - 1), y, c)
        ) / 3;
        if (x) horizontal += Math.abs(values[i]! - values[i - 3]!);
        if (y) vertical += Math.abs(values[i]! - values[i - CHANNELS]!);
      }
    }
    energy[y] = horizontal / (CHANNELS - 3) + vertical / CHANNELS;
  }
  // A short vertical blur preserves candidate peaks when the scroll offset is
  // between coarse search positions. Final ranking uses the unblurred rows.
  for (let y = 0; y < image.height; y++) {
    const start = Math.max(0, y - 2);
    const end = Math.min(image.height - 1, y + 2);
    for (let c = 0; c < CHANNELS; c++) {
      let sum = 0;
      for (let r = start; r <= end; r++) sum += values[r * CHANNELS + c]!;
      smooth[y * CHANNELS + c] = sum / (end - start + 1);
    }
  }
  const result = { height: image.height, values, smooth, energy };
  signatureCache.set(image, result);
  return result;
}

function rowError(a: Signature, ay: number, b: Signature, by: number): number {
  let error = 0;
  // The central 60% avoids a changed clock, scrollbar or peripheral controls.
  // This is only chrome detection; overlap matching still uses the full width.
  const sideColumns = 6;
  for (let x = sideColumns; x < COLUMNS - sideColumns; x++) {
    for (let c = 0; c < 3; c++) {
      error += Math.abs(a.values[ay * CHANNELS + x * 3 + c]! -
        b.values[by * CHANNELS + x * 3 + c]!);
    }
  }
  return error / ((COLUMNS - sideColumns * 2) * 3);
}

function fixedBars(
  a: Signature, b: Signature, top: number, bottom: number,
): { topTrim: number; bottomTrim: number } {
  const height = Math.min(a.height, b.height) - top - bottom;
  const scan = (fromBottom: boolean, limit: number): number => {
    let unequal = 0;
    let lastEqual = 0;
    for (let i = 0; i < limit; i++) {
      const ay = fromBottom ? a.height - bottom - 1 - i : top + i;
      const by = fromBottom ? b.height - bottom - 1 - i : top + i;
      if (rowError(a, ay, b, by) <= 1.6) {
        unequal = 0;
        lastEqual = i + 1;
      } else {
        unequal++;
        if (unequal >= 3) break;
      }
    }
    return lastEqual;
  };
  return {
    topTrim: scan(false, Math.floor(height * 0.26)),
    bottomTrim: scan(true, Math.floor(height * 0.19)),
  };
}

function exactlyEqual(a: PixelImage, b: PixelImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  // Quickly reject most pairs before a complete equality check.
  for (let i = 0; i < a.data.length; i += 193) {
    if (a.data[i] !== b.data[i]) return false;
  }
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

function evaluate(
  a: Signature, b: Signature, aEnd: number, bStart: number,
  overlap: number, blurred: boolean, maxSamples: number,
): Candidate {
  const av = blurred ? a.smooth : a.values;
  const bv = blurred ? b.smooth : b.values;
  const count = Math.min(overlap, maxSamples);
  let sum = 0;
  let weights = 0;
  let informative = 0;
  for (let row = 0; row < count; row++) {
    const offset = Math.floor((row + 0.5) * overlap / count);
    const ay = aEnd - overlap + offset;
    const by = bStart + offset;
    const detail = Math.max(a.energy[ay]!, b.energy[by]!);
    if (detail > 2.8) informative++;
    const weight = 1 + Math.min(5, detail / 5);
    let difference = 0;
    for (let c = 0; c < CHANNELS; c++) {
      difference += Math.abs(av[ay * CHANNELS + c]! - bv[by * CHANNELS + c]!);
    }
    sum += difference / CHANNELS * weight;
    weights += weight;
  }
  const error = sum / weights;
  // Featureless overlaps must never win merely because the background is white.
  const detailPenalty = informative < 5 ? (5 - informative) * 5 : 0;
  return { overlap, error, informative, samples: count,
    score: error + detailPenalty + 1 / Math.sqrt(overlap) };
}

/**
 * Shared white backgrounds and chat-bubble layouts are not enough evidence.
 * Verify text/image edges at much denser resolution than the search signatures.
 */
function verifyDetails(
  first: PixelImage, second: PixelImage, aStart: number, bStart: number, overlap: number,
): { edges: number; mismatchedFraction: number } {
  let edges = 0;
  let mismatched = 0;
  const xStep = Math.max(1, Math.floor(first.width / 420));
  const yStep = Math.max(1, Math.floor(overlap / 1000));
  const left = Math.max(1, Math.round(first.width * 0.02));
  const right = first.width - left - 1;
  const luminance = (image: PixelImage, x: number, y: number) =>
    channel(image, x, y, 0) * 0.299 + channel(image, x, y, 1) * 0.587 +
    channel(image, x, y, 2) * 0.114;
  for (let offset = 1; offset < overlap - 1; offset += yStep) {
    const ay = aStart + offset;
    const by = bStart + offset;
    for (let x = left; x < right; x += xStep) {
      const a = luminance(first, x, ay);
      const b = luminance(second, x, by);
      const edge = Math.max(
        Math.abs(a - luminance(first, x + 1, ay)),
        Math.abs(b - luminance(second, x + 1, by)),
        Math.abs(a - luminance(first, x, ay + 1)),
        Math.abs(b - luminance(second, x, by + 1)),
      );
      if (edge > 20) {
        edges++;
        if (Math.abs(a - b) > 24) mismatched++;
      }
    }
  }
  return { edges, mismatchedFraction: edges ? mismatched / edges : 0 };
}

/**
 * Find the bottom-of-first / top-of-second overlap. No pixels are changed.
 * Input widths must already be normalized by the caller.
 */
export function analyzePair(
  first: PixelImage, second: PixelImage, options: MatchOptions = {},
): PairMatch {
  validate(first);
  validate(second);
  if (first.width !== second.width) {
    throw new Error('Normalize screenshot widths before stitching.');
  }
  const [top, bottom] = crops(first, options);
  crops(second, options);
  if (exactlyEqual(first, second)) {
    return { overlap: first.height - top - bottom, confidence: 1, status: 'duplicate',
      topTrim: 0, bottomTrim: 0, reason: 'These screenshots are identical.' };
  }
  const a = signature(first);
  const b = signature(second);
  const bars = options.trimFixedBars === false ? { topTrim: 0, bottomTrim: 0 } :
    fixedBars(a, b, top, bottom);
  const bStart = top + bars.topTrim;
  const aEnd = first.height - bottom - bars.bottomTrim;
  const maxOverlap = Math.min(
    aEnd - bStart,
    second.height - bottom - bars.bottomTrim - bStart,
  );
  const requestedMin = options.minOverlap ?? Math.max(16, Math.round(first.width * 0.02));
  const minOverlap = Math.max(8, Math.round(requestedMin));
  const noMatch = (reason: string): PairMatch => ({
    overlap: 0, confidence: 0, status: 'unrelated', ...bars, reason,
  });
  if (maxOverlap < minOverlap) return noMatch('Too little image content remains to compare.');

  const coarse: Candidate[] = [];
  const stride = maxOverlap > 1400 ? 6 : maxOverlap > 350 ? 4 : 2;
  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += stride) {
    coarse.push(evaluate(a, b, aEnd, bStart, overlap, true, 64));
  }
  if ((maxOverlap - minOverlap) % stride) {
    coarse.push(evaluate(a, b, aEnd, bStart, maxOverlap, true, 64));
  }
  coarse.sort((x, y) => x.score - y.score);
  const candidates = new Set<number>();
  // Keep separate peaks as well as neighbors: repeated list rows can look alike.
  const peaks: Candidate[] = [];
  for (const candidate of coarse) {
    if (peaks.every(x => Math.abs(x.overlap - candidate.overlap) > stride * 2)) {
      peaks.push(candidate);
      if (peaks.length >= 12) break;
    }
  }
  for (const peak of peaks) {
    for (let delta = -stride; delta <= stride; delta++) {
      const overlap = peak.overlap + delta;
      if (overlap >= minOverlap && overlap <= maxOverlap) candidates.add(overlap);
    }
  }
  const refined = [...candidates].map(overlap =>
    evaluate(a, b, aEnd, bStart, overlap, false, 112));
  refined.sort((x, y) => x.score - y.score);
  // Verify the leading peaks densely so sparse sampling cannot hide a mismatch.
  const verified = refined.slice(0, 18).map(candidate =>
    evaluate(a, b, aEnd, bStart, candidate.overlap, false, 1024));
  verified.sort((x, y) => x.score - y.score);
  const best = verified[0]!;
  if (!best || best.informative < 5) {
    return noMatch('The shared area has too little detail for a reliable match.');
  }
  const alternatives = verified.filter(x =>
    Math.abs(x.overlap - best.overlap) > Math.max(4, stride));
  const next = alternatives[0];
  const gap = next ? next.score - best.score : 20;
  const ambiguous = gap < Math.max(0.65, best.error * 0.14);
  if (best.error > 16) return noMatch('No matching overlap was found. Check screenshot order.');
  const fit = clamp(1 - best.error / 16, 0, 1);
  const separation = clamp(gap / 8, 0, 1);
  const confidence = clamp(0.3 + fit * 0.52 + separation * 0.18, 0, 1);
  if (best.error > 8 || ambiguous) {
    return { overlap: best.overlap, confidence: Math.min(0.64, confidence),
      status: 'uncertain', ...bars,
      reason: ambiguous ? 'Repeated content makes this overlap ambiguous. Review the join.' :
        'The overlap is only a partial match. Review the join.' };
  }
  const details = verifyDetails(first, second, aEnd - best.overlap, bStart, best.overlap);
  if (details.edges >= 16 && details.mismatchedFraction > 0.2) {
    return { overlap: best.overlap, confidence: Math.min(0.5, confidence),
      status: 'uncertain', ...bars,
      reason: 'The layouts look similar, but text or image details differ. Review the join.' };
  }
  return { overlap: best.overlap, confidence, status: 'matched', ...bars,
    reason: 'A detailed matching overlap was found.' };
}

function findOrder(
  indexes: number[], pair: (a: number, b: number) => PairMatch,
): number[] | null {
  if (indexes.length < 2) return indexes;
  const starts = indexes.filter(index => !indexes.some(other =>
    index !== other && pair(other, index).status === 'matched'));
  if (starts.length !== 1) return null;
  const order = [starts[0]!];
  const remaining = new Set(indexes.filter(i => i !== order[0]));
  while (remaining.size) {
    const current = order[order.length - 1]!;
    const next = [...remaining].map(index => ({ index, match: pair(current, index) }))
      .filter(({ match }) => match.status === 'matched')
      .sort((a, b) => b.match.overlap - a.match.overlap);
    if (!next.length) return null;
    if (next[1] && Math.abs(next[0]!.match.overlap - next[1].match.overlap) < 3) return null;
    order.push(next[0]!.index);
    remaining.delete(next[0]!.index);
  }
  return order;
}

function trimTail(placements: Placement[], amount: number): void {
  while (amount > 0 && placements.length) {
    const last = placements[placements.length - 1]!;
    const removed = Math.min(last.sh, amount);
    last.sh -= removed;
    last.dh -= removed;
    amount -= removed;
    if (!last.sh) placements.pop();
  }
}

/** Build drawImage-ready regions. Unresolved joins concatenate without data loss. */
export function planStitch(images: PixelImage[], options: PlanOptions = {}): StitchPlan {
  if (!images.length) {
    return { width: 0, height: 0, order: [], skipped: [], placements: [],
      joins: [], warnings: [], needsReview: false };
  }
  for (const image of images) {
    validate(image);
    crops(image, options);
    if (image.width !== images[0]!.width) {
      throw new Error('Normalize screenshot widths before stitching.');
    }
  }
  const [top, bottom] = crops(images[0]!, options);
  const skipped: number[] = [];
  let order: number[] = [];
  for (let index = 0; index < images.length; index++) {
    if (order.some(other => exactlyEqual(images[other]!, images[index]!))) skipped.push(index);
    else order.push(index);
  }
  const warnings: string[] = [];
  if (skipped.length) warnings.push(`${skipped.length} identical screenshot${skipped.length === 1 ? '' : 's'} skipped.`);
  const matches = new Map<string, PairMatch>();
  const pair = (a: number, b: number): PairMatch => {
    const key = `${a}:${b}`;
    let match = matches.get(key);
    if (!match) {
      match = analyzePair(images[a]!, images[b]!, options);
      matches.set(key, match);
    }
    return match;
  };
  if (options.autoOrder && order.length > 1) {
    const automatic = findOrder(order, pair);
    if (automatic) order = automatic;
    else warnings.push('Automatic order was inconclusive. Your current order was kept.');
  }
  const placements: Placement[] = [];
  const joins: JoinMatch[] = [];
  const width = images[0]!.width;
  let needsReview = false;
  const firstIndex = order[0]!;
  const firstHeight = images[firstIndex]!.height - top - bottom;
  placements.push({ imageIndex: firstIndex, sx: 0, sy: top, sw: width, sh: firstHeight,
    dx: 0, dy: 0, dw: width, dh: firstHeight });
  for (let position = 1; position < order.length; position++) {
    const fromIndex = order[position - 1]!;
    const toIndex = order[position]!;
    let match = pair(fromIndex, toIndex);
    const override = options.manualOverlaps?.[position - 1];
    const manual = override !== undefined;
    if (manual) {
      const max = Math.min(images[fromIndex]!.height, images[toIndex]!.height) -
        top - bottom - match.topTrim - match.bottomTrim;
      if (!Number.isFinite(override) || override < 0 || override > max) {
        throw new Error(`The manual overlap for join ${position} must be between 0 and ${max} pixels.`);
      }
      match = { ...match, overlap: Math.round(override), confidence: 1,
        status: 'matched', reason: 'You set this overlap manually.' };
    }
    const accepted = match.status === 'matched';
    const overlap = accepted ? match.overlap : 0;
    const topTrim = accepted ? match.topTrim : 0;
    const bottomTrim = accepted ? match.bottomTrim : 0;
    if (!accepted) {
      needsReview = true;
      warnings.push(`Join ${position}: ${match.reason}`);
    }
    joins.push({ ...match, fromIndex, toIndex, manual, appliedOverlap: overlap });
    trimTail(placements, bottomTrim);
    const sy = top + topTrim + overlap;
    const sh = images[toIndex]!.height - bottom - sy;
    const last = placements[placements.length - 1];
    if (sh > 0) placements.push({ imageIndex: toIndex, sx: 0, sy, sw: width, sh,
      dx: 0, dy: last ? last.dy + last.dh : 0, dw: width, dh: sh });
  }
  const last = placements[placements.length - 1];
  return { width, height: last ? last.dy + last.dh : 0, order, skipped,
    placements, joins, warnings, needsReview };
}
