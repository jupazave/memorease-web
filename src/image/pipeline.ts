// Chains demosaicing, level measurement and film conversion for a raw frame.
import { FRAME_HEIGHT, FRAME_WIDTH } from '../frame';
import { demosaicBilinear, demosaicHalf } from './demosaic';
import { clippedFraction, computeLevels, develop, type FilmType, type Levels, type Orientation } from './develop';

export interface DevelopParams {
  film: FilmType;
  orientation: Orientation;
  /** When set, these levels are used instead of measuring the frame. */
  lockedLevels: Levels | null;
}

export interface Developed {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  levels: Levels;
  /** Largest fraction of saturated pixels in any channel of the raw frame. */
  clipped: number;
}

export function developPreview(raw: Uint8Array, params: DevelopParams, width = FRAME_WIDTH, height = FRAME_HEIGHT): Developed {
  const w = width / 2;
  const h = height / 2;
  const half = demosaicHalf(raw, width, height);
  const levels = params.lockedLevels ?? computeLevels(half, w, h, params.film);
  return {
    rgba: develop(half, w, h, params.film, levels, params.orientation),
    width: w,
    height: h,
    levels,
    clipped: clippedFraction(half),
  };
}

/** Levels are always measured on the half-resolution image, so a capture matches its preview. */
export function developCapture(raw: Uint8Array, params: DevelopParams, width = FRAME_WIDTH, height = FRAME_HEIGHT): Developed {
  const half = demosaicHalf(raw, width, height);
  const levels = params.lockedLevels ?? computeLevels(half, width / 2, height / 2, params.film);
  return {
    rgba: develop(demosaicBilinear(raw, width, height), width, height, params.film, levels, params.orientation),
    width,
    height,
    levels,
    clipped: clippedFraction(half),
  };
}
