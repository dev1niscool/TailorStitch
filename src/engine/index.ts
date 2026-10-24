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
  /** Absolute source-row cuts, keyed by join position in the fixed input order. */
  manualCuts?: Record<number, ManualCut>;
}

export interface ManualCut {
  /** Keep the upper source up to, but excluding, this row. */
  upperEnd: number;
  /** Keep the lower source beginning at this row. */
  lowerStart: number;
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

export interface JoinMatch extends PairMatch, ManualCut {
  fromIndex: number;
  toIndex: number;
  manual: boolean;
  /** Automatic/legacy overlap; zero for unresolved joins and explicit source cuts. */
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
  structureError: number;
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
  // The central half avoids a changed clock, scrollbar or peripheral controls.
  // This is only chrome detection; overlap matching still uses the full width.
  const sideColumns = 8;
  for (let x = sideColumns; x < COLUMNS - sideColumns; x++) {
    const ai = ay * CHANNELS + x * 3;
    const bi = by * CHANNELS + x * 3;
    // Glass-like toolbars can change hue as the underlying content scrolls.
    // Their luminance structure remains stationary. RGB color is still used
    // for content matching; it must not define the viewport by itself.
    const av = a.values[ai]! * 0.299 + a.values[ai + 1]! * 0.587 + a.values[ai + 2]! * 0.114;
    const bv = b.values[bi]! * 0.299 + b.values[bi + 1]! * 0.587 + b.values[bi + 2]! * 0.114;
    error += Math.abs(av - bv);
  }
  return error / (COLUMNS - sideColumns * 2);
}

/** One bounded brightness change may affect an entire stationary glass row. */
function rowShapeError(a: Signature, ay: number, b: Signature, by: number): number {
  const differences: number[] = [];
  let sum = 0;
  for (let x = 8; x < COLUMNS - 8; x++) {
    const ai = ay * CHANNELS + x * 3;
    const bi = by * CHANNELS + x * 3;
    const difference = (a.values[ai]! - b.values[bi]!) * 0.299 +
      (a.values[ai + 1]! - b.values[bi + 1]!) * 0.587 +
      (a.values[ai + 2]! - b.values[bi + 2]!) * 0.114;
    differences.push(difference);
    sum += difference;
  }
  const brightness = sum / differences.length;
  if (Math.abs(brightness) > 12) return Infinity;
  return differences.reduce((total, value) => total + Math.abs(value - brightness), 0) / differences.length;
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
  let structuralSum = 0;
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
    let structuralDifference = 0;
    for (let c = 0; c < CHANNELS; c++) {
      difference += Math.abs(av[ay * CHANNELS + c]! - bv[by * CHANNELS + c]!);
      if (c >= 3) {
        structuralDifference += Math.abs(
          (av[ay * CHANNELS + c]! - av[ay * CHANNELS + c - 3]!) -
          (bv[by * CHANNELS + c]! - bv[by * CHANNELS + c - 3]!));
      }
    }
    sum += difference / CHANNELS * weight;
    structuralSum += structuralDifference / (CHANNELS - 3) * weight;
    weights += weight;
  }
  const error = sum / weights;
  const structureError = structuralSum / weights;
  // Featureless overlaps must never win merely because the background is white.
  const detailPenalty = informative < 5 ? (5 - informative) * 5 : 0;
  // A scrolling view may recolor the same message bubble according to screen
  // position. Adjacent-column contrasts retain its layout without requiring the
  // background color to agree. Dense original-pixel verification still decides
  // whether the text/image content actually matches.
  return { overlap, error, structureError, informative, samples: count,
    score: Math.min(error, structureError * 1.25) + detailPenalty + 1 / Math.sqrt(overlap) };
}

/**
 * Shared white backgrounds and chat-bubble layouts are not enough evidence.
 * Verify text/image edges at much denser resolution than the search signatures.
 */
interface DetailEvidence {
  edges: number;
  mismatchedFraction: number;
  structuralMatch: boolean;
  consistentRegions: boolean;
}

function verifyDetails(
  first: PixelImage, second: PixelImage, aStart: number, bStart: number, overlap: number,
  checkRegions = false,
): DetailEvidence {
  const xStep = Math.max(1, Math.floor(first.width / 420));
  const yStep = Math.max(1, Math.floor(overlap / 1000));
  const left = Math.max(1, Math.round(first.width * 0.02));
  const right = first.width - left - 1;
  const luminance = (image: PixelImage, x: number, y: number) =>
    channel(image, x, y, 0) * 0.299 + channel(image, x, y, 1) * 0.587 +
    channel(image, x, y, 2) * 0.114;
  const featureRadius = Math.max(2, Math.round(first.width / 200));
  const hasNarrowFeature = (image: PixelImage, x: number, y: number, value: number) => {
    const opposed = (before: number, after: number) =>
      Math.abs(value - before) > 20 && Math.abs(value - after) > 20 &&
      (value - before) * (value - after) > 0;
    return opposed(luminance(image, Math.max(0, x - featureRadius), y),
      luminance(image, Math.min(image.width - 1, x + featureRadius), y)) ||
      opposed(luminance(image, x, Math.max(0, y - featureRadius)),
        luminance(image, x, Math.min(image.height - 1, y + featureRadius)));
  };
  // One shift must explain the entire overlap; individual edges cannot move
  // independently to make different letters appear to agree.
  const shifts = [-0.5, -0.25, 0, 0.25, 0.5];
  const errors = shifts.map(() => ({ edges: 0, mismatched: 0, error: 0,
    structuralMismatches: 0, corners: 0, matchingCornerRows: 0,
    firstMatchingRow: overlap, lastMatchingRow: 0,
    rowEdges: new Uint32Array(checkRegions ? overlap : 0),
    rowDisagreements: new Uint32Array(checkRegions ? overlap : 0),
    consistentRegions: true,
    regionCorners: new Uint32Array(9), regionMatches: new Uint32Array(9) }));
  for (let offset = 1; offset < overlap - 1; offset += yStep) {
    const ay = aStart + offset;
    const by = bStart + offset;
    const rowCorners = new Uint32Array(shifts.length);
    const rowMatches = new Uint32Array(shifts.length);
    const rowBand = Math.min(2, Math.floor(offset * 3 / overlap));
    for (let x = left; x < right; x += xStep) {
      const a = luminance(first, x, ay);
      const ax = a - luminance(first, x + 1, ay);
      const ad = a - luminance(first, x, ay + 1);
      const b = luminance(second, x, by);
      const bd = luminance(second, x, by + 1);
      const br = luminance(second, x + 1, by);
      const edge = Math.max(Math.abs(ax), Math.abs(ad), Math.abs(b - br), Math.abs(b - bd));
      if (edge <= 20) continue;
      const bu = luminance(second, x, by - 1);
      const bdd = luminance(second, x, Math.min(second.height - 1, by + 2));
      const bru = luminance(second, x + 1, by - 1);
      const brd = luminance(second, x + 1, by + 1);
      const aMagnitude = Math.hypot(ax, ad);
      let narrowFeature: boolean | undefined;
      const region = rowBand * 3 + Math.min(2, Math.floor(x * 3 / first.width));
      for (let i = 0; i < shifts.length; i++) {
        const shift = shifts[i]!;
        const t = Math.abs(shift);
        const adjusted = b * (1 - t) + (shift < 0 ? bu : bd) * t;
        const adjustedRight = br * (1 - t) + (shift < 0 ? bru : brd) * t;
        const adjustedDown = bd * (1 - t) + (shift < 0 ? b : bdd) * t;
        const bx = adjusted - adjustedRight;
        const byGradient = adjusted - adjustedDown;
        const difference = Math.abs(a - adjusted);
        const result = errors[i]!;
        result.edges++;
        result.error += difference;
        if (difference > 24) result.mismatched++;
        // Compare signed local contrast, not its background level. This allows
        // viewport-dependent bubble tints while still distinguishing the letter
        // strokes. Missing or reversed edges have a large normalized distance.
        const magnitude = Math.max(20, aMagnitude + Math.hypot(bx, byGradient));
        const agrees = (ax - bx) ** 2 + (ad - byGradient) ** 2 <= (0.38 * magnitude) ** 2;
        if (!agrees) result.structuralMismatches++;
        if (checkRegions) result.rowEdges[offset] = result.rowEdges[offset]! + 1;
        if (checkRegions && !agrees && difference > 24) {
          result.rowDisagreements[offset] = result.rowDisagreements[offset]! + 1;
        }
        const corner = Math.max(Math.abs(ax), Math.abs(bx)) > 20 &&
          Math.max(Math.abs(ad), Math.abs(byGradient)) > 20;
        // A rounded bubble perimeter also has two-dimensional gradients. Text
        // and image detail must additionally contain a narrow ridge or valley:
        // opposing transitions nearby, rather than one smooth silhouette edge.
        if (corner && (narrowFeature ??= hasNarrowFeature(first, x, ay, a) ||
            hasNarrowFeature(second, x, by, b))) {
          result.corners++;
          result.regionCorners[region] = result.regionCorners[region]! + 1;
          rowCorners[i] = rowCorners[i]! + 1;
          if (agrees) {
            result.regionMatches[region] = result.regionMatches[region]! + 1;
            rowMatches[i] = rowMatches[i]! + 1;
          }
        }
      }
    }
    for (let i = 0; i < errors.length; i++) {
      if (rowCorners[i]! >= 2 && rowMatches[i]! / rowCorners[i]! >= 0.8) {
        errors[i]!.matchingCornerRows++;
        errors[i]!.firstMatchingRow = Math.min(errors[i]!.firstMatchingRow, offset);
        errors[i]!.lastMatchingRow = offset;
      }
    }
  }
  const margin = Math.max(2, Math.round(first.width * 0.015));
  const window = Math.max(12, Math.round(first.width * 0.06));
  for (const result of checkRegions ? errors : []) {
    // A large shared photograph or sticker must not outvote a smaller block of
    // contradictory text. Inspect overlapping local bands as well as the total
    // edge count; the outer fringe can contain a partially obscuring toolbar.
    for (let start = margin; start < overlap - margin; start += Math.max(1, Math.floor(window / 2))) {
      let edges = 0;
      let disagreements = 0;
      for (let row = start; row < Math.min(overlap - margin, start + window); row++) {
        edges += result.rowEdges[row]!;
        disagreements += result.rowDisagreements[row]!;
      }
      if (edges >= 48 && disagreements / edges > 0.3) {
        result.consistentRegions = false;
        break;
      }
    }
  }
  const structuralMatch = errors.some(result => {
    const supported = [...result.regionCorners].map((count, region) =>
      count >= 16 && result.regionMatches[region]! / count >= 0.8);
    const supportedBands = [0, 1, 2].filter(band =>
      supported.slice(band * 3, band * 3 + 3).some(Boolean));
    // Long bubble outlines or a matching icon alone are insufficient. Require
    // many corner-like features across separate rows and vertical regions.
    return result.consistentRegions && result.edges >= 128 && result.corners >= 64 &&
      result.structuralMismatches / result.edges <= 0.2 &&
      result.matchingCornerRows >= 6 && supportedBands.length >= 2 &&
      result.lastMatchingRow - result.firstMatchingRow >= Math.max(12, first.width * 0.04);
  });
  errors.sort((a, b) => Number(b.consistentRegions) - Number(a.consistentRegions) ||
    a.mismatched - b.mismatched || a.error - b.error);
  const best = errors[0]!;
  return { edges: best.edges,
    mismatchedFraction: best.edges ? best.mismatched / best.edges : 0, structuralMatch,
    consistentRegions: best.consistentRegions };
}

/**
 * Place a verified join inside the shared content. Screenshot edges can contain
 * a composer border, translucent toolbar, or partially obscured message even
 * when the estimated fixed-bar boundary is only a few rows off.
 */
function seamOffset(
  first: PixelImage, second: PixelImage, match: PairMatch, top: number, bottom: number,
): number {
  const overlap = match.overlap;
  if (overlap < 8) return overlap;
  const a = signature(first);
  const b = signature(second);
  const aStart = first.height - bottom - match.bottomTrim - overlap;
  const bStart = top + match.topTrim;
  const start = Math.max(2, Math.floor(overlap * 0.2));
  const end = Math.min(overlap - 2, Math.ceil(overlap * 0.8));
  let best = Math.round(overlap / 2);
  let bestScore = Infinity;
  for (let offset = start; offset <= end; offset++) {
    let error = 0;
    let detail = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ay = aStart + offset + dy;
      const by = bStart + offset + dy;
      detail += Math.max(a.energy[ay]!, b.energy[by]!);
      for (let c = 0; c < CHANNELS; c++) {
        error += Math.abs(a.values[ay * CHANNELS + c]! - b.values[by * CHANNELS + c]!);
      }
    }
    // Prefer agreement and a quiet row; use the center to break otherwise
    // equivalent ties. This changes the source seam, never the inferred shift.
    const score = error / (CHANNELS * 3) + detail * 0.02 +
      Math.abs(offset - overlap / 2) / overlap * 0.5;
    if (score < bestScore) { bestScore = score; best = offset; }
  }
  return best;
}

/** A content tile votes only for a distinctive translation, not a similar icon. */
function contentOffsets(a: Signature, b: Signature, width: number, top: number, bottom: number): number[] {
  const tile = Math.max(16, Math.round(width * 0.055));
  const bins = 20;
  const usable = b.height - top - bottom - tile;
  if (usable <= 0) return [];
  const votes: { shift: number; row: number; score: number }[] = [];
  for (let bin = 0; bin < bins; bin++) {
    const begin = top + Math.floor(usable * bin / bins);
    const end = top + Math.floor(usable * (bin + 1) / bins);
    let by = begin;
    let energy = 0;
    for (let row = begin; row < end; row += 3) {
      let detail = 0;
      for (let dy = 0; dy < tile; dy += 3) detail += b.energy[row + dy]!;
      if (detail > energy) { energy = detail; by = row; }
    }
    if (energy < tile * 1.5) continue;
    const candidates: { shift: number; match: Candidate }[] = [];
    for (let ay = by + 1; ay + tile <= a.height - bottom; ay += 4) {
      candidates.push({ shift: ay - by,
        match: evaluate(a, b, ay + tile, by, tile, true, 10) });
    }
    candidates.sort((x, y) => x.match.score - y.match.score);
    const first = candidates[0];
    if (!first || first.match.informative < 5 || first.match.score > 8) continue;
    const runner = candidates.find(x => Math.abs(x.shift - first.shift) > tile / 2);
    if (runner && runner.match.score - first.match.score < Math.max(0.8, first.match.score * 0.2)) continue;
    let best: typeof first | undefined;
    for (let shift = Math.max(1, first.shift - 4); shift <= first.shift + 4; shift++) {
      if (by + shift + tile > a.height - bottom) continue;
      const match = evaluate(a, b, by + shift + tile, by, tile, false, 24);
      if (!best || match.score < best.match.score) best = { shift, match };
    }
    if (!best || best.match.score > 8 || best.match.informative < 5) continue;
    votes.push({ shift: best.shift, row: by, score: best.match.score });
  }
  // Keep independent displacement basins. Several rows of a repeated sticker
  // are not several independent positions: one vote per source tile is capped.
  const clusters: { votes: typeof votes; shift: number }[] = [];
  for (const vote of [...votes].sort((x, y) => x.shift - y.shift)) {
    const cluster = clusters.find(x => Math.abs(x.shift - vote.shift) <= 2);
    if (cluster) {
      cluster.votes.push(vote);
      cluster.shift = Math.round(cluster.votes.reduce((sum, x) => sum + x.shift, 0) / cluster.votes.length);
    } else clusters.push({ votes: [vote], shift: vote.shift });
  }
  return clusters.filter(x => x.votes.length >= 2 &&
    Math.max(...x.votes.map(v => v.row)) - Math.min(...x.votes.map(v => v.row)) >= tile)
    .sort((x, y) => y.votes.length - x.votes.length ||
      x.votes.reduce((sum, v) => sum + v.score, 0) - y.votes.reduce((sum, v) => sum + v.score, 0))
    .slice(0, 4).map(x => x.shift);
}

/** Stationary evidence proposes boundaries; moving content must verify them. */
function headerHypotheses(a: Signature, b: Signature, top: number, bottom: number, initial: number): number[] {
  const limit = Math.floor((Math.min(a.height, b.height) - top - bottom) * 0.35);
  const candidates = new Set([initial]);
  let equalRun = 0;
  let stationary = 0;
  let movingRun = 0;
  for (let row = 0; row < limit; row++) {
    const equal = rowError(a, top + row, b, top + row) <= 1.6;
    const stationaryShape = equal || rowShapeError(a, top + row, b, top + row) <= 1.6;
    if (stationaryShape) stationary++;
    if (equal) { equalRun++; }
    else {
      if (equalRun >= 4 && stationary / Math.max(1, row) >= 0.6) candidates.add(row);
      equalRun = 0;
    }
    // A mild glass tint may interrupt exact stationarity. Actual moving
    // content changes row shape: never scan past it to a convenient blank gap
    // and mislabel the intervening messages as another part of the header.
    movingRun = !stationaryShape ? movingRun + 1 : 0;
    if (movingRun >= 3) break;
  }
  return [...candidates].sort((x, y) => x - y).slice(0, 12);
}

/**
 * Recover registration without assuming the first fixed-bar estimate is right.
 * Local tiles propose raw y translations; every proposal is checked against its
 * entire remaining overlap, so one repeated emoji cannot erase contradictions.
 */
function recoverRegistration(
  first: PixelImage, second: PixelImage, options: MatchOptions, original: PairMatch,
): PairMatch {
  const [top, bottom] = crops(first, options);
  const a = signature(first);
  const b = signature(second);
  const offsets = contentOffsets(a, b, first.width, top, bottom);
  const originalShift = first.height - bottom - original.bottomTrim -
    top - original.topTrim - original.overlap;
  // The initial full-view search is another independent proposal source. A
  // small overlap can contain only one useful tile; the complete re-search
  // below still has to rule out every competing translation.
  if (original.overlap > 0 && originalShift > 0 &&
      !offsets.some(shift => Math.abs(shift - originalShift) <= 2)) offsets.push(originalShift);
  if (!offsets.length) return original;
  const headers = headerHypotheses(a, b, top, bottom, original.topTrim);
  const aEnd = first.height - bottom - original.bottomTrim;
  const minOverlap = Math.max(8, options.minOverlap ?? Math.max(16, Math.round(first.width * 0.02)));
  const proposals: { shift: number; match: Candidate; topTrim: number }[] = [];
  for (const offset of offsets) {
    for (let shift = Math.max(1, offset - 1); shift <= offset + 1; shift++) {
      for (const topTrim of headers) {
        const bStart = top + topTrim;
        const overlap = aEnd - shift - bStart;
        if (overlap < minOverlap || bStart + overlap > second.height - bottom - original.bottomTrim) continue;
        const match = evaluate(a, b, aEnd, bStart, overlap, false, 1024);
        if (match.informative < 5 || match.score > 8) continue;
        proposals.push({ shift, match, topTrim });
      }
    }
  }
  // Do not let a family of neighboring offsets crowd other translation basins
  // out of verification. Retain one best boundary/offset for each voted basin.
  const basins = offsets.map(offset => proposals.filter(x => Math.abs(x.shift - offset) <= 1)
    .sort((x, y) => x.match.score - y.match.score || y.match.overlap - x.match.overlap)[0])
    .filter((x): x is NonNullable<typeof x> => !!x);
  const accepted: { candidate: typeof basins[number]; verified: PairMatch }[] = [];
  for (const candidate of basins) {
    // Re-search the entire overlap under this boundary hypothesis. Votes only
    // propose registration; they must not hide a periodic alternative that a
    // tile near the end of the image could not see.
    const verified = analyzeViewport(first, second, options,
      { topTrim: candidate.topTrim, bottomTrim: original.bottomTrim });
    const verifiedShift = aEnd - top - verified.topTrim - verified.overlap;
    if (verified.status === 'matched' && Math.abs(verifiedShift - candidate.shift) <= 1) {
      accepted.push({ candidate, verified });
    }
  }
  if (accepted.length !== 1) return original;
  const { candidate: best, verified } = accepted[0]!;
  // A second, similarly good full-overlap alignment remains ambiguous even if
  // its exact pixels fell just outside the final detail threshold.
  if (basins.some(x => Math.abs(x.shift - best.shift) > 3 &&
      x.match.score <= best.match.score + Math.max(0.65, best.match.score * 0.14))) return original;
  return { ...verified,
    reason: 'The scroll alignment was verified after refining the fixed header.' };
}

/**
 * Find the bottom-of-first / top-of-second overlap. No pixels are changed.
 * Input widths must already be normalized by the caller.
 */
function analyzeViewport(
  first: PixelImage, second: PixelImage, options: MatchOptions = {},
  barOverride?: { topTrim: number; bottomTrim: number },
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
  const bars = barOverride ?? (options.trimFixedBars === false ? { topTrim: 0, bottomTrim: 0 } :
    fixedBars(a, b, top, bottom));
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
  // Keep distinct alignment basins through dense verification. A run of nearby
  // offsets must not crowd a repeated-content alternative out of the shortlist.
  const distinct: Candidate[] = [];
  for (const candidate of refined) {
    if (distinct.every(x => Math.abs(x.overlap - candidate.overlap) > stride * 2)) {
      distinct.push(candidate);
      if (distinct.length >= 12) break;
    }
  }
  const denseCandidates = new Map([...refined.slice(0, 18), ...distinct]
    .map(candidate => [candidate.overlap, candidate]));
  const verified = [...denseCandidates.values()].map(candidate =>
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
  const rankingError = Math.min(best.error, best.structureError * 1.25);
  const ambiguous = gap < Math.max(0.65, rankingError * 0.14);
  const fit = clamp(1 - rankingError / 16, 0, 1);
  const separation = clamp(gap / 8, 0, 1);
  const confidence = clamp(0.3 + fit * 0.52 + separation * 0.18, 0, 1);
  if (ambiguous) {
    return { overlap: best.overlap, confidence: Math.min(0.64, confidence),
      status: 'uncertain', ...bars,
      reason: 'Repeated content makes this overlap ambiguous. Review the join.' };
  }
  // If neither appearance nor layout agrees, there is no promising alignment
  // to verify. Bound dense work to the single best unambiguous candidate.
  if (rankingError > 16) return noMatch('No matching overlap was found. Check screenshot order.');
  const details = verifyDetails(first, second, aEnd - best.overlap, bStart, best.overlap, !!barOverride);
  if (!details.consistentRegions) {
    return { overlap: best.overlap, confidence: Math.min(0.5, confidence), status: 'uncertain', ...bars,
      reason: 'Some text or image regions disagree within the overlap. Review the join.' };
  }
  const appearanceGap = alternatives.length ? Math.min(...alternatives.map(candidate =>
    candidate.error + 1 / Math.sqrt(candidate.overlap))) -
    (best.error + 1 / Math.sqrt(best.overlap)) : 20;
  if (!details.structuralMatch && appearanceGap < Math.max(0.65, best.error * 0.14)) {
    // A contrast-selected peak may sharpen an otherwise flat color match to a
    // repeated icon. Without independent interior detail, the appearance path
    // must also distinguish this alignment from its alternatives.
    return { overlap: best.overlap, confidence: Math.min(0.64, confidence),
      status: 'uncertain', ...bars,
      reason: 'Repeated content makes this overlap ambiguous. Review the join.' };
  }
  if (best.error > 16 && !details.structuralMatch) {
    return noMatch('No matching overlap was found. Check screenshot order.');
  }
  if (best.error > 8 && !details.structuralMatch) {
    return { overlap: best.overlap, confidence: Math.min(0.64, confidence),
      status: 'uncertain', ...bars,
      reason: 'The overlap is only a partial match. Review the join.' };
  }
  if (details.edges >= 16 && details.mismatchedFraction > 0.2 && !details.structuralMatch) {
    return { overlap: best.overlap, confidence: Math.min(0.5, confidence),
      status: 'uncertain', ...bars,
      reason: 'The layouts look similar, but text or image details differ. Review the join.' };
  }
  return { overlap: best.overlap, confidence, status: 'matched', ...bars,
    reason: 'A detailed matching overlap was found.' };
}

/** Match appearance first, then recover from independently registered content. */
export function analyzePair(
  first: PixelImage, second: PixelImage, options: MatchOptions = {},
): PairMatch {
  const result = analyzeViewport(first, second, options);
  if (result.status === 'matched' || result.status === 'duplicate' || options.trimFixedBars === false) return result;
  return recoverRegistration(first, second, options, result);
}

/**
 * Choose a complete chain of verified joins. Keep the two best histories for
 * every subset/end state so a weak reverse edge cannot destroy the true start,
 * and competing complete orders remain visible instead of being chosen greedily.
 */
export function findVerifiedOrder(
  indexes: number[], pair: (a: number, b: number) => PairMatch,
  contentHeight: (index: number) => number,
): number[] | null {
  const count = indexes.length;
  if (count < 2) return [...indexes];
  // The product accepts at most twelve images. A larger programmatic input can
  // still stitch in its supplied order without unbounded combinatorial work.
  if (count > 12) return null;
  const weights = new Float64Array(count * count).fill(-Infinity);
  for (let from = 0; from < count; from++) {
    for (let to = 0; to < count; to++) {
      if (from === to) continue;
      const match = pair(indexes[from]!, indexes[to]!);
      if (match.status !== 'matched') continue;
      const coverage = clamp(match.overlap / Math.max(1,
        Math.min(contentHeight(indexes[from]!), contentHeight(indexes[to]!))), 0, 1);
      weights[from * count + to] = coverage * clamp(match.confidence, 0, 1);
    }
  }
  const states = (1 << count) * count * 2;
  const scores = new Float64Array(states).fill(-Infinity);
  const previousEnd = new Int8Array(states).fill(-1);
  const previousRank = new Int8Array(states).fill(-1);
  const at = (mask: number, end: number, rank: number) => (mask * count + end) * 2 + rank;
  for (let start = 0; start < count; start++) scores[at(1 << start, start, 0)] = 0;
  for (let mask = 1; mask < 1 << count; mask++) {
    for (let end = 0; end < count; end++) {
      if (!(mask & 1 << end)) continue;
      for (let rank = 0; rank < 2; rank++) {
        const score = scores[at(mask, end, rank)]!;
        if (!Number.isFinite(score)) continue;
        for (let next = 0; next < count; next++) {
          if (mask & 1 << next) continue;
          const edge = weights[end * count + next]!;
          if (!Number.isFinite(edge)) continue;
          const candidate = score + edge;
          const nextMask = mask | 1 << next;
          const first = at(nextMask, next, 0);
          const second = first + 1;
          if (candidate > scores[first]!) {
            scores[second] = scores[first]!;
            previousEnd[second] = previousEnd[first]!;
            previousRank[second] = previousRank[first]!;
            scores[first] = candidate;
            previousEnd[first] = end;
            previousRank[first] = rank;
          } else if (candidate > scores[second]!) {
            scores[second] = candidate;
            previousEnd[second] = end;
            previousRank[second] = rank;
          }
        }
      }
    }
  }
  const full = (1 << count) - 1;
  const complete: { end: number; rank: number; score: number }[] = [];
  for (let end = 0; end < count; end++) for (let rank = 0; rank < 2; rank++) {
    const score = scores[at(full, end, rank)]!;
    if (Number.isFinite(score)) complete.push({ end, rank, score });
  }
  complete.sort((a, b) => b.score - a.score);
  const best = complete[0];
  if (!best) return null;
  const runner = complete[1];
  const margin = Math.max(0.04, best.score / (count - 1) * 0.12);
  if (runner && best.score - runner.score < margin) return null;
  const reversed: number[] = [];
  let mask = full;
  let end = best.end;
  let rank = best.rank;
  while (end >= 0) {
    reversed.push(indexes[end]!);
    const state = at(mask, end, rank);
    mask ^= 1 << end;
    end = previousEnd[state]!;
    rank = previousRank[state]!;
  }
  return reversed.reverse();
}

/** Build drawImage-ready regions. Unresolved joins concatenate without data loss. */
export function planStitch(images: PixelImage[], options: PlanOptions = {}): StitchPlan {
  const visualKeys = Object.keys(options.manualCuts ?? {});
  if (visualKeys.length && options.autoOrder) {
    throw new Error('Visual join edits require a fixed screenshot order. Turn off automatic ordering.');
  }
  if (visualKeys.length && images.length < 2) {
    throw new Error('Visual join edits require at least two screenshots.');
  }
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
  for (const key of visualKeys) {
    const position = Number(key);
    if (!Number.isInteger(position) || String(position) !== key || position < 0 || position >= order.length - 1) {
      throw new Error('A visual join edit refers to a join that is no longer present.');
    }
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
    const automatic = findVerifiedOrder(order, pair, index => images[index]!.height - top - bottom);
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
    const visual = options.manualCuts?.[position - 1];
    const override = options.manualOverlaps?.[position - 1];
    const manual = visual !== undefined || override !== undefined;
    const fromBottom = images[fromIndex]!.height - bottom;
    const toBottom = images[toIndex]!.height - bottom;
    let match: PairMatch;
    let upperEnd: number;
    let lowerStart: number;
    if (visual !== undefined) {
      if (!visual || !Number.isInteger(visual.upperEnd) || !Number.isInteger(visual.lowerStart) ||
          visual.upperEnd <= top || visual.upperEnd > fromBottom ||
          visual.lowerStart < top || visual.lowerStart >= toBottom) {
        throw new Error(`The cut lines for join ${position} must be whole source rows within the cropped screenshots and keep at least one row from each screenshot.`);
      }
      upperEnd = visual.upperEnd;
      lowerStart = visual.lowerStart;
      // Visual cuts describe exactly which source pixels the user chose. They
      // deliberately bypass inferred chrome and overlap, including a bad match.
      match = { overlap: 0, confidence: 1, status: 'matched', topTrim: 0, bottomTrim: 0,
        reason: 'You aligned these screenshots visually.' };
    } else {
      match = pair(fromIndex, toIndex);
      if (override !== undefined) {
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
      const seam = accepted && !manual ?
        seamOffset(images[fromIndex]!, images[toIndex]!, match, top, bottom) : overlap;
      upperEnd = fromBottom - (accepted ? match.bottomTrim + overlap - seam : 0);
      lowerStart = top + (accepted ? match.topTrim + seam : 0);
    }
    const previous = joins[position - 2];
    const retainedStart = previous?.lowerStart ?? top;
    const confirmedVisual = visual !== undefined || options.manualCuts?.[position - 2] !== undefined;
    const minimumEnd = retainedStart + (confirmedVisual ? 1 : 0);
    if (upperEnd < minimumEnd) {
      if (manual) {
        throw new Error(`The cut lines for joins ${position - 1} and ${position} overlap or remove screenshot ${position}. Move the lines apart to keep at least one row.`);
      }
      // Keep an automatic seam in the currently retained source interval. This
      // preserves its inferred translation without consuming an earlier join.
      const adjustment = minimumEnd - upperEnd;
      const maximumEnd = fromBottom - match.bottomTrim;
      if (minimumEnd <= maximumEnd && lowerStart + adjustment <= toBottom) {
        upperEnd = minimumEnd;
        lowerStart += adjustment;
      } else {
        match = { ...match, status: 'uncertain', confidence: Math.min(0.5, match.confidence),
          reason: 'This join would cross the preceding cut. Align these screenshots visually.' };
        upperEnd = fromBottom;
        lowerStart = top;
      }
    }
    const accepted = match.status === 'matched';
    if (!accepted) {
      needsReview = true;
      warnings.push(`Join ${position}: ${match.reason}`);
    }
    joins.push({ ...match, fromIndex, toIndex, manual,
      appliedOverlap: accepted && visual === undefined ? match.overlap : 0, upperEnd, lowerStart });
    const last = placements[placements.length - 1];
    const removed = fromBottom - upperEnd;
    if (removed > 0) {
      if (!last || last.imageIndex !== fromIndex || removed > last.sh) {
        throw new Error(`Join ${position} would remove pixels kept by an earlier join. Move the cut lines apart.`);
      }
      last.sh -= removed;
      last.dh -= removed;
      if (!last.sh) placements.pop();
    }
    const sh = toBottom - lowerStart;
    const tail = placements[placements.length - 1];
    if (sh > 0) placements.push({ imageIndex: toIndex, sx: 0, sy: lowerStart, sw: width, sh,
      dx: 0, dy: tail ? tail.dy + tail.dh : 0, dw: width, dh: sh });

  }
  const last = placements[placements.length - 1];
  if (!last) throw new Error('The cut lines remove every image row. Keep part of at least one screenshot.');
  return { width, height: last ? last.dy + last.dh : 0, order, skipped,
    placements, joins, warnings, needsReview };
}
