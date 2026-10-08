import { describe, expect, it } from 'vitest';
import { Registers } from './registers';

/** Emulates the bridge: plain registers plus the SCCB sub-protocol on 0xf2..0xf6. */
class FakeBridge {
  bridge = new Map<number, number>();
  sensor = new Map<number, number>();
  statusScript: number[] = [];
  outs: Array<{ setup: USBControlTransferParameters; value: number }> = [];

  controlTransferOut = async (setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult> => {
    const value = (data as Uint8Array)[0];
    this.outs.push({ setup, value });
    this.bridge.set(setup.index, value);
    if (setup.index === 0xf5) {
      const sub = this.bridge.get(0xf2) ?? 0;
      if (value === 0x37) this.sensor.set(sub, this.bridge.get(0xf3) ?? 0);
      if (value === 0xf9) this.bridge.set(0xf4, this.sensor.get(sub) ?? 0);
    }
    return { status: 'ok', bytesWritten: 1 } as USBOutTransferResult;
  };

  controlTransferIn = async (setup: USBControlTransferParameters, _length: number): Promise<USBInTransferResult> => {
    const value = setup.index === 0xf6 ? (this.statusScript.shift() ?? 0x00) : (this.bridge.get(setup.index) ?? 0);
    return { status: 'ok', data: new DataView(Uint8Array.of(value).buffer) } as USBInTransferResult;
  };
}

function setup() {
  const fake = new FakeBridge();
  const waits: number[] = [];
  const regs = new Registers(fake, async (ms) => {
    waits.push(ms);
  });
  return { fake, waits, regs };
}

describe('Registers', () => {
  it('writes a bridge register with vendor request 0x01', async () => {
    const { fake, regs } = setup();
    await regs.write(0xe7, 0x3a);
    expect(fake.outs).toEqual([
      { setup: { requestType: 'vendor', recipient: 'device', request: 0x01, value: 0, index: 0xe7 }, value: 0x3a },
    ]);
  });

  it('reads a bridge register', async () => {
    const { fake, regs } = setup();
    fake.bridge.set(0x21, 0x5a);
    expect(await regs.read(0x21)).toBe(0x5a);
  });

  it('writes a sensor register through SCCB', async () => {
    const { fake, regs } = setup();
    await regs.sensorWrite(0x12, 0x80);
    expect(fake.outs.map((o) => [o.setup.index, o.value])).toEqual([
      [0xf2, 0x12],
      [0xf3, 0x80],
      [0xf5, 0x37],
    ]);
    expect(fake.sensor.get(0x12)).toBe(0x80);
  });

  it('reads a sensor register through SCCB', async () => {
    const { fake, regs } = setup();
    fake.sensor.set(0x0a, 0x56);
    expect(await regs.sensorRead(0x0a)).toBe(0x56);
    expect(fake.outs.map((o) => [o.setup.index, o.value])).toEqual([
      [0xf2, 0x0a],
      [0xf5, 0x33],
      [0xf5, 0xf9],
    ]);
  });

  it('waits 20 ms per poll and retries while the bridge reports busy', async () => {
    const { fake, waits, regs } = setup();
    fake.statusScript = [0x03, 0x03, 0x00];
    await regs.sensorWrite(0x11, 0x41);
    expect(waits).toEqual([20, 20, 20]);
  });

  it('throws when the bridge reports an SCCB failure', async () => {
    const { fake, regs } = setup();
    fake.statusScript = [0x04];
    await expect(regs.sensorWrite(0x11, 0x41)).rejects.toThrow(/SCCB write 0x11/);
  });

  it('throws after five busy polls', async () => {
    const { fake, waits, regs } = setup();
    fake.statusScript = [0x03, 0x03, 0x03, 0x03, 0x03];
    await expect(regs.sensorRead(0x0a)).rejects.toThrow(/SCCB read 0x0a/);
    expect(waits.length).toBe(5);
  });

  it('applies tables in order', async () => {
    const { fake, regs } = setup();
    await regs.writeAll([
      [0x88, 0x20],
      [0x89, 0x0a],
    ]);
    await regs.sensorWriteAll([
      [0x11, 0x41],
      [0x13, 0x00],
    ]);
    expect(fake.bridge.get(0x88)).toBe(0x20);
    expect(fake.bridge.get(0x89)).toBe(0x0a);
    expect(fake.sensor.get(0x11)).toBe(0x41);
    expect(fake.sensor.get(0x13)).toBe(0x00);
  });
});
