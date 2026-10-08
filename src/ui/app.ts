// Screen controller: owns the state and wires the scanner, the development worker and the folder.
import type { Frame } from '../device/frames';
import { Scanner, SENSOR_CAPS } from '../device/scanner';
import { FRAME_HEIGHT, FRAME_WIDTH } from '../frame';
import { DevelopClient } from '../image/client';
import { CLIP_WARN_FRACTION, type FilmType, type Levels } from '../image/develop';
import { checkCalibration, FLAT_FRAMES, type FlatCalibration, type FlatProblem } from '../image/flatfield';
import type { DevelopParams } from '../image/pipeline';
import { dbDelete, dbGet, dbPut } from '../storage/db';
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

const FLAT_KEY = 'flat';

const FLAT_PROBLEM_TEXT: Record<FlatProblem, string> = {
  dark: 'Casi no llega luz al sensor. Revisa que el escáner esté vacío y vuelve a calibrar.',
  saturated: 'La luz satura el sensor. Baja la exposición y vuelve a calibrar.',
  uneven: 'Parece que hay película puesta: la luz no es pareja. Vacía el escáner y vuelve a calibrar.',
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
  /** The lamp reference in use, if any. */
  private flat: FlatCalibration | null = null;
  /** Blank frames being collected for a new lamp reference. */
  private flatFrames: { since: number; frames: Uint8Array<ArrayBuffer>[] } | null = null;
  private calibrating = false;

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
    await this.restoreFlat();
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
    this.flatFrames = null;
    this.calibrating = false;
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
    const collecting = this.flatFrames;
    if (collecting && frame.startedAt >= collecting.since) {
      collecting.frames.push(frame.data);
      if (collecting.frames.length < FLAT_FRAMES) return;
      this.flatFrames = null;
      await this.finishCalibration(collecting.frames);
      return;
    }
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
    return this.status === 'live' && !this.calibrating && this.baseWritable && this.rollFolder !== null;
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

  // ---- lamp calibration ----

  private async restoreFlat(): Promise<void> {
    const saved = await dbGet<FlatCalibration>(FLAT_KEY).catch(() => null);
    if (!saved || saved.width !== FRAME_WIDTH || saved.height !== FRAME_HEIGHT) return;
    await this.client.setFlat(saved);
    this.flat = saved;
    this.render();
  }

  /** Starts collecting blank frames; onFrame() finishes the job. */
  private onCalibrateClick(): void {
    if (this.status !== 'live' || this.calibrating) return;
    this.calibrating = true;
    this.message = null;
    this.flatFrames = { since: performance.now(), frames: [] };
    this.render();
  }

  private async finishCalibration(frames: Uint8Array<ArrayBuffer>[]): Promise<void> {
    try {
      const calibration = await this.client.calibrate(frames);
      const problem = checkCalibration(calibration);
      if (problem) {
        this.message = FLAT_PROBLEM_TEXT[problem];
        return;
      }
      // Levels locked under the previous correction no longer match.
      await this.unlock();
      await this.client.setFlat(calibration);
      this.flat = calibration;
      this.message = null;
      await dbPut(FLAT_KEY, calibration).catch(() => {
        this.message = 'La calibración se aplicó, pero no se pudo guardar: se perderá al recargar.';
      });
    } catch (error) {
      this.message = `No se pudo calibrar la luz: ${messageOf(error)}`;
    } finally {
      this.calibrating = false;
      this.render();
    }
  }

  private async onFlatClearClick(): Promise<void> {
    if (!this.flat || this.calibrating) return;
    try {
      await this.unlock();
      await this.client.setFlat(null);
      this.flat = null;
      await dbDelete(FLAT_KEY);
    } catch (error) {
      this.report(error);
    }
    this.render();
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
    v.calibrate.addEventListener('click', () => this.onCalibrateClick());
    v.flatClear.addEventListener('click', () => void this.onFlatClearClick());
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
    v.lock.disabled = this.status !== 'live' || this.calibrating || (!locked && !this.lastLevels);
    v.lock.setAttribute('aria-pressed', String(locked));
    v.lock.textContent = locked ? 'Soltar exposición y color' : 'Fijar exposición y color';
    v.calibrate.disabled = this.status !== 'live' || this.calibrating;
    v.calibrate.textContent = this.calibrating ? 'Calibrando…' : this.flat ? 'Volver a calibrar luz' : 'Calibrar luz';
    v.flatStatus.textContent = this.flat
      ? `Luz calibrada el ${new Date(this.flat.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}.`
      : 'Sin calibrar. Hazlo con el escáner vacío, sin película ni portanegativos.';
    v.flatClear.hidden = !this.flat;
    v.flatClear.disabled = this.calibrating;
    v.capture.disabled = !this.canCapture();
    v.undo.disabled = this.status === 'capturing' || !this.rollFolder?.canUndo;
    v.nextName.textContent = this.rollFolder ? `Siguiente: ${this.rollFolder.nextName}` : '';
    if (!streaming) {
      v.placeholder.hidden = false;
      v.clipWarning.hidden = true;
    }
  }
}
