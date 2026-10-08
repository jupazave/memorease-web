import { describe, expect, it } from 'vitest';
import { COM8_AUTO, COM8_FROZEN, exposureTargetRegisters } from './sensor-control';

describe('exposureTargetRegisters', () => {
  it('uses the driver defaults at zero', () => {
    expect(exposureTargetRegisters(0)).toEqual([
      [0x24, 0x76],
      [0x25, 0x6a],
      [0x26, 0x94],
    ]);
  });

  it('shifts both window registers by n', () => {
    expect(exposureTargetRegisters(-60)).toEqual([
      [0x24, 0x3a],
      [0x25, 0x2e],
      [0x26, 0x71],
    ]);
    expect(exposureTargetRegisters(90)).toEqual([
      [0x24, 0xd0],
      [0x25, 0xc4],
      [0x26, 0xe6],
    ]);
  });

  it('switches the third register at -40 and 20', () => {
    expect(exposureTargetRegisters(-41)[2]).toEqual([0x26, 0x71]);
    expect(exposureTargetRegisters(-40)[2]).toEqual([0x26, 0x94]);
    expect(exposureTargetRegisters(19)[2]).toEqual([0x26, 0x94]);
    expect(exposureTargetRegisters(20)[2]).toEqual([0x26, 0xe6]);
  });

  it('clamps to -90..90 and rounds', () => {
    expect(exposureTargetRegisters(500)).toEqual(exposureTargetRegisters(90));
    expect(exposureTargetRegisters(-500)).toEqual(exposureTargetRegisters(-90));
    expect(exposureTargetRegisters(4.6)).toEqual(exposureTargetRegisters(5));
  });
});

describe('COM8 values', () => {
  it('frozen clears exactly the three auto bits', () => {
    expect(COM8_AUTO & ~COM8_FROZEN).toBe(0x07);
    expect(COM8_FROZEN & 0x07).toBe(0);
  });
});
