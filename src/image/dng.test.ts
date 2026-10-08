import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeDng } from './dng';

interface Tag {
  type: number;
  count: number;
  /** Offset of the 4-byte value field inside the file. */
  at: number;
}

function parse(dng: Uint8Array) {
  const dv = new DataView(dng.buffer, dng.byteOffset, dng.byteLength);
  const ifd = dv.getUint32(4, true);
  const n = dv.getUint16(ifd, true);
  const tags = new Map<number, Tag>();
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12;
    const tag = dv.getUint16(o, true);
    order.push(tag);
    tags.set(tag, { type: dv.getUint16(o + 2, true), count: dv.getUint32(o + 4, true), at: o + 8 });
  }
  const short = (tag: number) => dv.getUint16(tags.get(tag)!.at, true);
  const long = (tag: number) => dv.getUint32(tags.get(tag)!.at, true);
  const text = (tag: number) => {
    const t = tags.get(tag)!;
    const start = t.count <= 4 ? t.at : dv.getUint32(t.at, true);
    return String.fromCharCode(...dng.subarray(start, start + t.count));
  };
  return { dv, tags, order, short, long, text, ifd };
}

const raw = Uint8Array.from({ length: 8 * 4 }, (_, i) => i * 3);

describe('encodeDng', () => {
  it('starts with a little-endian TIFF header and one IFD at offset 8', () => {
    const dng = encodeDng(raw, 8, 4, 1);
    expect([...dng.subarray(0, 4)]).toEqual([0x49, 0x49, 42, 0]);
    expect(parse(dng).ifd).toBe(8);
  });

  it('writes tags in ascending order', () => {
    const { order } = parse(encodeDng(raw, 8, 4, 1));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.length).toBe(25);
  });

  it('describes an uncompressed 8-bit BGGR mosaic', () => {
    const { short, long, tags, dv } = parse(encodeDng(raw, 8, 4, 1));
    expect(long(256)).toBe(8); // ImageWidth
    expect(long(257)).toBe(4); // ImageLength
    expect(short(258)).toBe(8); // BitsPerSample
    expect(short(259)).toBe(1); // Compression: none
    expect(short(262)).toBe(32803); // PhotometricInterpretation: CFA
    expect(short(277)).toBe(1); // SamplesPerPixel
    const cfa = tags.get(33422)!;
    expect([dv.getUint8(cfa.at), dv.getUint8(cfa.at + 1), dv.getUint8(cfa.at + 2), dv.getUint8(cfa.at + 3)]).toEqual([2, 1, 1, 0]);
    expect(short(50717)).toBe(255); // WhiteLevel
  });

  it('stores the sensor data in one strip at the end of the file', () => {
    const dng = encodeDng(raw, 8, 4, 1);
    const { long } = parse(dng);
    expect(long(279)).toBe(raw.length); // StripByteCounts
    expect(long(273) + long(279)).toBe(dng.length); // StripOffsets
    expect([...dng.subarray(long(273))]).toEqual([...raw]);
  });

  it('records the orientation it is given', () => {
    expect(parse(encodeDng(raw, 8, 4, 3)).short(274)).toBe(3);
  });

  it('names the camera', () => {
    const { text } = parse(encodeDng(raw, 8, 4, 1));
    expect(text(271)).toBe('Pacific Image\0');
    expect(text(272)).toBe('Memor-ease CS500\0');
    expect(text(50708)).toBe('Pacific Image Memor-ease CS500\0');
  });

  it('carries a 3x3 signed-rational colour matrix', () => {
    const { tags, dv } = parse(encodeDng(raw, 8, 4, 1));
    const m = tags.get(50721)!;
    expect(m.type).toBe(10);
    expect(m.count).toBe(9);
    const at = dv.getUint32(m.at, true);
    expect(dv.getInt32(at, true)).toBe(32405);
    expect(dv.getInt32(at + 4, true)).toBe(10000);
    expect(dv.getInt32(at + 8, true)).toBe(-15371);
  });

  it.runIf(process.platform === 'darwin')('produces a file macOS reads as a 2592x1680 DNG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memorease-dng-'));
    try {
      const file = join(dir, 'frame.dng');
      writeFileSync(file, encodeDng(new Uint8Array(2592 * 1680).fill(128), 2592, 1680, 1));
      const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', file], { encoding: 'utf8' });
      expect(info).toContain('pixelWidth: 2592');
      expect(info).toContain('pixelHeight: 1680');
      expect(info).toContain('format: dng');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
