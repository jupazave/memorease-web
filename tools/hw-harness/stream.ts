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
