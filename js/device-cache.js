const DATABASE_NAME = 'language-studio-device-cache';
const DATABASE_VERSION = 1;
const STORE_NAMES = Object.freeze(['content', 'pendingWrites', 'metadata']);

export const MAX_CONTENT_BYTES = 100 * 1024 * 1024;

/**
 * Errors returned by the cache API. Public methods resolve to a result instead
 * of rejecting, so callers can safely use them while offline or without IDB.
 */
export class DeviceCacheError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'DeviceCacheError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * @typedef {{ ok: true, found?: boolean, value?: unknown, items?: Array<{key: string, value: unknown, sizeBytes?: number, createdAt?: number, updatedAt?: number}>, sizeBytes?: number }} DeviceCacheSuccess
 * @typedef {{ ok: false, error: DeviceCacheError }} DeviceCacheFailure
 * @typedef {DeviceCacheSuccess | DeviceCacheFailure} DeviceCacheResult
 */

const success = properties => ({ ok: true, ...properties });
const failure = (code, message, cause) => ({
  ok: false,
  error: new DeviceCacheError(code, message, cause)
});

function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function estimateContentSize(value) {
  const seen = new WeakSet();
  let bytes = 0;

  function add(item) {
    if (item === null || item === undefined) {
      bytes += 4;
      return;
    }

    switch (typeof item) {
      case 'boolean':
        bytes += 4;
        return;
      case 'number':
        bytes += 8;
        return;
      case 'bigint':
        bytes += utf8ByteLength(item.toString()) + 8;
        return;
      case 'string':
        bytes += utf8ByteLength(item) + 8;
        return;
      case 'function':
      case 'symbol':
        throw new DeviceCacheError('INVALID_CONTENT', 'Content must be structured-cloneable.');
      case 'object':
        break;
      default:
        throw new DeviceCacheError('INVALID_CONTENT', 'Content must be structured-cloneable.');
    }

    if (seen.has(item)) {
      bytes += 8;
      return;
    }
    seen.add(item);

    if (typeof Blob !== 'undefined' && item instanceof Blob) {
      bytes += item.size + utf8ByteLength(item.type) + 16;
      if (typeof File !== 'undefined' && item instanceof File) {
        bytes += utf8ByteLength(item.name) + 8;
      }
      return;
    }
    if (item instanceof ArrayBuffer) {
      bytes += item.byteLength + 8;
      return;
    }
    if (typeof SharedArrayBuffer !== 'undefined' && item instanceof SharedArrayBuffer) {
      bytes += item.byteLength + 8;
      return;
    }
    if (ArrayBuffer.isView(item)) {
      bytes += 8;
      add(item.buffer);
      return;
    }
    if (item instanceof Date) {
      bytes += 16;
      return;
    }
    if (item instanceof RegExp) {
      bytes += utf8ByteLength(item.source) + utf8ByteLength(item.flags) + 16;
      return;
    }
    if (item instanceof Map) {
      bytes += 8;
      for (const [key, entryValue] of item) {
        add(key);
        add(entryValue);
      }
      return;
    }
    if (item instanceof Set) {
      bytes += Array.isArray(item) ? 8 + item.length * 8 : 8;
      for (const entry of item) add(entry);
      return;
    }

    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new DeviceCacheError(
        'INVALID_CONTENT',
        'Content values must use supported structured-clone types (plain objects, arrays, maps, sets, dates, blobs, or buffers).'
      );
    }

    bytes += 8;
    for (const key of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new DeviceCacheError('INVALID_CONTENT', 'Content cannot contain accessor properties.');
      }
      bytes += utf8ByteLength(key) + 4;
      add(descriptor.value);
    }
  }

  add(value);
  if (!Number.isSafeInteger(bytes)) {
    throw new DeviceCacheError('INVALID_CONTENT', 'Content size could not be safely estimated.');
  }
  return bytes;
}

function validateKey(key) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return failure('INVALID_KEY', 'Cache keys must be non-empty strings.');
  }
  return null;
}

function validateScope(scope) {
  if (typeof scope !== 'string' || scope.trim().length === 0) {
    return failure('INVALID_SCOPE', 'Cache scopes must be non-empty strings.');
  }
  return null;
}

function makeScopedKey(scope, key) {
  return JSON.stringify([scope, key]);
}

/**
 * Create an isolated cache API. Options are useful for embedding/testing:
 * `{ indexedDB, logger, databaseName }`.
 *
 * Every method resolves to `{ ok: true, ... }` or
 * `{ ok: false, error: DeviceCacheError }`.
 */
export function createDeviceCache(options = {}) {
  let idb;
  let idbAccessError;
  try {
    idb = options.indexedDB ?? globalThis.indexedDB;
  } catch (error) {
    idbAccessError = error;
  }
  const logger = options.logger ?? globalThis.console;
  const databaseName = options.databaseName ?? DATABASE_NAME;
  let databasePromise;

  function logError(operation, error) {
    try {
      logger?.warn?.(`[device-cache] ${operation} failed: ${error.message}`, error);
    } catch {
      // A logging failure must not turn an otherwise handled cache error into
      // a rejected promise.
    }
  }

  function report(code, message, cause, operation) {
    const result = failure(code, message, cause);
    logError(operation, result.error);
    return result;
  }

  function openDatabase() {
    if (!idb || typeof idb.open !== 'function') {
      return Promise.reject(new DeviceCacheError(
        'INDEXEDDB_UNAVAILABLE',
        'IndexedDB is unavailable in this browser or execution context.',
        idbAccessError
      ));
    }
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      try {
        request = idb.open(databaseName, DATABASE_VERSION);
      } catch (error) {
        reject(new DeviceCacheError('DATABASE_OPEN_FAILED', 'Could not open the IndexedDB database.', error));
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of STORE_NAMES) {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName, { keyPath: 'key' });
          }
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(new DeviceCacheError('DATABASE_OPEN_FAILED', 'Could not open the IndexedDB database.', request.error));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new DeviceCacheError('DATABASE_BLOCKED', 'Opening the IndexedDB database was blocked by another connection.'));
      };
    }).catch(error => {
      databasePromise = undefined;
      throw error;
    });

    return databasePromise;
  }

  async function run(operation, stores, mode, execute) {
    let database;
    try {
      database = await openDatabase();
      return await new Promise(resolve => {
        let transaction;
        let result;
        let operationError;
        try {
          transaction = database.transaction(stores, mode);
          execute(transaction, value => { result = value; }, error => { operationError = error; });
        } catch (error) {
          resolve(report('TRANSACTION_FAILED', `The ${operation} operation could not be started.`, error, operation));
          return;
        }

        transaction.oncomplete = () => {
          if (operationError) {
            resolve(report(operationError.code ?? 'OPERATION_FAILED', operationError.message, operationError.cause, operation));
          } else {
            resolve(result ?? success());
          }
        };
        transaction.onerror = () => {
          // The abort event also fires; handle the error there once only.
        };
        transaction.onabort = () => {
          const cause = transaction.error;
          resolve(report(
            'TRANSACTION_FAILED',
            `The ${operation} operation was aborted.`,
            cause ?? operationError,
            operation
          ));
        };
      });
    } catch (error) {
      return report(
        error.code ?? 'DATABASE_ERROR',
        error.message ?? `The ${operation} operation failed.`,
        error.cause ?? error,
        operation
      );
    }
  }

  function requestValue(request, onValue, onError) {
    request.onsuccess = () => {
      try {
        onValue(request.result);
      } catch (error) {
        onError(error);
      }
    };
    request.onerror = () => onError(request.error ?? new Error('IndexedDB request failed.'));
  }

  function createStoreApi(storeName) {
    return Object.freeze({
      async get(key) {
        const invalid = validateKey(key);
        if (invalid) return report(invalid.error.code, invalid.error.message, undefined, `${storeName}.get`);
        return run(`${storeName}.get`, [storeName], 'readonly', (tx, succeed, fail) => {
          requestValue(tx.objectStore(storeName).get(key), record => {
            succeed(success({ found: record !== undefined, value: record?.value }));
          }, fail);
        });
      },

      async set(key, value) {
        const invalid = validateKey(key);
        if (invalid) return report(invalid.error.code, invalid.error.message, undefined, `${storeName}.set`);
        if (storeName === 'metadata' && (!Number.isFinite(value) || value < 0)) {
          return report('INVALID_TIMESTAMP', 'Metadata timestamps must be non-negative finite numbers.', undefined, 'metadata.set');
        }

        let contentSize;
        if (storeName === 'content') {
          try {
            contentSize = estimateContentSize(value) + utf8ByteLength(key) + 32;
            if (!Number.isSafeInteger(contentSize)) {
              throw new DeviceCacheError('INVALID_CONTENT', 'Content size could not be safely estimated.');
            }
          } catch (error) {
            return report(error.code ?? 'INVALID_CONTENT', error.message, error, 'content.set');
          }
          if (contentSize > MAX_CONTENT_BYTES) {
            return report('CONTENT_CAP_EXCEEDED', `This item exceeds the ${MAX_CONTENT_BYTES}-byte content limit.`, undefined, 'content.set');
          }
        }

        const now = Date.now();
        if (storeName !== 'content') {
          return run(`${storeName}.set`, [storeName], 'readwrite', (tx, succeed, fail) => {
            const store = tx.objectStore(storeName);
            const getRequest = store.get(key);
            requestValue(getRequest, existing => {
              const record = storeName === 'metadata'
                ? { key, value, updatedAt: now }
                : { key, value, createdAt: existing?.createdAt ?? now, updatedAt: now };
              const putRequest = store.put(record);
              requestValue(putRequest, () => succeed(success({ value })), fail);
            }, fail);
          });
        }

        return run('content.set', ['content'], 'readwrite', (tx, succeed, fail) => {
          const store = tx.objectStore('content');
          requestValue(store.getAll(), records => {
            const existing = records.find(record => record.key === key);
            const usedBytes = records.reduce((total, record) => total + (record.sizeBytes ?? 0), 0);
            const nextBytes = usedBytes - (existing?.sizeBytes ?? 0) + contentSize;
            if (nextBytes > MAX_CONTENT_BYTES) {
              fail(new DeviceCacheError(
                'CONTENT_CAP_EXCEEDED',
                `Adding this item would exceed the ${MAX_CONTENT_BYTES}-byte content limit. Existing items were left unchanged.`
              ));
              return;
            }
            const putRequest = store.put({
              key,
              value,
              sizeBytes: contentSize,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now
            });
            requestValue(putRequest, () => succeed(success({ value, sizeBytes: contentSize })), fail);
          }, fail);
        });
      },

      async remove(key) {
        const invalid = validateKey(key);
        if (invalid) return report(invalid.error.code, invalid.error.message, undefined, `${storeName}.remove`);
        return run(`${storeName}.remove`, [storeName], 'readwrite', (tx, succeed, fail) => {
          const request = tx.objectStore(storeName).delete(key);
          requestValue(request, () => succeed(success()), fail);
        });
      },

      async list() {
        return run(`${storeName}.list`, [storeName], 'readonly', (tx, succeed, fail) => {
          requestValue(tx.objectStore(storeName).getAll(), records => {
            records.sort((left, right) => {
              const leftTime = left.createdAt ?? left.updatedAt ?? 0;
              const rightTime = right.createdAt ?? right.updatedAt ?? 0;
              return leftTime - rightTime || left.key.localeCompare(right.key);
            });
            succeed(success({ items: records.map(({ key, value, sizeBytes, createdAt, updatedAt }) => ({
              key,
              value,
              ...(sizeBytes === undefined ? {} : { sizeBytes }),
              ...(createdAt === undefined ? {} : { createdAt }),
              ...(updatedAt === undefined ? {} : { updatedAt })
            })) }));
          }, fail);
        });
      }
    });
  }

  const content = createStoreApi('content');
  const pendingWrites = createStoreApi('pendingWrites');
  const metadata = createStoreApi('metadata');
  // Metadata keys are caller-defined scopes; each value is a Firebase marker
  // timestamp (a non-negative millisecond number), not Firebase data itself.
  let pendingId = 0;
  function newPendingId() {
    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    } catch {
      // Fall through for restricted contexts without usable crypto.
    }
    pendingId++;
    return `pending-${Date.now().toString(36)}-${pendingId.toString(36)}`;
  }

  return Object.freeze({
    content,
    pendingWrites,
    metadata,
    async get(scope, key) {
      const invalidScope = validateScope(scope);
      if (invalidScope) return report(invalidScope.error.code, invalidScope.error.message, undefined, 'get');
      const invalidKey = validateKey(key);
      if (invalidKey) return report(invalidKey.error.code, invalidKey.error.message, undefined, 'get');
      const result = await content.get(makeScopedKey(scope, key));
      if (!result.ok || !result.found) return result;
      return success({ found: true, value: result.value });
    },
    async set(scope, key, value) {
      const invalidScope = validateScope(scope);
      if (invalidScope) return report(invalidScope.error.code, invalidScope.error.message, undefined, 'set');
      const invalidKey = validateKey(key);
      if (invalidKey) return report(invalidKey.error.code, invalidKey.error.message, undefined, 'set');
      return content.set(makeScopedKey(scope, key), value);
    },
    async remove(scope, key) {
      const invalidScope = validateScope(scope);
      if (invalidScope) return report(invalidScope.error.code, invalidScope.error.message, undefined, 'remove');
      const invalidKey = validateKey(key);
      if (invalidKey) return report(invalidKey.error.code, invalidKey.error.message, undefined, 'remove');
      return content.remove(makeScopedKey(scope, key));
    },
    async getMeta(key) {
      return metadata.get(key);
    },
    async setMeta(key, value) {
      return metadata.set(key, value);
    },
    async enqueue(operation) {
      const id = newPendingId();
      const now = Date.now();
      return run('pendingWrites.enqueue', ['pendingWrites'], 'readwrite', (tx, succeed, fail) => {
        const request = tx.objectStore('pendingWrites').add({
          key: id,
          value: operation,
          createdAt: now,
          updatedAt: now
        });
        requestValue(request, () => succeed(success({ id })), fail);
      });
    },
    async listPending() {
      const result = await pendingWrites.list();
      return result.ok ? success({ items: result.items.map(({ key, value, createdAt, updatedAt }) => ({
        id: key,
        operation: value,
        createdAt,
        updatedAt
      })) }) : result;
    },
    async removePending(id) {
      return pendingWrites.remove(id);
    },
    close: async () => {
      try {
        const database = await openDatabase();
        database.close();
        databasePromise = undefined;
        return success();
      } catch (error) {
        return report(error.code ?? 'DATABASE_ERROR', error.message, error.cause ?? error, 'close');
      }
    }
  });
}

export const deviceCache = createDeviceCache();
export const get = (scope, key) => deviceCache.get(scope, key);
export const set = (scope, key, value) => deviceCache.set(scope, key, value);
export const remove = (scope, key) => deviceCache.remove(scope, key);
export const getMeta = key => deviceCache.getMeta(key);
export const setMeta = (key, value) => deviceCache.setMeta(key, value);
export const enqueue = operation => deviceCache.enqueue(operation);
export const listPending = () => deviceCache.listPending();
export const removePending = id => deviceCache.removePending(id);
export default deviceCache;
