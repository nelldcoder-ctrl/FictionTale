(() => {
  const DB_NAME = 'fictiontale-app-data';
  const STORE_NAME = 'records';
  const LARGE_RECORD_BYTES = 48 * 1024;
  const MARKER = '{"__fictionTaleIndexedDB":1}';
  const values = new Map();
  const generations = new Map();
  const writes = new Map();
  let database = null;

  function isAppKey(key) {
    return key.startsWith('FictionTales.') || key.startsWith('fable.');
  }

  function isMarker(raw) {
    return raw === MARKER;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is unavailable.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore(STORE_NAME);
      });
      request.addEventListener('success', () => {
        database = request.result;
        database.addEventListener('versionchange', () => database.close());
        resolve(database);
      });
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('blocked', () => reject(new Error('Opening IndexedDB was blocked.')));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => reject(request.error));
    });
  }

  function getRecord(key) {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    return requestResult(transaction.objectStore(STORE_NAME).get(key));
  }

  function putRecord(key, value) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.addEventListener('complete', resolve, { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB write was aborted.')), { once: true });
    });
  }

  function deleteRecord(key) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.addEventListener('complete', resolve, { once: true });
      transaction.addEventListener('error', () => reject(transaction.error), { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB delete was aborted.')), { once: true });
    });
  }

  function notifyError(key, error) {
    console.error(`Could not save "${key}" in IndexedDB.`, error);
    window.dispatchEvent(new CustomEvent('fictiontale-storage-error', {
      detail: { key, message: error instanceof Error ? error.message : String(error) },
    }));
  }

  function parseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async function migrateLegacyKeys() {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key && key.startsWith('fable.'));
    for (const legacyKey of keys) {
      try {
        const currentKey = `FictionTales.${legacyKey.slice('fable.'.length)}`;
        const legacyRaw = localStorage.getItem(legacyKey);
        if (legacyRaw === null) continue;
        const currentRaw = localStorage.getItem(currentKey);
        if (currentRaw !== null) {
          if (currentRaw === legacyRaw) {
            await deleteRecord(legacyKey);
            localStorage.removeItem(legacyKey);
          }
          continue;
        }

        if (isMarker(legacyRaw)) {
          const legacyValue = await getRecord(legacyKey);
          if (legacyValue === undefined) continue;
          await putRecord(currentKey, legacyValue);
          localStorage.setItem(currentKey, MARKER);
        } else if (legacyRaw.length * 2 >= LARGE_RECORD_BYTES) {
          const legacyValue = parseJson(legacyRaw);
          if (legacyValue === undefined) continue;
          await putRecord(currentKey, legacyValue);
          localStorage.setItem(currentKey, MARKER);
        } else {
          localStorage.setItem(currentKey, legacyRaw);
        }
        await deleteRecord(legacyKey);
        localStorage.removeItem(legacyKey);
      } catch (error) {
        console.error(`Could not migrate legacy data from "${legacyKey}".`, error);
      }
    }
  }

  async function migrateLargeRecords() {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key && key.startsWith('FictionTales.'));
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null || isMarker(raw) || raw.length * 2 < LARGE_RECORD_BYTES) continue;
        const value = parseJson(raw);
        if (value === undefined) continue;
        await putRecord(key, value);
        localStorage.setItem(key, MARKER);
      } catch (error) {
        console.error(`Could not migrate "${key}" to IndexedDB. Existing data was left in place.`, error);
      }
    }
  }

  async function loadIndexedRecords() {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key && isAppKey(key) && isMarker(localStorage.getItem(key)));
    for (const key of keys) {
      try {
        const value = await getRecord(key);
        if (value !== undefined) values.set(key, value);
        else console.error(`IndexedDB data for "${key}" is missing; the saved marker was preserved.`);
      } catch (error) {
        console.error(`Could not load "${key}" from IndexedDB.`, error);
      }
    }
  }

  async function initialize() {
    try {
      await openDatabase();
      await migrateLegacyKeys();
      await migrateLargeRecords();
      await loadIndexedRecords();
      return true;
    } catch (error) {
      database?.close();
      database = null;
      console.error('IndexedDB storage could not be initialized. Existing browser data was left in place.', error);
      return false;
    }
  }

  function read(key, fallback) {
    if (values.has(key)) return values.get(key);
    const raw = localStorage.getItem(key);
    if (raw === null || isMarker(raw)) return fallback;
    const value = parseJson(raw);
    return value === undefined ? fallback : value;
  }

  function queueWrite(key, generation, serialized, previousValue, hadPreviousValue) {
    const previous = writes.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (generations.get(key) !== generation) return;
      await putRecord(key, JSON.parse(serialized));
      if (generations.get(key) !== generation) return;
      localStorage.setItem(key, MARKER);
      if (key.startsWith('FictionTales.')) {
        localStorage.removeItem(`fable.${key.slice('FictionTales.'.length)}`);
      }
      window.dispatchEvent(new Event('fictiontale-storage-updated'));
    }).catch((error) => {
      if (generations.get(key) === generation) {
        if (hadPreviousValue) values.set(key, previousValue);
        else values.delete(key);
        notifyError(key, error);
      }
    }).finally(() => {
      if (writes.get(key) === pending) writes.delete(key);
    });
    writes.set(key, pending);
    return pending;
  }

  function write(key, value) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError('Storage values must be JSON serializable.');
    } catch (error) {
      console.error(`Could not serialize "${key}".`, error);
      return false;
    }

    const generation = (generations.get(key) || 0) + 1;
    generations.set(key, generation);
    let previousValue;
    let hadPreviousValue = false;
    try {
      previousValue = read(key, undefined);
      hadPreviousValue = previousValue !== undefined;
    } catch (error) {
      console.warn(`Could not read the previous value for "${key}" before saving.`, error);
    }
    if (database && serialized.length * 2 >= LARGE_RECORD_BYTES) {
      values.set(key, JSON.parse(serialized));
      queueWrite(key, generation, serialized, previousValue, hadPreviousValue);
      return true;
    }

    try {
      localStorage.setItem(key, serialized);
      values.delete(key);
      if (key.startsWith('FictionTales.')) {
        localStorage.removeItem(`fable.${key.slice('FictionTales.'.length)}`);
      }
      if (database) {
        const previous = writes.get(key) || Promise.resolve();
        const pending = previous.catch(() => {}).then(() => {
          if (generations.get(key) === generation) return deleteRecord(key);
          return undefined;
        }).catch((error) => notifyError(key, error)).finally(() => {
          if (writes.get(key) === pending) writes.delete(key);
        });
        writes.set(key, pending);
      }
      window.dispatchEvent(new Event('fictiontale-storage-updated'));
      return true;
    } catch (error) {
      if (database) {
        try {
          values.set(key, JSON.parse(serialized));
          queueWrite(key, generation, serialized, previousValue, hadPreviousValue);
          return true;
        } catch (serializationError) {
          console.error(`Could not queue "${key}" for IndexedDB storage.`, serializationError);
        }
      }
      console.error(`Could not save "${key}" in browser storage.`, error);
      return false;
    }
  }

  function remove(key) {
    const generation = (generations.get(key) || 0) + 1;
    generations.set(key, generation);
    values.delete(key);
    try {
      localStorage.removeItem(key);
      if (database) {
        const previous = writes.get(key) || Promise.resolve();
        const pending = previous.catch(() => {}).then(() => {
          if (generations.get(key) === generation) return deleteRecord(key);
          return undefined;
        }).catch((error) => notifyError(key, error)).finally(() => {
          if (writes.get(key) === pending) writes.delete(key);
        });
        writes.set(key, pending);
      }
      window.dispatchEvent(new Event('fictiontale-storage-updated'));
      return true;
    } catch (error) {
      console.error(`Could not remove "${key}" from browser storage.`, error);
      return false;
    }
  }

  function getUsageBytes() {
    let bytes = 0;
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !isAppKey(key)) continue;
        const raw = localStorage.getItem(key) || '';
        const value = isMarker(raw) ? values.get(key) : raw;
        bytes += key.length * 2 + (typeof value === 'string' ? value.length * 2 : JSON.stringify(value)?.length * 2 || 0);
      }
    } catch (error) {
      console.warn('Could not estimate Fiction Tale storage use.', error);
    }
    return bytes;
  }

  async function flush() {
    while (writes.size) {
      await Promise.all(Array.from(writes.values()));
    }
  }

  async function verify(key, expected) {
    await (writes.get(key) || Promise.resolve());
    const raw = localStorage.getItem(key);
    let actual;
    if (raw === MARKER) {
      if (!database) return false;
      actual = await getRecord(key);
    } else if (raw === null) {
      if (database && (await getRecord(key)) !== undefined) return false;
      actual = undefined;
    } else {
      actual = parseJson(raw);
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  async function clearAppData() {
    await flush();
    if (database) {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).clear();
        transaction.addEventListener('complete', resolve, { once: true });
        transaction.addEventListener('error', () => reject(transaction.error), { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB clear was aborted.')), { once: true });
      });
    }
    for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
      if (key && isAppKey(key)) localStorage.removeItem(key);
    }
    values.clear();
    writes.clear();
  }

  window.FictionTaleStorage = {
    ready: initialize(),
    read,
    write,
    remove,
    getUsageBytes,
    flush,
    verify,
    clearAppData,
    isAvailable: () => Boolean(database),
  };
})();
