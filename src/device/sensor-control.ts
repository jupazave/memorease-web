// Sensor control values for the OV5621. The exposure-target formula is the brightness control of
// Linux drivers/media/usb/gspca/ov534_9.c (GPL-2.0-or-later; Jean-Francois Moine, Antonio Ospite,
// Jim Paris).
import type { RegisterTable } from './tables';

/** COM8: bit 0 auto exposure, bit 1 auto white balance, bit 2 auto gain. */
export const COM8 = 0x13;
export const COM8_AUTO = 0xc7;
export const COM8_FROZEN = 0xc0;

/** Sensor writes that move the auto-exposure target. `n` runs from -90 to 90; 0 is the default. */
export function exposureTargetRegisters(n: number): RegisterTable {
  const v = Math.max(-90, Math.min(90, Math.round(n)));
  return [
    [0x24, (0x76 + v) & 0xff],
    [0x25, (0x6a + v) & 0xff],
    [0x26, v < -40 ? 0x71 : v < 20 ? 0x94 : 0xe6],
  ];
}
