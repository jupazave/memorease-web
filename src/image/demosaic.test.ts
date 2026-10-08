import { describe, expect, it } from 'vitest';
import { demosaicBilinear, demosaicHalf } from './demosaic';

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

function pixel(rgb: Uint8Array, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 3;
  return [rgb[o], rgb[o + 1], rgb[o + 2]];
}

describe('demosaicHalf', () => {
  it('turns each 2x2 cell into one pixel', () => {
    const rgb = demosaicHalf(Uint8Array.of(10, 20, 30, 40), 2, 2);
    expect([...rgb]).toEqual([40, 25, 10]);
  });

  it('returns a quarter of the pixels', () => {
    expect(demosaicHalf(new Uint8Array(8 * 4), 8, 4).length).toBe(4 * 2 * 3);
  });

  it('reproduces a flat colour', () => {
    const rgb = demosaicHalf(flat(8, 4, [200, 100, 50]), 8, 4);
    for (let i = 0; i < rgb.length; i += 3) expect([rgb[i], rgb[i + 1], rgb[i + 2]]).toEqual([200, 100, 50]);
  });
});

describe('demosaicBilinear', () => {
  it('keeps full resolution', () => {
    expect(demosaicBilinear(new Uint8Array(6 * 4), 6, 4).length).toBe(6 * 4 * 3);
  });

  it('reproduces a flat colour everywhere, including the borders', () => {
    const rgb = demosaicBilinear(flat(6, 4, [200, 100, 50]), 6, 4);
    for (let i = 0; i < rgb.length; i += 3) expect([rgb[i], rgb[i + 1], rgb[i + 2]]).toEqual([200, 100, 50]);
  });

  it('interpolates red from a single lit red site', () => {
    const raw = new Uint8Array(4 * 4);
    raw[1 * 4 + 1] = 200; // red site at (1, 1)
    const rgb = demosaicBilinear(raw, 4, 4);
    expect(pixel(rgb, 4, 1, 1)[0]).toBe(200); // the site itself
    expect(pixel(rgb, 4, 2, 1)[0]).toBe(100); // green site on the red row: left/right average
    expect(pixel(rgb, 4, 1, 2)[0]).toBe(100); // green site on the blue row: up/down average
    expect(pixel(rgb, 4, 2, 2)[0]).toBe(50); // blue site: average of four diagonals
  });

  it('mirrors at the border so neighbours keep their Bayer colour', () => {
    const raw = new Uint8Array(4 * 4);
    raw[1 * 4 + 1] = 200;
    // Blue site (0, 0): all four mirrored diagonals land on the red site (1, 1).
    expect(pixel(demosaicBilinear(raw, 4, 4), 4, 0, 0)[0]).toBe(200);
  });
});
