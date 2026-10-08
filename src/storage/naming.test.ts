import { describe, expect, it } from 'vitest';
import { fileBase, isValidRoll, nextIndex } from './naming';

describe('isValidRoll', () => {
  it.each(['rollo-01', 'a', 'Navidad 1998', 'cumpleaños_98', 'x'.repeat(40)])('accepts %j', (name) => {
    expect(isValidRoll(name)).toBe(true);
  });

  it.each(['', ' rollo', 'rollo ', 'a/b', 'a.b', 'a:b', '..', 'x'.repeat(41)])('rejects %j', (name) => {
    expect(isValidRoll(name)).toBe(false);
  });
});

describe('fileBase', () => {
  it('pads the index to four digits', () => {
    expect(fileBase('rollo-01', 7)).toBe('rollo-01_0007');
    expect(fileBase('rollo-01', 12345)).toBe('rollo-01_12345');
  });
});

describe('nextIndex', () => {
  it('starts at 1 in an empty folder', () => {
    expect(nextIndex('rollo-01', [])).toBe(1);
  });

  it('continues after the highest number, even with gaps', () => {
    expect(nextIndex('rollo-01', ['rollo-01_0001.jpg', 'rollo-01_0001.dng', 'rollo-01_0005.jpg'])).toBe(6);
  });

  it('counts a DNG that lost its JPEG', () => {
    expect(nextIndex('rollo-01', ['rollo-01_0003.dng'])).toBe(4);
  });

  it('ignores files that do not belong to the roll', () => {
    const names = ['otro_0009.jpg', 'rollo-01_abc.jpg', 'rollo-01_0008.txt', 'rollo-01_0007.jpg.tmp', 'rollo-011_0050.jpg', '.DS_Store'];
    expect(nextIndex('rollo-01', names)).toBe(1);
  });
});
