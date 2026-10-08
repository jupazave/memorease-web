// Choices remembered between sessions.
import type { FilmType } from '../image/develop';
import { isValidRoll } from '../storage/naming';

export interface Settings {
  film: FilmType;
  rotate180: boolean;
  mirror: boolean;
  /** Auto-exposure target, -90 to 90. */
  exposure: number;
  roll: string;
}

export const DEFAULT_SETTINGS: Settings = {
  film: 'color-negative',
  rotate180: false,
  mirror: false,
  exposure: 0,
  roll: 'rollo-01',
};

const KEY = 'memorease.settings';
const FILMS: readonly string[] = ['color-negative', 'bw-negative', 'slide'];

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSettings(store: Store): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed as typeof saved;
  } catch {
    // corrupt value: fall through to the defaults
  }
  const { film, exposure, roll } = saved;
  return {
    film: typeof film === 'string' && FILMS.includes(film) ? (film as FilmType) : DEFAULT_SETTINGS.film,
    rotate180: saved.rotate180 === true,
    mirror: saved.mirror === true,
    exposure: typeof exposure === 'number' && exposure >= -90 && exposure <= 90 ? Math.round(exposure) : DEFAULT_SETTINGS.exposure,
    roll: typeof roll === 'string' && isValidRoll(roll) ? roll : DEFAULT_SETTINGS.roll,
  };
}

export function saveSettings(store: Store, settings: Settings): void {
  store.setItem(KEY, JSON.stringify(settings));
}
