// Minimal DNG writer: one IFD holding the unprocessed BGGR mosaic as a single uncompressed strip.
// Multi-byte values are written through typed-array buffers, which are little-endian on every
// platform this runs on (the file header declares little-endian).

const BYTE = 1;
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const SRATIONAL = 10;

const STRIP_OFFSETS = 273;

const u8 = (...v: number[]) => Uint8Array.from(v);
const u16 = (...v: number[]) => new Uint8Array(Uint16Array.from(v).buffer);
const u32 = (...v: number[]) => new Uint8Array(Uint32Array.from(v).buffer);
const i32 = (...v: number[]) => new Uint8Array(Int32Array.from(v).buffer);
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(0));

// XYZ (D65) to linear sRGB, as numerator/10000 pairs. The sensor is not characterised, so its
// channels are treated as sRGB primaries.
const COLOR_MATRIX = i32(
  32405, 10000, -15371, 10000, -4985, 10000,
  -9693, 10000, 18760, 10000, 416, 10000,
  556, 10000, -2040, 10000, 10572, 10000,
);

type Entry = readonly [tag: number, type: number, count: number, data: Uint8Array];

export function encodeDng(raw: Uint8Array, width: number, height: number, orientation: number): Uint8Array<ArrayBuffer> {
  // Entries must stay sorted by tag number.
  const entries: Entry[] = [
    [254, LONG, 1, u32(0)], // NewSubFileType: full-resolution image
    [256, LONG, 1, u32(width)],
    [257, LONG, 1, u32(height)],
    [258, SHORT, 1, u16(8)],
    [259, SHORT, 1, u16(1)],
    [262, SHORT, 1, u16(32803)],
    [271, ASCII, 0, ascii('Pacific Image')],
    [272, ASCII, 0, ascii('Memor-ease CS500')],
    [STRIP_OFFSETS, LONG, 1, u32(0)], // patched below
    [274, SHORT, 1, u16(orientation)],
    [277, SHORT, 1, u16(1)],
    [278, LONG, 1, u32(height)],
    [279, LONG, 1, u32(width * height)],
    [284, SHORT, 1, u16(1)],
    [305, ASCII, 0, ascii('memorease')],
    [33421, SHORT, 2, u16(2, 2)], // CFARepeatPatternDim
    [33422, BYTE, 4, u8(2, 1, 1, 0)], // CFAPattern: B G / G R
    [50706, BYTE, 4, u8(1, 4, 0, 0)], // DNGVersion
    [50707, BYTE, 4, u8(1, 1, 0, 0)], // DNGBackwardVersion
    [50708, ASCII, 0, ascii('Pacific Image Memor-ease CS500')],
    [50714, SHORT, 1, u16(0)], // BlackLevel
    [50717, SHORT, 1, u16(255)], // WhiteLevel
    [50721, SRATIONAL, 9, COLOR_MATRIX], // ColorMatrix1
    [50728, RATIONAL, 3, u32(1, 1, 1, 1, 1, 1)], // AsShotNeutral
    [50778, SHORT, 1, u16(21)], // CalibrationIlluminant1: D65
  ];

  const ifdOffset = 8;
  let extra = ifdOffset + 2 + entries.length * 12 + 4;
  const placed = entries.map(([tag, type, count, data]) => {
    const n = type === ASCII ? data.length : count;
    if (data.length <= 4) return { tag, type, n, data, at: -1 };
    const at = extra;
    extra += data.length + (data.length & 1);
    return { tag, type, n, data, at };
  });
  const stripOffset = extra;

  const out = new Uint8Array(stripOffset + raw.length);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0], 0);
  dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, placed.length, true);
  placed.forEach((entry, i) => {
    const o = ifdOffset + 2 + i * 12;
    dv.setUint16(o, entry.tag, true);
    dv.setUint16(o + 2, entry.type, true);
    dv.setUint32(o + 4, entry.n, true);
    if (entry.tag === STRIP_OFFSETS) {
      dv.setUint32(o + 8, stripOffset, true);
    } else if (entry.at < 0) {
      out.set(entry.data, o + 8);
    } else {
      dv.setUint32(o + 8, entry.at, true);
      out.set(entry.data, entry.at);
    }
  });
  out.set(raw, stripOffset);
  return out;
}
