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
