// Scanner session over WebUSB: open, initialise, stream frames, report the button. Protocol and
// init sequence ported from Linux drivers/media/usb/gspca/ov534_9.c (GPL-2.0-or-later;
// Jean-Francois Moine, Antonio Ospite, Jim Paris).
import { ButtonDecoder } from './button';
import { isoBytesPerMicroframe } from './descriptor';
import { FrameAssembler, splitPayloads, type Frame } from './frames';
import { REG_SENSOR_ADDRESS, Registers, sleep } from './registers';
import { OV562X_BRIDGE_INIT, OV562X_SENSOR_INIT } from './tables';

export const VENDOR_ID = 0x05a9;
export const PRODUCT_ID = 0x1550;

const INTERFACE = 0;
const ALT_IDLE = 0;
const ALT_STREAM = 1;
const EP_ISO = 1;
const EP_BUTTON = 3;
const TRANSFERS_IN_FLIGHT = 6;
const PACKETS_PER_TRANSFER = 32;
const STALL_MS = 3000;
const BUTTON_RETRY_MS = 200;

export interface ScannerEvents {
  onFrame(frame: Frame): void;
  onButton(): void;
  /** The stream stopped and will not recover on its own. */
  onError(error: Error): void;
}

export class Scanner {
  private readonly regs: Registers;
  private packetBytes = 0;
  private opened = false;
  /** Identity of the running stream; replaced on every start, cleared on stop. */
  private session: object | null = null;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly dev: USBDevice,
    private readonly events: ScannerEvents,
  ) {
    this.regs = new Registers(dev);
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  static matches(dev: USBDevice): boolean {
    return dev.vendorId === VENDOR_ID && dev.productId === PRODUCT_ID;
  }

  /** Opens the browser's device chooser. Must be called from a user gesture. */
  static request(): Promise<USBDevice> {
    return navigator.usb.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] });
  }

  /** A scanner this origin already has permission for, without showing the chooser. */
  static async findGranted(): Promise<USBDevice | null> {
    return (await navigator.usb.getDevices()).find(Scanner.matches) ?? null;
  }

  get device(): USBDevice {
    return this.dev;
  }

  async open(): Promise<void> {
    await this.dev.open();
    if (!this.dev.configuration) await this.dev.selectConfiguration(1);
    await this.dev.claimInterface(INTERFACE);
    this.packetBytes = isoBytesPerMicroframe(await this.configDescriptor(), ALT_STREAM, 0x80 | EP_ISO);
    await this.initSensor();
    this.opened = true;
    void this.buttonLoop();
  }

  async start(): Promise<void> {
    if (this.session) return;
    await this.dev.selectAlternateInterface(INTERFACE, ALT_STREAM);
    const session = {};
    this.session = session;
    this.loop = this.run(session);
  }

  /** Stops submitting transfers, waits for the ones in flight, then idles the interface. */
  async stop(): Promise<void> {
    if (!this.session) return;
    this.session = null;
    await this.loop;
    await this.dev.selectAlternateInterface(INTERFACE, ALT_IDLE);
  }

  async close(): Promise<void> {
    this.opened = false;
    try {
      await this.stop();
    } finally {
      await this.dev.close().catch(() => {});
    }
  }

  private async configDescriptor(): Promise<Uint8Array> {
    const result = await this.dev.controlTransferIn(
      { requestType: 'standard', recipient: 'device', request: 0x06, value: 0x0200, index: 0 },
      255,
    );
    if (result.status !== 'ok' || !result.data) throw new Error(`config descriptor: ${result.status}`);
    return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  }

  private async initSensor(): Promise<void> {
    const regs = this.regs;
    await regs.write(0xe7, 0x3a); // reset bridge
    await regs.write(0xe0, 0x08);
    await sleep(100);
    await regs.write(REG_SENSOR_ADDRESS, 0x60);
    await regs.sensorWrite(0x12, 0x80); // reset sensor
    await sleep(10);
    // Each id register is read twice; the first read after a reset is not reliable.
    await regs.sensorRead(0x0a);
    const high = await regs.sensorRead(0x0a);
    await regs.sensorRead(0x0b);
    const low = await regs.sensorRead(0x0b);
    const id = (high << 8) | low;
    if ((id & 0xfff0) !== 0x5620) throw new Error(`Sensor no soportado: 0x${id.toString(16)}`);
    await regs.writeAll(OV562X_BRIDGE_INIT);
    await regs.sensorWriteAll(OV562X_SENSOR_INIT);
    await regs.write(0xe0, 0x00);
  }

  /** Runs the stream until stop(). A stall gets one restart; a restart that yields no frame is fatal. */
  private async run(session: object): Promise<void> {
    try {
      let afterRestart = false;
      for (;;) {
        const { reason, frames } = await this.streamUntilStall(session);
        if (reason === 'stopped') return;
        if (afterRestart && frames === 0) throw new Error('El escáner dejó de enviar cuadros');
        afterRestart = true;
        await this.dev.selectAlternateInterface(INTERFACE, ALT_IDLE);
        await this.dev.selectAlternateInterface(INTERFACE, ALT_STREAM);
      }
    } catch (error) {
      if (this.session === session) {
        this.session = null;
        this.events.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async streamUntilStall(session: object): Promise<{ reason: 'stopped' | 'stalled'; frames: number }> {
    const lengths = new Array<number>(PACKETS_PER_TRANSFER).fill(this.packetBytes);
    const inFlight: Promise<USBIsochronousInTransferResult>[] = [];
    const submit = () => {
      const transfer = this.dev.isochronousTransferIn(EP_ISO, lengths);
      transfer.catch(() => {}); // rejections are observed when the transfer is awaited below
      inFlight.push(transfer);
    };
    const assembler = new FrameAssembler();
    let frames = 0;
    let lastFrameAt = performance.now();
    try {
      for (let i = 0; i < TRANSFERS_IN_FLIGHT; i++) submit();
      while (this.session === session) {
        const result = await inFlight.shift()!;
        const now = performance.now();
        for (const packet of result.packets) {
          const view = packet.data;
          if (!view || view.byteLength === 0) continue;
          for (const payload of splitPayloads(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))) {
            const frame = assembler.push(payload, now);
            if (!frame) continue;
            frames++;
            lastFrameAt = now;
            if (this.session === session) this.events.onFrame(frame);
          }
        }
        if (now - lastFrameAt > STALL_MS) return { reason: 'stalled', frames };
        if (this.session === session) submit();
      }
      return { reason: 'stopped', frames };
    } finally {
      await Promise.allSettled(inFlight);
    }
  }

  /** Lives as long as the device is open. Alternate-setting changes reset the endpoint, so it re-arms. */
  private async buttonLoop(): Promise<void> {
    const decoder = new ButtonDecoder();
    while (this.opened) {
      try {
        const result = await this.dev.transferIn(EP_BUTTON, 4);
        const view = result.data;
        if (result.status !== 'ok' || !view) {
          await sleep(BUTTON_RETRY_MS);
        } else if (decoder.feed(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), performance.now())) {
          this.events.onButton();
        }
      } catch {
        if (!this.opened) return;
        await sleep(BUTTON_RETRY_MS);
      }
    }
  }
}
