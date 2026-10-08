import { describe, expect, it } from 'vitest';
import { isoBytesPerMicroframe } from './descriptor';

// Configuration descriptor of the Memor-ease (05a9:1550), as read from the device.
const CONFIG = Uint8Array.from([
  9, 2, 55, 0, 1, 1, 0, 0x80, 250, // configuration, wTotalLength 55
  9, 4, 0, 0, 2, 0xff, 0, 0, 0, // interface 0, alternate 0
  7, 5, 0x83, 3, 4, 0, 1, // endpoint 3 IN, interrupt, 4 bytes
  7, 5, 0x81, 1, 0, 0, 1, // endpoint 1 IN, isochronous, 0 bytes
  9, 4, 0, 1, 2, 0xff, 0, 0, 0, // interface 0, alternate 1
  7, 5, 0x83, 3, 4, 0, 1,
  7, 5, 0x81, 1, 0xfc, 0x13, 1, // endpoint 1 IN, isochronous, wMaxPacketSize 0x13fc
]);

describe('isoBytesPerMicroframe', () => {
  it('decodes the high-bandwidth multiplier: 0x13fc is 3 x 1020', () => {
    expect(isoBytesPerMicroframe(CONFIG, 1, 0x81)).toBe(3060);
  });

  it('reads the idle alternate as zero', () => {
    expect(isoBytesPerMicroframe(CONFIG, 0, 0x81)).toBe(0);
  });

  it('throws when the endpoint is not in that alternate', () => {
    expect(() => isoBytesPerMicroframe(CONFIG, 1, 0x82)).toThrow(/0x82/);
  });
});
