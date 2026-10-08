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
