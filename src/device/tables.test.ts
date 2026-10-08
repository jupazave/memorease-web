import { describe, expect, it } from 'vitest';
import { OV562X_BRIDGE_INIT, OV562X_SENSOR_INIT, type RegisterTable } from './tables';

const sum = (t: RegisterTable) => t.reduce((acc, [reg, value]) => acc + reg + value, 0);

// Pair counts and byte sums were computed from Linux drivers/media/usb/gspca/ov534_9.c
// (ov562x_init and ov562x_init_2). They catch transcription mistakes.
describe('init tables', () => {
  it('bridge table matches the Linux driver', () => {
    expect(OV562X_BRIDGE_INIT.length).toBe(13);
    expect(sum(OV562X_BRIDGE_INIT)).toBe(1654);
    expect(OV562X_BRIDGE_INIT[0]).toEqual([0x88, 0x20]);
    expect(OV562X_BRIDGE_INIT[12]).toEqual([0x1d, 0x1e]);
  });

  it('sensor table matches the Linux driver', () => {
    expect(OV562X_SENSOR_INIT.length).toBe(99);
    expect(sum(OV562X_SENSOR_INIT)).toBe(14313);
    expect(OV562X_SENSOR_INIT[0]).toEqual([0x12, 0x80]);
    expect(OV562X_SENSOR_INIT[98]).toEqual([0x85, 0xc0]);
  });
});
