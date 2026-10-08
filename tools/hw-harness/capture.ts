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
