// Scenario: with NOTHING in the scanner, a lamp reference evens out a later blank frame, and the
// worker keeps developing previews and captures with the correction on.
import type { Frame } from '../../src/device/frames';
import { Scanner } from '../../src/device/scanner';
import { FRAME_HEIGHT, FRAME_WIDTH } from '../../src/frame';
import { DevelopClient } from '../../src/image/client';
import { applyFlat, checkCalibration, expandGains, FLAT_FRAMES } from '../../src/image/flatfield';
import type { DevelopParams } from '../../src/image/pipeline';
import type { HwContext } from './page';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Largest deviation from even light over an 8 x 6 grid, per colour, as a fraction. */
function unevenness(raw: Uint8Array): number[] {
  const GX = 8;
  const GY = 6;
  const sum = [new Float64Array(GX * GY), new Float64Array(GX * GY), new Float64Array(GX * GY)];
  const count = [new Uint32Array(GX * GY), new Uint32Array(GX * GY), new Uint32Array(GX * GY)];
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const colour = (y & 1) === 0 ? ((x & 1) === 0 ? 2 : 1) : (x & 1) === 0 ? 1 : 0;
      const cell = Math.floor((y * GY) / FRAME_HEIGHT) * GX + Math.floor((x * GX) / FRAME_WIDTH);
      sum[colour][cell] += raw[y * FRAME_WIDTH + x];
      count[colour][cell]++;
    }
  }
  return sum.map((s, c) => {
    const means = Array.from(s, (v, i) => v / count[c][i]);
    const lo = Math.min(...means);
    const hi = Math.max(...means);
    return (hi - lo) / (hi + lo);
  });
}

const percent = (values: number[]) => values.map((v) => `${(v * 100).toFixed(1)}%`).join(' / ');

export default async function flat(ctx: HwContext): Promise<void> {
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
  const params: DevelopParams = { film: 'color-negative', orientation: { rotate180: false, mirror: false }, lockedLevels: null };

  try {
    await scanner.open();
    await scanner.start();
    await sleep(3000); // let auto exposure settle on the bare lamp

    const blanks: Frame[] = [];
    while (blanks.length < FLAT_FRAMES) blanks.push(await nextFrame());
    const calibration = await client.calibrate(blanks.map((frame) => frame.data));
    const problem = checkCalibration(calibration);
    if (problem === 'uneven') throw new Error('the scanner is not empty: remove the film and the holder to run this scenario');
    ctx.check(problem === null, `the blank frames make a usable reference (${problem ?? 'ok'})`);

    const later = (await nextFrame()).data;
    const before = unevenness(later);
    const after = unevenness(applyFlat(later, expandGains(calibration)));
    ctx.log(`unevenness R / G / B: ${percent(before)} before, ${percent(after)} after`);
    ctx.check(Math.max(...after) < 0.03, 'a later blank frame is even within 3% once corrected');
    ctx.check(Math.max(...after) < Math.max(...before) / 2, 'the correction at least halves the unevenness');

    await client.setFlat(calibration);
    const preview = await client.preview((await nextFrame()).data, params);
    ctx.check(preview !== null && preview.bitmap.width === 1296, 'the worker previews with the correction on');
    if (preview) ctx.check(preview.clipped < 0.01, `saturation is still measured on the sensor data (${(preview.clipped * 100).toFixed(2)}%)`);
    const shot = await client.capture((await nextFrame()).data, params);
    const decoded = await createImageBitmap(shot.jpeg);
    ctx.check(decoded.width === FRAME_WIDTH && decoded.height === FRAME_HEIGHT, 'the worker captures with the correction on');
    ctx.file('flat-capture.jpg', new Uint8Array(await shot.jpeg.arrayBuffer()));

    await client.setFlat(null);
    ctx.check((await client.preview((await nextFrame()).data, params)) !== null, 'the correction can be turned off');
    await scanner.stop();
  } finally {
    await scanner.close();
  }
}
