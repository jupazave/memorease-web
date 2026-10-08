// Flat-field correction: evens out the scanner's lamp using a reference taken with nothing in it.
// The reference is kept as a coarse grid of cell means per colour, so the correction is smooth and
// adds no noise. It does not remove dust.

/** Grid cell size, in half-resolution pixels. */
export const FLAT_CELL = 24;
/** Blank frames averaged into one calibration. */
export const FLAT_FRAMES = 4;
/** Fixed-point representation of a gain of 1. */
export const GAIN_ONE = 1 << 15;

const MIN_LEVEL = 30;
const MAX_CLIPPED = 0.001;
// Dimmest cell over brightest cell. Measured on the scanner: 0.67 to 0.75 when empty, 0.19 to 0.46
// with a negative in it.
const MIN_UNIFORMITY = 0.55;

export interface FlatCalibration {
  /** Mosaic size the reference was taken at. */
  width: number;
  height: number;
  cell: number;
  gridWidth: number;
  gridHeight: number;
  /** Mean level of each cell of the blank frames, for R, G and B. */
  grids: [Float32Array, Float32Array, Float32Array];
  /** Fraction of saturated samples in the blank frames. */
  clipped: number;
  createdAt: number;
}

export type FlatProblem = 'dark' | 'saturated' | 'uneven';

/** Averages blank BGGR frames into a grid of cell means per colour. */
export function buildCalibration(
  frames: Uint8Array[],
  width: number,
  height: number,
  createdAt: number,
  cell = FLAT_CELL,
): FlatCalibration {
  const w = width >> 1;
  const h = height >> 1;
  const gridWidth = Math.ceil(w / cell);
  const gridHeight = Math.ceil(h / cell);
  const sums = [new Float64Array(gridWidth * gridHeight), new Float64Array(gridWidth * gridHeight), new Float64Array(gridWidth * gridHeight)];
  const counts = new Uint32Array(gridWidth * gridHeight);
  let clipped = 0;
  for (const raw of frames) {
    for (let i = 0; i < raw.length; i++) if (raw[i] === 255) clipped++;
    for (let y = 0; y < h; y++) {
      const top = 2 * y * width;
      const bottom = top + width;
      const row = Math.floor(y / cell) * gridWidth;
      for (let x = 0; x < w; x++) {
        const c = row + Math.floor(x / cell);
        sums[0][c] += raw[bottom + 2 * x + 1];
        sums[1][c] += (raw[top + 2 * x + 1] + raw[bottom + 2 * x]) / 2;
        sums[2][c] += raw[top + 2 * x];
        counts[c]++;
      }
    }
  }
  const mean = (sum: Float64Array) => Float32Array.from(sum, (s, i) => s / counts[i]);
  return {
    width,
    height,
    cell,
    gridWidth,
    gridHeight,
    grids: [mean(sums[0]), mean(sums[1]), mean(sums[2])],
    clipped: clipped / (frames.length * width * height),
    createdAt,
  };
}

/** Why a reference cannot be trusted, or null when it can. */
export function checkCalibration(c: FlatCalibration): FlatProblem | null {
  const ranges = c.grids.map((grid) => {
    let lo = Infinity;
    let hi = 0;
    let sum = 0;
    for (const v of grid) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
    }
    return { lo, hi, mean: sum / grid.length };
  });
  if (ranges.some((r) => r.mean < MIN_LEVEL)) return 'dark';
  if (c.clipped > MAX_CLIPPED) return 'saturated';
  if (ranges.some((r) => r.lo < r.hi * MIN_UNIFORMITY)) return 'uneven';
  return null;
}

/**
 * Per-sample gains for the whole mosaic, in units of 1 / GAIN_ONE. Each colour is scaled down to
 * the level of its dimmest cell, so no sample is ever brightened into saturation.
 */
export function expandGains(c: FlatCalibration): Uint16Array {
  const { width, height, cell, gridWidth, gridHeight } = c;
  const w = width >> 1;
  const h = height >> 1;
  const floors = c.grids.map((grid) => grid.reduce((lo, v) => Math.min(lo, v), Infinity));
  const gains = new Uint16Array(width * height);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gridHeight - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gridHeight - 1, y0 + 1);
    const ty = fy - y0;
    const top = 2 * y * width;
    const bottom = top + width;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gridWidth - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gridWidth - 1, x0 + 1);
      const tx = fx - x0;
      const gain = (channel: number): number => {
        const grid = c.grids[channel];
        const level =
          (grid[y0 * gridWidth + x0] * (1 - tx) + grid[y0 * gridWidth + x1] * tx) * (1 - ty) +
          (grid[y1 * gridWidth + x0] * (1 - tx) + grid[y1 * gridWidth + x1] * tx) * ty;
        return Math.round((floors[channel] / level) * GAIN_ONE);
      };
      const green = gain(1);
      gains[top + 2 * x] = gain(2);
      gains[top + 2 * x + 1] = green;
      gains[bottom + 2 * x] = green;
      gains[bottom + 2 * x + 1] = gain(0);
    }
  }
  return gains;
}

// Rounding offsets in [0, GAIN_ONE), from a fixed xorshift sequence so results are reproducible.
const DITHER = (() => {
  const table = new Uint16Array(1 << 16);
  let state = 0x9e3779b9;
  for (let i = 0; i < table.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    table[i] = (state >>> 0) % GAIN_ONE;
  }
  return table;
})();

/**
 * Returns a corrected copy of a BGGR frame. Rounding is dithered: with a fixed half-up rule, a
 * gain that changes smoothly across 8-bit data rounds up on one side of a line and down on the
 * other, which draws contour bands in smooth areas such as skies.
 */
export function applyFlat(raw: Uint8Array, gains: Uint16Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] * gains[i] + DITHER[i & 0xffff]) >> 15;
  return out;
}
