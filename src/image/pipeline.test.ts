import { describe, expect, it } from 'vitest';
import { MIN_RANGE, type Levels } from './develop';
import { developCapture, developPreview, type DevelopParams } from './pipeline';

/** BGGR mosaic of a single flat colour. */
function flat(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw[y * width + x] = y % 2 === 0 ? (x % 2 === 0 ? b : g) : x % 2 === 0 ? g : r;
    }
  }
  return raw;
}

const auto: DevelopParams = { film: 'slide', orientation: { rotate180: false, mirror: false }, lockedLevels: null };
const locked: Levels = [
  { lo: 10, hi: 210 },
  { lo: 20, hi: 220 },
  { lo: 30, hi: 230 },
];

describe('developPreview', () => {
  it('returns a half-resolution RGBA image', () => {
    const r = developPreview(flat(8, 4, [200, 100, 50]), auto, 8, 4);
    expect([r.width, r.height]).toEqual([4, 2]);
    expect(r.rgba.length).toBe(4 * 2 * 4);
  });

  it('measures levels when none are locked', () => {
    const r = developPreview(flat(8, 4, [200, 100, 50]), auto, 8, 4);
    expect(r.levels[0]).toEqual({ lo: 200, hi: 200 + MIN_RANGE });
  });

  it('uses locked levels as given', () => {
    const r = developPreview(flat(8, 4, [200, 100, 50]), { ...auto, lockedLevels: locked }, 8, 4);
    expect(r.levels).toBe(locked);
  });

  it('reports saturation', () => {
    expect(developPreview(flat(8, 4, [255, 100, 50]), auto, 8, 4).clipped).toBe(1);
    expect(developPreview(flat(8, 4, [200, 100, 50]), auto, 8, 4).clipped).toBe(0);
  });
});

describe('developCapture', () => {
  it('returns a full-resolution RGBA image', () => {
    const r = developCapture(flat(8, 4, [200, 100, 50]), auto, 8, 4);
    expect([r.width, r.height]).toEqual([8, 4]);
    expect(r.rgba.length).toBe(8 * 4 * 4);
  });

  it('develops with the same levels the preview would use', () => {
    const raw = flat(8, 4, [200, 100, 50]);
    expect(developCapture(raw, auto, 8, 4).levels).toEqual(developPreview(raw, auto, 8, 4).levels);
  });

  it('uses locked levels as given', () => {
    const r = developCapture(flat(8, 4, [200, 100, 50]), { ...auto, lockedLevels: locked }, 8, 4);
    expect(r.levels).toBe(locked);
  });
});
