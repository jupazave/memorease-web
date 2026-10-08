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
  ...(scenario === 'app' ? { HW_POLL: APP_POLL, HW_SCREENSHOT: 'app.png' } : {}),
};
// require('electron') from Node resolves to the path of the Electron binary.
const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [path.join(here, 'main.cjs')], { env, stdio: 'inherit' });
const code = await new Promise((resolve) => child.on('exit', resolve));
await server.close();
process.exit(code ?? 1);
