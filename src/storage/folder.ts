// Destination folder: remembered across sessions with IndexedDB, written with the File System
// Access API. Captures of a roll go to <base>/<roll>/<roll>_<index>.{dng,jpg}.
import { fileBase, nextIndex } from './naming';

export interface WritableLike {
  write(data: Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

export interface FileLike {
  createWritable(): Promise<WritableLike>;
}

/** The part of FileSystemDirectoryHandle this module uses, so tests can pass a fake. */
export interface DirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

export class RollFolder {
  private lastSaved: number | null = null;

  private constructor(
    private readonly base: DirectoryLike,
    private dir: DirectoryLike | null,
    readonly roll: string,
    private next: number,
  ) {}

  /** Reads the roll's subfolder if it exists. The subfolder is only created by the first save. */
  static async open(base: DirectoryLike, roll: string): Promise<RollFolder> {
    const dir = await base.getDirectoryHandle(roll).catch(() => null);
    const names: string[] = [];
    if (dir) for await (const name of dir.keys()) names.push(name);
    return new RollFolder(base, dir, roll, nextIndex(roll, names));
  }

  get nextName(): string {
    return fileBase(this.roll, this.next);
  }

  get canUndo(): boolean {
    return this.lastSaved !== null;
  }

  /** Writes the DNG and then the JPEG. When either write fails, no file of the pair is left. */
  async save(jpeg: Blob, dng: Uint8Array<ArrayBuffer>): Promise<string> {
    this.dir ??= await this.base.getDirectoryHandle(this.roll, { create: true });
    const dir = this.dir;
    const base = this.nextName;
    const started: string[] = [];
    try {
      for (const [name, data] of [[`${base}.dng`, dng], [`${base}.jpg`, jpeg]] as const) {
        started.push(name);
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write(data);
        await writable.close();
      }
    } catch (error) {
      for (const name of started) await dir.removeEntry(name).catch(() => {});
      throw error;
    }
    this.lastSaved = this.next;
    this.next++;
    return base;
  }

  /** Deletes the pair written by the last save() and frees its number. One level only. */
  async undoLast(): Promise<string> {
    if (this.lastSaved === null || !this.dir) throw new Error('No hay captura que deshacer');
    const base = fileBase(this.roll, this.lastSaved);
    await this.dir.removeEntry(`${base}.jpg`);
    await this.dir.removeEntry(`${base}.dng`);
    this.next = this.lastSaved;
    this.lastSaved = null;
    return base;
  }
}

const DB_NAME = 'memorease';
const STORE = 'handles';
const KEY = 'baseDir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The folder chosen in an earlier session, or null. Its permission may need to be requested again. */
export async function loadSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Opens the system folder picker and remembers the choice. Rejects when the user cancels. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: 'memorease', mode: 'readwrite' });
  await saveFolder(handle);
  return handle;
}

export async function canWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Must be called from a user gesture. */
export async function requestWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}
