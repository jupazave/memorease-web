import { describe, expect, it } from 'vitest';
import { ButtonDecoder } from './button';

const report = (first: number) => Uint8Array.of(first, 0x22, 0x05, 0x44);

describe('ButtonDecoder', () => {
  it('ignores the report the scanner sends at start-up', () => {
    expect(new ButtonDecoder().feed(Uint8Array.of(0x02, 0x01, 0x00, 0x00), 0)).toBe(false);
  });

  it('fires once per press: on 0x82, not on the 0x8a that follows', () => {
    const d = new ButtonDecoder();
    expect(d.feed(report(0x82), 1000)).toBe(true);
    expect(d.feed(report(0x8a), 1065)).toBe(false);
  });

  it('ignores a second trigger within 300 ms', () => {
    const d = new ButtonDecoder();
    expect(d.feed(report(0x82), 1000)).toBe(true);
    expect(d.feed(report(0x82), 1299)).toBe(false);
    expect(d.feed(report(0x82), 1300)).toBe(true);
  });

  it('ignores an empty report', () => {
    expect(new ButtonDecoder().feed(new Uint8Array(0), 0)).toBe(false);
  });
});
