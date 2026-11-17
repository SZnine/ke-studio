/** Browser-only connection details; neither keys nor folder handles are deployed. */
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("ke-studio-local", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function preference<T>(key: string): Promise<T | undefined> {
  const store = (await db()).transaction("settings").objectStore("settings");
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function savePreference(key: string, value: unknown) {
  const transaction = (await db()).transaction("settings", "readwrite");
  const store = transaction.objectStore("settings");
  if (value === undefined) store.delete(key);
  else store.put(value, key);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
