// Turns demosaiced RGB into a displayable image for each film type.

export type FilmType = 'color-negative' | 'bw-negative' | 'slide';

export interface ChannelLevels {
  lo: number;
  hi: number;
}

/** Levels for R, G and B. Black-and-white film carries the same luminance levels three times. */
export type Levels = readonly [ChannelLevels, ChannelLevels, ChannelLevels];

export interface Orientation {
  rotate180: boolean;
  mirror: boolean;
}

export const LO_PERCENTILE = 0.005;
export const HI_PERCENTILE = 0.995;
/** Fraction of the image ignored on each side when measuring levels. */
export const MARGIN = 0.05;
export const MIN_RANGE = 8;
/** Exponent applied to normalised density for negatives. */
export const TONE = 1.0;
export const SLIDE_GAMMA = 2.2;
/** Above this fraction of saturated pixels in any channel the UI warns. */
export const CLIP_WARN_FRACTION = 0.01;

const luminance = (r: number, g: number, b: number) => (r + 2 * g + b) >> 2;

function percentileLevels(hist: Uint32Array, total: number): ChannelLevels {
  const at = (fraction: number): number => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= fraction * total) return v;
    }
    return 255;
  };
  let lo = at(LO_PERCENTILE);
  let hi = at(HI_PERCENTILE);
  if (hi - lo < MIN_RANGE) {
    hi = Math.min(255, lo + MIN_RANGE);
    lo = hi - MIN_RANGE;
  }
  return { lo, hi };
}

export function computeLevels(rgb: Uint8Array, width: number, height: number, film: FilmType): Levels {
  const mx = Math.floor(width * MARGIN);
  const my = Math.floor(height * MARGIN);
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const grey = film === 'bw-negative';
  let total = 0;
  for (let y = my; y < height - my; y++) {
    for (let x = mx; x < width - mx; x++) {
      const o = (y * width + x) * 3;
      if (grey) {
        hist[0][luminance(rgb[o], rgb[o + 1], rgb[o + 2])]++;
      } else {
        hist[0][rgb[o]]++;
        hist[1][rgb[o + 1]]++;
        hist[2][rgb[o + 2]]++;
      }
      total++;
    }
  }
  if (grey) {
    const l = percentileLevels(hist[0], total);
    return [l, l, l];
  }
  return [percentileLevels(hist[0], total), percentileLevels(hist[1], total), percentileLevels(hist[2], total)];
}

export function clippedFraction(rgb: Uint8Array): number {
  const counts = [0, 0, 0];
  for (let o = 0; o < rgb.length; o += 3) {
    if (rgb[o] === 255) counts[0]++;
    if (rgb[o + 1] === 255) counts[1]++;
    if (rgb[o + 2] === 255) counts[2]++;
  }
  return Math.max(counts[0], counts[1], counts[2]) / (rgb.length / 3);
}

/**
 * Negatives: normalised density d = ln(hi / v) / ln(hi / lo) is 0 at the film base and 1 at the
 * densest area. Normalising each channel separately removes the orange mask and equalises the
 * contrast of the three dye layers. Slides are a plain levels stretch with display gamma.
 */
export function buildLut(levels: ChannelLevels, film: FilmType): Uint8Array {
  const lo = Math.max(1, levels.lo);
  const hi = Math.max(lo + 1, levels.hi);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let out: number;
    if (film === 'slide') {
      const n = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      out = Math.pow(n, 1 / SLIDE_GAMMA);
    } else {
      const d = Math.min(1, Math.max(0, Math.log(hi / Math.max(v, 1)) / Math.log(hi / lo)));
      out = Math.pow(d, TONE);
    }
    lut[v] = Math.round(255 * out);
  }
  return lut;
}

/** RGB in, RGBA out, with the film conversion and the orientation applied. */
export function develop(
  rgb: Uint8Array,
  width: number,
  height: number,
  film: FilmType,
  levels: Levels,
  orientation: Orientation,
): Uint8ClampedArray<ArrayBuffer> {
  const luts = [buildLut(levels[0], film), buildLut(levels[1], film), buildLut(levels[2], film)];
  const out = new Uint8ClampedArray(width * height * 4);
  const grey = film === 'bw-negative';
  // A 180-degree turn flips both axes; adding a mirror flips x back.
  const flipX = orientation.mirror !== orientation.rotate180;
  const flipY = orientation.rotate180;
  for (let y = 0; y < height; y++) {
    const dy = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const dx = flipX ? width - 1 - x : x;
      const s = (y * width + x) * 3;
      const d = (dy * width + dx) * 4;
      if (grey) {
        const v = luts[0][luminance(rgb[s], rgb[s + 1], rgb[s + 2])];
        out[d] = v;
        out[d + 1] = v;
        out[d + 2] = v;
      } else {
        out[d] = luts[0][rgb[s]];
        out[d + 1] = luts[1][rgb[s + 1]];
        out[d + 2] = luts[2][rgb[s + 2]];
      }
      out[d + 3] = 255;
    }
  }
  return out;
}

/** TIFF/DNG orientation tag for sensor data that is stored unrotated. */
export function tiffOrientation(o: Orientation): number {
  if (o.rotate180) return o.mirror ? 4 : 3;
  return o.mirror ? 2 : 1;
}
