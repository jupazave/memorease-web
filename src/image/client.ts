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
