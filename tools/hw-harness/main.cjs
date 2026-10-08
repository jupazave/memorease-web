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
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { backgroundThrottling: false } });
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
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, base64] of Object.entries(result.files || {})) {
    fs.writeFileSync(path.join(outDir, path.basename(name)), Buffer.from(base64, 'base64'));
  }
  if (process.env.HW_SCREENSHOT) {
    fs.writeFileSync(path.join(outDir, process.env.HW_SCREENSHOT), (await win.webContents.capturePage()).toPNG());
  }
  app.exit(result.ok ? 0 : 1);
});
