// Firebase app/database/auth setup — the one place credentials live. Every
// other module reaches the database through `database`/`wordsRef` exported
// here rather than initializing its own connection.
import { firebaseConfig } from '../../firebase-config.js';
import { deviceCache } from './device-cache.js';

export const firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
export const database = firebase.database(firebaseApp);
export const auth = firebase.auth();
export const japanRef = database.ref('languages/japan');
export const wordsRef = japanRef.child('words');
export const languageUpdateMarkerRef = database.ref('contentUpdateMarkers/language');

const isNetworkFailure = (error) => !navigator.onLine || /network|disconnect|unavailable|timeout|offline/i.test(String(error));
const valuesEqual = (left, right) => {
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
};

async function queueLanguageUpdate(updates, expected = {}) {
  const result = await deviceCache.enqueue({
    kind: 'language-update',
    userId: auth.currentUser && auth.currentUser.uid,
    updates,
    expected
  });
  if (!result.ok) throw result.error || new Error('Could not queue this Language change for offline sync.');
  return { queued: true, id: result.id };
}

export async function markLanguageUpdated() {
  try {
    await languageUpdateMarkerRef.set(Date.now());
    return true;
  } catch (error) {
    console.warn('Could not update the global Language content marker.', error);
    return false;
  }
}

export async function updateJapanData(updates, expected = {}) {
  const rootUpdates = Object.fromEntries(
    Object.entries(updates).map(([path, value]) => [`languages/japan/${path}`, value])
  );
  const rootExpected = Object.fromEntries(
    Object.entries(expected).map(([path, value]) => [`languages/japan/${path}`, value])
  );
  if (!navigator.onLine) return queueLanguageUpdate(rootUpdates, rootExpected);
  try {
    await database.ref().update({
      ...rootUpdates,
      'contentUpdateMarkers/language': Date.now()
    });
  } catch (markerError) {
    if (isNetworkFailure(markerError)) return queueLanguageUpdate(rootUpdates, rootExpected);
    console.warn('Could not update the global Language content marker; retrying the requested data update.', markerError);
    try {
      await database.ref().update(rootUpdates);
    } catch (dataError) {
      if (isNetworkFailure(dataError)) return queueLanguageUpdate(rootUpdates, rootExpected);
      throw dataError;
    }
  }
  return { queued: false };
}

export async function syncPendingLanguageWrites() {
  const pending = await deviceCache.listPending();
  if (!pending.ok) {
    console.error('Could not read queued Language changes:', pending.error);
    return;
  }
  const userId = auth.currentUser && auth.currentUser.uid;
  for (const record of pending.items) {
    const operation = record.operation;
    if (!operation || operation.kind !== 'language-update' || operation.userId !== userId) continue;
    try {
      const expected = operation.expected || {};
      const updatePaths = Object.keys(operation.updates || {});
      const pathsToCheck = Object.keys(expected);
      const isNewOnly = pathsToCheck.length === 0 && updatePaths.length > 0 &&
        updatePaths.every(path => operation.updates[path] !== null);
      const checks = isNewOnly ? updatePaths.map(path => [path, null]) : Object.entries(expected);
      if (!checks.length) {
        console.warn('Offline Language change needs conflict review; no safe base value was saved.', record.id);
        continue;
      }
      let matchesBase = true;
      let alreadyApplied = updatePaths.length > 0;
      for (const [path, expectedValue] of checks) {
        const snapshot = await database.ref(path).once('value');
        if (!valuesEqual(snapshot.val(), expectedValue)) {
          matchesBase = false;
        }
      }
      for (const [path, value] of Object.entries(operation.updates || {})) {
        const snapshot = await database.ref(path).once('value');
        if (!valuesEqual(snapshot.val(), value)) {
          alreadyApplied = false;
          break;
        }
      }
      if (!matchesBase && !alreadyApplied) {
        window.dispatchEvent(new CustomEvent('offline-sync-conflict', {
          detail: { area: 'Language', id: record.id }
        }));
        console.warn('Offline Language change conflicts with newer online content and was not overwritten.', record.id);
        continue;
      }
      if (!alreadyApplied) {
        try {
          await database.ref().update({
            ...operation.updates,
            'contentUpdateMarkers/language': Date.now()
          });
        } catch (markerError) {
          if (isNetworkFailure(markerError)) throw markerError;
          console.warn('Could not update the global Language marker while syncing; saving the change without it.', markerError);
          await database.ref().update(operation.updates);
        }
      }
      let translationPending = false;
      for (const [path, value] of Object.entries(operation.updates || {})) {
        const match = path.match(/^languages\/japan\/words\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (!match || !value || !value.w) continue;
        const [, language, section, wordId] = match;
        try {
          const { translateText, romanizeNativeWord } = await import('./translate.js');
          let hydrated;
          if (value.needsTranslation) {
            const word = await translateText(value.em || value.w, 'en', 'ja');
            if (!word) {
              translationPending = true;
              continue;
            }
            const pronunciation = await romanizeNativeWord(word, 'ja');
            if (!pronunciation) {
              translationPending = true;
              continue;
            }
            hydrated = { ...value, w: word, p: pronunciation || value.p || '', needsTranslation: null };
          } else {
            const needsMeaning = !value.em;
            const needsPronunciation = /\p{Script=Han}/u.test(value.w) && !value.p;
            if (!needsMeaning && !needsPronunciation) continue;
            hydrated = { ...value };
            if (needsMeaning) {
              const englishMeaning = await translateText(value.w, 'ja', 'en');
              if (!englishMeaning) {
                translationPending = true;
                continue;
              }
              hydrated.em = englishMeaning;
            }
            if (needsPronunciation) {
              const pronunciation = await romanizeNativeWord(value.w, 'ja');
              if (!pronunciation) {
                translationPending = true;
                continue;
              }
              hydrated.p = pronunciation;
            }
          }
          await database.ref(path).update(hydrated);
          await markLanguageUpdated();
          const cachedWords = await deviceCache.get(`language:${userId}:${language}`, `words:${section}`);
          if (cachedWords.ok && cachedWords.found && cachedWords.value[wordId]) {
            cachedWords.value[wordId] = { ...cachedWords.value[wordId], ...hydrated };
            const cached = await deviceCache.set(`language:${userId}:${language}`, `words:${section}`, cachedWords.value);
            if (!cached.ok) console.warn('Could not cache the translated word meaning.', cached.error);
          }
        } catch (error) {
          translationPending = true;
          console.error('Could not load the meaning for a word saved offline.', error);
        }
      }
      if (!translationPending) {
        const removed = await deviceCache.removePending(record.id);
        if (!removed.ok) console.error('Synced a Language change but could not remove its queue record.', removed.error);
      }
    } catch (error) {
      console.error('Could not sync a queued Language change:', error);
      return;
    }
  }
}
