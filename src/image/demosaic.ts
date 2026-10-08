// Demosaicing for a BGGR mosaic: blue on even rows and even columns, red on odd rows and odd columns.
// Both functions return interleaved RGB, three bytes per pixel.

/** Half resolution: every 2x2 cell becomes one pixel, with the two greens averaged. */
export function demosaicHalf(raw: Uint8Array, width: number, height: number): Uint8Array {
  const w = width >> 1;
  const h = height >> 1;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const top = 2 * y * width;
    const bottom = top + width;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      out[o] = raw[bottom + 2 * x + 1];
      out[o + 1] = (raw[top + 2 * x + 1] + raw[bottom + 2 * x] + 1) >> 1;
      out[o + 2] = raw[top + 2 * x];
    }
  }
  return out;
}

/**
 * Full resolution, bilinear. Borders are mirrored (-1 becomes 1, width becomes width - 2) so that
 * a neighbour always has the Bayer colour it would have inside the image.
 */
export function demosaicBilinear(raw: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const north = (y === 0 ? 1 : y - 1) * width;
    const south = (y === height - 1 ? height - 2 : y + 1) * width;
    const blueRow = (y & 1) === 0;
    for (let x = 0; x < width; x++) {
      const west = x === 0 ? 1 : x - 1;
      const east = x === width - 1 ? width - 2 : x + 1;
      const here = raw[row + x];
      const horizontal = (raw[row + west] + raw[row + east] + 1) >> 1;
      const vertical = (raw[north + x] + raw[south + x] + 1) >> 1;
      const cross = (raw[north + x] + raw[south + x] + raw[row + west] + raw[row + east] + 2) >> 2;
      const diagonal = (raw[north + west] + raw[north + east] + raw[south + west] + raw[south + east] + 2) >> 2;
      const evenColumn = (x & 1) === 0;
      let r: number;
      let g: number;
      let b: number;
      if (blueRow) {
        if (evenColumn) {
          b = here;
          g = cross;
          r = diagonal;
        } else {
          g = here;
          b = horizontal;
          r = vertical;
        }
      } else if (evenColumn) {
        g = here;
        r = horizontal;
        b = vertical;
      } else {
        r = here;
        g = cross;
        b = diagonal;
      }
      const o = (row + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}
