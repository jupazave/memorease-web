# Memor-ease WebUSB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una página web que maneja el escáner de película Memor-ease CS500 por WebUSB: vista previa en vivo revelada y captura de rollos completos a una carpeta, en JPEG más DNG.

**Architecture:** Página estática sin backend. `device/` habla el protocolo USB y entrega cuadros Bayer crudos; `image/` los revela en un Web Worker con funciones puras; `storage/` escribe en una carpeta elegida con la File System Access API; `ui/` es una sola pantalla que conecta las tres partes.

**Tech Stack:** TypeScript, Vite, Vitest, WebUSB, File System Access API, OffscreenCanvas. Electron solo como arnés de pruebas con el aparato.

**Spec:** `docs/superpowers/specs/2026-10-07-memorease-webusb-design.md`

## Global Constraints

- Node 24 y npm. TypeScript 5.7 o posterior (el código usa `Uint8Array<ArrayBuffer>`).
- Cero dependencias en tiempo de ejecución: todo lo que se instala va en `devDependencies`.
- Servidor de desarrollo en `http://localhost:5173` con `strictPort`. El arnés de hardware usa el 5174.
- Geometría del cuadro: 2592×1680, Bayer BGGR de 8 bits, 4 354 560 bytes. Azul en fila par y columna par; rojo en fila impar y columna impar.
- Textos de interfaz en español. Identificadores y comentarios de código en inglés.
- Cada archivo de `src/device/` que derive del driver de Linux empieza con el comentario de atribución que se muestra en su tarea.
- Licencia del proyecto: GPL-2.0-or-later.
- Nunca se agregan a git `spike/` ni `tools/hw-harness/out/`.
- Solo un proceso puede tener abierto el escáner. Antes de cualquier tarea marcada **[hardware]**, el escáner debe estar conectado y ninguna pestaña o programa debe tenerlo abierto (en particular la pestaña `localhost:8538` de la prueba de factibilidad en Chromium).
- Cada commit termina con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html
src/
  frame.ts                    constantes de geometría
  main.ts, styles.css
  device/
    frames.ts                 armado de cuadros (puro)
    button.ts                 reportes del botón (puro)
    descriptor.ts             tamaño del paquete isócrono (puro)
    tables.ts                 tablas de inicialización
    registers.ts              registros del puente y del sensor
    sensor-control.ts         valores para exposición y congelado (puro)
    scanner.ts                sesión WebUSB completa
  image/
    demosaic.ts, develop.ts, dng.ts, pipeline.ts     (puros)
    worker.ts, client.ts
  storage/
    naming.ts                 (puro)
    folder.ts
  ui/
    settings.ts, view.ts, app.ts
tools/hw-harness/
  main.cjs, run.mjs, page.html, page.ts
  stream.ts, sensor.ts, capture.ts                   escenarios
```

Las pruebas unitarias van junto a su módulo como `*.test.ts`.

---

### Task 1: Proyecto base y armado de cuadros

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`
- Modify: `.gitignore`
- Create: `src/frame.ts`, `src/device/frames.ts`
- Test: `src/device/frames.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `src/frame.ts`: `FRAME_WIDTH = 2592`, `FRAME_HEIGHT = 1680`, `FRAME_BYTES = 4354560`.
  - `src/device/frames.ts`: `PAYLOAD_MAX = 2040`; `interface Frame { data: Uint8Array<ArrayBuffer>; startedAt: number }`; `function* splitPayloads(packet: Uint8Array, max?: number): Generator<Uint8Array>`; `class FrameAssembler { constructor(size?: number); readonly stats: AssemblerStats; push(payload: Uint8Array, now: number): Frame | null }`.

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "memorease",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-or-later",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "hw": "node tools/hw-harness/run.mjs"
  }
}
```

- [ ] **Step 2: Instalar dependencias de desarrollo**

Run: `npm install -D vite vitest typescript @types/node @types/w3c-web-usb @types/wicg-file-system-access`
Expected: termina sin errores y crea `package-lock.json`.

Run: `npx tsc --version`
Expected: `Version 5.7` o posterior. Si es anterior, detenerse y reportarlo.

- [ ] **Step 3: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
    "types": ["vite/client", "node", "w3c-web-usb", "wicg-file-system-access"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tools/hw-harness", "vite.config.ts"]
}
```

- [ ] **Step 4: Crear `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 5: Reemplazar `.gitignore`**

```
node_modules/
dist/
tools/hw-harness/out/
# prueba de factibilidad desechable; out/ contiene fotos personales
spike/
```

- [ ] **Step 6: Crear `src/frame.ts`**

```ts
export const FRAME_WIDTH = 2592;
export const FRAME_HEIGHT = 1680;
export const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT;
```

- [ ] **Step 7: Escribir la prueba que falla, `src/device/frames.test.ts`**

```ts
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
```

- [ ] **Step 8: Correr la prueba y verla fallar**

Run: `npx vitest run src/device/frames.test.ts`
Expected: FAIL, no puede resolver `./frames`.

- [ ] **Step 9: Implementar `src/device/frames.ts`**

```ts
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
```

- [ ] **Step 10: Correr la prueba y verla pasar**

Run: `npx vitest run src/device/frames.test.ts`
Expected: PASS, 13 pruebas.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts .gitignore src/frame.ts src/device/frames.ts src/device/frames.test.ts
git commit -m "feat: scaffold project and add frame assembler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Decodificadores del botón y del descriptor

**Files:**
- Create: `src/device/button.ts`, `src/device/descriptor.ts`
- Test: `src/device/button.test.ts`, `src/device/descriptor.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `class ButtonDecoder { feed(report: Uint8Array, now: number): boolean }`: `true` cuando el reporte debe disparar una captura.
  - `function isoBytesPerMicroframe(config: Uint8Array, alternate: number, endpointAddress: number): number`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`src/device/button.test.ts`:

```ts
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
```

`src/device/descriptor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isoBytesPerMicroframe } from './descriptor';

// Configuration descriptor of the Memor-ease (05a9:1550), as read from the device.
const CONFIG = Uint8Array.from([
  9, 2, 55, 0, 1, 1, 0, 0x80, 250, // configuration, wTotalLength 55
  9, 4, 0, 0, 2, 0xff, 0, 0, 0, // interface 0, alternate 0
  7, 5, 0x83, 3, 4, 0, 1, // endpoint 3 IN, interrupt, 4 bytes
  7, 5, 0x81, 1, 0, 0, 1, // endpoint 1 IN, isochronous, 0 bytes
  9, 4, 0, 1, 2, 0xff, 0, 0, 0, // interface 0, alternate 1
  7, 5, 0x83, 3, 4, 0, 1,
  7, 5, 0x81, 1, 0xfc, 0x13, 1, // endpoint 1 IN, isochronous, wMaxPacketSize 0x13fc
]);

describe('isoBytesPerMicroframe', () => {
  it('decodes the high-bandwidth multiplier: 0x13fc is 3 x 1020', () => {
    expect(isoBytesPerMicroframe(CONFIG, 1, 0x81)).toBe(3060);
  });

  it('reads the idle alternate as zero', () => {
    expect(isoBytesPerMicroframe(CONFIG, 0, 0x81)).toBe(0);
  });

  it('throws when the endpoint is not in that alternate', () => {
    expect(() => isoBytesPerMicroframe(CONFIG, 1, 0x82)).toThrow(/0x82/);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/device/button.test.ts src/device/descriptor.test.ts`
Expected: FAIL, no puede resolver `./button` ni `./descriptor`.

- [ ] **Step 3: Implementar `src/device/button.ts`**

```ts
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
```

- [ ] **Step 4: Implementar `src/device/descriptor.ts`**

```ts
const DESCRIPTOR_INTERFACE = 4;
const DESCRIPTOR_ENDPOINT = 5;

/**
 * Bytes per microframe of an endpoint, from a raw configuration descriptor. Chromium reports the
 * undecoded wMaxPacketSize as `packetSize`, so the high-bandwidth multiplier must be read here.
 */
export function isoBytesPerMicroframe(config: Uint8Array, alternate: number, endpointAddress: number): number {
  let current = -1;
  for (let i = 0; i + 1 < config.length && config[i] > 0; i += config[i]) {
    const type = config[i + 1];
    if (type === DESCRIPTOR_INTERFACE) {
      current = config[i + 3];
    } else if (type === DESCRIPTOR_ENDPOINT && current === alternate && config[i + 2] === endpointAddress) {
      const w = config[i + 4] | (config[i + 5] << 8);
      return (w & 0x7ff) * (1 + ((w >> 11) & 3));
    }
  }
  throw new Error(`endpoint 0x${endpointAddress.toString(16)} not found in alternate ${alternate}`);
}
```

- [ ] **Step 5: Correr y ver pasar**

Run: `npx vitest run src/device/button.test.ts src/device/descriptor.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 6: Commit**

```bash
git add src/device/button.ts src/device/button.test.ts src/device/descriptor.ts src/device/descriptor.test.ts
git commit -m "feat: decode button reports and isochronous packet size" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tablas de inicialización y registros

**Files:**
- Create: `src/device/tables.ts`, `src/device/registers.ts`, `src/device/sensor-control.ts`
- Test: `src/device/tables.test.ts`, `src/device/registers.test.ts`, `src/device/sensor-control.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type RegisterTable = ReadonlyArray<readonly [reg: number, value: number]>`; `OV562X_BRIDGE_INIT` (13 pares); `OV562X_SENSOR_INIT` (99 pares).
  - `REG_SENSOR_ADDRESS = 0xf1`; `type Sleep = (ms: number) => Promise<void>`; `sleep: Sleep`; `type ControlDevice = Pick<USBDevice, 'controlTransferIn' | 'controlTransferOut'>`.
  - `class Registers { constructor(dev: ControlDevice, wait?: Sleep); write(reg, value): Promise<void>; read(reg): Promise<number>; writeAll(table): Promise<void>; sensorWrite(reg, value): Promise<void>; sensorRead(reg): Promise<number>; sensorWriteAll(table): Promise<void> }`. Las operaciones de sensor lanzan `Error` si el puente reporta fallo de SCCB.
  - `COM8 = 0x13`, `COM8_AUTO = 0xc7`, `COM8_FROZEN = 0xc0`; `function exposureTargetRegisters(n: number): RegisterTable`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`src/device/tables.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OV562X_BRIDGE_INIT, OV562X_SENSOR_INIT, type RegisterTable } from './tables';

const sum = (t: RegisterTable) => t.reduce((acc, [reg, value]) => acc + reg + value, 0);

// Pair counts and byte sums were computed from Linux drivers/media/usb/gspca/ov534_9.c
// (ov562x_init and ov562x_init_2). They catch transcription mistakes.
describe('init tables', () => {
  it('bridge table matches the Linux driver', () => {
    expect(OV562X_BRIDGE_INIT.length).toBe(13);
    expect(sum(OV562X_BRIDGE_INIT)).toBe(1654);
    expect(OV562X_BRIDGE_INIT[0]).toEqual([0x88, 0x20]);
    expect(OV562X_BRIDGE_INIT[12]).toEqual([0x1d, 0x1e]);
  });

  it('sensor table matches the Linux driver', () => {
    expect(OV562X_SENSOR_INIT.length).toBe(99);
    expect(sum(OV562X_SENSOR_INIT)).toBe(14313);
    expect(OV562X_SENSOR_INIT[0]).toEqual([0x12, 0x80]);
    expect(OV562X_SENSOR_INIT[98]).toEqual([0x85, 0xc0]);
  });
});
```

`src/device/registers.test.ts`:

```ts
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
```

`src/device/sensor-control.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COM8_AUTO, COM8_FROZEN, exposureTargetRegisters } from './sensor-control';

describe('exposureTargetRegisters', () => {
  it('uses the driver defaults at zero', () => {
    expect(exposureTargetRegisters(0)).toEqual([
      [0x24, 0x76],
      [0x25, 0x6a],
      [0x26, 0x94],
    ]);
  });

  it('shifts both window registers by n', () => {
    expect(exposureTargetRegisters(-60)).toEqual([
      [0x24, 0x3a],
      [0x25, 0x2e],
      [0x26, 0x71],
    ]);
    expect(exposureTargetRegisters(90)).toEqual([
      [0x24, 0xd0],
      [0x25, 0xc4],
      [0x26, 0xe6],
    ]);
  });

  it('switches the third register at -40 and 20', () => {
    expect(exposureTargetRegisters(-41)[2]).toEqual([0x26, 0x71]);
    expect(exposureTargetRegisters(-40)[2]).toEqual([0x26, 0x94]);
    expect(exposureTargetRegisters(19)[2]).toEqual([0x26, 0x94]);
    expect(exposureTargetRegisters(20)[2]).toEqual([0x26, 0xe6]);
  });

  it('clamps to -90..90 and rounds', () => {
    expect(exposureTargetRegisters(500)).toEqual(exposureTargetRegisters(90));
    expect(exposureTargetRegisters(-500)).toEqual(exposureTargetRegisters(-90));
    expect(exposureTargetRegisters(4.6)).toEqual(exposureTargetRegisters(5));
  });
});

describe('COM8 values', () => {
  it('frozen clears exactly the three auto bits', () => {
    expect(COM8_AUTO & ~COM8_FROZEN).toBe(0x07);
    expect(COM8_FROZEN & 0x07).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/device/tables.test.ts src/device/registers.test.ts src/device/sensor-control.test.ts`
Expected: FAIL, no puede resolver los tres módulos.

- [ ] **Step 3: Implementar `src/device/tables.ts`**

Copiar los valores exactamente; la prueba de sumas detecta cualquier error.

```ts
// Initialisation tables for the OV538 bridge with an OV5621 sensor. Copied from
// ov562x_init and ov562x_init_2 in Linux drivers/media/usb/gspca/ov534_9.c
// (GPL-2.0-or-later; Jean-Francois Moine, Antonio Ospite, Jim Paris).

export type RegisterTable = ReadonlyArray<readonly [reg: number, value: number]>;

// 0x88/0x89 = width 0x0a20 (2592), 0x8a/0x8b = height 0x0690 (1680).
export const OV562X_BRIDGE_INIT: RegisterTable = [
  [0x88, 0x20], [0x89, 0x0a], [0x8a, 0x90], [0x8b, 0x06], [0x8c, 0x01], [0x8d, 0x10],
  [0x1c, 0x00], [0x1d, 0x48], [0x1d, 0x00], [0x1d, 0xff], [0x1c, 0x0a], [0x1d, 0x2e], [0x1d, 0x1e],
];

export const OV562X_SENSOR_INIT: RegisterTable = [
  [0x12, 0x80], [0x11, 0x41], [0x13, 0x00], [0x10, 0x1e], [0x3b, 0x07], [0x5b, 0x40], [0x39, 0x07],
  [0x53, 0x02], [0x54, 0x60], [0x04, 0x20], [0x27, 0x04], [0x3d, 0x40], [0x36, 0x00], [0xc5, 0x04],
  [0x4e, 0x00], [0x4f, 0x93], [0x50, 0x7b], [0xca, 0x0c], [0xcb, 0x0f], [0x39, 0x07], [0x4a, 0x10],
  [0x3e, 0x0a], [0x3d, 0x00], [0x0c, 0x38], [0x38, 0x90], [0x46, 0x30], [0x4f, 0x93], [0x50, 0x7b],
  [0xab, 0x00], [0xca, 0x0c], [0xcb, 0x0f], [0x37, 0x02], [0x44, 0x48], [0x8d, 0x44], [0x2a, 0x00],
  [0x2b, 0x00], [0x32, 0x00], [0x38, 0x90], [0x53, 0x02], [0x54, 0x60], [0x12, 0x00], [0x17, 0x12],
  [0x18, 0xb4], [0x19, 0x0c], [0x1a, 0xf4], [0x03, 0x4a], [0x89, 0x20], [0x83, 0x80], [0xb7, 0x9d],
  [0xb6, 0x11], [0xb5, 0x55], [0xb4, 0x00], [0xa9, 0xf0], [0xa8, 0x0a], [0xb8, 0xf0], [0xb9, 0xf0],
  [0xba, 0xf0], [0x81, 0x07], [0x63, 0x44], [0x13, 0xc7], [0x14, 0x60], [0x33, 0x75], [0x2c, 0x00],
  [0x09, 0x00], [0x35, 0x30], [0x27, 0x04], [0x3c, 0x07], [0x3a, 0x0a], [0x3b, 0x07], [0x01, 0x40],
  [0x02, 0x40], [0x16, 0x40], [0x52, 0xb0], [0x51, 0x83], [0x21, 0xbb], [0x22, 0x10], [0x23, 0x03],
  [0x35, 0x38], [0x20, 0x90], [0x28, 0x30], [0x73, 0xe1], [0x6c, 0x00], [0x6d, 0x80], [0x6e, 0x00],
  [0x70, 0x04], [0x71, 0x00], [0x8d, 0x04], [0x64, 0x00], [0x65, 0x00], [0x66, 0x00], [0x67, 0x00],
  [0x68, 0x00], [0x69, 0x00], [0x6a, 0x00], [0x6b, 0x00], [0x71, 0x94], [0x74, 0x20], [0x80, 0x09],
  [0x85, 0xc0],
];
```

- [ ] **Step 4: Implementar `src/device/registers.ts`**

```ts
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
```

- [ ] **Step 5: Implementar `src/device/sensor-control.ts`**

```ts
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
```

- [ ] **Step 6: Correr y ver pasar**

Run: `npx vitest run src/device`
Expected: PASS en los seis archivos de prueba de `src/device`.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/device/tables.ts src/device/tables.test.ts src/device/registers.ts src/device/registers.test.ts src/device/sensor-control.ts src/device/sensor-control.test.ts
git commit -m "feat: add init tables, register access and sensor control values" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Demosaico

**Files:**
- Create: `src/image/demosaic.ts`
- Test: `src/image/demosaic.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `demosaicHalf(raw: Uint8Array, width: number, height: number): Uint8Array` devuelve RGB intercalado de `(width/2) × (height/2)`; `demosaicBilinear(raw, width, height): Uint8Array` devuelve RGB intercalado de `width × height`. Ambas asumen BGGR con `width` y `height` pares.

- [ ] **Step 1: Escribir la prueba que falla, `src/image/demosaic.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { demosaicBilinear, demosaicHalf } from './demosaic';

/** BGGR mosaic of a single flat colour. */
function flat(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw[y * width + x] = y % 2 === 0 ? (x % 2 === 0 ? b : g) : x % 2 === 0 ? g : r;
    }
  }
  return raw;
}

function pixel(rgb: Uint8Array, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 3;
  return [rgb[o], rgb[o + 1], rgb[o + 2]];
}

describe('demosaicHalf', () => {
  it('turns each 2x2 cell into one pixel', () => {
    const rgb = demosaicHalf(Uint8Array.of(10, 20, 30, 40), 2, 2);
    expect([...rgb]).toEqual([40, 25, 10]);
  });

  it('returns a quarter of the pixels', () => {
    expect(demosaicHalf(new Uint8Array(8 * 4), 8, 4).length).toBe(4 * 2 * 3);
  });

  it('reproduces a flat colour', () => {
    const rgb = demosaicHalf(flat(8, 4, [200, 100, 50]), 8, 4);
    for (let i = 0; i < rgb.length; i += 3) expect([rgb[i], rgb[i + 1], rgb[i + 2]]).toEqual([200, 100, 50]);
  });
});

describe('demosaicBilinear', () => {
  it('keeps full resolution', () => {
    expect(demosaicBilinear(new Uint8Array(6 * 4), 6, 4).length).toBe(6 * 4 * 3);
  });

  it('reproduces a flat colour everywhere, including the borders', () => {
    const rgb = demosaicBilinear(flat(6, 4, [200, 100, 50]), 6, 4);
    for (let i = 0; i < rgb.length; i += 3) expect([rgb[i], rgb[i + 1], rgb[i + 2]]).toEqual([200, 100, 50]);
  });

  it('interpolates red from a single lit red site', () => {
    const raw = new Uint8Array(4 * 4);
    raw[1 * 4 + 1] = 200; // red site at (1, 1)
    const rgb = demosaicBilinear(raw, 4, 4);
    expect(pixel(rgb, 4, 1, 1)[0]).toBe(200); // the site itself
    expect(pixel(rgb, 4, 2, 1)[0]).toBe(100); // green site on the red row: left/right average
    expect(pixel(rgb, 4, 1, 2)[0]).toBe(100); // green site on the blue row: up/down average
    expect(pixel(rgb, 4, 2, 2)[0]).toBe(50); // blue site: average of four diagonals
  });

  it('mirrors at the border so neighbours keep their Bayer colour', () => {
    const raw = new Uint8Array(4 * 4);
    raw[1 * 4 + 1] = 200;
    // Blue site (0, 0): all four mirrored diagonals land on the red site (1, 1).
    expect(pixel(demosaicBilinear(raw, 4, 4), 4, 0, 0)[0]).toBe(200);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/image/demosaic.test.ts`
Expected: FAIL, no puede resolver `./demosaic`.

- [ ] **Step 3: Implementar `src/image/demosaic.ts`**

```ts
// Demosaicing for a BGGR mosaic: blue on even rows and even columns, red on odd rows and odd columns.
// Both functions return interleaved RGB, three bytes per pixel.

/** Half resolution: every 2x2 cell becomes one pixel, with the two greens averaged. */
export function demosaicHalf(raw: Uint8Array, width: number, height: number): Uint8Array {
  const w = width >> 1;
  const h = height >> 1;
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const top = 2 * y * width;
    const bottom = top + width;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      out[o] = raw[bottom + 2 * x + 1];
      out[o + 1] = (raw[top + 2 * x + 1] + raw[bottom + 2 * x] + 1) >> 1;
      out[o + 2] = raw[top + 2 * x];
    }
  }
  return out;
}

/**
 * Full resolution, bilinear. Borders are mirrored (-1 becomes 1, width becomes width - 2) so that
 * a neighbour always has the Bayer colour it would have inside the image.
 */
export function demosaicBilinear(raw: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const north = (y === 0 ? 1 : y - 1) * width;
    const south = (y === height - 1 ? height - 2 : y + 1) * width;
    const blueRow = (y & 1) === 0;
    for (let x = 0; x < width; x++) {
      const west = x === 0 ? 1 : x - 1;
      const east = x === width - 1 ? width - 2 : x + 1;
      const here = raw[row + x];
      const horizontal = (raw[row + west] + raw[row + east] + 1) >> 1;
      const vertical = (raw[north + x] + raw[south + x] + 1) >> 1;
      const cross = (raw[north + x] + raw[south + x] + raw[row + west] + raw[row + east] + 2) >> 2;
      const diagonal = (raw[north + west] + raw[north + east] + raw[south + west] + raw[south + east] + 2) >> 2;
      const evenColumn = (x & 1) === 0;
      let r: number;
      let g: number;
      let b: number;
      if (blueRow) {
        if (evenColumn) {
          b = here;
          g = cross;
          r = diagonal;
        } else {
          g = here;
          b = horizontal;
          r = vertical;
        }
      } else if (evenColumn) {
        g = here;
        r = horizontal;
        b = vertical;
      } else {
        r = here;
        g = cross;
        b = diagonal;
      }
      const o = (row + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/image/demosaic.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/image/demosaic.ts src/image/demosaic.test.ts
git commit -m "feat: add half-resolution and bilinear demosaicing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Revelado

**Files:**
- Create: `src/image/develop.ts`
- Test: `src/image/develop.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type FilmType = 'color-negative' | 'bw-negative' | 'slide'`; `interface ChannelLevels { lo: number; hi: number }`; `type Levels = readonly [ChannelLevels, ChannelLevels, ChannelLevels]` (orden R, G, B); `interface Orientation { rotate180: boolean; mirror: boolean }`.
  - Constantes `LO_PERCENTILE = 0.005`, `HI_PERCENTILE = 0.995`, `MARGIN = 0.05`, `MIN_RANGE = 8`, `TONE = 1.0`, `SLIDE_GAMMA = 2.2`, `CLIP_WARN_FRACTION = 0.01`.
  - `computeLevels(rgb: Uint8Array, width: number, height: number, film: FilmType): Levels`.
  - `clippedFraction(rgb: Uint8Array): number`: la mayor fracción de píxeles en 255 entre los tres canales.
  - `buildLut(levels: ChannelLevels, film: FilmType): Uint8Array` de 256 entradas.
  - `develop(rgb: Uint8Array, width: number, height: number, film: FilmType, levels: Levels, orientation: Orientation): Uint8ClampedArray<ArrayBuffer>` devuelve RGBA.
  - `tiffOrientation(o: Orientation): number`: 1 normal, 2 espejo, 3 rotado 180°, 4 ambos.

- [ ] **Step 1: Escribir la prueba que falla, `src/image/develop.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildLut,
  clippedFraction,
  computeLevels,
  develop,
  MIN_RANGE,
  tiffOrientation,
  type Levels,
  type Orientation,
} from './develop';

const NONE: Orientation = { rotate180: false, mirror: false };
const FULL: Levels = [
  { lo: 1, hi: 255 },
  { lo: 1, hi: 255 },
  { lo: 1, hi: 255 },
];

/** width x height image whose left half is `left` and right half is `right`. */
function halves(width: number, height: number, left: number[], right: number[]): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgb.set(x < width / 2 ? left : right, (y * width + x) * 3);
  }
  return rgb;
}

describe('computeLevels', () => {
  it('takes the 0.5 and 99.5 percentiles of each channel', () => {
    const rgb = halves(100, 100, [60, 70, 80], [180, 190, 200]);
    expect(computeLevels(rgb, 100, 100, 'color-negative')).toEqual([
      { lo: 60, hi: 180 },
      { lo: 70, hi: 190 },
      { lo: 80, hi: 200 },
    ]);
  });

  it('ignores a 5% margin on every side', () => {
    const rgb = halves(100, 100, [60, 70, 80], [180, 190, 200]);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        if (x < 5 || y < 5) rgb.set([0, 0, 0], (y * 100 + x) * 3);
        else if (x >= 95 || y >= 95) rgb.set([255, 255, 255], (y * 100 + x) * 3);
      }
    }
    expect(computeLevels(rgb, 100, 100, 'slide')).toEqual([
      { lo: 60, hi: 180 },
      { lo: 70, hi: 190 },
      { lo: 80, hi: 200 },
    ]);
  });

  it('keeps a minimum range on a flat image', () => {
    const levels = computeLevels(halves(20, 20, [100, 100, 100], [100, 100, 100]), 20, 20, 'slide');
    for (const { lo, hi } of levels) expect(hi - lo).toBe(MIN_RANGE);
    const top = computeLevels(halves(20, 20, [255, 255, 255], [255, 255, 255]), 20, 20, 'slide');
    expect(top[0]).toEqual({ lo: 255 - MIN_RANGE, hi: 255 });
  });

  it('uses a single luminance level set for black and white', () => {
    // luminance = (R + 2G + B) >> 2: 80 on the left, 140 on the right
    const levels = computeLevels(halves(100, 100, [40, 80, 120], [100, 140, 180]), 100, 100, 'bw-negative');
    expect(levels).toEqual([
      { lo: 80, hi: 140 },
      { lo: 80, hi: 140 },
      { lo: 80, hi: 140 },
    ]);
  });
});

describe('buildLut', () => {
  it('maps the film base to black and the densest area to white for negatives', () => {
    const lut = buildLut({ lo: 50, hi: 200 }, 'color-negative');
    expect(lut[200]).toBe(0);
    expect(lut[255]).toBe(0);
    expect(lut[50]).toBe(255);
    expect(lut[10]).toBe(255);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeLessThanOrEqual(lut[v - 1]);
  });

  it('keeps slides the right way round', () => {
    const lut = buildLut({ lo: 50, hi: 200 }, 'slide');
    expect(lut[50]).toBe(0);
    expect(lut[200]).toBe(255);
    for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
  });

  it('survives a zero low level', () => {
    const lut = buildLut({ lo: 0, hi: 200 }, 'color-negative');
    expect(lut[200]).toBe(0);
    expect(lut[0]).toBe(255);
  });
});

describe('develop', () => {
  it('renders a grey ramp seen through an orange mask as neutral', () => {
    // Film model: transmittance of channel c = base[c] * exposure ^ -gamma[c].
    const base = [0.9, 0.6, 0.35];
    const gamma = [0.5, 0.6, 0.7];
    const steps = 64;
    const maxExposure = 20;
    const rawAt = (c: number, e: number) => Math.round(255 * base[c] * Math.pow(e, -gamma[c]));
    const rgb = new Uint8Array(steps * 3);
    for (let i = 0; i < steps; i++) {
      const e = Math.pow(maxExposure, i / (steps - 1));
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rawAt(c, e);
    }
    const levels: Levels = [
      { lo: rawAt(0, maxExposure), hi: rawAt(0, 1) },
      { lo: rawAt(1, maxExposure), hi: rawAt(1, 1) },
      { lo: rawAt(2, maxExposure), hi: rawAt(2, 1) },
    ];
    const out = develop(rgb, steps, 1, 'color-negative', levels, NONE);
    for (let i = 0; i < steps; i++) {
      const px = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]];
      // 8-bit rounding of the dark blue channel alone costs up to 6 levels
      expect(Math.max(...px) - Math.min(...px)).toBeLessThanOrEqual(12);
      expect(out[i * 4 + 3]).toBe(255);
    }
    expect(out[0]).toBe(0);
    expect(out[(steps - 1) * 4]).toBe(255);
  });

  it('outputs grey for black-and-white negatives', () => {
    const out = develop(Uint8Array.of(40, 80, 120, 200, 10, 90), 2, 1, 'bw-negative', FULL, NONE);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
    expect(out[4]).toBe(out[5]);
    expect(out[5]).toBe(out[6]);
  });

  it('applies the four orientations', () => {
    const rgb = Uint8Array.of(10, 10, 10, 60, 60, 60, 120, 120, 120, 240, 240, 240); // 2x2
    const reference = develop(rgb, 2, 2, 'slide', FULL, NONE);
    const red = (out: Uint8ClampedArray) => [out[0], out[4], out[8], out[12]];
    const src = red(reference);
    const cases: Array<[Orientation, number[]]> = [
      [{ rotate180: false, mirror: false }, [0, 1, 2, 3]],
      [{ rotate180: true, mirror: false }, [3, 2, 1, 0]],
      [{ rotate180: false, mirror: true }, [1, 0, 3, 2]],
      [{ rotate180: true, mirror: true }, [2, 3, 0, 1]],
    ];
    for (const [orientation, order] of cases) {
      expect(red(develop(rgb, 2, 2, 'slide', FULL, orientation))).toEqual(order.map((i) => src[i]));
    }
  });
});

describe('clippedFraction', () => {
  it('reports the worst channel', () => {
    const rgb = new Uint8Array(100 * 3);
    for (let i = 0; i < 2; i++) rgb[i * 3] = 255;
    for (let i = 0; i < 3; i++) rgb[i * 3 + 2] = 255;
    expect(clippedFraction(rgb)).toBeCloseTo(0.03, 10);
  });
});

describe('tiffOrientation', () => {
  it('maps to TIFF orientation values', () => {
    expect(tiffOrientation({ rotate180: false, mirror: false })).toBe(1);
    expect(tiffOrientation({ rotate180: false, mirror: true })).toBe(2);
    expect(tiffOrientation({ rotate180: true, mirror: false })).toBe(3);
    expect(tiffOrientation({ rotate180: true, mirror: true })).toBe(4);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/image/develop.test.ts`
Expected: FAIL, no puede resolver `./develop`.

- [ ] **Step 3: Implementar `src/image/develop.ts`**

```ts
// Turns demosaiced RGB into a displayable image for each film type.

export type FilmType = 'color-negative' | 'bw-negative' | 'slide';

export interface ChannelLevels {
  lo: number;
  hi: number;
}

/** Levels for R, G and B. Black-and-white film carries the same luminance levels three times. */
export type Levels = readonly [ChannelLevels, ChannelLevels, ChannelLevels];

export interface Orientation {
  rotate180: boolean;
  mirror: boolean;
}

export const LO_PERCENTILE = 0.005;
export const HI_PERCENTILE = 0.995;
/** Fraction of the image ignored on each side when measuring levels. */
export const MARGIN = 0.05;
export const MIN_RANGE = 8;
/** Exponent applied to normalised density for negatives. */
export const TONE = 1.0;
export const SLIDE_GAMMA = 2.2;
/** Above this fraction of saturated pixels in any channel the UI warns. */
export const CLIP_WARN_FRACTION = 0.01;

const luminance = (r: number, g: number, b: number) => (r + 2 * g + b) >> 2;

function percentileLevels(hist: Uint32Array, total: number): ChannelLevels {
  const at = (fraction: number): number => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= fraction * total) return v;
    }
    return 255;
  };
  let lo = at(LO_PERCENTILE);
  let hi = at(HI_PERCENTILE);
  if (hi - lo < MIN_RANGE) {
    hi = Math.min(255, lo + MIN_RANGE);
    lo = hi - MIN_RANGE;
  }
  return { lo, hi };
}

export function computeLevels(rgb: Uint8Array, width: number, height: number, film: FilmType): Levels {
  const mx = Math.floor(width * MARGIN);
  const my = Math.floor(height * MARGIN);
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const grey = film === 'bw-negative';
  let total = 0;
  for (let y = my; y < height - my; y++) {
    for (let x = mx; x < width - mx; x++) {
      const o = (y * width + x) * 3;
      if (grey) {
        hist[0][luminance(rgb[o], rgb[o + 1], rgb[o + 2])]++;
      } else {
        hist[0][rgb[o]]++;
        hist[1][rgb[o + 1]]++;
        hist[2][rgb[o + 2]]++;
      }
      total++;
    }
  }
  if (grey) {
    const l = percentileLevels(hist[0], total);
    return [l, l, l];
  }
  return [percentileLevels(hist[0], total), percentileLevels(hist[1], total), percentileLevels(hist[2], total)];
}

export function clippedFraction(rgb: Uint8Array): number {
  const counts = [0, 0, 0];
  for (let o = 0; o < rgb.length; o += 3) {
    if (rgb[o] === 255) counts[0]++;
    if (rgb[o + 1] === 255) counts[1]++;
    if (rgb[o + 2] === 255) counts[2]++;
  }
  return Math.max(counts[0], counts[1], counts[2]) / (rgb.length / 3);
}

/**
 * Negatives: normalised density d = ln(hi / v) / ln(hi / lo) is 0 at the film base and 1 at the
 * densest area. Normalising each channel separately removes the orange mask and equalises the
 * contrast of the three dye layers. Slides are a plain levels stretch with display gamma.
 */
export function buildLut(levels: ChannelLevels, film: FilmType): Uint8Array {
  const lo = Math.max(1, levels.lo);
  const hi = Math.max(lo + 1, levels.hi);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let out: number;
    if (film === 'slide') {
      const n = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      out = Math.pow(n, 1 / SLIDE_GAMMA);
    } else {
      const d = Math.min(1, Math.max(0, Math.log(hi / Math.max(v, 1)) / Math.log(hi / lo)));
      out = Math.pow(d, TONE);
    }
    lut[v] = Math.round(255 * out);
  }
  return lut;
}

/** RGB in, RGBA out, with the film conversion and the orientation applied. */
export function develop(
  rgb: Uint8Array,
  width: number,
  height: number,
  film: FilmType,
  levels: Levels,
  orientation: Orientation,
): Uint8ClampedArray<ArrayBuffer> {
  const luts = [buildLut(levels[0], film), buildLut(levels[1], film), buildLut(levels[2], film)];
  const out = new Uint8ClampedArray(width * height * 4);
  const grey = film === 'bw-negative';
  // A 180-degree turn flips both axes; adding a mirror flips x back.
  const flipX = orientation.mirror !== orientation.rotate180;
  const flipY = orientation.rotate180;
  for (let y = 0; y < height; y++) {
    const dy = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const dx = flipX ? width - 1 - x : x;
      const s = (y * width + x) * 3;
      const d = (dy * width + dx) * 4;
      if (grey) {
        const v = luts[0][luminance(rgb[s], rgb[s + 1], rgb[s + 2])];
        out[d] = v;
        out[d + 1] = v;
        out[d + 2] = v;
      } else {
        out[d] = luts[0][rgb[s]];
        out[d + 1] = luts[1][rgb[s + 1]];
        out[d + 2] = luts[2][rgb[s + 2]];
      }
      out[d + 3] = 255;
    }
  }
  return out;
}

/** TIFF/DNG orientation tag for sensor data that is stored unrotated. */
export function tiffOrientation(o: Orientation): number {
  if (o.rotate180) return o.mirror ? 4 : 3;
  return o.mirror ? 2 : 1;
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/image/develop.test.ts`
Expected: PASS, 12 pruebas.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/image/develop.ts src/image/develop.test.ts
git commit -m "feat: add levels, film conversion and orientation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Escritor de DNG

**Files:**
- Create: `src/image/dng.ts`
- Test: `src/image/dng.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `encodeDng(raw: Uint8Array, width: number, height: number, orientation: number): Uint8Array<ArrayBuffer>`. `orientation` es el valor TIFF (1 a 4).

Este formato exacto ya se comprobó en esta Mac: `sips` lo reconoce como DNG de 2592×1680 con fabricante y modelo.

- [ ] **Step 1: Escribir la prueba que falla, `src/image/dng.test.ts`**

```ts
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
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/image/dng.test.ts`
Expected: FAIL, no puede resolver `./dng`.

- [ ] **Step 3: Implementar `src/image/dng.ts`**

```ts
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
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/image/dng.test.ts`
Expected: PASS, 8 pruebas (7 si no es macOS).

- [ ] **Step 5: Commit**

```bash
git add src/image/dng.ts src/image/dng.test.ts
git commit -m "feat: add DNG writer for the raw mosaic" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pipeline de revelado

**Files:**
- Create: `src/image/pipeline.ts`
- Test: `src/image/pipeline.test.ts`

**Interfaces:**
- Consumes: `FRAME_WIDTH`, `FRAME_HEIGHT` de `src/frame.ts`; `demosaicHalf`, `demosaicBilinear` (Task 4); `computeLevels`, `clippedFraction`, `develop`, `FilmType`, `Levels`, `Orientation` (Task 5).
- Produces:
  - `interface DevelopParams { film: FilmType; orientation: Orientation; lockedLevels: Levels | null }`.
  - `interface Developed { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; levels: Levels; clipped: number }`.
  - `developPreview(raw: Uint8Array, params: DevelopParams, width?: number, height?: number): Developed` a media resolución.
  - `developCapture(raw: Uint8Array, params: DevelopParams, width?: number, height?: number): Developed` a resolución completa.

- [ ] **Step 1: Escribir la prueba que falla, `src/image/pipeline.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { MIN_RANGE, type Levels } from './develop';
import { developCapture, developPreview, type DevelopParams } from './pipeline';

/** BGGR mosaic of a single flat colour. */
function flat(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw[y * width + x] = y % 2 === 0 ? (x % 2 === 0 ? b : g) : x % 2 === 0 ? g : r;
    }
  }
  return raw;
}

const auto: DevelopParams = { film: 'slide', orientation: { rotate180: false, mirror: false }, lockedLevels: null };
const locked: Levels = [
  { lo: 10, hi: 210 },
  { lo: 20, hi: 220 },
  { lo: 30, hi: 230 },
];

describe('developPreview', () => {
  it('returns a half-resolution RGBA image', () => {
    const r = developPreview(flat(8, 4, [200, 100, 50]), auto, 8, 4);
    expect([r.width, r.height]).toEqual([4, 2]);
    expect(r.rgba.length).toBe(4 * 2 * 4);
  });

  it('measures levels when none are locked', () => {
    const r = developPreview(flat(8, 4, [200, 100, 50]), auto, 8, 4);
    expect(r.levels[0]).toEqual({ lo: 200, hi: 200 + MIN_RANGE });
  });

  it('uses locked levels as given', () => {
    const r = developPreview(flat(8, 4, [200, 100, 50]), { ...auto, lockedLevels: locked }, 8, 4);
    expect(r.levels).toBe(locked);
  });

  it('reports saturation', () => {
    expect(developPreview(flat(8, 4, [255, 100, 50]), auto, 8, 4).clipped).toBe(1);
    expect(developPreview(flat(8, 4, [200, 100, 50]), auto, 8, 4).clipped).toBe(0);
  });
});

describe('developCapture', () => {
  it('returns a full-resolution RGBA image', () => {
    const r = developCapture(flat(8, 4, [200, 100, 50]), auto, 8, 4);
    expect([r.width, r.height]).toEqual([8, 4]);
    expect(r.rgba.length).toBe(8 * 4 * 4);
  });

  it('develops with the same levels the preview would use', () => {
    const raw = flat(8, 4, [200, 100, 50]);
    expect(developCapture(raw, auto, 8, 4).levels).toEqual(developPreview(raw, auto, 8, 4).levels);
  });

  it('uses locked levels as given', () => {
    const r = developCapture(flat(8, 4, [200, 100, 50]), { ...auto, lockedLevels: locked }, 8, 4);
    expect(r.levels).toBe(locked);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/image/pipeline.test.ts`
Expected: FAIL, no puede resolver `./pipeline`.

- [ ] **Step 3: Implementar `src/image/pipeline.ts`**

```ts
// Chains demosaicing, level measurement and film conversion for a raw frame.
import { FRAME_HEIGHT, FRAME_WIDTH } from '../frame';
import { demosaicBilinear, demosaicHalf } from './demosaic';
import { clippedFraction, computeLevels, develop, type FilmType, type Levels, type Orientation } from './develop';

export interface DevelopParams {
  film: FilmType;
  orientation: Orientation;
  /** When set, these levels are used instead of measuring the frame. */
  lockedLevels: Levels | null;
}

export interface Developed {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  levels: Levels;
  /** Largest fraction of saturated pixels in any channel of the raw frame. */
  clipped: number;
}

export function developPreview(raw: Uint8Array, params: DevelopParams, width = FRAME_WIDTH, height = FRAME_HEIGHT): Developed {
  const w = width / 2;
  const h = height / 2;
  const half = demosaicHalf(raw, width, height);
  const levels = params.lockedLevels ?? computeLevels(half, w, h, params.film);
  return {
    rgba: develop(half, w, h, params.film, levels, params.orientation),
    width: w,
    height: h,
    levels,
    clipped: clippedFraction(half),
  };
}

/** Levels are always measured on the half-resolution image, so a capture matches its preview. */
export function developCapture(raw: Uint8Array, params: DevelopParams, width = FRAME_WIDTH, height = FRAME_HEIGHT): Developed {
  const half = demosaicHalf(raw, width, height);
  const levels = params.lockedLevels ?? computeLevels(half, width / 2, height / 2, params.film);
  return {
    rgba: develop(demosaicBilinear(raw, width, height), width, height, params.film, levels, params.orientation),
    width,
    height,
    levels,
    clipped: clippedFraction(half),
  };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/image`
Expected: PASS en los cuatro archivos de prueba de `src/image`.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/image/pipeline.ts src/image/pipeline.test.ts
git commit -m "feat: add preview and capture development pipeline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Nombres de archivo

**Files:**
- Create: `src/storage/naming.ts`
- Test: `src/storage/naming.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `isValidRoll(name: string): boolean`; `fileBase(roll: string, index: number): string` (por ejemplo `rollo-01_0007`); `nextIndex(roll: string, fileNames: Iterable<string>): number`.

- [ ] **Step 1: Escribir la prueba que falla, `src/storage/naming.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { fileBase, isValidRoll, nextIndex } from './naming';

describe('isValidRoll', () => {
  it.each(['rollo-01', 'a', 'Navidad 1998', 'cumpleaños_98', 'x'.repeat(40)])('accepts %j', (name) => {
    expect(isValidRoll(name)).toBe(true);
  });

  it.each(['', ' rollo', 'rollo ', 'a/b', 'a.b', 'a:b', '..', 'x'.repeat(41)])('rejects %j', (name) => {
    expect(isValidRoll(name)).toBe(false);
  });
});

describe('fileBase', () => {
  it('pads the index to four digits', () => {
    expect(fileBase('rollo-01', 7)).toBe('rollo-01_0007');
    expect(fileBase('rollo-01', 12345)).toBe('rollo-01_12345');
  });
});

describe('nextIndex', () => {
  it('starts at 1 in an empty folder', () => {
    expect(nextIndex('rollo-01', [])).toBe(1);
  });

  it('continues after the highest number, even with gaps', () => {
    expect(nextIndex('rollo-01', ['rollo-01_0001.jpg', 'rollo-01_0001.dng', 'rollo-01_0005.jpg'])).toBe(6);
  });

  it('counts a DNG that lost its JPEG', () => {
    expect(nextIndex('rollo-01', ['rollo-01_0003.dng'])).toBe(4);
  });

  it('ignores files that do not belong to the roll', () => {
    const names = ['otro_0009.jpg', 'rollo-01_abc.jpg', 'rollo-01_0008.txt', 'rollo-01_0007.jpg.tmp', 'rollo-011_0050.jpg', '.DS_Store'];
    expect(nextIndex('rollo-01', names)).toBe(1);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/storage/naming.test.ts`
Expected: FAIL, no puede resolver `./naming`.

- [ ] **Step 3: Implementar `src/storage/naming.ts`**

```ts
// Roll names and capture file names: <roll>/<roll>_<4-digit index>.{jpg,dng}

// Letters, digits, space, hyphen and underscore; 1 to 40 characters; no space at either end.
const ROLL = /^[\p{L}\p{N}_-](?:[\p{L}\p{N} _-]{0,38}[\p{L}\p{N}_-])?$/u;

export function isValidRoll(name: string): boolean {
  return ROLL.test(name);
}

export function fileBase(roll: string, index: number): string {
  return `${roll}_${String(index).padStart(4, '0')}`;
}

/** One more than the highest index already used by this roll's files; 1 when there are none. */
export function nextIndex(roll: string, fileNames: Iterable<string>): number {
  const prefix = `${roll}_`;
  let max = 0;
  for (const name of fileNames) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(\d{4,})\.(?:jpg|dng)$/.exec(name.slice(prefix.length));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/storage/naming.test.ts`
Expected: PASS, 18 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/storage/naming.ts src/storage/naming.test.ts
git commit -m "feat: add roll validation and capture numbering" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Carpeta de destino

**Files:**
- Create: `src/storage/folder.ts`
- Test: `src/storage/folder.test.ts`

**Interfaces:**
- Consumes: `fileBase`, `nextIndex` (Task 8).
- Produces:
  - `interface DirectoryLike { getFileHandle(name, options?): Promise<FileLike>; getDirectoryHandle(name, options?): Promise<DirectoryLike>; removeEntry(name): Promise<void>; keys(): AsyncIterable<string> }`. `FileSystemDirectoryHandle` la cumple.
  - `class RollFolder { static open(base: DirectoryLike, roll: string): Promise<RollFolder>; readonly roll: string; get nextName(): string; get canUndo(): boolean; save(jpeg: Blob, dng: Uint8Array<ArrayBuffer>): Promise<string>; undoLast(): Promise<string> }`. `save` y `undoLast` devuelven el nombre base, por ejemplo `rollo-01_0003`.
  - `loadSavedFolder(): Promise<FileSystemDirectoryHandle | null>`; `pickFolder(): Promise<FileSystemDirectoryHandle>`; `canWrite(handle): Promise<boolean>`; `requestWrite(handle): Promise<boolean>`. Estas cuatro solo existen en el navegador y se comprueban en la aceptación manual.

- [ ] **Step 1: Escribir la prueba que falla, `src/storage/folder.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { RollFolder, type DirectoryLike } from './folder';

class FakeDir implements DirectoryLike {
  files = new Map<string, Blob | BufferSource>();
  dirs = new Map<string, FakeDir>();
  /** Writing a file with this name fails. */
  failOn: string | null = null;

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options?.create) throw new Error('NotFoundError');
      dir = new FakeDir();
      dir.failOn = this.failOn;
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error('NotFoundError');
      this.files.set(name, new Uint8Array(0));
    }
    return {
      createWritable: async () => ({
        write: async (data: Blob | BufferSource) => {
          if (name === this.failOn) throw new Error('disk full');
          this.files.set(name, data);
        },
        close: async () => {},
      }),
    };
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new Error('NotFoundError');
  }

  async *keys(): AsyncGenerator<string> {
    yield* this.files.keys();
    yield* this.dirs.keys();
  }
}

const jpeg = new Blob(['jpeg']);
const dng = Uint8Array.of(1, 2, 3);

describe('RollFolder', () => {
  it('starts at 0001 and does not create the subfolder until the first save', async () => {
    const base = new FakeDir();
    const roll = await RollFolder.open(base, 'rollo-01');
    expect(roll.nextName).toBe('rollo-01_0001');
    expect(base.dirs.has('rollo-01')).toBe(false);
  });

  it('writes the DNG and the JPEG and advances', async () => {
    const base = new FakeDir();
    const roll = await RollFolder.open(base, 'rollo-01');
    expect(await roll.save(jpeg, dng)).toBe('rollo-01_0001');
    const dir = base.dirs.get('rollo-01')!;
    expect(dir.files.get('rollo-01_0001.dng')).toBe(dng);
    expect(dir.files.get('rollo-01_0001.jpg')).toBe(jpeg);
    expect(roll.nextName).toBe('rollo-01_0002');
  });

  it('continues numbering after existing files', async () => {
    const base = new FakeDir();
    const dir = await base.getDirectoryHandle('rollo-01', { create: true });
    dir.files.set('rollo-01_0004.jpg', jpeg);
    dir.files.set('rollo-01_0004.dng', dng);
    expect((await RollFolder.open(base, 'rollo-01')).nextName).toBe('rollo-01_0005');
  });

  it('leaves nothing behind and does not advance when the JPEG fails', async () => {
    const base = new FakeDir();
    base.failOn = 'rollo-01_0001.jpg';
    const roll = await RollFolder.open(base, 'rollo-01');
    await expect(roll.save(jpeg, dng)).rejects.toThrow('disk full');
    expect([...base.dirs.get('rollo-01')!.files.keys()]).toEqual([]);
    expect(roll.nextName).toBe('rollo-01_0001');
    expect(roll.canUndo).toBe(false);
  });

  it('undoes the last capture once and reuses its number', async () => {
    const base = new FakeDir();
    const roll = await RollFolder.open(base, 'rollo-01');
    await roll.save(jpeg, dng);
    await roll.save(jpeg, dng);
    expect(roll.canUndo).toBe(true);
    expect(await roll.undoLast()).toBe('rollo-01_0002');
    expect([...base.dirs.get('rollo-01')!.files.keys()].sort()).toEqual(['rollo-01_0001.dng', 'rollo-01_0001.jpg']);
    expect(roll.nextName).toBe('rollo-01_0002');
    expect(roll.canUndo).toBe(false);
    await expect(roll.undoLast()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/storage/folder.test.ts`
Expected: FAIL, no puede resolver `./folder`.

- [ ] **Step 3: Implementar `src/storage/folder.ts`**

```ts
// Destination folder: remembered across sessions with IndexedDB, written with the File System
// Access API. Captures of a roll go to <base>/<roll>/<roll>_<index>.{dng,jpg}.
import { fileBase, nextIndex } from './naming';

export interface WritableLike {
  write(data: Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

export interface FileLike {
  createWritable(): Promise<WritableLike>;
}

/** The part of FileSystemDirectoryHandle this module uses, so tests can pass a fake. */
export interface DirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

export class RollFolder {
  private lastSaved: number | null = null;

  private constructor(
    private readonly base: DirectoryLike,
    private dir: DirectoryLike | null,
    readonly roll: string,
    private next: number,
  ) {}

  /** Reads the roll's subfolder if it exists. The subfolder is only created by the first save. */
  static async open(base: DirectoryLike, roll: string): Promise<RollFolder> {
    const dir = await base.getDirectoryHandle(roll).catch(() => null);
    const names: string[] = [];
    if (dir) for await (const name of dir.keys()) names.push(name);
    return new RollFolder(base, dir, roll, nextIndex(roll, names));
  }

  get nextName(): string {
    return fileBase(this.roll, this.next);
  }

  get canUndo(): boolean {
    return this.lastSaved !== null;
  }

  /** Writes the DNG and then the JPEG. When either write fails, no file of the pair is left. */
  async save(jpeg: Blob, dng: Uint8Array<ArrayBuffer>): Promise<string> {
    this.dir ??= await this.base.getDirectoryHandle(this.roll, { create: true });
    const dir = this.dir;
    const base = this.nextName;
    const started: string[] = [];
    try {
      for (const [name, data] of [[`${base}.dng`, dng], [`${base}.jpg`, jpeg]] as const) {
        started.push(name);
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write(data);
        await writable.close();
      }
    } catch (error) {
      for (const name of started) await dir.removeEntry(name).catch(() => {});
      throw error;
    }
    this.lastSaved = this.next;
    this.next++;
    return base;
  }

  /** Deletes the pair written by the last save() and frees its number. One level only. */
  async undoLast(): Promise<string> {
    if (this.lastSaved === null || !this.dir) throw new Error('No hay captura que deshacer');
    const base = fileBase(this.roll, this.lastSaved);
    await this.dir.removeEntry(`${base}.jpg`);
    await this.dir.removeEntry(`${base}.dng`);
    this.next = this.lastSaved;
    this.lastSaved = null;
    return base;
  }
}

const DB_NAME = 'memorease';
const STORE = 'handles';
const KEY = 'baseDir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The folder chosen in an earlier session, or null. Its permission may need to be requested again. */
export async function loadSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Opens the system folder picker and remembers the choice. Rejects when the user cancels. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: 'memorease', mode: 'readwrite' });
  await saveFolder(handle);
  return handle;
}

export async function canWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Must be called from a user gesture. */
export async function requestWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/storage`
Expected: PASS en los dos archivos de prueba de `src/storage`.

Run: `npm run typecheck`
Expected: sin errores. Si TypeScript rechaza pasar un `FileSystemDirectoryHandle` como `DirectoryLike` en una tarea posterior, la conversión se hace en el punto de uso con `handle as unknown as DirectoryLike`; no se cambia esta interfaz.

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS en los 12 archivos de prueba.

- [ ] **Step 6: Commit**

```bash
git add src/storage/folder.ts src/storage/folder.test.ts
git commit -m "feat: add roll folder with atomic pair writes and undo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Sesión del escáner y arnés de hardware [hardware]

**Files:**
- Create: `src/device/scanner.ts`
- Create: `tools/hw-harness/main.cjs`, `tools/hw-harness/run.mjs`, `tools/hw-harness/page.html`, `tools/hw-harness/page.ts`, `tools/hw-harness/stream.ts`

**Interfaces:**
- Consumes: `ButtonDecoder` (Task 2); `isoBytesPerMicroframe` (Task 2); `FrameAssembler`, `splitPayloads`, `Frame` (Task 1); `Registers`, `REG_SENSOR_ADDRESS`, `sleep` (Task 3); `OV562X_BRIDGE_INIT`, `OV562X_SENSOR_INIT` (Task 3).
- Produces:
  - `VENDOR_ID = 0x05a9`, `PRODUCT_ID = 0x1550`.
  - `interface ScannerEvents { onFrame(frame: Frame): void; onButton(): void; onError(error: Error): void }`.
  - `class Scanner { constructor(dev: USBDevice, events: ScannerEvents); static supported(): boolean; static matches(dev: USBDevice): boolean; static request(): Promise<USBDevice>; static findGranted(): Promise<USBDevice | null>; get device(): USBDevice; open(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; close(): Promise<void> }`.
  - Arnés: `npm run hw -- <escenario>` sale con código 0 si el escenario pasa. Un escenario es un módulo en `tools/hw-harness/` con `export default async function (ctx: HwContext): Promise<void>`, donde `HwContext` tiene `log(message)`, `check(condition, message)` y `file(name, bytes)`.

No hay prueba unitaria: `Scanner` es la costura con WebUSB y se prueba contra el aparato real con el escenario `stream`.

- [ ] **Step 1: Confirmar que el escáner está libre**

El escáner debe estar conectado por USB. Pedir al usuario que cierre la pestaña `localhost:8538` de Chromium si sigue abierta; esa página mantiene el dispositivo reclamado.

Run: `ioreg -p IOUSB -w0 | grep -c "USB Camera"`
Expected: `1`.

- [ ] **Step 2: Instalar Electron**

Run: `npm install -D electron`
Expected: termina sin errores.

- [ ] **Step 3: Implementar `src/device/scanner.ts`**

```ts
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
```

- [ ] **Step 4: Crear `tools/hw-harness/main.cjs`**

```js
// Electron host for hardware tests. Grants WebUSB access to the scanner without a chooser, loads
// HW_URL and polls the expression in HW_POLL until it yields { done, ok, log, files }.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.HW_URL;
const poll = process.env.HW_POLL || 'window.__hw';
const outDir = process.env.HW_OUT;
const timeoutMs = Number(process.env.HW_TIMEOUT_MS) || 90000;
const isScanner = (d) => d && d.vendorId === 0x05a9 && d.productId === 0x1550;

app.dock?.hide();
app.whenReady().then(async () => {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_webContents, permission) => permission === 'usb');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'usb' && isScanner(details.device));
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    callback(details.deviceList.find(isScanner)?.deviceId);
  });

  // Hidden windows throttle timers; the register protocol depends on 20 ms sleeps.
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.log('[console]', event.message);
  });
  await win.loadURL(url);

  const started = Date.now();
  let result = null;
  while (!result && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    result = await win.webContents.executeJavaScript(`(() => { const r = ${poll}; return r && r.done ? r : null; })()`);
  }
  if (!result) result = { done: true, ok: false, log: ['timeout: the page never reported a result'], files: {} };

  for (const line of result.log) console.log(line);
  for (const [name, base64] of Object.entries(result.files || {})) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, path.basename(name)), Buffer.from(base64, 'base64'));
  }
  app.exit(result.ok ? 0 : 1);
});
```

- [ ] **Step 5: Crear `tools/hw-harness/run.mjs`**

```js
// Runs one hardware scenario: starts Vite on port 5174, opens the page in Electron with the scanner
// pre-authorised, prints the scenario log and exits 0 on success.
// Usage: npm run hw -- <stream|sensor|capture|app>
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const scenario = process.argv[2];
if (!scenario) {
  console.error('usage: npm run hw -- <stream|sensor|capture|app>');
  process.exit(2);
}

const PORT = 5174;
// The real app has no test page: poll its DOM until the preview is live.
const APP_POLL = `(() => {
  const status = document.body.dataset.status;
  const placeholder = document.querySelector('#placeholder');
  const canvas = document.querySelector('#preview');
  const message = document.querySelector('#message')?.textContent ?? '';
  if (status === 'error' || status === 'unsupported') {
    return { done: true, ok: false, log: ['app status: ' + status + ' ' + message], files: {} };
  }
  if (status === 'live' && placeholder?.hidden) {
    return { done: true, ok: true, log: ['app is live, preview ' + canvas.width + 'x' + canvas.height], files: {} };
  }
  return null;
})()`;

const server = await createServer({ root, server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();

const env = {
  ...process.env,
  HW_URL: scenario === 'app' ? `http://localhost:${PORT}/` : `http://localhost:${PORT}/tools/hw-harness/page.html#${scenario}`,
  HW_OUT: path.join(here, 'out'),
  ...(scenario === 'app' ? { HW_POLL: APP_POLL } : {}),
};
// require('electron') from Node resolves to the path of the Electron binary.
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [path.join(here, 'main.cjs')], { env, stdio: 'inherit' });
const code = await new Promise((resolve) => child.on('exit', resolve));
await server.close();
process.exit(code ?? 1);
```

- [ ] **Step 6: Crear `tools/hw-harness/page.html`**

```html
<!doctype html>
<meta charset="utf-8">
<title>hw</title>
<script type="module" src="./page.ts"></script>
```

- [ ] **Step 7: Crear `tools/hw-harness/page.ts`**

```ts
// Hardware test page. Runs the scenario named in the URL hash and leaves the outcome in
// window.__hw, where tools/hw-harness/main.cjs collects it.

export interface HwContext {
  log(message: string): void;
  /** Records a pass or a failure; a failure makes the run exit non-zero. */
  check(condition: boolean, message: string): void;
  /** Saves bytes as tools/hw-harness/out/<name>. */
  file(name: string, bytes: Uint8Array): void;
}

export type Scenario = (ctx: HwContext) => Promise<void>;

const scenarios: Record<string, () => Promise<{ default: Scenario }>> = {
  stream: () => import('./stream'),
};

interface HwResult {
  done: boolean;
  ok: boolean;
  log: string[];
  files: Record<string, string>;
}

declare global {
  interface Window {
    __hw?: HwResult;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const result: HwResult = { done: false, ok: true, log: [], files: {} };
const ctx: HwContext = {
  log: (message) => {
    result.log.push(message);
  },
  check: (condition, message) => {
    result.log.push(`${condition ? 'ok  ' : 'FAIL'} ${message}`);
    if (!condition) result.ok = false;
  },
  file: (name, bytes) => {
    result.files[name] = toBase64(bytes);
  },
};

const name = location.hash.slice(1);
try {
  const load = scenarios[name];
  if (!load) throw new Error(`unknown scenario "${name}"`);
  await (await load()).default(ctx);
} catch (error) {
  result.ok = false;
  result.log.push(`ERROR ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
}
result.done = true;
window.__hw = result;
```

- [ ] **Step 8: Crear `tools/hw-harness/stream.ts`**

```ts
// Scenario: frames arrive complete, stop() really stops, and the stream can start again.
import type { Frame } from '../../src/device/frames';
import { Scanner } from '../../src/device/scanner';
import { FRAME_BYTES } from '../../src/frame';
import type { HwContext } from './page';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function stream(ctx: HwContext): Promise<void> {
  const device = await Scanner.findGranted();
  if (!device) throw new Error('scanner not found: is it plugged in?');
  const frames: Frame[] = [];
  const errors: Error[] = [];
  const scanner = new Scanner(device, {
    onFrame: (frame) => frames.push(frame),
    onButton: () => ctx.log('button pressed'),
    onError: (error) => errors.push(error),
  });
  try {
    const t0 = performance.now();
    await scanner.open();
    ctx.log(`open + init: ${Math.round(performance.now() - t0)} ms`);

    await scanner.start();
    await sleep(3000);
    await scanner.stop();
    const first = frames.length;
    ctx.check(first >= 4, `first run delivered ${first} frames in 3 s (expected >= 4)`);
    ctx.check(frames.every((f) => f.data.length === FRAME_BYTES), `every frame has ${FRAME_BYTES} bytes`);
    ctx.check(frames.every((f, i) => i === 0 || f.startedAt > frames[i - 1].startedAt), 'frame start times increase');

    await sleep(500);
    ctx.check(frames.length === first, 'no frames arrive after stop()');

    await scanner.start();
    await sleep(2000);
    await scanner.stop();
    const second = frames.length - first;
    ctx.check(second >= 2, `second run delivered ${second} frames in 2 s (expected >= 2)`);
    ctx.check(errors.length === 0, `no stream errors (${errors.map((e) => e.message).join('; ') || 'none'})`);
  } finally {
    await scanner.close();
  }
}
```

- [ ] **Step 9: Comprobar tipos**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 10: Correr el escenario contra el aparato**

Run: `npm run hw -- stream`
Expected: código de salida 0 y un log como este (los números varían):

```
open + init: 2600 ms
ok   first run delivered 5 frames in 3 s (expected >= 4)
ok   every frame has 4354560 bytes
ok   frame start times increase
ok   no frames arrive after stop()
ok   second run delivered 3 frames in 2 s (expected >= 2)
ok   no stream errors (none)
```

Electron puede imprimir una línea `sandbox_extension_issue_file failed`; es ruido y se ignora.

Si el log trae `ERROR` con `claimInterface` o `Unable to claim interface`, otro programa tiene abierto el escáner: volver al Step 1. Si falla `no frames arrive after stop()` o la segunda corrida, el orden de parada de `Scanner.stop()` no le sirve a este navegador: detenerse y reportarlo con el log, sin cambiar el orden a ciegas.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src/device/scanner.ts tools/hw-harness/main.cjs tools/hw-harness/run.mjs tools/hw-harness/page.html tools/hw-harness/page.ts tools/hw-harness/stream.ts
git commit -m "feat: add scanner session and hardware test harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Controles del sensor [hardware]

**Files:**
- Modify: `src/device/scanner.ts`
- Create: `tools/hw-harness/sensor.ts`
- Modify: `tools/hw-harness/page.ts` (mapa `scenarios`)

**Interfaces:**
- Consumes: `COM8`, `COM8_AUTO`, `COM8_FROZEN`, `exposureTargetRegisters` (Task 3); `Scanner` y el arnés (Task 10).
- Produces, en `src/device/scanner.ts`:
  - `SENSOR_CAPS: { exposureTarget: boolean; freeze: boolean }`, con el resultado medido en el aparato.
  - `Scanner.setExposureTarget(n: number): Promise<void>`; `Scanner.setAutoModes(on: boolean): Promise<void>`; `Scanner.sensorRead(reg: number): Promise<number>`. Las tres se encolan entre sí, de modo que nunca se intercalan dos secuencias SCCB.

Esta tarea mide dos cosas que la especificación deja como supuestos: que el objetivo de exposición funciona, y que `0x13 = 0xc0` congela el sensor.

- [ ] **Step 1: Agregar los controles a `src/device/scanner.ts`**

Agregar el import junto a los demás:

```ts
import { COM8, COM8_AUTO, COM8_FROZEN, exposureTargetRegisters } from './sensor-control';
```

Agregar debajo de la constante `BUTTON_RETRY_MS`:

```ts
/**
 * Which sensor controls this scanner honours, as measured by `npm run hw -- sensor`.
 * When exposureTarget is false the UI hides the exposure slider; when freeze is false,
 * locking only freezes the development levels.
 */
export const SENSOR_CAPS: { exposureTarget: boolean; freeze: boolean } = { exposureTarget: true, freeze: true };
```

Agregar este campo junto a los demás campos privados de la clase:

```ts
  private sensorQueue: Promise<unknown> = Promise.resolve();
```

Agregar estos métodos a la clase, después de `close()`:

```ts
  /** Moves the auto-exposure target. `n` runs from -90 to 90; 0 is the default. */
  setExposureTarget(n: number): Promise<void> {
    return this.sensor(() => this.regs.sensorWriteAll(exposureTargetRegisters(n)));
  }

  /** `false` freezes exposure, gain and white balance at their current values. */
  setAutoModes(on: boolean): Promise<void> {
    return this.sensor(() => this.regs.sensorWrite(COM8, on ? COM8_AUTO : COM8_FROZEN));
  }

  sensorRead(reg: number): Promise<number> {
    return this.sensor(() => this.regs.sensorRead(reg));
  }

  /** Serialises sensor access: an SCCB exchange is several bridge writes that must not interleave. */
  private sensor<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.sensorQueue.then(operation, operation);
    this.sensorQueue = run.catch(() => {});
    return run;
  }
```

- [ ] **Step 2: Crear `tools/hw-harness/sensor.ts`**

```ts
// Scenario: measures whether the exposure target and the COM8 freeze behave as the spec assumes.
// It reports RESULT lines instead of failing; SENSOR_CAPS in src/device/scanner.ts records them.
import type { Frame } from '../../src/device/frames';
import { Scanner } from '../../src/device/scanner';
import type { HwContext } from './page';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mean raw level. A step of 17 visits every Bayer site in turn. */
function mean(frame: Frame): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < frame.data.length; i += 17) {
    sum += frame.data[i];
    n++;
  }
  return sum / n;
}

export default async function sensor(ctx: HwContext): Promise<void> {
  const device = await Scanner.findGranted();
  if (!device) throw new Error('scanner not found: is it plugged in?');
  const state: { latest: Frame | null } = { latest: null };
  const scanner = new Scanner(device, {
    onFrame: (frame) => {
      state.latest = frame;
    },
    onButton: () => {},
    onError: (error) => ctx.log(`stream error: ${error.message}`),
  });

  /** Mean of a frame that started after the sensor had 4 s (about 8 frames) to react. */
  const settledMean = async (): Promise<number> => {
    await sleep(4000);
    const since = performance.now();
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      if (state.latest && state.latest.startedAt > since) return mean(state.latest);
    }
    throw new Error('no frame within 5 s');
  };

  try {
    await scanner.open();
    await scanner.start();

    await scanner.setAutoModes(true);
    await scanner.setExposureTarget(0);
    const base = await settledMean();
    await scanner.setExposureTarget(-60);
    const darker = await settledMean();
    ctx.log(`auto on:  mean ${base.toFixed(1)} at target 0, ${darker.toFixed(1)} at target -60`);
    const exposureTarget = darker < base * 0.85;
    ctx.log(`RESULT exposureTarget=${exposureTarget}`);

    await scanner.setExposureTarget(0);
    const restored = await settledMean();
    const gainsBefore = [await scanner.sensorRead(0x01), await scanner.sensorRead(0x02)];
    await scanner.setAutoModes(false);
    await scanner.setExposureTarget(-60);
    const frozen = await settledMean();
    const gainsAfter = [await scanner.sensorRead(0x01), await scanner.sensorRead(0x02)];
    ctx.log(`auto off: mean ${restored.toFixed(1)} before, ${frozen.toFixed(1)} after moving the target to -60`);
    ctx.log(`blue/red gain registers: ${gainsBefore.join(',')} -> ${gainsAfter.join(',')}`);
    // The freeze can only be shown through the exposure target, so it needs that control to work.
    const freeze =
      exposureTarget &&
      Math.abs(frozen - restored) < restored * 0.05 &&
      gainsBefore[0] === gainsAfter[0] &&
      gainsBefore[1] === gainsAfter[1];
    ctx.log(`RESULT freeze=${freeze}`);

    await scanner.setAutoModes(true);
    await scanner.setExposureTarget(0);
    await scanner.stop();
  } finally {
    await scanner.close();
  }
}
```

- [ ] **Step 3: Registrar el escenario en `tools/hw-harness/page.ts`**

Reemplazar el mapa `scenarios` por:

```ts
const scenarios: Record<string, () => Promise<{ default: Scenario }>> = {
  stream: () => import('./stream'),
  sensor: () => import('./sensor'),
};
```

- [ ] **Step 4: Comprobar tipos y medir en el aparato**

Run: `npm run typecheck`
Expected: sin errores.

Run: `npm run hw -- sensor`
Expected: código de salida 0, tras unos 25 s, con dos líneas `RESULT`:

```
auto on:  mean 118.4 at target 0, 71.9 at target -60
RESULT exposureTarget=true
auto off: mean 118.1 before, 117.6 after moving the target to -60
blue/red gain registers: 64,64 -> 64,64
RESULT freeze=true
```

- [ ] **Step 5: Registrar el resultado en `SENSOR_CAPS`**

Editar la constante `SENSOR_CAPS` de `src/device/scanner.ts` para que cada campo valga exactamente lo que imprimió su línea `RESULT`. Si ambas son `true`, el archivo ya está correcto.

Anotar los dos valores: la Task 14 los usa para redactar el README.

- [ ] **Step 6: Volver a correr el escenario de stream**

Run: `npm run hw -- stream`
Expected: código de salida 0, igual que en la Task 10.

- [ ] **Step 7: Commit**

```bash
git add src/device/scanner.ts tools/hw-harness/sensor.ts tools/hw-harness/page.ts
git commit -m "feat: add exposure target and freeze controls, verified on hardware" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Worker de revelado [hardware]

**Files:**
- Create: `src/image/worker.ts`, `src/image/client.ts`
- Create: `tools/hw-harness/capture.ts`
- Modify: `tools/hw-harness/page.ts` (mapa `scenarios`)

**Interfaces:**
- Consumes: `developPreview`, `developCapture`, `DevelopParams` (Task 7); `encodeDng` (Task 6); `tiffOrientation`, `Levels` (Task 5); `FRAME_WIDTH`, `FRAME_HEIGHT`, `FRAME_BYTES` (Task 1); `Scanner` y el arnés (Task 10).
- Produces:
  - `src/image/worker.ts`: `JPEG_QUALITY = 0.92`, `THUMB_WIDTH = 240`, y los tipos `WorkerRequest` y `WorkerResponse`.
  - `src/image/client.ts`: `interface PreviewOutput { bitmap: ImageBitmap; levels: Levels; clipped: number }`; `interface CaptureOutput { jpeg: Blob; dng: Uint8Array<ArrayBuffer>; thumbnail: ImageBitmap; levels: Levels }`; `class DevelopClient { preview(raw: Uint8Array<ArrayBuffer>, params: DevelopParams): Promise<PreviewOutput | null>; capture(raw: Uint8Array<ArrayBuffer>, params: DevelopParams): Promise<CaptureOutput> }`. `preview` devuelve `null` sin tocar `raw` cuando ya hay una vista previa en curso. En los demás casos `raw` se transfiere al worker y queda inutilizable para quien llamó.

`OffscreenCanvas` y los workers no existen en el entorno de Vitest, así que esta capa se prueba en el navegador real con el escenario `capture`.

- [ ] **Step 1: Implementar `src/image/worker.ts`**

```ts
// Web Worker: develops raw frames off the main thread and encodes captures.
import { FRAME_HEIGHT, FRAME_WIDTH } from '../frame';
import { tiffOrientation, type Levels } from './develop';
import { encodeDng } from './dng';
import { developCapture, developPreview, type DevelopParams } from './pipeline';

export const JPEG_QUALITY = 0.92;
export const THUMB_WIDTH = 240;

export interface WorkerRequest {
  id: number;
  kind: 'preview' | 'capture';
  raw: Uint8Array<ArrayBuffer>;
  params: DevelopParams;
}

export type WorkerResponse =
  | { id: number; kind: 'preview'; bitmap: ImageBitmap; levels: Levels; clipped: number }
  | { id: number; kind: 'capture'; jpeg: Blob; dng: Uint8Array<ArrayBuffer>; thumbnail: ImageBitmap; levels: Levels }
  | { id: number; kind: 'error'; message: string };

// The project compiles against the DOM library, where `self` is typed as a Window.
const post = (message: WorkerResponse, transfer: Transferable[]) =>
  (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(message, transfer);

async function handle(request: WorkerRequest): Promise<void> {
  if (request.kind === 'preview') {
    const r = developPreview(request.raw, request.params);
    const bitmap = await createImageBitmap(new ImageData(r.rgba, r.width, r.height));
    post({ id: request.id, kind: 'preview', bitmap, levels: r.levels, clipped: r.clipped }, [bitmap]);
    return;
  }
  const r = developCapture(request.raw, request.params);
  const canvas = new OffscreenCanvas(r.width, r.height);
  canvas.getContext('2d')!.putImageData(new ImageData(r.rgba, r.width, r.height), 0, 0);
  const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  const thumb = new OffscreenCanvas(THUMB_WIDTH, Math.round((THUMB_WIDTH * r.height) / r.width));
  thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  const thumbnail = thumb.transferToImageBitmap();
  const dng = encodeDng(request.raw, FRAME_WIDTH, FRAME_HEIGHT, tiffOrientation(request.params.orientation));
  post({ id: request.id, kind: 'capture', jpeg, dng, thumbnail, levels: r.levels }, [thumbnail, dng.buffer]);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  handle(event.data).catch((error) => post({ id: event.data.id, kind: 'error', message: String(error) }, []));
};
```

- [ ] **Step 2: Implementar `src/image/client.ts`**

```ts
// Promise interface to the development worker.
import type { Levels } from './develop';
import type { DevelopParams } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface PreviewOutput {
  bitmap: ImageBitmap;
  levels: Levels;
  clipped: number;
}

export interface CaptureOutput {
  jpeg: Blob;
  dng: Uint8Array<ArrayBuffer>;
  thumbnail: ImageBitmap;
  levels: Levels;
}

interface Waiter {
  resolve(response: WorkerResponse): void;
  reject(error: Error): void;
}

export class DevelopClient {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly waiting = new Map<number, Waiter>();
  private nextId = 1;
  private previewBusy = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const waiter = this.waiting.get(event.data.id);
      if (!waiter) return;
      this.waiting.delete(event.data.id);
      if (event.data.kind === 'error') waiter.reject(new Error(event.data.message));
      else waiter.resolve(event.data);
    };
  }

  /**
   * Half-resolution preview. Frames arrive faster than they are worth drawing while the worker is
   * busy, so a call made during another preview returns null and leaves `raw` untouched.
   */
  async preview(raw: Uint8Array<ArrayBuffer>, params: DevelopParams): Promise<PreviewOutput | null> {
    if (this.previewBusy) return null;
    this.previewBusy = true;
    try {
      const response = await this.send('preview', raw, params);
      if (response.kind !== 'preview') throw new Error('unexpected worker reply');
      return { bitmap: response.bitmap, levels: response.levels, clipped: response.clipped };
    } finally {
      this.previewBusy = false;
    }
  }

  /** Full-resolution JPEG, DNG and thumbnail. */
  async capture(raw: Uint8Array<ArrayBuffer>, params: DevelopParams): Promise<CaptureOutput> {
    const response = await this.send('capture', raw, params);
    if (response.kind !== 'capture') throw new Error('unexpected worker reply');
    return { jpeg: response.jpeg, dng: response.dng, thumbnail: response.thumbnail, levels: response.levels };
  }

  private send(kind: WorkerRequest['kind'], raw: Uint8Array<ArrayBuffer>, params: DevelopParams): Promise<WorkerResponse> {
    const request: WorkerRequest = { id: this.nextId++, kind, raw, params };
    return new Promise((resolve, reject) => {
      this.waiting.set(request.id, { resolve, reject });
      this.worker.postMessage(request, [raw.buffer]);
    });
  }
}
```

- [ ] **Step 3: Crear `tools/hw-harness/capture.ts`**

```ts
// Scenario: a live frame goes through the worker and comes out as a preview, a JPEG and a DNG.
import type { Frame } from '../../src/device/frames';
import { Scanner } from '../../src/device/scanner';
import { FRAME_BYTES } from '../../src/frame';
import { DevelopClient } from '../../src/image/client';
import type { DevelopParams } from '../../src/image/pipeline';
import type { HwContext } from './page';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function capture(ctx: HwContext): Promise<void> {
  const device = await Scanner.findGranted();
  if (!device) throw new Error('scanner not found: is it plugged in?');
  const frames: Frame[] = [];
  const scanner = new Scanner(device, {
    onFrame: (frame) => frames.push(frame),
    onButton: () => {},
    onError: (error) => ctx.log(`stream error: ${error.message}`),
  });
  /** The next frame to arrive after this call. */
  const nextFrame = async (): Promise<Frame> => {
    const seen = frames.length;
    for (let i = 0; i < 100; i++) {
      if (frames.length > seen) return frames[frames.length - 1];
      await sleep(100);
    }
    throw new Error('no frame within 10 s');
  };
  const client = new DevelopClient();
  const params: DevelopParams = { film: 'color-negative', orientation: { rotate180: true, mirror: false }, lockedLevels: null };

  try {
    await scanner.open();
    await scanner.start();
    await sleep(2000); // let auto exposure settle

    const preview = await client.preview((await nextFrame()).data, params);
    ctx.check(preview !== null && preview.bitmap.width === 1296 && preview.bitmap.height === 840, 'preview bitmap is 1296x840');
    if (preview) ctx.log(`levels ${JSON.stringify(preview.levels)}, saturated ${(preview.clipped * 100).toFixed(2)}%`);

    const t0 = performance.now();
    const shot = await client.capture((await nextFrame()).data, params);
    ctx.log(`capture developed in ${Math.round(performance.now() - t0)} ms`);
    await scanner.stop();

    const decoded = await createImageBitmap(shot.jpeg);
    ctx.check(shot.jpeg.type === 'image/jpeg', 'capture is a JPEG');
    ctx.check(decoded.width === 2592 && decoded.height === 1680, `JPEG decodes at ${decoded.width}x${decoded.height}`);
    ctx.check(shot.dng.length > FRAME_BYTES && shot.dng.length < FRAME_BYTES + 2048, `DNG is ${shot.dng.length} bytes`);
    ctx.check(shot.thumbnail.width === 240, `thumbnail is ${shot.thumbnail.width} px wide`);
    ctx.file('capture.jpg', new Uint8Array(await shot.jpeg.arrayBuffer()));
    ctx.file('capture.dng', shot.dng);
  } finally {
    await scanner.close();
  }
}
```

- [ ] **Step 4: Registrar el escenario en `tools/hw-harness/page.ts`**

Reemplazar el mapa `scenarios` por:

```ts
const scenarios: Record<string, () => Promise<{ default: Scenario }>> = {
  stream: () => import('./stream'),
  sensor: () => import('./sensor'),
  capture: () => import('./capture'),
};
```

- [ ] **Step 5: Comprobar tipos y correr contra el aparato**

Run: `npm run typecheck`
Expected: sin errores.

Run: `npm run hw -- capture`
Expected: código de salida 0 y un log como este:

```
ok   preview bitmap is 1296x840
levels [{"lo":52,"hi":255},{"lo":60,"hi":255},{"lo":97,"hi":201}], saturated 3.10%
capture developed in 450 ms
ok   capture is a JPEG
ok   JPEG decodes at 2592x1680
ok   DNG is 4355044 bytes
ok   thumbnail is 240 px wide
```

- [ ] **Step 6: Comprobar los archivos generados**

Run: `sips -g pixelWidth -g pixelHeight -g format tools/hw-harness/out/capture.jpg tools/hw-harness/out/capture.dng`
Expected: ambos con `pixelWidth: 2592` y `pixelHeight: 1680`; formatos `jpeg` y `dng`.

Abrir `tools/hw-harness/out/capture.jpg` y mirarlo: debe ser una imagen en positivo, reconocible, de lo que haya en el escáner. Una imagen en negativo, con colores de mosaico o desplazada es un fallo de esta tarea.

- [ ] **Step 7: Commit**

```bash
git add src/image/worker.ts src/image/client.ts tools/hw-harness/capture.ts tools/hw-harness/page.ts
git commit -m "feat: develop frames in a worker and encode JPEG and DNG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Pantalla [hardware]

**Files:**
- Create: `index.html`, `src/main.ts`, `src/styles.css`
- Create: `src/ui/settings.ts`, `src/ui/view.ts`, `src/ui/app.ts`
- Test: `src/ui/settings.test.ts`

**Interfaces:**
- Consumes: `Scanner`, `SENSOR_CAPS` (Tasks 10 y 11); `Frame` (Task 1); `DevelopClient` (Task 12); `CLIP_WARN_FRACTION`, `FilmType`, `Levels` (Task 5); `DevelopParams` (Task 7); `RollFolder`, `loadSavedFolder`, `pickFolder`, `canWrite`, `requestWrite` (Task 9); `isValidRoll` (Task 8).
- Produces:
  - `interface Settings { film: FilmType; rotate180: boolean; mirror: boolean; exposure: number; roll: string }`; `DEFAULT_SETTINGS`; `loadSettings(store): Settings`; `saveSettings(store, settings): void`.
  - `createView(root: HTMLElement): View`.
  - `class App { constructor(root: HTMLElement); init(): Promise<void> }`.
  - En el DOM: `document.body.dataset.status` vale `unsupported`, `disconnected`, `connecting`, `live`, `capturing` o `error`. Los elementos `#preview`, `#placeholder` y `#message` existen; el escenario `app` del arnés depende de ellos.

- [ ] **Step 1: Escribir la prueba que falla, `src/ui/settings.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

class MemoryStore {
  private readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const KEY = 'memorease.settings';

describe('settings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings(new MemoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults when the stored value is not usable JSON', () => {
    for (const stored of ['{nope', 'null', '42']) {
      const store = new MemoryStore();
      store.setItem(KEY, stored);
      expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('replaces only the invalid fields', () => {
    const store = new MemoryStore();
    store.setItem(KEY, JSON.stringify({ film: 'x', rotate180: true, mirror: 'yes', exposure: 500, roll: ' bad ' }));
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, rotate180: true });
  });

  it('rounds the exposure', () => {
    const store = new MemoryStore();
    store.setItem(KEY, JSON.stringify({ exposure: -12.4 }));
    expect(loadSettings(store).exposure).toBe(-12);
  });

  it('round-trips', () => {
    const store = new MemoryStore();
    const settings = { film: 'slide', rotate180: true, mirror: true, exposure: -35, roll: 'Navidad 1998' } as const;
    saveSettings(store, settings);
    expect(loadSettings(store)).toEqual(settings);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/ui/settings.test.ts`
Expected: FAIL, no puede resolver `./settings`.

- [ ] **Step 3: Implementar `src/ui/settings.ts`**

```ts
// Choices remembered between sessions.
import type { FilmType } from '../image/develop';
import { isValidRoll } from '../storage/naming';

export interface Settings {
  film: FilmType;
  rotate180: boolean;
  mirror: boolean;
  /** Auto-exposure target, -90 to 90. */
  exposure: number;
  roll: string;
}

export const DEFAULT_SETTINGS: Settings = {
  film: 'color-negative',
  rotate180: false,
  mirror: false,
  exposure: 0,
  roll: 'rollo-01',
};

const KEY = 'memorease.settings';
const FILMS: readonly string[] = ['color-negative', 'bw-negative', 'slide'];

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSettings(store: Store): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed as typeof saved;
  } catch {
    // corrupt value: fall through to the defaults
  }
  const { film, exposure, roll } = saved;
  return {
    film: typeof film === 'string' && FILMS.includes(film) ? (film as FilmType) : DEFAULT_SETTINGS.film,
    rotate180: saved.rotate180 === true,
    mirror: saved.mirror === true,
    exposure: typeof exposure === 'number' && exposure >= -90 && exposure <= 90 ? Math.round(exposure) : DEFAULT_SETTINGS.exposure,
    roll: typeof roll === 'string' && isValidRoll(roll) ? roll : DEFAULT_SETTINGS.roll,
  };
}

export function saveSettings(store: Store, settings: Settings): void {
  store.setItem(KEY, JSON.stringify(settings));
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/ui/settings.test.ts`
Expected: PASS, 5 pruebas.

- [ ] **Step 5: Crear `index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Memor-ease</title>
  </head>
  <body data-status="disconnected">
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Implementar `src/ui/view.ts`**

```ts
// Builds the single screen and hands back typed references to its parts.

const TEMPLATE = `
<main class="layout">
  <section class="stage">
    <canvas id="preview" width="1296" height="840"></canvas>
    <p id="placeholder" class="placeholder">Conecta el escáner para ver la vista previa.</p>
    <p id="clip-warning" class="warning" hidden>Hay zonas saturadas: baja la exposición.</p>
  </section>

  <aside class="controls">
    <h1>Memor-ease</h1>
    <p id="status" class="status" role="status"></p>
    <p id="message" class="error" hidden></p>
    <button id="connect" type="button">Conectar escáner</button>

    <h2>Destino</h2>
    <button id="folder" type="button">Elegir carpeta</button>
    <p id="folder-name" class="hint"></p>
    <button id="regrant" type="button" hidden>Reactivar permiso de la carpeta</button>
    <label class="field">Rollo
      <input id="roll" type="text" maxlength="40" autocomplete="off" spellcheck="false">
    </label>
    <p id="roll-error" class="error" hidden>Usa letras, números, espacios, guiones o guiones bajos (1 a 40), sin espacios al inicio ni al final.</p>

    <h2>Película</h2>
    <fieldset class="choices">
      <label><input type="radio" name="film" value="color-negative"> Negativo color</label>
      <label><input type="radio" name="film" value="bw-negative"> Negativo B/N</label>
      <label><input type="radio" name="film" value="slide"> Diapositiva</label>
    </fieldset>
    <label class="check"><input id="rotate" type="checkbox"> Rotar 180°</label>
    <label class="check"><input id="mirror" type="checkbox"> Espejo</label>

    <h2>Exposición</h2>
    <label id="exposure-row" class="field">Exposición <output id="exposure-value"></output>
      <input id="exposure" type="range" min="-90" max="90" step="5">
    </label>
    <button id="lock" type="button" aria-pressed="false">Fijar exposición y color</button>

    <h2>Captura</h2>
    <button id="capture" type="button" class="primary">Capturar</button>
    <p class="hint">También con la barra espaciadora o el botón del escáner.</p>
    <p id="next-name" class="hint"></p>
    <button id="undo" type="button">Deshacer última</button>
  </aside>

  <section id="strip" class="strip" aria-label="Capturas de esta sesión"></section>
</main>
`;

export interface View {
  status: HTMLElement;
  message: HTMLElement;
  preview: HTMLCanvasElement;
  placeholder: HTMLElement;
  clipWarning: HTMLElement;
  connect: HTMLButtonElement;
  folder: HTMLButtonElement;
  folderName: HTMLElement;
  regrant: HTMLButtonElement;
  roll: HTMLInputElement;
  rollError: HTMLElement;
  film: HTMLInputElement[];
  rotate: HTMLInputElement;
  mirror: HTMLInputElement;
  exposureRow: HTMLElement;
  exposure: HTMLInputElement;
  exposureValue: HTMLElement;
  lock: HTMLButtonElement;
  capture: HTMLButtonElement;
  undo: HTMLButtonElement;
  nextName: HTMLElement;
  strip: HTMLElement;
}

export function createView(root: HTMLElement): View {
  root.innerHTML = TEMPLATE;
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`missing element ${selector}`);
    return element;
  };
  return {
    status: find('#status'),
    message: find('#message'),
    preview: find('#preview'),
    placeholder: find('#placeholder'),
    clipWarning: find('#clip-warning'),
    connect: find('#connect'),
    folder: find('#folder'),
    folderName: find('#folder-name'),
    regrant: find('#regrant'),
    roll: find('#roll'),
    rollError: find('#roll-error'),
    film: [...root.querySelectorAll<HTMLInputElement>('input[name="film"]')],
    rotate: find('#rotate'),
    mirror: find('#mirror'),
    exposureRow: find('#exposure-row'),
    exposure: find('#exposure'),
    exposureValue: find('#exposure-value'),
    lock: find('#lock'),
    capture: find('#capture'),
    undo: find('#undo'),
    nextName: find('#next-name'),
    strip: find('#strip'),
  };
}
```

- [ ] **Step 7: Implementar `src/ui/app.ts`**

```ts
// Screen controller: owns the state and wires the scanner, the development worker and the folder.
import type { Frame } from '../device/frames';
import { Scanner, SENSOR_CAPS } from '../device/scanner';
import { DevelopClient } from '../image/client';
import { CLIP_WARN_FRACTION, type FilmType, type Levels } from '../image/develop';
import type { DevelopParams } from '../image/pipeline';
import { canWrite, loadSavedFolder, pickFolder, requestWrite, RollFolder } from '../storage/folder';
import { isValidRoll } from '../storage/naming';
import { loadSettings, saveSettings, type Settings } from './settings';
import { createView, type View } from './view';

type Status = 'unsupported' | 'disconnected' | 'connecting' | 'live' | 'capturing' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  unsupported: 'Este navegador no tiene WebUSB. Abre la app en Chrome, Edge o Chromium.',
  disconnected: 'Escáner desconectado.',
  connecting: 'Conectando e inicializando el sensor…',
  live: 'En vivo.',
  capturing: 'Capturando…',
  error: 'Error del escáner.',
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class App {
  private readonly view: View;
  private readonly client = new DevelopClient();
  private readonly settings: Settings;
  /** Thumbnails of this session, by capture name. */
  private readonly shots = new Map<string, HTMLElement>();
  private status: Status = 'disconnected';
  private message: string | null = null;
  /** The device of the current or failed session; null once it is unplugged. */
  private device: USBDevice | null = null;
  private scanner: Scanner | null = null;
  private base: FileSystemDirectoryHandle | null = null;
  private baseWritable = false;
  private rollFolder: RollFolder | null = null;
  private rollRequest = 0;
  private lastLevels: Levels | null = null;
  private lockedLevels: Levels | null = null;
  private captureRequestedAt: number | null = null;

  constructor(root: HTMLElement) {
    this.view = createView(root);
    this.settings = loadSettings(localStorage);
    this.fillInputs();
    this.bind();
    this.render();
  }

  async init(): Promise<void> {
    if (!Scanner.supported()) {
      this.setStatus('unsupported');
      return;
    }
    navigator.usb.addEventListener('disconnect', (event) => {
      if (event.device === this.device) void this.onUnplugged();
    });
    await this.restoreFolder();
    const device = await Scanner.findGranted();
    if (device) await this.connect(device);
  }

  // ---- scanner session ----

  private async onConnectClick(): Promise<void> {
    const device = (await Scanner.findGranted()) ?? (await Scanner.request().catch(() => null));
    if (device) await this.connect(device);
  }

  private async connect(device: USBDevice): Promise<void> {
    if (this.scanner || this.status === 'connecting') return;
    this.device = device;
    this.message = null;
    this.setStatus('connecting');
    const scanner = new Scanner(device, {
      onFrame: (frame) => void this.onFrame(frame),
      onButton: () => this.requestCapture(),
      onError: (error) => void this.fail(error),
    });
    this.scanner = scanner;
    try {
      await scanner.open();
      if (SENSOR_CAPS.exposureTarget) await scanner.setExposureTarget(this.settings.exposure);
      await scanner.start();
      this.setStatus('live');
    } catch (error) {
      await this.fail(error);
    }
  }

  private async teardown(): Promise<void> {
    const scanner = this.scanner;
    this.scanner = null;
    this.captureRequestedAt = null;
    this.lastLevels = null;
    this.lockedLevels = null;
    if (scanner) await scanner.close().catch(() => {});
  }

  private async fail(error: unknown): Promise<void> {
    if (!this.device) return; // already handled as an unplug
    await this.teardown();
    if (!this.device) return; // unplugged while closing
    this.message = messageOf(error);
    this.setStatus('error');
  }

  private async onUnplugged(): Promise<void> {
    this.device = null;
    await this.teardown();
    this.message = null;
    this.setStatus('disconnected');
  }

  // ---- frames ----

  private params(): DevelopParams {
    const { film, rotate180, mirror } = this.settings;
    return { film, orientation: { rotate180, mirror }, lockedLevels: this.lockedLevels };
  }

  private async onFrame(frame: Frame): Promise<void> {
    if (!this.scanner) return;
    const params = this.params();
    // Only a frame that started after the trigger is captured, so the film was already still.
    if (this.captureRequestedAt !== null && frame.startedAt >= this.captureRequestedAt) {
      this.captureRequestedAt = null;
      await this.capture(frame, params);
      return;
    }
    const preview = await this.client.preview(frame.data, params).catch(() => null);
    if (!preview) return;
    if (!this.scanner) {
      preview.bitmap.close();
      return;
    }
    const first = this.lastLevels === null;
    this.lastLevels = preview.levels;
    this.showPreview(preview.bitmap, preview.clipped);
    if (first) this.render();
  }

  private showPreview(bitmap: ImageBitmap, clipped: number): void {
    const canvas = this.view.preview;
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    this.view.placeholder.hidden = true;
    this.view.clipWarning.hidden = clipped <= CLIP_WARN_FRACTION;
  }

  // ---- capture ----

  private canCapture(): boolean {
    return this.status === 'live' && this.baseWritable && this.rollFolder !== null;
  }

  private requestCapture(): void {
    if (!this.canCapture()) return;
    this.captureRequestedAt = performance.now();
    this.setStatus('capturing');
  }

  private async capture(frame: Frame, params: DevelopParams): Promise<void> {
    const folder = this.rollFolder;
    try {
      if (!folder) throw new Error('no hay carpeta de destino');
      const shot = await this.client.capture(frame.data, params);
      const name = await folder.save(shot.jpeg, shot.dng);
      this.addShot(name, shot.thumbnail);
      this.message = null;
    } catch (error) {
      this.message = `No se pudo guardar la captura: ${messageOf(error)}`;
    }
    if (this.status === 'capturing') this.setStatus('live');
    else this.render();
  }

  private addShot(name: string, thumbnail: ImageBitmap): void {
    const figure = document.createElement('figure');
    const canvas = document.createElement('canvas');
    canvas.width = thumbnail.width;
    canvas.height = thumbnail.height;
    canvas.getContext('2d')!.drawImage(thumbnail, 0, 0);
    thumbnail.close();
    const caption = document.createElement('figcaption');
    caption.textContent = name;
    figure.append(canvas, caption);
    this.view.strip.prepend(figure);
    this.shots.set(name, figure);
  }

  private async undo(): Promise<void> {
    if (this.status === 'capturing' || !this.rollFolder?.canUndo) return;
    try {
      const name = await this.rollFolder.undoLast();
      this.shots.get(name)?.remove();
      this.shots.delete(name);
      this.message = null;
    } catch (error) {
      this.message = `No se pudo deshacer: ${messageOf(error)}`;
    }
    this.render();
  }

  // ---- exposure and lock ----

  private async toggleLock(): Promise<void> {
    if (this.lockedLevels) {
      await this.unlock();
      return;
    }
    if (!this.scanner || !this.lastLevels) return;
    this.lockedLevels = this.lastLevels;
    if (SENSOR_CAPS.freeze) await this.scanner.setAutoModes(false).catch((error) => this.report(error));
    this.render();
  }

  private async unlock(): Promise<void> {
    if (!this.lockedLevels) return;
    this.lockedLevels = null;
    if (SENSOR_CAPS.freeze && this.scanner) await this.scanner.setAutoModes(true).catch((error) => this.report(error));
    this.render();
  }

  private async onExposureChange(value: number): Promise<void> {
    this.updateSettings({ exposure: value });
    if (this.scanner && SENSOR_CAPS.exposureTarget) {
      await this.scanner.setExposureTarget(value).catch((error) => this.report(error));
    }
  }

  private async onFilmChange(film: FilmType): Promise<void> {
    this.updateSettings({ film });
    await this.unlock();
  }

  // ---- folder ----

  private async restoreFolder(): Promise<void> {
    this.base = await loadSavedFolder().catch(() => null);
    if (this.base) this.baseWritable = await canWrite(this.base);
    await this.openRoll();
  }

  private async onFolderClick(): Promise<void> {
    try {
      this.base = await pickFolder();
      this.baseWritable = true;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) this.report(error);
      return;
    }
    await this.openRoll();
  }

  private async onRegrantClick(): Promise<void> {
    if (!this.base) return;
    this.baseWritable = await requestWrite(this.base);
    await this.openRoll();
  }

  private async onRollChange(): Promise<void> {
    if (isValidRoll(this.view.roll.value)) this.updateSettings({ roll: this.view.roll.value });
    await this.openRoll();
  }

  /** Reads the roll's folder to find the next file number. The latest call wins. */
  private async openRoll(): Promise<void> {
    const request = ++this.rollRequest;
    const name = this.view.roll.value;
    let folder: RollFolder | null = null;
    if (this.base && this.baseWritable && isValidRoll(name)) {
      try {
        folder = await RollFolder.open(this.base, name);
      } catch (error) {
        this.message = `No se pudo leer la carpeta del rollo: ${messageOf(error)}`;
      }
    }
    if (request !== this.rollRequest) return;
    this.rollFolder = folder;
    this.render();
  }

  // ---- wiring and rendering ----

  private fillInputs(): void {
    const v = this.view;
    const s = this.settings;
    v.roll.value = s.roll;
    for (const radio of v.film) radio.checked = radio.value === s.film;
    v.rotate.checked = s.rotate180;
    v.mirror.checked = s.mirror;
    v.exposure.value = String(s.exposure);
  }

  private bind(): void {
    const v = this.view;
    v.connect.addEventListener('click', () => void this.onConnectClick());
    v.folder.addEventListener('click', () => void this.onFolderClick());
    v.regrant.addEventListener('click', () => void this.onRegrantClick());
    v.roll.addEventListener('input', () => this.render());
    v.roll.addEventListener('change', () => void this.onRollChange());
    for (const radio of v.film) radio.addEventListener('change', () => void this.onFilmChange(radio.value as FilmType));
    v.rotate.addEventListener('change', () => this.updateSettings({ rotate180: v.rotate.checked }));
    v.mirror.addEventListener('change', () => this.updateSettings({ mirror: v.mirror.checked }));
    v.exposure.addEventListener('input', () => {
      v.exposureValue.textContent = v.exposure.value;
    });
    v.exposure.addEventListener('change', () => void this.onExposureChange(Number(v.exposure.value)));
    v.lock.addEventListener('click', () => void this.toggleLock());
    v.capture.addEventListener('click', () => this.requestCapture());
    v.undo.addEventListener('click', () => void this.undo());
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input[type="text"], textarea, select')) return;
    event.preventDefault();
    this.requestCapture();
  }

  private updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    saveSettings(localStorage, this.settings);
    this.render();
  }

  private report(error: unknown): void {
    this.message = messageOf(error);
    this.render();
  }

  private setStatus(status: Status): void {
    this.status = status;
    this.render();
  }

  private render(): void {
    const v = this.view;
    const locked = this.lockedLevels !== null;
    const streaming = this.status === 'live' || this.status === 'capturing';
    document.body.dataset.status = this.status;
    v.status.textContent = STATUS_TEXT[this.status];
    v.message.textContent = this.message ?? '';
    v.message.hidden = this.message === null;
    v.connect.hidden = streaming || this.status === 'unsupported';
    v.connect.disabled = this.status === 'connecting';
    v.connect.textContent = this.status === 'error' ? 'Reintentar' : 'Conectar escáner';
    v.folderName.textContent = this.base ? `Carpeta: ${this.base.name}` : 'Sin carpeta elegida.';
    v.regrant.hidden = !this.base || this.baseWritable;
    v.rollError.hidden = isValidRoll(v.roll.value);
    v.exposureRow.hidden = !SENSOR_CAPS.exposureTarget;
    v.exposure.disabled = !streaming || (SENSOR_CAPS.freeze && locked);
    v.exposureValue.textContent = v.exposure.value;
    v.lock.disabled = this.status !== 'live' || (!locked && !this.lastLevels);
    v.lock.setAttribute('aria-pressed', String(locked));
    v.lock.textContent = locked ? 'Soltar exposición y color' : 'Fijar exposición y color';
    v.capture.disabled = !this.canCapture();
    v.undo.disabled = this.status === 'capturing' || !this.rollFolder?.canUndo;
    v.nextName.textContent = this.rollFolder ? `Siguiente: ${this.rollFolder.nextName}` : '';
    if (!streaming) {
      v.placeholder.hidden = false;
      v.clipWarning.hidden = true;
    }
  }
}
```

- [ ] **Step 8: Crear `src/main.ts`**

```ts
import './styles.css';
import { App } from './ui/app';

const app = new App(document.querySelector<HTMLElement>('#app')!);
void app.init();
```

- [ ] **Step 9: Crear `src/styles.css`**

```css
:root {
  color-scheme: dark;
  --bg: #16181b;
  --panel: #1f2226;
  --line: #33383f;
  --text: #e6e8eb;
  --muted: #9aa1ab;
  --accent: #f0a23b;
  --danger: #ff7a6b;
  font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

* {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
}

.stage {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 16px;
}

#preview {
  max-width: 100%;
  max-height: 100%;
  background: #000;
}

.placeholder {
  position: absolute;
  margin: 0;
  color: var(--muted);
}

.warning {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 6px 12px;
  border-radius: 4px;
  background: var(--danger);
  color: #1a0d0a;
  font-weight: 600;
}

.controls {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 16px;
  border-left: 1px solid var(--line);
  background: var(--panel);
}

.controls h1 {
  margin: 0;
  font-size: 18px;
}

.controls h2 {
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.controls p {
  margin: 0;
}

.status {
  color: var(--muted);
}

.hint {
  color: var(--muted);
  font-size: 13px;
}

.error {
  color: var(--danger);
  font-size: 13px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.check,
.choices label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 0;
}

button,
input[type='text'] {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #2a2e34;
  color: var(--text);
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: default;
  opacity: 0.45;
}

button[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent);
}

button.primary {
  padding: 14px 10px;
  border-color: var(--accent);
  background: var(--accent);
  color: #1b1408;
  font-size: 17px;
  font-weight: 700;
}

body[data-status='capturing'] button.primary {
  opacity: 0.6;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.strip {
  grid-column: 1;
  display: flex;
  gap: 8px;
  min-height: 132px;
  overflow-x: auto;
  padding: 8px 16px;
  border-top: 1px solid var(--line);
}

.strip figure {
  flex: none;
  margin: 0;
}

.strip canvas {
  display: block;
  width: auto;
  height: 96px;
}

.strip figcaption {
  color: var(--muted);
  font-size: 11px;
}
```

- [ ] **Step 10: Comprobar tipos, pruebas y build**

Run: `npm run typecheck`
Expected: sin errores. Si TypeScript rechaza `RollFolder.open(this.base, name)` porque `FileSystemDirectoryHandle` no encaja con `DirectoryLike`, importar el tipo `DirectoryLike` de `../storage/folder` y pasar `this.base as unknown as DirectoryLike`.

Run: `npm test`
Expected: PASS en los 13 archivos de prueba.

Run: `npm run build`
Expected: termina sin errores y genera `dist/index.html` más un archivo de worker en `dist/assets/`.

- [ ] **Step 11: Probar la app real con el aparato**

Run: `npm run hw -- app`
Expected: código de salida 0 y la línea `app is live, preview 1296x840`.

El arnés no tiene carpeta guardada ni puede abrir el selector, así que este escenario solo cubre conexión y vista previa. La captura a carpeta se comprueba en la aceptación manual de la Task 14.

- [ ] **Step 12: Commit**

```bash
git add index.html src/main.ts src/styles.css src/ui/settings.ts src/ui/settings.test.ts src/ui/view.ts src/ui/app.ts
git commit -m "feat: add the scanning screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Documentación, licencia y aceptación

**Files:**
- Create: `README.md`, `LICENSE`
- Modify: `.claude/launch.json`, `.gitignore`
- Delete: `spike/` (solo con el visto bueno del usuario)

**Interfaces:**
- Consumes: los valores de `SENSOR_CAPS` anotados en la Task 11.
- Produces: nada que otra tarea use.

- [ ] **Step 1: Descargar el texto de la licencia**

Run: `curl -sSL https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt -o LICENSE && head -3 LICENSE`
Expected: las primeras líneas contienen `GNU GENERAL PUBLIC LICENSE` y `Version 2, June 1991`.

- [ ] **Step 2: Reemplazar `.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 3: Crear `README.md`**

En la sección «Controles del sensor» va una frase por control, elegida según `SENSOR_CAPS`:

- `exposureTarget: true`: «El deslizador de exposición mueve el objetivo de exposición automática del sensor. Verificado en el aparato.»
- `exposureTarget: false`: «El objetivo de exposición del sensor no respondió en la verificación con el aparato, así que la app no muestra el deslizador.»
- `freeze: true`: «**Fijar exposición y color** congela los niveles del revelado y también la exposición, la ganancia y el balance de blancos del sensor. Verificado en el aparato.»
- `freeze: false`: «**Fijar exposición y color** congela solo los niveles del revelado: el sensor no respondió al congelado en la verificación con el aparato.»

````markdown
# Memor-ease

App web para escanear película de 35 mm con el Memor-ease CS500 de Pacific Image, sin su software
original. Habla con el escáner por WebUSB, muestra la vista previa ya revelada y guarda cada foto en
una carpeta como JPEG más DNG.

## Requisitos

- Chrome, Edge o Chromium de escritorio. Safari y Firefox no tienen WebUSB; iOS y Android no sirven.
- Node 24 para correr el servidor local.

## Uso

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

1. **Conectar escáner** y elige `USB Camera`.
2. **Elegir carpeta** de destino. Cada rollo se guarda en una subcarpeta con su nombre.
3. Elige el tipo de película y, si hace falta, rota o refleja la imagen.
4. Captura con el botón del escáner, la barra espaciadora o el botón **Capturar**. Avanza la tira y
   repite.

Cada captura produce `<rollo>_<número>.jpg` y `<rollo>_<número>.dng`. El DNG guarda los datos del
sensor sin procesar y se abre en Lightroom, darktable o RawTherapee; un negativo se abre como
negativo y se invierte ahí. El color automático del JPEG es aproximado: para color fino, usa el DNG.

**Deshacer última** borra el par de archivos de la captura más reciente.

## Controles del sensor

<una frase por control, según las reglas de arriba>

Si la vista previa avisa de zonas saturadas, baja la exposición: la base de la película está
quemando el sensor y se pierde detalle en las sombras.

## Problemas conocidos

- **El selector de dispositivos sale vacío.** Si otro programa tocó el escáner mientras el navegador
  lo enumeraba, el navegador lo descarta hasta reiniciarse. Cierra el navegador por completo y
  vuelve a abrirlo.
- **Solo un programa a la vez.** Si la app está abierta en dos pestañas, o corre el arnés de pruebas,
  la segunda no puede conectar.
- **Hay que volver a elegir el escáner** después de reconectarlo o de reiniciar el navegador. El
  aparato no tiene número de serie y el navegador no puede recordar el permiso.
- **La carpeta pide permiso otra vez** al volver a abrir la app. Es un clic en «Reactivar permiso de
  la carpeta».

## Desarrollo

```bash
npm test                 # pruebas unitarias
npm run typecheck
npm run build            # página estática en dist/
npm run hw -- stream     # pruebas con el aparato conectado: stream, sensor, capture, app
```

Las pruebas con el aparato corren la página dentro de Electron, que se concede el permiso USB sin
mostrar el selector. Dejan sus archivos en `tools/hw-harness/out/`.

El diseño está en `docs/superpowers/specs/2026-10-07-memorease-webusb-design.md`.

## Créditos y licencia

El protocolo USB, la secuencia de inicialización y las tablas de registros vienen del driver
`gspca/ov534_9.c` del kernel de Linux, de Jean-Francois Moine, Antonio Ospite y Jim Paris.

GPL-2.0-or-later. Ver `LICENSE`.
````

- [ ] **Step 4: Verificación final automática**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo pasa.

Run: `npm run hw -- stream && npm run hw -- capture && npm run hw -- app`
Expected: los tres escenarios salen con código 0.

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE .claude/launch.json
git commit -m "docs: add README, license and dev server launch config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Aceptación manual con el usuario**

Arrancar `npm run dev` y pedir al usuario que haga esto en Chromium, en `http://localhost:5173`, y reporte cada punto:

1. **Conectar escáner** muestra `USB Camera` y, tras unos 3 s, aparece la vista previa en positivo.
2. **Elegir carpeta** abre el selector; después se ve el nombre de la carpeta y `Siguiente: rollo-01_0001`.
3. Tres pulsaciones del botón físico del escáner producen tres miniaturas y, en la carpeta, `rollo-01/rollo-01_0001` a `0003`, cada uno en `.jpg` y `.dng`.
4. La barra espaciadora captura; al escribir en el campo «Rollo», no.
5. **Deshacer última** quita la miniatura y borra el par `0004`; la siguiente captura vuelve a ser `0004`.
6. Recargar la página: la app reconecta sola, pide reactivar el permiso de la carpeta con un clic, y la numeración continúa.
7. Cambiar a «Negativo B/N» da una vista previa gris; «Diapositiva» la deja sin invertir.
8. **Fijar exposición y color** mantiene el mismo aspecto al mover la tira; el botón pasa a «Soltar exposición y color».
9. Desconectar el cable pasa el estado a «Escáner desconectado»; al reconectar y pulsar **Conectar escáner**, vuelve la vista previa.

Cada punto que falle se corrige con una prueba que lo reproduzca antes de dar la tarea por terminada.

- [ ] **Step 7: Retirar la prueba de factibilidad**

`spike/` contiene el código desechable y, en `spike/out/`, fotos del usuario. Preguntar al usuario si se puede borrar. Solo con su sí:

Run: `rm -rf spike`

Quitar de `.gitignore` las dos líneas de `spike/`, de modo que quede:

```
node_modules/
dist/
tools/hw-harness/out/
```

```bash
git add .gitignore
git commit -m "chore: drop the feasibility spike" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Si el usuario prefiere conservarla, no se toca nada y este paso queda cerrado.
