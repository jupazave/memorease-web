import { describe, expect, it } from 'vitest';
import { FrameAssembler, splitPayloads } from './frames';

const PTS = 0x04;
const EOF = 0x02;
const ERR = 0x40;

function payload(pts: number, flags: number, body: number[]): Uint8Array {
  const p = new Uint8Array(12 + body.length);
  p[0] = 12;
  p[1] = 0x80 | flags;
  new DataView(p.buffer).setUint32(2, pts, true);
  p.set(body, 12);
  return p;
}

describe('FrameAssembler', () => {
  it('joins payloads with the same PTS and delivers on EOF', () => {
    const a = new FrameAssembler(10);
    expect(a.push(payload(100, PTS, [1, 2, 3, 4, 5, 6]), 5)).toBeNull();
    const frame = a.push(payload(100, PTS | EOF, [7, 8, 9, 10]), 9);
    expect([...frame!.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(frame!.startedAt).toBe(5);
    expect(a.stats.frames).toBe(1);
  });

  it('accepts a header-only EOF payload', () => {
    const a = new FrameAssembler(2);
    a.push(payload(7, PTS, [1, 2]), 0);
    expect([...a.push(payload(7, PTS | EOF, []), 1)!.data]).toEqual([1, 2]);
  });

  it('drops a frame whose PTS changes before EOF', () => {
    const a = new FrameAssembler(4);
    a.push(payload(1, PTS, [1, 2]), 0);
    expect(a.push(payload(2, PTS, [5, 6]), 1)).toBeNull();
    const frame = a.push(payload(2, PTS | EOF, [7, 8]), 2);
    expect([...frame!.data]).toEqual([5, 6, 7, 8]);
    expect(frame!.startedAt).toBe(1);
    expect(a.stats.incomplete).toBe(1);
  });

  it('starts a new frame when FID toggles with the same PTS', () => {
    const a = new FrameAssembler(2);
    a.push(payload(1, PTS, [1]), 0);
    a.push(payload(1, PTS | 0x01, [8]), 1);
    expect([...a.push(payload(1, PTS | 0x01 | EOF, [9]), 2)!.data]).toEqual([8, 9]);
  });

  it('discards the frame in progress on an invalid header', () => {
    const a = new FrameAssembler(4);
    a.push(payload(1, PTS, [1, 2]), 0);
    const bad = payload(1, PTS, [3, 4]);
    bad[0] = 11;
    expect(a.push(bad, 1)).toBeNull();
    expect(a.push(payload(1, PTS | EOF, [3, 4]), 2)).toBeNull();
    expect(a.stats.badHeader).toBe(1);

    a.push(payload(2, PTS, [1, 2]), 3);
    expect(a.push(payload(2, PTS | EOF, [3, 4]), 4)).not.toBeNull();
  });

  it('treats a payload shorter than the header as invalid', () => {
    const a = new FrameAssembler(4);
    expect(a.push(new Uint8Array(5), 0)).toBeNull();
    expect(a.stats.badHeader).toBe(1);
  });

  it('discards the frame in progress on the error flag', () => {
    const a = new FrameAssembler(4);
    a.push(payload(1, PTS, [1, 2]), 0);
    a.push(payload(1, PTS | ERR, [3, 4]), 1);
    expect(a.push(payload(1, PTS | EOF, []), 2)).toBeNull();
    expect(a.stats.errorFlag).toBe(1);
  });

  it('discards the frame in progress when PTS is missing', () => {
    const a = new FrameAssembler(4);
    a.push(payload(1, PTS, [1, 2]), 0);
    a.push(payload(1, 0, [3, 4]), 1);
    expect(a.push(payload(1, PTS | EOF, []), 2)).toBeNull();
    expect(a.stats.noPts).toBe(1);
  });

  it('rejects a frame with too many bytes', () => {
    const a = new FrameAssembler(4);
    a.push(payload(1, PTS, [1, 2, 3]), 0);
    expect(a.push(payload(1, PTS | EOF, [4, 5]), 1)).toBeNull();
    expect(a.stats.incomplete).toBe(1);
  });

  it('rejects a frame with too few bytes', () => {
    const a = new FrameAssembler(4);
    expect(a.push(payload(1, PTS | EOF, [1, 2]), 0)).toBeNull();
    expect(a.stats.incomplete).toBe(1);
  });
});

describe('splitPayloads', () => {
  it('splits a 3060-byte packet into 2040 + 1020', () => {
    expect([...splitPayloads(new Uint8Array(3060))].map((p) => p.length)).toEqual([2040, 1020]);
  });

  it('yields nothing for an empty packet', () => {
    expect([...splitPayloads(new Uint8Array(0))]).toEqual([]);
  });

  it('feeds an assembler with a packet that carries two payloads', () => {
    const first = payload(9, PTS, new Array(2028).fill(1));
    const second = payload(9, PTS | EOF, new Array(1008).fill(2));
    const packet = new Uint8Array(first.length + second.length);
    packet.set(first, 0);
    packet.set(second, first.length);

    const a = new FrameAssembler(2028 + 1008);
    let frame = null;
    for (const p of splitPayloads(packet)) frame = a.push(p, 0) ?? frame;
    expect(frame!.data.length).toBe(3036);
    expect(frame!.data[0]).toBe(1);
    expect(frame!.data[3035]).toBe(2);
  });
});
