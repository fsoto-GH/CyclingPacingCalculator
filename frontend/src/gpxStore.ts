/**
 * Thin IndexedDB wrapper for persisting the loaded GPX file across page
 * reloads.  localStorage is unsuitable for large race GPX files (5-10 MB)
 * due to the ~5 MB per-origin quota.
 *
 * Schema: one object store ("gpx"), single record with key "current".
 * Record shape: { fileName: string; xml: string }
 */

const DB_NAME = "ultra-cycling-planner-gpx";
const DB_VERSION = 1;
const STORE = "gpx";
const KEY = "current";

interface GpxRecord {
  fileName: string;
  xml: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the raw GPX XML and display filename (without .gpx extension).
 * Writes the record under two keys:
 *   - the filename itself, so it can be looked up by name on import
 *   - "current", so the mount-time restore always finds the latest file
 */
export async function saveGpx(fileName: string, xml: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const record: GpxRecord = { fileName, xml };
    store.put(record, fileName);
    store.put(record, KEY); // "current" — always points to the latest file
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Load a GPX record by key.
 * Pass a filename to look up a specific archived file (used by the import
 * flow), or omit the key to load the "current" record (used on mount).
 */
export async function loadGpx(key: string = KEY): Promise<GpxRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as GpxRecord) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** Remove the stored GPX record. */
export async function clearGpx(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
