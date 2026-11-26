(() => {
  const DB_NAME = 'fictiontale-app-data';
  const STORE_NAME = 'records';
  const LARGE_RECORD_BYTES = 48 * 1024;
  const MARKER = '{"__fictionTaleIndexedDB":1}';
  const values = new Map();
  const generations = new Map();
  const writes = new Map();
  let database = null;
  let storageInitialized = false;
  let localStorageAvailable = false;
  let unavailableIndexedData = false;

  function probeLocalStorage() {
    const key = 'FictionTales.__storage_probe__';
    try {
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        // The failed probe is reported to the app below.
      }
      return false;
    }
  }

  function isAppKey(key) {
    return key.startsWith('FictionTales.') || key.startsWith('fable.');
  }

  function isMarker(raw) {
    return raw === MARKER;
  }

  function hasUnavailableIndexedData() {
    if (unavailableIndexedData) return true;
    if (database && storageInitialized) return false;
    try {
      return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .some((key) => key && isAppKey(key) && isMarker(localStorage.getItem(key)));
    } catch (error) {
      console.error('Could not check for saved IndexedDB data markers.', error);
      return true;
    }
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
        database.addEventListener('versionchange', () => {
          database.close();
          database = null;
        });
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

  function refuseUnavailableIndexedData(key, operation) {
    if (!hasUnavailableIndexedData()) return false;
    const message = `Could not ${operation} "${key}" because previously saved IndexedDB data is unavailable. The saved data was left untouched. Restore browser storage or use a backup before editing or resetting content.`;
    console.error(message);
    window.dispatchEvent(new CustomEvent('fictiontale-storage-error', {
      detail: { key, message },
    }));
    return true;
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
        else {
          unavailableIndexedData = true;
          console.error(`IndexedDB data for "${key}" is missing; the saved marker was preserved.`);
        }
      } catch (error) {
        unavailableIndexedData = true;
        console.error(`Could not load "${key}" from IndexedDB.`, error);
      }
    }
  }

  async function initialize() {
    localStorageAvailable = probeLocalStorage();
    try {
      await openDatabase();
      await migrateLegacyKeys();
      await migrateLargeRecords();
      await loadIndexedRecords();
      storageInitialized = true;
      return true;
    } catch (error) {
      database?.close();
      database = null;
      try {
        unavailableIndexedData = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .some((key) => key && isAppKey(key) && isMarker(localStorage.getItem(key)));
      } catch {
        unavailableIndexedData = true;
      }
      storageInitialized = true;
      console.error('IndexedDB storage could not be initialized. Existing browser data was left in place.', error);
      return false;
    }
  }

  function read(key, fallback) {
    if (values.has(key)) return values.get(key);
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (error) {
      console.error(`Could not read "${key}" from browser storage.`, error);
      return fallback;
    }
    if (raw === null || isMarker(raw)) return fallback;
    const value = parseJson(raw);
    return value === undefined ? fallback : value;
  }

  function queueWrite(key, generation, serialized, previousValue, hadPreviousValue) {
    window.dispatchEvent(new CustomEvent('fictiontale-storage-pending', { detail: { key } }));
    const previous = writes.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (generations.get(key) !== generation) return;
      await putRecord(key, JSON.parse(serialized));
      if (generations.get(key) !== generation) return;
      localStorage.setItem(key, MARKER);
      if (key.startsWith('FictionTales.')) {
        localStorage.removeItem(`fable.${key.slice('FictionTales.'.length)}`);
      }
      window.dispatchEvent(new CustomEvent('fictiontale-storage-updated', { detail: { key } }));
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
    if (refuseUnavailableIndexedData(key, 'save')) return false;
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
      window.dispatchEvent(new CustomEvent('fictiontale-storage-updated', { detail: { key } }));
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
    if (refuseUnavailableIndexedData(key, 'remove')) return false;
    const generation = (generations.get(key) || 0) + 1;
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Could not remove "${key}" from browser storage.`, error);
      return false;
    }
    generations.set(key, generation);
    values.delete(key);
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
    window.dispatchEvent(new CustomEvent('fictiontale-storage-updated', { detail: { key } }));
    return true;
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
      return null;
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
    if (hasUnavailableIndexedData()) {
      throw new Error('Reset was blocked because previously saved IndexedDB data is unavailable. Restore browser storage or use a backup before resetting content.');
    }
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

  async function getPersistenceStatus() {
    try {
      const storageManager = navigator.storage;
      if (!storageManager || typeof storageManager.persisted !== 'function') return 'unsupported';
      return await storageManager.persisted() ? 'granted' : 'not-granted';
    } catch (error) {
      console.warn('Could not check persistent browser storage status.', error);
      return 'error';
    }
  }

  async function requestPersistence() {
    try {
      const storageManager = navigator.storage;
      if (!storageManager || typeof storageManager.persisted !== 'function'
        || typeof storageManager.persist !== 'function') return 'unsupported';
      if (await storageManager.persisted()) return 'granted';
      return await storageManager.persist() ? 'granted' : 'not-granted';
    } catch (error) {
      console.warn('Could not request persistent browser storage.', error);
      return 'error';
    }
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
    getPersistenceStatus,
    requestPersistence,
    isAvailable: () => Boolean(database),
    canUseLocalStorage: () => {
      localStorageAvailable = probeLocalStorage();
      return localStorageAvailable;
    },
    hasUnavailableIndexedData,
  };
})();
