import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

class MemoryStore {
  private readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const KEY = 'memorease.settings';

describe('settings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings(new MemoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults when the stored value is not usable JSON', () => {
    for (const stored of ['{nope', 'null', '42']) {
      const store = new MemoryStore();
      store.setItem(KEY, stored);
      expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('replaces only the invalid fields', () => {
    const store = new MemoryStore();
    store.setItem(KEY, JSON.stringify({ film: 'x', rotate180: true, mirror: 'yes', exposure: 500, roll: ' bad ' }));
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, rotate180: true });
  });

  it('rounds the exposure', () => {
    const store = new MemoryStore();
    store.setItem(KEY, JSON.stringify({ exposure: -12.4 }));
    expect(loadSettings(store).exposure).toBe(-12);
  });

  it('round-trips', () => {
    const store = new MemoryStore();
    const settings = { film: 'slide', rotate180: true, mirror: true, exposure: -35, roll: 'Navidad 1998' } as const;
    saveSettings(store, settings);
    expect(loadSettings(store)).toEqual(settings);
  });
});
