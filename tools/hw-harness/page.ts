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
  sensor: () => import('./sensor'),
  capture: () => import('./capture'),
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
