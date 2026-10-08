import { describe, expect, it } from 'vitest';
import {
  buildLut,
  clippedFraction,
  computeLevels,
  develop,
  MIN_RANGE,
  tiffOrientation,
  type Levels,
  type Orientation,
} from './develop';

const NONE: Orientation = { rotate180: false, mirror: false };
const FULL: Levels = [
  { lo: 1, hi: 255 },
  { lo: 1, hi: 255 },
  { lo: 1, hi: 255 },
];

/** width x height image whose left half is `left` and right half is `right`. */
function halves(width: number, height: number, left: number[], right: number[]): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgb.set(x < width / 2 ? left : right, (y * width + x) * 3);
  }
  return rgb;
}

describe('computeLevels', () => {
  it('takes the 0.5 and 99.5 percentiles of each channel', () => {
    const rgb = halves(100, 100, [60, 70, 80], [180, 190, 200]);
    expect(computeLevels(rgb, 100, 100, 'color-negative')).toEqual([
      { lo: 60, hi: 180 },
      { lo: 70, hi: 190 },
      { lo: 80, hi: 200 },
    ]);
  });

  it('ignores a 5% margin on every side', () => {
    const rgb = halves(100, 100, [60, 70, 80], [180, 190, 200]);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        if (x < 5 || y < 5) rgb.set([0, 0, 0], (y * 100 + x) * 3);
        else if (x >= 95 || y >= 95) rgb.set([255, 255, 255], (y * 100 + x) * 3);
      }
    }
    expect(computeLevels(rgb, 100, 100, 'slide')).toEqual([
      { lo: 60, hi: 180 },
      { lo: 70, hi: 190 },
      { lo: 80, hi: 200 },
    ]);
  });

  it('keeps a minimum range on a flat image', () => {
    const levels = computeLevels(halves(20, 20, [100, 100, 100], [100, 100, 100]), 20, 20, 'slide');
    for (const { lo, hi } of levels) expect(hi - lo).toBe(MIN_RANGE);
    const top = computeLevels(halves(20, 20, [255, 255, 255], [255, 255, 255]), 20, 20, 'slide');
    expect(top[0]).toEqual({ lo: 255 - MIN_RANGE, hi: 255 });
  });

  it('uses a single luminance level set for black and white', () => {
    // luminance = (R + 2G + B) >> 2: 80 on the left, 140 on the right
    const levels = computeLevels(halves(100, 100, [40, 80, 120], [100, 140, 180]), 100, 100, 'bw-negative');
    expect(levels).toEqual([
      { lo: 80, hi: 140 },
      { lo: 80, hi: 140 },
      { lo: 80, hi: 140 },
    ]);
  });
});

describe('buildLut', () => {
  it('maps the film base to black and the densest area to white for negatives', () => {
    const lut = buildLut({ lo: 50, hi: 200 }, 'color-negative');
    expect(lut[200]).toBe(0);
    expect(lut[255]).toBe(0);
    expect(lut[50]).toBe(255);
    expect(lut[10]).toBe(255);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeLessThanOrEqual(lut[v - 1]);
  });

  it('keeps slides the right way round', () => {
    const lut = buildLut({ lo: 50, hi: 200 }, 'slide');
    expect(lut[50]).toBe(0);
    expect(lut[200]).toBe(255);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it('survives a zero low level', () => {
    const lut = buildLut({ lo: 0, hi: 200 }, 'color-negative');
    expect(lut[200]).toBe(0);
    expect(lut[0]).toBe(255);
  });
});

describe('develop', () => {
  it('renders a grey ramp seen through an orange mask as neutral', () => {
    // Film model: transmittance of channel c = base[c] * exposure ^ -gamma[c].
    const base = [0.9, 0.6, 0.35];
    const gamma = [0.5, 0.6, 0.7];
    const steps = 64;
    const maxExposure = 20;
    const rawAt = (c: number, e: number) => Math.round(255 * base[c] * Math.pow(e, -gamma[c]));
    const rgb = new Uint8Array(steps * 3);
    for (let i = 0; i < steps; i++) {
      const e = Math.pow(maxExposure, i / (steps - 1));
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rawAt(c, e);
    }
    const levels: Levels = [
      { lo: rawAt(0, maxExposure), hi: rawAt(0, 1) },
      { lo: rawAt(1, maxExposure), hi: rawAt(1, 1) },
      { lo: rawAt(2, maxExposure), hi: rawAt(2, 1) },
    ];
    const out = develop(rgb, steps, 1, 'color-negative', levels, NONE);
    for (let i = 0; i < steps; i++) {
      const px = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]];
      // 8-bit rounding of the dark blue channel alone costs up to 6 levels
      expect(Math.max(...px) - Math.min(...px)).toBeLessThanOrEqual(12);
      expect(out[i * 4 + 3]).toBe(255);
    }
    expect(out[0]).toBe(0);
    expect(out[(steps - 1) * 4]).toBe(255);
  });

  it('outputs grey for black-and-white negatives', () => {
    const out = develop(Uint8Array.of(40, 80, 120, 200, 10, 90), 2, 1, 'bw-negative', FULL, NONE);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(out[4]).toBe(out[5]);
    expect(out[5]).toBe(out[6]);
  });

  it('applies the four orientations', () => {
    const rgb = Uint8Array.of(10, 10, 10, 60, 60, 60, 120, 120, 120, 240, 240, 240); // 2x2
    const reference = develop(rgb, 2, 2, 'slide', FULL, NONE);
    const red = (out: Uint8ClampedArray) => [out[0], out[4], out[8], out[12]];
    const src = red(reference);
    const cases: Array<[Orientation, number[]]> = [
      [{ rotate180: false, mirror: false }, [0, 1, 2, 3]],
      [{ rotate180: true, mirror: false }, [3, 2, 1, 0]],
      [{ rotate180: false, mirror: true }, [1, 0, 3, 2]],
      [{ rotate180: true, mirror: true }, [2, 3, 0, 1]],
    ];
    for (const [orientation, order] of cases) {
      expect(red(develop(rgb, 2, 2, 'slide', FULL, orientation))).toEqual(order.map((i) => src[i]));
    }
  });
});

describe('clippedFraction', () => {
  it('reports the worst channel', () => {
    const rgb = new Uint8Array(100 * 3);
    for (let i = 0; i < 2; i++) rgb[i * 3] = 255;
    for (let i = 0; i < 3; i++) rgb[i * 3 + 2] = 255;
    expect(clippedFraction(rgb)).toBeCloseTo(0.03, 10);
  });
});

describe('tiffOrientation', () => {
  it('maps to TIFF orientation values', () => {
    expect(tiffOrientation({ rotate180: false, mirror: false })).toBe(1);
    expect(tiffOrientation({ rotate180: false, mirror: true })).toBe(2);
    expect(tiffOrientation({ rotate180: true, mirror: false })).toBe(3);
    expect(tiffOrientation({ rotate180: true, mirror: true })).toBe(4);
  });
});
