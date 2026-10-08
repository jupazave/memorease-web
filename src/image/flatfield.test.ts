import { describe, expect, it } from 'vitest';
import { applyFlat, buildCalibration, checkCalibration, expandGains, GAIN_ONE, type FlatCalibration } from './flatfield';

const W = 96;
const H = 64;
const CELL = 8; // half-resolution pixels, so the grid is 6 x 4

type Level = (hx: number, hy: number) => number;

/** BGGR mosaic whose channels follow the given functions of the half-resolution position. */
function mosaic(r: Level, g: Level, b: Level): Uint8Array {
  const raw = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const level = y % 2 === 0 ? (x % 2 === 0 ? b : g) : x % 2 === 0 ? g : r;
      raw[y * W + x] = level(x >> 1, y >> 1);
    }
  }
  return raw;
}

const constant = (v: number): Level => () => v;
const calibrate = (...frames: Uint8Array[]) => buildCalibration(frames, W, H, 1234, CELL);

/** Values of one colour's sites over the interior columns, away from the clamped grid edges. */
function interior(raw: Uint8Array, site: 'r' | 'b'): number[] {
  const values: number[] = [];
  for (let hy = 0; hy < H / 2; hy++) {
    for (let hx = CELL / 2; hx < W / 2 - CELL / 2; hx++) {
      const x = 2 * hx + (site === 'r' ? 1 : 0);
      const y = 2 * hy + (site === 'r' ? 1 : 0);
      values.push(raw[y * W + x]);
    }
  }
  return values;
}

describe('buildCalibration', () => {
  it('records the mean of every cell for R, G and B', () => {
    const c = calibrate(mosaic(constant(200), constant(100), constant(50)));
    expect([c.width, c.height, c.cell, c.gridWidth, c.gridHeight]).toEqual([W, H, CELL, 6, 4]);
    expect([...c.grids[0]]).toEqual(new Array(24).fill(200));
    expect([...c.grids[1]]).toEqual(new Array(24).fill(100));
    expect([...c.grids[2]]).toEqual(new Array(24).fill(50));
    expect(c.clipped).toBe(0);
    expect(c.createdAt).toBe(1234);
  });

  it('averages the frames it is given', () => {
    const c = calibrate(mosaic(constant(100), constant(100), constant(100)), mosaic(constant(110), constant(100), constant(100)));
    expect(c.grids[0][0]).toBe(105);
  });

  it('reports the fraction of saturated samples', () => {
    // red sites are a quarter of the mosaic
    expect(calibrate(mosaic(constant(255), constant(100), constant(100))).clipped).toBe(0.25);
  });
});

describe('expandGains', () => {
  it('is all ones for an even light', () => {
    const gains = expandGains(calibrate(mosaic(constant(120), constant(120), constant(120))));
    expect(gains.length).toBe(W * H);
    expect(gains.every((g) => g === GAIN_ONE)).toBe(true);
  });

  it('never brightens: the dimmest cell is the reference', () => {
    const gains = expandGains(calibrate(mosaic((hx) => 100 + hx, (hx) => 100 + hx, (hx) => 100 + hx)));
    expect(Math.max(...gains)).toBe(GAIN_ONE);
    expect(Math.min(...gains)).toBeLessThan(GAIN_ONE * 0.75);
  });
});

describe('applyFlat', () => {
  it('leaves a frame untouched when the light is even', () => {
    const frame = mosaic((hx) => 30 + hx * 3, (_, hy) => 40 + hy * 5, (hx, hy) => 20 + hx + hy);
    const gains = expandGains(calibrate(mosaic(constant(120), constant(120), constant(120))));
    expect([...applyFlat(frame, gains)]).toEqual([...frame]);
  });

  it('flattens the blank frame it was calibrated with', () => {
    const blank = mosaic((hx) => 100 + hx, (hx) => 100 + hx, (hx) => 100 + hx);
    const flat = interior(applyFlat(blank, expandGains(calibrate(blank))), 'r');
    // before: 104..143 across the interior; after: the level of the dimmest cell, 103.5
    expect(Math.min(...flat)).toBeGreaterThanOrEqual(102);
    expect(Math.max(...flat)).toBeLessThanOrEqual(105);
  });

  it('corrects each colour with its own map', () => {
    const blank = mosaic((hx) => 100 + hx, constant(120), (hx) => 147 - hx);
    const out = applyFlat(blank, expandGains(calibrate(blank)));
    for (const site of ['r', 'b'] as const) {
      const values = interior(out, site);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(3);
    }
  });

  it('dithers its rounding, so a smooth gain cannot draw contour lines on 8-bit data', () => {
    // 100 x 0.9955 = 99.55: plain rounding would give 100 everywhere, and 99 just across a contour
    const frame = new Uint8Array(W * H).fill(100);
    const gains = new Uint16Array(W * H).fill(Math.round(0.9955 * GAIN_ONE));
    const out = applyFlat(frame, gains);
    expect(new Set(out)).toEqual(new Set([99, 100]));
    const mean = out.reduce((sum, v) => sum + v, 0) / out.length;
    expect(Math.abs(mean - 99.55)).toBeLessThan(0.05);
  });

  it('returns a new array and does not modify its input', () => {
    const blank = mosaic((hx) => 100 + hx, (hx) => 100 + hx, (hx) => 100 + hx);
    const copy = blank.slice();
    const out = applyFlat(blank, expandGains(calibrate(blank)));
    expect(out).not.toBe(blank);
    expect([...blank]).toEqual([...copy]);
  });
});

describe('checkCalibration', () => {
  const withGrid = (base: FlatCalibration, channel: number, values: number[]): FlatCalibration => {
    const grids = base.grids.map((g) => g.slice()) as FlatCalibration['grids'];
    grids[channel].set(values);
    return { ...base, grids };
  };
  const even = calibrate(mosaic(constant(120), constant(120), constant(120)));

  it('accepts the unevenness of a real lamp', () => {
    // measured on the scanner: the dimmest cell is about 0.67 of the brightest
    expect(checkCalibration(withGrid(even, 2, [94, 141]))).toBeNull();
  });

  it('rejects a frame with a photo in it', () => {
    // measured on real negatives: 0.19 to 0.46
    expect(checkCalibration(withGrid(even, 0, [56, 122]))).toBe('uneven');
  });

  it('rejects a saturated frame', () => {
    expect(checkCalibration({ ...even, clipped: 0.01 })).toBe('saturated');
  });

  it('rejects a frame with almost no light', () => {
    expect(checkCalibration(calibrate(mosaic(constant(10), constant(10), constant(10))))).toBe('dark');
  });
});
