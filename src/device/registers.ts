// Register access for the OV538 bridge and, through its SCCB master, the sensor. Protocol from
// Linux drivers/media/usb/gspca/ov534_9.c (GPL-2.0-or-later; Jean-Francois Moine, Antonio Ospite,
// Jim Paris).
import type { RegisterTable } from './tables';

export const REG_SENSOR_ADDRESS = 0xf1;
const REG_SUBADDR = 0xf2;
const REG_WRITE = 0xf3;
const REG_READ = 0xf4;
const REG_OPERATION = 0xf5;
const REG_STATUS = 0xf6;
const OP_WRITE_3 = 0x37;
const OP_WRITE_2 = 0x33;
const OP_READ_2 = 0xf9;
const STATUS_DONE = 0x00;
const STATUS_FAILED = 0x04;
const STATUS_POLLS = 5;
const STATUS_POLL_MS = 20;

export type Sleep = (ms: number) => Promise<void>;
export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The part of USBDevice this layer uses, so tests can pass a fake. */
export type ControlDevice = Pick<USBDevice, 'controlTransferIn' | 'controlTransferOut'>;

const hex = (n: number) => n.toString(16).padStart(2, '0');
const request = (reg: number): USBControlTransferParameters => ({
  requestType: 'vendor',
  recipient: 'device',
  request: 0x01,
  value: 0,
  index: reg,
});

export class Registers {
  constructor(
    private readonly dev: ControlDevice,
    private readonly wait: Sleep = sleep,
  ) {}

  async write(reg: number, value: number): Promise<void> {
    const result = await this.dev.controlTransferOut(request(reg), Uint8Array.of(value));
    if (result.status !== 'ok') throw new Error(`bridge write 0x${hex(reg)}: ${result.status}`);
  }

  async read(reg: number): Promise<number> {
    const result = await this.dev.controlTransferIn(request(reg), 1);
    if (result.status !== 'ok' || !result.data || result.data.byteLength < 1) {
      throw new Error(`bridge read 0x${hex(reg)}: ${result.status}`);
    }
    return result.data.getUint8(0);
  }

  async writeAll(table: RegisterTable): Promise<void> {
    for (const [reg, value] of table) await this.write(reg, value);
  }

  async sensorWrite(reg: number, value: number): Promise<void> {
    await this.write(REG_SUBADDR, reg);
    await this.write(REG_WRITE, value);
    await this.write(REG_OPERATION, OP_WRITE_3);
    if (!(await this.sccbDone())) throw new Error(`SCCB write 0x${hex(reg)} failed`);
  }

  async sensorRead(reg: number): Promise<number> {
    await this.write(REG_SUBADDR, reg);
    await this.write(REG_OPERATION, OP_WRITE_2);
    if (!(await this.sccbDone())) throw new Error(`SCCB read 0x${hex(reg)} failed (address phase)`);
    await this.write(REG_OPERATION, OP_READ_2);
    if (!(await this.sccbDone())) throw new Error(`SCCB read 0x${hex(reg)} failed (data phase)`);
    return this.read(REG_READ);
  }

  async sensorWriteAll(table: RegisterTable): Promise<void> {
    for (const [reg, value] of table) await this.sensorWrite(reg, value);
  }

  private async sccbDone(): Promise<boolean> {
    for (let i = 0; i < STATUS_POLLS; i++) {
      await this.wait(STATUS_POLL_MS);
      const status = await this.read(REG_STATUS);
      if (status === STATUS_DONE) return true;
      if (status === STATUS_FAILED) return false;
    }
    return false;
  }
}
