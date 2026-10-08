import { describe, expect, it } from 'vitest';
import { RollFolder, type DirectoryLike } from './folder';

class FakeDir implements DirectoryLike {
  files = new Map<string, Blob | BufferSource>();
  dirs = new Map<string, FakeDir>();
  /** Writing a file with this name fails. */
  failOn: string | null = null;

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options?.create) throw new Error('NotFoundError');
      dir = new FakeDir();
      dir.failOn = this.failOn;
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error('NotFoundError');
      this.files.set(name, new Uint8Array(0));
    }
    return {
      createWritable: async () => ({
        write: async (data: Blob | BufferSource) => {
          if (name === this.failOn) throw new Error('disk full');
          this.files.set(name, data);
        },
        close: async () => {},
      }),
    };
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new Error('NotFoundError');
  }

  async *keys(): AsyncGenerator<string> {
    yield* this.files.keys();
    yield* this.dirs.keys();
  }
}

const jpeg = new Blob(['jpeg']);
const dng = Uint8Array.of(1, 2, 3);

describe('RollFolder', () => {
  it('starts at 0001 and does not create the subfolder until the first save', async () => {
    const base = new FakeDir();
    const roll = await RollFolder.open(base, 'rollo-01');
    expect(roll.nextName).toBe('rollo-01_0001');
    expect(base.dirs.has('rollo-01')).toBe(false);
  });

  it('writes the DNG and the JPEG and advances', async () => {
    const base = new FakeDir();
    const roll = await RollFolder.open(base, 'rollo-01');
    expect(await roll.save(jpeg, dng)).toBe('rollo-01_0001');
    const dir = base.dirs.get('rollo-01')!;
    expect(dir.files.get('rollo-01_0001.dng')).toBe(dng);
    expect(dir.files.get('rollo-01_0001.jpg')).toBe(jpeg);
    expect(roll.nextName).toBe('rollo-01_0002');
  });

  it('continues numbering after existing files', async () => {
    const base = new FakeDir();
    const dir = await base.getDirectoryHandle('rollo-01', { create: true });
    dir.files.set('rollo-01_0004.jpg', jpeg);
    dir.files.set('rollo-01_0004.dng', dng);
    expect((await RollFolder.open(base, 'rollo-01')).nextName).toBe('rollo-01_0005');
  });

  it('leaves nothing behind and does not advance when the JPEG fails', async () => {
    const base = new FakeDir();
    base.failOn = 'rollo-01_0001.jpg';
    const roll = await RollFolder.open(base, 'rollo-01');
    await expect(roll.save(jpeg, dng)).rejects.toThrow('disk full');
    expect([...base.dirs.get('rollo-01')!.files.keys()]).toEqual([]);
    expect(roll.nextName).toBe('rollo-01_0001');
    expect(roll.canUndo).toBe(false);
  });

  it('undoes the last capture once and reuses its number', async () => {
    const base = new FakeDir();
    const roll = await RollFolder.open(base, 'rollo-01');
    await roll.save(jpeg, dng);
    await roll.save(jpeg, dng);
    expect(roll.canUndo).toBe(true);
    expect(await roll.undoLast()).toBe('rollo-01_0002');
    expect([...base.dirs.get('rollo-01')!.files.keys()].sort()).toEqual(['rollo-01_0001.dng', 'rollo-01_0001.jpg']);
    expect(roll.nextName).toBe('rollo-01_0002');
    expect(roll.canUndo).toBe(false);
    await expect(roll.undoLast()).rejects.toThrow();
  });
});
