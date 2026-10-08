const DEBOUNCE_MS = 300;

/**
 * Each press of the scanner button produces two 4-byte reports on the interrupt endpoint:
 * 0x82 .. and, about 65 ms later, 0x8a .. . The first one is the trigger.
 */
export class ButtonDecoder {
  private last = -Infinity;

  feed(report: Uint8Array, now: number): boolean {
    if (report.length === 0 || (report[0] & 0x88) !== 0x80) return false;
    if (now - this.last < DEBOUNCE_MS) return false;
    this.last = now;
    return true;
  }
}
