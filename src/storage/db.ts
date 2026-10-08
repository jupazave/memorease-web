// Small key-value store in IndexedDB for things that must survive a reload and that localStorage
// cannot hold: the folder handle and the lamp reference.

const DB_NAME = 'memorease';
// The store predates the lamp reference, hence its name.
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function dbGet<T>(key: string): Promise<T | null> {
  return ((await withStore('readonly', (store) => store.get(key))) as T | undefined) ?? null;
}

export async function dbPut(key: string, value: unknown): Promise<void> {
  await withStore('readwrite', (store) => store.put(value, key));
}

export async function dbDelete(key: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(key));
}
