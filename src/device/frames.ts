// Frame reassembly for the OV538 bridge. Payload layout from Linux
// drivers/media/usb/gspca/ov534_9.c (GPL-2.0-or-later; Jean-Francois Moine, Antonio Ospite, Jim Paris).
import { FRAME_BYTES } from '../frame';

/** The endpoint advertises 3 x 1020 bytes per microframe, but a payload never exceeds 2040. */
export const PAYLOAD_MAX = 2040;

const HEADER_LEN = 12;
const FLAG_ERR = 0x40;
const FLAG_PTS = 0x04;
const FLAG_EOF = 0x02;
const FLAG_FID = 0x01;

export interface Frame {
  data: Uint8Array<ArrayBuffer>;
  /** `now` of the frame's first payload. */
  startedAt: number;
}

export interface AssemblerStats {
  payloads: number;
  badHeader: number;
  errorFlag: number;
  noPts: number;
  incomplete: number;
  frames: number;
}

/** Splits one isochronous packet into payloads of at most `max` bytes. */
export function* splitPayloads(packet: Uint8Array, max = PAYLOAD_MAX): Generator<Uint8Array> {
  for (let o = 0; o < packet.length; o += max) yield packet.subarray(o, Math.min(packet.length, o + max));
}

/**
 * A frame starts when PTS or FID changes and ends on EOF. Only frames that end with EOF and
 * hold exactly `size` bytes are delivered.
 */
export class FrameAssembler {
  readonly stats: AssemblerStats = { payloads: 0, badHeader: 0, errorFlag: 0, noPts: 0, incomplete: 0, frames: 0 };
  private buf: Uint8Array<ArrayBuffer> | null = null;
  private len = 0;
  private overflow = false;
  private pts = -1;
  private fid = -1;
  private startedAt = 0;

  constructor(private readonly size = FRAME_BYTES) {}

  push(payload: Uint8Array, now: number): Frame | null {
    this.stats.payloads++;
    if (payload.length < HEADER_LEN || payload[0] !== HEADER_LEN) {
      this.stats.badHeader++;
      this.buf = null;
      return null;
    }
    const flags = payload[1];
    if (flags & FLAG_ERR) {
      this.stats.errorFlag++;
      this.buf = null;
      return null;
    }
    if (!(flags & FLAG_PTS)) {
      this.stats.noPts++;
      this.buf = null;
      return null;
    }
    const pts = (payload[2] | (payload[3] << 8) | (payload[4] << 16) | (payload[5] << 24)) >>> 0;
    const fid = flags & FLAG_FID;

    if (pts !== this.pts || fid !== this.fid) {
      if (this.buf) this.stats.incomplete++;
      this.pts = pts;
      this.fid = fid;
      this.buf = new Uint8Array(this.size);
      this.len = 0;
      this.overflow = false;
      this.startedAt = now;
    } else if (!this.buf) {
      return null; // remainder of a discarded frame
    }

    const body = payload.subarray(HEADER_LEN);
    if (this.len + body.length > this.size) {
      this.overflow = true;
    } else {
      this.buf.set(body, this.len);
      this.len += body.length;
    }
    if (!(flags & FLAG_EOF)) return null;

    const data = this.buf;
    const complete = !this.overflow && this.len === this.size;
    this.buf = null;
    this.pts = -1;
    if (!complete) {
      this.stats.incomplete++;
      return null;
    }
    this.stats.frames++;
    return { data, startedAt: this.startedAt };
  }
}
