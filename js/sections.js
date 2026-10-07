// Everything about sections and subsections: the data model (naming,
// sorting, hidden/starred flags, parent/child relationships), Firebase
// sync, and the entire section-list UI — headers, the kebab menu, merge,
// delete, star. If you're changing how sections are organized, sorted,
// hidden, starred, merged, or deleted, or how the section list/kebab menu
// looks or behaves, it's in this file.
//
// Deliberately owns BOTH the data model and its rendering (unlike
// dictionary-cards.js/sections.js's split from quick-add.js) — nearly every
// data change here immediately triggers a re-render, and the rendering code
// leans on the model helpers constantly, so splitting them would mean a
// circular import between two files instead of one, for no real benefit.
//
// Circular import note: this file and dictionary-cards.js import from each
// other (sections.js needs buildDictionaryCard to render word lists;
// dictionary-cards.js needs section helpers like isSubsection and
// renderCurrentView for its drag-to-move feature). Safe in practice because
// nothing here is invoked at module-evaluation time — only from inside
// functions, called after every module has finished loading.

import { state } from './state.js';
import { auth, database, japanRef, wordsRef, updateJapanData, markLanguageUpdated } from './firebase-init.js';
import { firebaseConfig } from '../../firebase-config.js';
import { deviceCache } from './device-cache.js';
import { normalize, escapeHtml, repairMojibake } from './utils.js';
import { TRASH_ICON_PATHS } from './icons.js';
import { dictionaryList, dictionaryCount, sectionFilterInput } from './dom.js';
import { buildDictionaryCard } from './dictionary-cards.js';
import { closeQuickAdd } from './quick-add.js';
import { startSectionReading } from './reading.js';
import { renderSectionNoteInto, openNoteEditor } from './section-notes.js';

// Firebase shape: words/{language}/{section}/{id} -> { w, p, em, c }.
// Flattens ONE section's snapshot into the entry list the rest of the app
// works with — sections are always fetched individually, on demand, never
// as a whole-language read (see ensureSectionLoaded).
export function flattenSectionSnapshot(language, section, snapshot) {
  return flattenSectionData(language, section, snapshot.val() || {});
}

export function flattenSectionData(language, section, val) {
  const entries = [];
  Object.entries(val).forEach(([id, data]) => {
    if (!data) return;
    entries.push({
      id,
      // Some stored words are garbled (see repairMojibake); show them as originally typed
      word: repairMojibake(data.w || ''),
      pronunciation: repairMojibake(data.p || ''),
      englishMeaning: repairMojibake(data.em || ''),
      rawData: data,
      language,
      section,
      createdAt: data.c || 0
    });
  });
  return entries.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

export function normalizeSectionName(name) {
  return (name || '').trim().toUpperCase() || 'UNCATEGORIZED';
}

export function sectionSort(a, b) {
  const aStarred = isSectionStarred(a);
  const bStarred = isSectionStarred(b);
  if (aStarred !== bStarred) return aStarred ? -1 : 1;
  if (a === 'UNCATEGORIZED') return 1;
  if (b === 'UNCATEGORIZED') return -1;
  return a.localeCompare(b);
}

export function getSortedSectionNames() {
  return Object.keys(state.sectionSummary).sort(sectionSort);
}

// Subsections are just ordinary sections whose Firebase key encodes a
// parent via a '>' separator, e.g. "FOOD>DESSERTS" is a child of "FOOD" —
// a single flat key (Firebase keys allow '>' fine), split apart only for
// display/behavior. Only one level deep is rendered; a '>' typed while
// already inside a subsection's own add-widget is rejected rather than
// silently building a confusing multi-level key.
export function isSubsection(section) {
  return section.includes('>');
}

export function getParentSectionName(section) {
  const idx = section.indexOf('>');
  return idx === -1 ? null : section.slice(0, idx);
}

export function getSubsectionLabel(section) {
  const idx = section.indexOf('>');
  return idx === -1 ? section : section.slice(idx + 1);
}

// Top-level sections only — used everywhere subsections must be excluded
// (the main list's own rows, and the reading "all sections" sweep).
export function getTopLevelSectionNames() {
  return getSortedSectionNames().filter(section => !isSubsection(section));
}

export function getSubsectionsOf(parentSection) {
  return getSortedSectionNames().filter(section => getParentSectionName(section) === parentSection);
}

// A section is visible on the very first load unless explicitly hidden —
// presence in state.hiddenSections is the only thing that marks it hidden,
// so nothing needs writing for the (default) enabled case. Only top-level
// sections carry this flag; subsections always follow their parent.
export function isSectionHidden(section) {
  return !!state.hiddenSections[section];
}

// True when a (visible) parent has at least one subsection that's been
// explicitly hidden on its own — the parent itself stays visible, but the
// hidden pane still needs to surface it as a container for that
// subsection (see renderSectionHeaders / renderSectionBodyIfPresent).
export function sectionHasHiddenSubsection(section) {
  return getSubsectionsOf(section).some(sub => isSectionHidden(sub));
}


// Starring a section ("top 5") pins it ahead of everything else in
// sectionSort — capped at MAX_STARRED_SECTIONS total (top-level sections
// and subsections share the one cap) so it stays a genuine shortlist.
export const MAX_STARRED_SECTIONS = 5;

export function isSectionStarred(section) {
  return !!state.starredSections[section];
}

export async function toggleSectionStarred(section) {
  const nextStarred = !isSectionStarred(section);
  if (nextStarred && Object.keys(state.starredSections).length >= MAX_STARRED_SECTIONS) {
    window.alert(`You can only star up to ${MAX_STARRED_SECTIONS} sections — un-star one first.`);
    return;
  }
  try {
    await updateJapanData(
      { [`starredSections/${state.language}/${section}`]: nextStarred ? true : null },
      { [`starredSections/${state.language}/${section}`]: nextStarred ? null : true }
    );
    if (nextStarred) state.starredSections[section] = true;
    else delete state.starredSections[section];
    await writeLanguageCache(state.language, 'starred-sections', state.starredSections);
    renderCurrentView();
  } catch (err) {
    console.error('Failed to toggle starred section', err);
    window.alert('Failed to update starred section. See console for details.');
  }
}

// On-screen label for a section — subsections show as "PARENT → CHILD" so
// it's clear which parent they're nested under even out of context.
export function getSectionDisplayLabel(section) {
  return isSubsection(section) ? `${getParentSectionName(section)} → ${getSubsectionLabel(section)}` : section;
}

// Spoken form for reading mode's section announcement — just the child
// name on its own reads far more naturally than repeating the full path.
export function getSectionSpokenLabel(section) {
  return isSubsection(section) ? getSubsectionLabel(section) : section;
}

// Expands each section into itself followed by its own subsections (never
// recursing further) — this is what makes reading a top-level section, or
// the app-level "read everything" sweep, also cover
// whatever's nested under it. A subsection passed in expands to itself
// alone, since it has none of its own.
export function expandWithSubsections(sections) {
  const expanded = [];
  sections.forEach(section => {
    expanded.push(section);
    if (!isSubsection(section)) {
      getSubsectionsOf(section).forEach(sub => expanded.push(sub));
    }
  });
  return expanded;
}

// On-demand duplicate check when adding a brand-new word — a single direct
// read of this language's words, done only at the moment "Add" is clicked
// (not maintained as a standing index). Returns where the first match
// lives (section, id, and its raw stored fields) so the caller can offer
// to move it instead of just refusing the add, or null if there's no match.
export async function findExistingWordLocation(normalizedWord) {
  if (!navigator.onLine) {
    for (const [section, entries] of state.sectionCache) {
      const match = entries.find(entry => normalize(repairMojibake(entry.word || '')) === normalizedWord);
      if (match) {
        return {
          section,
          id: match.id,
          data: {
            w: match.word,
            p: match.pronunciation || '',
            em: match.englishMeaning || '',
            c: match.createdAt || 0
          }
        };
      }
    }
    return null;
  }
  try {
    const snapshot = await wordsRef.child(state.language).once('value');
    const languageData = snapshot.val() || {};
    for (const [section, sectionWords] of Object.entries(languageData)) {
      for (const [id, data] of Object.entries(sectionWords || {})) {
        if (data && normalize(repairMojibake(data.w || '')) === normalizedWord) {
          return { section, id, data };
        }
      }
    }
    return null;
  } catch (err) {
    console.error('Duplicate check failed', err);
    return null;
  }
}

// Atomically bumps a section's live count in sectionSummary — this is how the
// header counts stay in sync with the actual data, without ever having to
// re-read the whole language to recompute them.
export function bumpSectionCount(language, section, delta) {
  if (!navigator.onLine) {
    const current = Number(state.sectionSummary[section]) || 0;
    const next = Math.max(0, current + delta);
    if (next) state.sectionSummary[section] = next;
    else delete state.sectionSummary[section];
    renderCurrentView();
    writeLanguageCache(language, 'section-summary', state.sectionSummary).then(result => {
      if (!result.ok) console.warn('Could not cache the updated section count.', result.error);
    });
    return updateJapanData(
      { [`sectionSummary/${language}/${section}`]: next || null },
      { [`sectionSummary/${language}/${section}`]: current || null }
    ).then(() => ({ committed: true }));
  }
  return japanRef.child(`sectionSummary/${language}/${section}`).transaction(current => {
    const next = (Number(current) || 0) + delta;
    return next > 0 ? next : null;
  }).then(result => {
    if (result.committed) return markLanguageUpdated().then(() => result);
    return result;
  });
}

// Runs at most once per language, ever (guarded by sectionSummary already
// existing): folds any legacy mixed-case section keys into their upper-case
// counterpart and (re)computes the section counts. This is the ONLY place
// that reads a language's entire word tree — everything else fetches one
// section at a time.
export async function bootstrapLanguageIfNeeded(language) {
  if (!state.isAdmin) return;
  try {
    const summarySnap = await japanRef.child(`sectionSummary/${language}`).once('value');
    if (summarySnap.exists()) return;

    const wordsSnap = await wordsRef.child(language).once('value');
    const raw = wordsSnap.val() || {};
    const updates = {};
    const summary = {};

    Object.entries(raw).forEach(([section, words]) => {
      const upper = normalizeSectionName(section);
      Object.entries(words || {}).forEach(([id, data]) => {
        if (!data) return;
        if (section !== upper) {
          updates[`words/${language}/${upper}/${id}`] = data;
          updates[`words/${language}/${section}/${id}`] = null;
        }
        summary[upper] = (summary[upper] || 0) + 1;
      });
    });

    updates[`sectionSummary/${language}`] = summary;
    await updateJapanData(updates);
  } catch (err) {
    console.error(`Failed to bootstrap language "${language}"`, err);
  }
}

async function reconcileMissingSectionSummaryEntries(language) {
  const user = auth.currentUser;
  if (!user || !navigator.onLine) return;

  const token = await user.getIdToken();
  const wordsUrl = new URL(`${firebaseConfig.databaseURL}/languages/japan/words/${encodeURIComponent(language)}.json`);
  wordsUrl.searchParams.set('shallow', 'true');
  wordsUrl.searchParams.set('auth', token);
  const wordsResponse = await fetch(wordsUrl);
  if (!wordsResponse.ok) {
    throw new Error(`Could not discover Language sections (${wordsResponse.status}).`);
  }

  const sectionKeys = Object.keys(await wordsResponse.json() || {});
  if (!sectionKeys.length) return;
  const summarySnapshot = await japanRef.child(`sectionSummary/${language}`).once('value');
  const remoteSummary = summarySnapshot.val() || {};
  const missingSections = sectionKeys.filter(section =>
    !Object.prototype.hasOwnProperty.call(remoteSummary, section)
  );
  if (!missingSections.length) return;

  const missingCounts = await Promise.all(missingSections.map(async section => {
    const sectionUrl = new URL(
      `${firebaseConfig.databaseURL}/languages/japan/words/${encodeURIComponent(language)}/${encodeURIComponent(section)}.json`
    );
    sectionUrl.searchParams.set('shallow', 'true');
    sectionUrl.searchParams.set('auth', token);
    const response = await fetch(sectionUrl);
    if (!response.ok) {
      throw new Error(`Could not read section "${section}" (${response.status}).`);
    }
    const wordKeys = await response.json();
    return [section, Object.keys(wordKeys || {}).length];
  }));

  const discovered = Object.fromEntries(missingCounts);
  if (language === state.language) {
    state.discoveredSections = { ...state.discoveredSections, ...discovered };
    state.sectionSummary = { ...state.sectionSummary, ...discovered };
    state.sectionSummaryLoaded = true;
    renderCurrentView();
    const stored = await writeLanguageCache(language, 'section-summary', state.sectionSummary);
    if (!stored.ok) console.warn('Could not cache discovered Language sections.', stored.error);
  }

  if (!state.isAdmin) return;
  const results = await Promise.all(missingCounts.map(([section, count]) =>
    japanRef.child(`sectionSummary/${language}/${section}`).transaction(current =>
      current === null ? count : current
    )
  ));
  if (results.some(result => result.committed)) await markLanguageUpdated();
}

// Fetches (once) and live-subscribes to a single section's words. Resolves
// with whatever's cached already if this section was loaded before — the
// listener set up on first load keeps that cache fresh from then on.
export async function ensureSectionLoaded(section) {
  const language = state.language;
  let cachedEntries = state.sectionCache.get(section);
  if (!cachedEntries) {
    const raw = await readLanguageCache(language, `words:${section}`);
    if (raw && language === state.language) {
      cachedEntries = flattenSectionData(language, section, raw);
      state.sectionCache.set(section, cachedEntries);
      renderSectionBodyIfPresent(section, cachedEntries);
    }
  }
  if (!navigator.onLine) return cachedEntries || [];
  if (cachedEntries && state.languageUpdateMarker !== null) {
    const cachedMarker = await deviceCache.getMeta(`${languageCacheScope(language)}:words:${section}:marker`);
    if (cachedMarker.ok && cachedMarker.found && cachedMarker.value === state.languageUpdateMarker) {
      return cachedEntries;
    }
  }
  if (cachedEntries && state.sectionListeners.has(section)) return cachedEntries;
  return new Promise((resolve) => {
    const indexed = sectionIndexEntry(section);
    const sectionRef = indexed && indexed.path ? database.ref(indexed.path) : wordsRef.child(language).child(section);
    let resolved = !!cachedEntries;
    if (cachedEntries) resolve(cachedEntries);
    sectionRef.on('value', async (snapshot) => {
      const raw = snapshot.val() || {};
      const entries = flattenSectionData(language, section, raw);
      state.sectionCache.set(section, entries);
      writeLanguageCache(language, `words:${section}`, raw);
      if (state.languageUpdateMarker !== null) {
        const marker = await deviceCache.setMeta(`${languageCacheScope(language)}:words:${section}:marker`, state.languageUpdateMarker);
        if (!marker.ok) console.warn(`Could not store the refresh marker for "${section}".`, marker.error);
      }
      persistLanguageMarker(language);
      renderSectionBodyIfPresent(section, entries);
      if (!resolved) {
        resolved = true;
        resolve(entries);
      }
    }, (err) => {
      console.error(`Failed to load section "${section}"`, err);
      if (!resolved) {
        resolved = true;
        readLanguageCache(language, `words:${section}`).then(raw => {
          const entries = raw ? flattenSectionData(language, section, raw) : [];
          state.sectionCache.set(section, entries);
          resolve(entries);
        });
      }
    });
    state.sectionListeners.set(section, sectionRef);
  });
}

// Headers + counts only — this is the lightweight listener that drives the
// default page-load view. Actual word data is never pulled in here.
export function subscribeSectionSummary(language) {
  const ref = japanRef.child(`sectionSummary/${language}`);
  ref.on('value', (snapshot) => {
    state.sectionSummary = { ...(snapshot.val() || {}), ...state.discoveredSections };
    state.sectionSummaryLoaded = true;
    writeLanguageCache(language, 'section-summary', state.sectionSummary);
    persistLanguageMarker(language);
    renderCurrentView();
    syncSectionIndex(language);
  }, (err) => {
    console.error('Failed to subscribe to section summary', err);
    readLanguageCache(language, 'section-summary').then(summary => {
      if (!summary || language !== state.language) return;
      state.sectionSummary = summary;
      state.sectionSummaryLoaded = true;
      renderCurrentView();
    });
  });
  return ref;
}

// ---------- Section index ----------
// languages/japan/sectionIndex/<language> = { version, updatedAt, sections: {
//   <TOP>: { path, words, subsections, totalWords,
//            children: { <LABEL>: { key: 'TOP>LABEL', path, words } } } } }
// One read gives every section and subsection with its counts and totals, and `path` links to
// its words under words/<language>/…, which are fetched only when that section is opened.
// Every word or section change already updates sectionSummary; an admin session watches it and
// writes just the changed parts of the index, so the index always follows the main data.
const SECTION_INDEX_VERSION = 1;
const sectionWordsPath = (language, section) => `languages/japan/words/${language}/${section}`;

export function buildSectionIndex(language, summary) {
  const sections = {};
  Object.entries(summary || {}).forEach(([key, count]) => {
    const top = isSubsection(key) ? getParentSectionName(key) : key;
    const entry = sections[top] || (sections[top] = { path: sectionWordsPath(language, top), words: 0, subsections: 0, totalWords: 0 });
    if (isSubsection(key)) {
      entry.children = entry.children || {};
      entry.children[getSubsectionLabel(key)] = { key, path: sectionWordsPath(language, key), words: Number(count) || 0 };
    } else {
      entry.words = Number(count) || 0;
    }
  });
  Object.values(sections).forEach(entry => {
    const children = Object.values(entry.children || {});
    entry.subsections = children.length;
    entry.totalWords = children.reduce((sum, child) => sum + child.words, entry.words);
  });
  return sections;
}

// Section name -> its own word count, the shape the rest of the page works with
function summaryFromIndex(sections) {
  const flat = {};
  Object.entries(sections || {}).forEach(([top, entry]) => {
    flat[top] = Number(entry.words) || 0;
    Object.values(entry.children || {}).forEach(child => { flat[child.key] = Number(child.words) || 0; });
  });
  return flat;
}

// The index entry for a section or subsection (null when there is no index)
export function sectionIndexEntry(section) {
  if (!state.sectionIndex) return null;
  if (!isSubsection(section)) return state.sectionIndex[section] || null;
  const parent = state.sectionIndex[getParentSectionName(section)];
  return (parent && parent.children && parent.children[getSubsectionLabel(section)]) || null;
}

export function subscribeSectionIndex(language) {
  const ref = japanRef.child(`sectionIndex/${language}`);
  // Without a usable index, readers load the section list straight from sectionSummary
  const fallBack = () => {
    state.sectionIndex = null;
    if (!state.isAdmin && !state.sectionSummaryRef) state.sectionSummaryRef = subscribeSectionSummary(language);
  };
  ref.on('value', (snapshot) => {
    const stored = snapshot.val();
    if (stored && stored.version === SECTION_INDEX_VERSION) {
      state.sectionIndex = stored.sections || {};
      if (!state.isAdmin) state.sectionSummary = summaryFromIndex(state.sectionIndex);
      writeLanguageCache(language, 'section-index', {
        version: stored.version,
        updatedAt: stored.updatedAt || 0,
        sections: state.sectionIndex
      });
      writeLanguageCache(language, 'section-summary', state.sectionSummary);
      persistLanguageMarker(language);
      renderCurrentView();
    } else {
      fallBack();
    }
    syncSectionIndex(language);
  }, (err) => {
    console.warn('Section index unavailable — loading sections from sectionSummary instead', err);
    readLanguageCache(language, 'section-index').then(cached => {
      if (cached && language === state.language) {
        state.sectionIndex = cached.sections || {};
        if (!state.isAdmin) state.sectionSummary = summaryFromIndex(state.sectionIndex);
        renderCurrentView();
      } else {
        fallBack();
      }
    });
  });
  return ref;
}

const sortedJson = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
  : v));

const languageCacheScope = (language) => `language:${state.currentUser ? state.currentUser.uid : 'anonymous'}:${language}`;

function persistLanguageMarker(language) {
  if (language !== state.language || state.languageUpdateMarker === null) return;
  deviceCache.setMeta(`${languageCacheScope(language)}:marker`, state.languageUpdateMarker).then(result => {
    if (!result.ok) console.warn('Could not store the Language update marker locally.', result.error);
  });
}

async function readLanguageCache(language, key) {
  const result = await deviceCache.get(languageCacheScope(language), key);
  return result.ok && result.found ? result.value : null;
}

async function writeLanguageCache(language, key, value) {
  return deviceCache.set(languageCacheScope(language), key, value);
}

export function cacheSectionWords(language, section, words) {
  return writeLanguageCache(language, `words:${section}`, words);
}

export function cacheSectionSummary(language) {
  return writeLanguageCache(language, 'section-summary', state.sectionSummary);
}

export async function readCachedSectionWords(language, section) {
  return readLanguageCache(language, `words:${section}`);
}

let sectionIndexSyncing = false;
let sectionIndexResync = false;
// Admins only: write whatever parts of the index differ from sectionSummary
async function syncSectionIndex(language) {
  if (!state.isAdmin || !state.sectionSummaryLoaded || state.sectionIndex === undefined || language !== state.language) return;
  if (sectionIndexSyncing) {
    sectionIndexResync = true;
    return;
  }
  const desired = buildSectionIndex(language, state.sectionSummary);
  const updates = {};
  if (state.sectionIndex === null) {
    updates[`sectionIndex/${language}`] = { version: SECTION_INDEX_VERSION, updatedAt: Date.now(), sections: desired };
  } else {
    new Set([...Object.keys(desired), ...Object.keys(state.sectionIndex)]).forEach(top => {
      if (sortedJson(desired[top] || null) !== sortedJson(state.sectionIndex[top] || null)) {
        updates[`sectionIndex/${language}/sections/${top}`] = desired[top] || null;
      }
    });
    if (!Object.keys(updates).length) return;
    updates[`sectionIndex/${language}/updatedAt`] = Date.now();
  }
  sectionIndexSyncing = true;
  try {
    await updateJapanData(updates);
  } catch (err) {
    console.warn('Could not update the section index', err);
  } finally {
    sectionIndexSyncing = false;
    if (sectionIndexResync) {
      sectionIndexResync = false;
      syncSectionIndex(language);
    }
  }
}

export function subscribeHiddenSections(language) {
  const ref = japanRef.child(`hiddenSections/${language}`);
  ref.on('value', (snapshot) => {
    state.hiddenSections = snapshot.val() || {};
    writeLanguageCache(language, 'hidden-sections', state.hiddenSections);
    persistLanguageMarker(language);
    renderCurrentView();
  }, (err) => {
    console.error('Failed to subscribe to hidden sections', err);
    readLanguageCache(language, 'hidden-sections').then(value => {
      if (!value || language !== state.language) return;
      state.hiddenSections = value;
      renderCurrentView();
    });
  });
  return ref;
}

export function subscribeStarredSections(language) {
  const ref = japanRef.child(`starredSections/${language}`);
  ref.on('value', (snapshot) => {
    state.starredSections = snapshot.val() || {};
    writeLanguageCache(language, 'starred-sections', state.starredSections);
    persistLanguageMarker(language);
    renderCurrentView();
  }, (err) => {
    console.error('Failed to subscribe to starred sections', err);
    readLanguageCache(language, 'starred-sections').then(value => {
      if (!value || language !== state.language) return;
      state.starredSections = value;
      renderCurrentView();
    });
  });
  return ref;
}

export function teardownLanguageData() {
  closeQuickAdd();
  state.sectionMenu = { section: null, mode: 'closed' };
  if (state.sectionSummaryRef) {
    state.sectionSummaryRef.off('value');
    state.sectionSummaryRef = null;
  }
  if (state.languageUpdateMarkerRef) {
    state.languageUpdateMarkerRef.off('value');
    state.languageUpdateMarkerRef = null;
  }
  state.languageUpdateMarker = null;
  state.languageDataSubscriptionsActive = false;
  if (state.sectionIndexRef) {
    state.sectionIndexRef.off('value');
    state.sectionIndexRef = null;
  }
  state.sectionIndex = undefined;
  state.sectionSummaryLoaded = false;
  if (state.hiddenSectionsRef) {
    state.hiddenSectionsRef.off('value');
    state.hiddenSectionsRef = null;
  }
  if (state.starredSectionsRef) {
    state.starredSectionsRef.off('value');
    state.starredSectionsRef = null;
  }
  state.sectionListeners.forEach(ref => ref.off('value'));
  state.sectionListeners.clear();
  state.sectionCache.clear();
  state.sectionNotes.clear();
  state.sectionSummary = {};
  state.discoveredSections = {};
  state.hiddenSections = {};
  state.starredSections = {};
  state.expandedSections.clear();
  state.expandedUnsectionedGroups.clear();
}

export async function switchLanguage(language) {
  teardownLanguageData();
  state.language = language;
  const [cachedIndex, cachedSummary, cachedHidden, cachedStarred] = await Promise.all([
    readLanguageCache(language, 'section-index'),
    readLanguageCache(language, 'section-summary'),
    readLanguageCache(language, 'hidden-sections'),
    readLanguageCache(language, 'starred-sections')
  ]);
  if (language !== state.language) return;
  const markerRef = database.ref('contentUpdateMarkers/language');
  const cachedMarker = await deviceCache.getMeta(`${languageCacheScope(language)}:marker`);
  if (cachedMarker.ok && cachedMarker.found) state.languageUpdateMarker = cachedMarker.value;
  let shouldRefreshFromFirebase = !cachedIndex && !cachedSummary;
  if (navigator.onLine) {
    try {
      const markerSnapshot = await markerRef.once('value');
      const onlineMarker = Number(markerSnapshot.val()) || 0;
      shouldRefreshFromFirebase = shouldRefreshFromFirebase || onlineMarker !== state.languageUpdateMarker;
      state.languageUpdateMarker = onlineMarker;
    } catch (error) {
      state.languageUpdateMarker = null;
      console.warn('Language update marker is unavailable; using cached data where Firebase cannot be reached.', error);
    }
  }
  if (cachedIndex) {
    state.sectionIndex = cachedIndex.sections || {};
    state.sectionSummary = cachedSummary || summaryFromIndex(state.sectionIndex);
  } else if (cachedSummary) {
    state.sectionIndex = null;
    state.sectionSummary = cachedSummary;
  }
  if (cachedHidden) state.hiddenSections = cachedHidden;
  if (cachedStarred) state.starredSections = cachedStarred;
  if (cachedIndex || cachedSummary) state.sectionSummaryLoaded = true;
  renderCurrentView();

  state.languageUpdateMarkerRef = markerRef;
  markerRef.on('value', snapshot => {
    if (language !== state.language) return;
    const updatedAt = Number(snapshot.val()) || 0;
    if (updatedAt === state.languageUpdateMarker) return;
    state.languageUpdateMarker = updatedAt;
    if (!state.languageDataSubscriptionsActive) {
      subscribeLanguageData(language);
      refreshCachedLanguageSections();
    }
  }, error => console.warn('Could not watch the global Language update marker.', error));

  if (navigator.onLine) {
    state.sectionSummaryRef = subscribeSectionSummary(language);
    const reconcileSections = async () => {
      if (state.isAdmin) await bootstrapLanguageIfNeeded(language);
      await reconcileMissingSectionSummaryEntries(language);
    };
    reconcileSections().catch(error => {
      console.error(`Could not reconcile Language sections for "${language}".`, error);
    });
  }

  if (shouldRefreshFromFirebase) {
    subscribeLanguageData(language);
    refreshCachedLanguageSections();
  }
}

function refreshCachedLanguageSections() {
  for (const section of state.sectionCache.keys()) {
    ensureSectionLoaded(section).catch(error => {
      console.error(`Could not refresh cached section "${section}".`, error);
    });
  }
}

function subscribeLanguageData(language) {
  if (state.languageDataSubscriptionsActive || !navigator.onLine || language !== state.language) return;
  state.languageDataSubscriptionsActive = true;
  // Bootstrap is a background, best-effort, admin-only write — it must never
  // block the summary subscription below.
  bootstrapLanguageIfNeeded(language).catch(err => {
    console.error('Failed to bootstrap language index', err);
  });
  // Cached data is kept until the Firebase listeners deliver refreshed values.
  state.sectionIndexRef = subscribeSectionIndex(language);
  if (!state.sectionSummaryRef) state.sectionSummaryRef = subscribeSectionSummary(language);
  state.hiddenSectionsRef = subscribeHiddenSections(language);
  state.starredSectionsRef = subscribeStarredSections(language);
}

export function renderCurrentView() {
  renderSectionHeaders();
}

// Default view: section headers + counts only, straight from sectionSummary.
// A section's actual word cards are fetched (via ensureSectionLoaded) only
// when that section is expanded or read. A search query filters
// this list down to sections whose NAME matches — it never searches word
// content, so it never needs to fetch anything beyond the header list.

// Always reflects the full corpus (not the current search filter), so it
// reads as a stable "here's everything" overview next to the eye toggle.
export function updateEntryCounts() {
  let hiddenTotal = 0;
  let visibleTotal = 0;
  getTopLevelSectionNames().forEach(section => {
    const parentHidden = isSectionHidden(section);
    const ownCount = state.sectionSummary[section] || 0;
    if (parentHidden) hiddenTotal += ownCount;
    else visibleTotal += ownCount;

    // A subsection follows its parent when the parent itself is hidden;
    // otherwise it's only hidden if it's been explicitly hidden on its own.
    getSubsectionsOf(section).forEach(sub => {
      const subCount = state.sectionSummary[sub] || 0;
      if (parentHidden || isSectionHidden(sub)) hiddenTotal += subCount;
      else visibleTotal += subCount;
    });
  });
  dictionaryCount.textContent = `${hiddenTotal} hidden | ${visibleTotal} visible`;
}

export function renderSectionHeaders() {
  const query = normalize(state.query);
  const sections = getTopLevelSectionNames()
    .filter(section => !query || section.toLowerCase().includes(query))
    .filter(section => !isSectionHidden(section));
  updateEntryCounts();
  dictionaryList.innerHTML = '';
  state.sectionHeaderDomRefs = new Map();

  if (!sections.length) {
    notifyLanguageRibbon();
    return;
  }

  sections.forEach(section => {
    const wrapper = buildSectionDetailsShell(section, state.sectionSummary[section] || 0);
    state.sectionHeaderDomRefs.set(section, wrapper);
    dictionaryList.appendChild(wrapper);
    if (state.expandedSections.has(section)) {
      wrapper.querySelector('details').open = true;
      loadAndRenderSectionBody(section);
    }
  });
  notifyLanguageRibbon();
}

function notifyLanguageRibbon() {
  const activeSection = state.lastActiveSection &&
    state.expandedSections.has(state.lastActiveSection) &&
    state.sectionHeaderDomRefs.has(state.lastActiveSection)
    ? state.lastActiveSection
    : Array.from(state.expandedSections).reverse().find(section => state.sectionHeaderDomRefs.has(section));
  const language = state.language.charAt(0).toUpperCase() + state.language.slice(1);
  const path = [language, ...(activeSection ? activeSection.split('>') : [])];
  window.parent.postMessage({ type: 'language-studio-path', path }, window.location.origin);
}

// Enter in the section filter box: if the typed name doesn't match any
// existing section, it creates a new (empty) one instead of just filtering
// down to nothing — admins only, since this writes to the dictionary.
export function handleSectionFilterEnter() {
  if (!state.isAdmin) return;
  const raw = sectionFilterInput.value.trim();
  if (!raw) return;
  const normalized = raw.toUpperCase();
  if (Object.keys(state.sectionSummary).includes(normalized)) return;
  createNewSection(normalized);
}

export async function createNewSection(section) {
  try {
    // Only seed a count if this section doesn't already exist — avoids a
    // race clobbering a concurrent admin's count with a stale 0.
    const result = await japanRef.child(`sectionSummary/${state.language}/${section}`).transaction(current => (current === null ? 0 : current));
    if (result.committed) await markLanguageUpdated();
  } catch (err) {
    console.error('Failed to create section', err);
    window.alert('Failed to create section. See console for details.');
    return;
  }
  sectionFilterInput.value = '';
  state.query = '';
  state.expandedSections.add(section);
  renderCurrentView();
  const wrapper = state.sectionHeaderDomRefs.get(section);
  if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function getDistinctSections() {
  return Object.keys(state.sectionSummary)
    .filter(section => section !== 'UNCATEGORIZED')
    .sort((a, b) => a.localeCompare(b));
}

// Returns a wrapper <div> containing the <details> plus a sibling actions
// bar — the actions bar can't live inside the <details> at all (not even
// as a sibling of <summary>): Chromium refuses to render or hit-test any
// non-summary child of a closed <details>, and that isn't something CSS
// can override (display/content-visibility overrides had no effect). It
// also can't live inside <summary> — interactive controls nested there
// aren't reliably reachable by keyboard/assistive tech. A true sibling of
// <details> itself is unaffected by any of that.
// Header count: "26 - 649" (subsections - words, its own plus all of theirs) for a section
// with subsections, just the word count otherwise.
function sectionCountLabel(section, count) {
  const indexed = !isSubsection(section) && sectionIndexEntry(section);
  if (indexed) return indexed.subsections ? `${indexed.subsections} - ${indexed.totalWords}` : String(count);
  const subs = isSubsection(section) ? [] : getSubsectionsOf(section);
  if (!subs.length) return String(count);
  const words = subs.reduce((sum, sub) => sum + (state.sectionSummary[sub] || 0), count);
  return `${subs.length} - ${words}`;
}

export function buildSectionDetailsShell(section, count) {
  const sub = isSubsection(section);

  const wrapper = document.createElement('div');
  wrapper.className = sub ? 'section-row section-row-sub' : 'section-row';
  // Lets a card drag's hit-testing (elementFromPoint + closest) read back
  // which section a given row is, without needing a separate DOM->name
  // reverse lookup.
  wrapper.dataset.section = section;
  // Desktop "which section does space-bar/swipe target" signal — mobile
  // has no hover, so it falls back to lastActiveSection below instead.
  wrapper.addEventListener('mouseenter', () => { state.hoveredSection = section; });
  wrapper.addEventListener('mouseleave', () => {
    if (state.hoveredSection === section) state.hoveredSection = null;
  });

  const details = document.createElement('details');
  details.className = 'section-group';

  const summary = document.createElement('summary');
  const label = sub ? getSubsectionLabel(section) : section;
  const starMark = isSectionStarred(section) ? '<span class="section-star-mark">★</span> ' : '';
  summary.innerHTML = `<span class="section-label">${starMark}${escapeHtml(label)} (${sectionCountLabel(section, count)})</span>`;
  details.appendChild(summary);
  if (state.isAdmin) {
    // Double-click / double-tap the heading to rename it — the same gesture that edits a word
    // card. (The two clicks also open and close the section, leaving it as it was.) Tracked by
    // section name, since opening a section can rebuild this heading between the two taps.
    summary.addEventListener('pointerup', (event) => {
      if (event.button > 0) return;
      const isDoubleTap = lastHeadingTap.section === section && event.timeStamp - lastHeadingTap.time <= RENAME_DOUBLE_TAP_MS;
      lastHeadingTap = isDoubleTap ? { section: null, time: 0 } : { section, time: event.timeStamp };
      if (!isDoubleTap) return;
      // This tap's own click would reach the menu's close-on-outside-click handler and shut it
      // again, so stop that one click at the document (the section still opens/closes as usual).
      const keepMenuOpen = (clickEvent) => clickEvent.stopPropagation();
      document.addEventListener('click', keepMenuOpen, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', keepMenuOpen, { capture: true }), 600);
      openSectionRename(section);
    });
  }

  const body = document.createElement('div');
  body.className = 'section-body space-y-2';
  body.innerHTML = '<div class="text-xs text-slate-400 dark:text-slate-500 py-1">Loading…</div>';
  details.appendChild(body);

  details.addEventListener('toggle', () => {
    if (details.open) {
      state.expandedSections.add(section);
      state.lastActiveSection = section;
      loadAndRenderSectionBody(section);
    } else {
      state.expandedSections.delete(section);
    }
    notifyLanguageRibbon();
    // Opening/closing a subsection also flips whether its parent's own
    // words show flat or tucked into the "Unsectioned" group — refresh
    // just that part of the parent (never the parent's subsections, which
    // would re-toggle this very row).
    if (sub) {
      updateOwnEntriesDisplay(getParentSectionName(section));
    }
  });

  wrapper.appendChild(details);

  const actions = document.createElement('span');
  actions.className = 'section-actions';

  // Hide/un-hide stays outside the popup, right before the kebab — a
  // section is added to via the space-bar/swipe shortcut (targeting
  // whichever section is hovered/last-active) rather than a per-row button.

  // In the hidden pane, a still-visible parent shown only as a container
  // for its hidden subsections isn't itself a hidden thing to un-hide —
  // toggling it here would actually hide it, so skip the button.
  if (state.isAdmin) {
    // Add / edit this section's note, on the heading's own line
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'section-action-btn';
    noteBtn.dataset.noteBtn = '';
    noteBtn.title = 'Add / edit note';
    noteBtn.setAttribute('aria-label', 'Add or edit note');
    noteBtn.innerHTML = '<svg class="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M14.5 2.5a1.4 1.4 0 0 1 2 2L10 11l-2.7.7.7-2.7z"/></svg>';
    noteBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openNoteEditor(section);
    });
    actions.appendChild(noteBtn);
  }

  const menuWrap = document.createElement('span');
  menuWrap.className = 'section-menu-wrap';

  const menuToggleBtn = document.createElement('button');
  menuToggleBtn.type = 'button';
  menuToggleBtn.className = 'section-action-btn';
  menuToggleBtn.title = 'More actions';
  menuToggleBtn.textContent = '⋮';
  menuToggleBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSectionMenu(section);
  });
  menuWrap.appendChild(menuToggleBtn);

  // The less-frequent actions (read/merge/delete) live behind this
  // kebab button, rebuilt open or closed straight from state — no
  // reattachment dance needed since (unlike the add widget) this menu
  // isn't a shared singleton DOM node moved between rows.
  if (state.sectionMenu.section === section && state.sectionMenu.mode !== 'closed') {
    const menuEl = document.createElement('div');
    menuEl.className = 'section-menu';
    menuEl.addEventListener('click', (event) => event.stopPropagation());
    if (state.sectionMenu.mode === 'merge') {
      renderSectionMergePicker(menuEl, section);
    } else if (state.sectionMenu.mode === 'rename') {
      renderSectionRenamePicker(menuEl, section);
    } else {
      renderSectionMenuList(menuEl, section, sub);
    }
    menuWrap.appendChild(menuEl);
    // wrapper isn't attached to the document yet — the caller appends it
    // right after this function returns — so the button/menu have no
    // real layout to measure until the next paint.
    requestAnimationFrame(() => positionSectionMenu(menuEl, menuToggleBtn));
  }

  actions.appendChild(menuWrap);
  wrapper.appendChild(actions);

  return wrapper;
}

// Places the (position:fixed) dropdown from the kebab button's actual
// screen coordinates — flush under its bottom-right corner, flipped
// above if there isn't room below, and clamped so it can't run off the
// left/right edge of the viewport either.
export function positionSectionMenu(menuEl, anchorBtn) {
  const anchorRect = anchorBtn.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  let left = anchorRect.right - menuRect.width;
  left = Math.max(4, Math.min(left, viewportWidth - menuRect.width - 4));

  let top = anchorRect.bottom + 4;
  if (top + menuRect.height > viewportHeight - 4) {
    top = anchorRect.top - menuRect.height - 4;
  }
  top = Math.max(4, top);

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

export function toggleSectionMenu(section) {
  if (state.sectionMenu.section === section && state.sectionMenu.mode !== 'closed') {
    closeSectionMenu();
    return;
  }
  state.sectionMenu = { section, mode: 'menu' };
  renderCurrentView();
}

export function closeSectionMenu() {
  state.sectionMenu = { section: null, mode: 'closed' };
  renderCurrentView();
}

// The open kebab menu's contents: one icon per action (star/read,
// plus merge/delete for admins). Add and hide/un-hide live outside the
// menu entirely (see buildSectionDetailsShell), so every action here can
// safely use closeSectionMenu's simple close-then-rerender.
export function renderSectionMenuList(menuEl, section, sub) {
  const readTitle = sub ? 'Read this subsection' : 'Read this section (and its subsections)';
  const deleteTitle = sub ? 'Delete this subsection' : 'Delete this section';
  const starred = isSectionStarred(section);
  const starTitle = starred ? 'Un-star this (remove from top 5)' : 'Star this (mark as a top 5 section)';

  menuEl.innerHTML = `
    <div class="section-menu-grid">
      ${state.isAdmin ? `<button type="button" class="section-menu-icon-btn${starred ? ' section-menu-icon-starred' : ''}" data-menu-star title="${escapeHtml(starTitle)}">${starred ? '★' : '☆'}</button>` : ''}
      <button type="button" class="section-menu-icon-btn" data-menu-read title="${escapeHtml(readTitle)}">▶</button>
      ${state.isAdmin ? `
        <button type="button" class="section-menu-icon-btn" data-menu-note title="Note">📝</button>
        <button type="button" class="section-menu-icon-btn" data-menu-rename title="Rename">✎</button>
        <button type="button" class="section-menu-icon-btn" data-menu-merge title="Merge into…">⇄</button>
        <button type="button" class="section-menu-icon-btn section-menu-icon-danger" data-menu-delete title="${escapeHtml(deleteTitle)}"><svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">${TRASH_ICON_PATHS}</svg></button>
      ` : ''}
    </div>
  `;

  const starBtn = menuEl.querySelector('[data-menu-star]');
  if (starBtn) starBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeSectionMenu();
    toggleSectionStarred(section);
  });
  menuEl.querySelector('[data-menu-read]').addEventListener('click', (event) => {
    event.stopPropagation();
    closeSectionMenu();
    startSectionReading(section);
  });
  const noteBtn = menuEl.querySelector('[data-menu-note]');
  if (noteBtn) noteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeSectionMenu();
    openNoteEditor(section);
  });
  const renameBtn = menuEl.querySelector('[data-menu-rename]');
  if (renameBtn) renameBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.sectionMenu = { section, mode: 'rename' };
    renderSectionRenamePicker(menuEl, section);
  });
  const mergeBtn = menuEl.querySelector('[data-menu-merge]');
  if (mergeBtn) mergeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    state.sectionMenu = { section, mode: 'merge' };
    renderSectionMergePicker(menuEl, section);
  });
  const deleteBtn = menuEl.querySelector('[data-menu-delete]');
  if (deleteBtn) deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeSectionMenu();
    deleteSectionEntirely(section);
  });
}

// Swaps the open menu's contents for a single section-name input (reusing
// the same autocomplete-datalist pattern as the word-level move picker)
// plus confirm/cancel — kept in the same menu node rather than closing
// and reopening it.
export function renderSectionMergePicker(menuEl, section) {
  menuEl.innerHTML = `
    <div class="section-menu-merge">
      <input type="text" class="section-menu-merge-input" data-merge-target-input list="section-merge-options" placeholder="Merge into…" />
      <div class="section-menu-merge-actions">
        <button type="button" class="section-menu-item" data-merge-cancel>Cancel</button>
        <button type="button" class="section-menu-item section-menu-item-primary" data-merge-confirm>Merge</button>
      </div>
    </div>
  `;
  if (menuEl.previousElementSibling) {
    requestAnimationFrame(() => positionSectionMenu(menuEl, menuEl.previousElementSibling));
  }

  const datalist = document.getElementById('section-merge-options');
  datalist.innerHTML = getDistinctSections()
    .filter(name => name !== section)
    .map(name => `<option value="${escapeHtml(name)}"></option>`)
    .join('');

  const backToMenu = () => {
    state.sectionMenu = { section, mode: 'menu' };
    renderSectionMenuList(menuEl, section, isSubsection(section));
    if (menuEl.previousElementSibling) {
      requestAnimationFrame(() => positionSectionMenu(menuEl, menuEl.previousElementSibling));
    }
  };

  const input = menuEl.querySelector('[data-merge-target-input]');
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmSectionMerge(section, input.value);
    } else if (event.key === 'Escape') {
      backToMenu();
    }
  });
  input.focus();

  menuEl.querySelector('[data-merge-cancel]').addEventListener('click', (event) => {
    event.stopPropagation();
    backToMenu();
  });
  menuEl.querySelector('[data-merge-confirm]').addEventListener('click', (event) => {
    event.stopPropagation();
    confirmSectionMerge(section, input.value);
  });
}

const RENAME_DOUBLE_TAP_MS = 300;
let lastHeadingTap = { section: null, time: 0 };

// Opens the section's menu straight on its rename field (double-click/tap on the heading).
export function openSectionRename(section) {
  if (!state.isAdmin) return;
  state.sectionMenu = { section, mode: 'rename' };
  renderCurrentView();
}

// Same in-menu pattern as the merge picker: one name field (pre-filled with the current
// name) plus Cancel/Rename, swapped into the open menu node.
export function renderSectionRenamePicker(menuEl, section) {
  const currentLabel = getSubsectionLabel(section);
  menuEl.innerHTML = `
    <div class="section-menu-merge">
      <input type="text" class="section-menu-merge-input" data-rename-input value="${escapeHtml(currentLabel)}" aria-label="New section name" />
      <div class="section-menu-merge-actions">
        <button type="button" class="section-menu-item" data-rename-cancel>Cancel</button>
        <button type="button" class="section-menu-item section-menu-item-primary" data-rename-confirm>Rename</button>
      </div>
    </div>
  `;
  if (menuEl.previousElementSibling) {
    requestAnimationFrame(() => positionSectionMenu(menuEl, menuEl.previousElementSibling));
  }

  const input = menuEl.querySelector('[data-rename-input]');
  const submit = async () => {
    if (await renameSection(section, input.value)) closeSectionMenu();
    else input.focus(); // Name refused: keep editing (Esc still cancels)
  };
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      closeSectionMenu();
    }
  });
  menuEl.querySelector('[data-rename-cancel]').addEventListener('click', (event) => {
    event.stopPropagation();
    closeSectionMenu();
  });
  menuEl.querySelector('[data-rename-confirm]').addEventListener('click', (event) => {
    event.stopPropagation();
    submit();
  });
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

// Renames a section (or subsection) in place: its words, word count, hidden and
// starred flags, and — for a top-level section — its subsections all move to the
// new name. Refuses a name that's already taken (that's what merge is for).
// Returns true once renamed (or when the name didn't change).
export async function renameSection(section, rawName) {
  const newLabel = (rawName || '').trim().toUpperCase();
  if (!newLabel) return false;
  if (newLabel.includes('>')) {
    window.alert("A section name can't contain '>'.");
    return false;
  }
  if (/[.#$[\]/]/.test(newLabel)) {
    window.alert("A section name can't contain . # $ [ ] or /");
    return false;
  }
  const parent = getParentSectionName(section);
  const target = parent ? `${parent}>${newLabel}` : newLabel;
  if (target === section) return true;
  if (Object.prototype.hasOwnProperty.call(state.sectionSummary, target)) {
    window.alert(`"${getSectionDisplayLabel(target)}" already exists. Use Merge to combine the two.`);
    return false;
  }
  if (!state.isAdmin) {
    window.alert('You are not authorized to rename sections.');
    return false;
  }

  const moves = [[section, target]];
  if (!parent) {
    getSubsectionsOf(section).forEach(sub => moves.push([sub, `${target}>${getSubsectionLabel(sub)}`]));
  }
  try {
    const updates = {};
    for (const [from, to] of moves) {
      const words = (await wordsRef.child(state.language).child(from).once('value')).val();
      updates[`words/${state.language}/${to}`] = words || null;
      updates[`words/${state.language}/${from}`] = null;
      updates[`sectionSummary/${state.language}/${to}`] = state.sectionSummary[from] || 0;
      updates[`sectionSummary/${state.language}/${from}`] = null;
      updates[`hiddenSections/${state.language}/${to}`] = isSectionHidden(from) ? true : null;
      updates[`hiddenSections/${state.language}/${from}`] = null;
      updates[`starredSections/${state.language}/${to}`] = isSectionStarred(from) ? true : null;
      updates[`starredSections/${state.language}/${from}`] = null;
      const note = (await japanRef.child(`sectionNotes/${state.language}/${from}`).once('value')).val();
      updates[`sectionNotes/${state.language}/${to}`] = note || null;
      updates[`sectionNotes/${state.language}/${from}`] = null;
    }
    await updateJapanData(updates);
  } catch (err) {
    console.error('Failed to rename section', err);
    window.alert('Failed to rename section. See console for details.');
    return false;
  }

  // Keep it open / targeted under its new name
  moves.forEach(([from, to]) => {
    if (state.expandedSections.has(from)) state.expandedSections.add(to);
    if (state.lastActiveSection === from) state.lastActiveSection = to;
    if (state.hoveredSection === from) state.hoveredSection = to;
  });
  forgetSections(moves.map(([from]) => from));
  return true;
}

// A merged-away section's note is appended to the target's note (or becomes it)
async function addNoteMergeUpdates(updates, from, to) {
  const [source, target] = await Promise.all([from, to].map(name =>
    japanRef.child(`sectionNotes/${state.language}/${name}`).once('value').then(snap => snap.val())));
  if (source && source.html) {
    updates[`sectionNotes/${state.language}/${to}`] = {
      ...(target || {}),
      ...source,
      html: target && target.html ? `${target.html}<p><br></p>${source.html}` : source.html,
      updatedAt: Date.now(),
    };
  }
  updates[`sectionNotes/${state.language}/${from}`] = null;
}

// Moves everything out of `section` and into `target`, then removes
// `section` entirely. A source section's own subsections (a subsection
// never has any of its own) are re-parented under the target rather than
// dropped — TARGET>CHILD, merging word counts with any same-named
// subsection the target already has.
export async function confirmSectionMerge(section, rawTarget) {
  const target = (rawTarget || '').trim().toUpperCase();
  if (!target) return;
  if (target === section) {
    closeSectionMenu();
    return;
  }
  if (getParentSectionName(target) === section) {
    window.alert("Can't merge a section into its own subsection.");
    return;
  }

  const sourceLabel = getSectionDisplayLabel(section);
  const targetLabel = getSectionDisplayLabel(target);
  if (!window.confirm(`Merge "${sourceLabel}" into "${targetLabel}"? All its words (and any subsections) move there, and "${sourceLabel}" is removed. This can't be undone.`)) {
    return;
  }
  if (!state.isAdmin) {
    window.alert('You are not authorized to merge sections.');
    return;
  }

  const removedKeys = [section];
  try {
    const updates = {};

    const sourceWordsSnap = await wordsRef.child(state.language).child(section).once('value');
    const sourceWords = sourceWordsSnap.val() || {};
    Object.entries(sourceWords).forEach(([id, data]) => {
      updates[`words/${state.language}/${target}/${id}`] = data;
    });
    updates[`words/${state.language}/${section}`] = null;

    const existingTargetCount = state.sectionSummary[target] || 0;
    updates[`sectionSummary/${state.language}/${target}`] = existingTargetCount + Object.keys(sourceWords).length;
    updates[`sectionSummary/${state.language}/${section}`] = null;
    updates[`hiddenSections/${state.language}/${section}`] = null;
    await addNoteMergeUpdates(updates, section, target);

    for (const sub of getSubsectionsOf(section)) {
      const newSubKey = `${target}>${getSubsectionLabel(sub)}`;
      const subWordsSnap = await wordsRef.child(state.language).child(sub).once('value');
      const subWords = subWordsSnap.val() || {};
      Object.entries(subWords).forEach(([id, data]) => {
        updates[`words/${state.language}/${newSubKey}/${id}`] = data;
      });
      updates[`words/${state.language}/${sub}`] = null;

      const existingNewSubCount = state.sectionSummary[newSubKey] || 0;
      updates[`sectionSummary/${state.language}/${newSubKey}`] = existingNewSubCount + Object.keys(subWords).length;
      updates[`sectionSummary/${state.language}/${sub}`] = null;

      if (isSectionHidden(sub)) updates[`hiddenSections/${state.language}/${newSubKey}`] = true;
      updates[`hiddenSections/${state.language}/${sub}`] = null;
      await addNoteMergeUpdates(updates, sub, newSubKey);

      removedKeys.push(sub);
    }

    await updateJapanData(updates);
  } catch (err) {
    console.error('Failed to merge section', err);
    window.alert('Failed to merge section. See console for details.');
    return;
  }

  forgetSections(removedKeys);
  state.sectionNotes.clear(); // The target's note may now include the merged one
  closeSectionMenu();
}

// Deletes a section (or subsection) outright, including every word in
// it. Deleting a top-level section also deletes its subsections — there
// being nowhere else for their words to go, unlike a merge.
export async function deleteSectionEntirely(section) {
  const sub = isSubsection(section);
  const subs = sub ? [] : getSubsectionsOf(section);
  const ownCount = state.sectionSummary[section] || 0;
  const subCount = subs.reduce((sum, name) => sum + (state.sectionSummary[name] || 0), 0);
  const totalWords = ownCount + subCount;
  const label = getSectionDisplayLabel(section);
  const detail = subs.length
    ? `"${label}" and its ${subs.length} subsection${subs.length === 1 ? '' : 's'} (${totalWords} word${totalWords === 1 ? '' : 's'} total)`
    : `"${label}" (${totalWords} word${totalWords === 1 ? '' : 's'})`;

  if (!window.confirm(`Delete ${detail}? This can't be undone.`)) return;
  if (!state.isAdmin) {
    window.alert('You are not authorized to delete this section.');
    return;
  }

  try {
    const updates = {};
    updates[`words/${state.language}/${section}`] = null;
    updates[`sectionSummary/${state.language}/${section}`] = null;
    updates[`hiddenSections/${state.language}/${section}`] = null;
    updates[`sectionNotes/${state.language}/${section}`] = null;
    subs.forEach(name => {
      updates[`words/${state.language}/${name}`] = null;
      updates[`sectionSummary/${state.language}/${name}`] = null;
      updates[`hiddenSections/${state.language}/${name}`] = null;
      updates[`sectionNotes/${state.language}/${name}`] = null;
    });
    await updateJapanData(updates);
  } catch (err) {
    console.error('Failed to delete section', err);
    window.alert('Failed to delete section. See console for details.');
    return;
  }

  forgetSections([section, ...subs]);
}

// Common cleanup after a section key stops existing (deleted, or merged
// away): drops its local caches and detaches its live listener, so nothing
// stale lingers between now and the sectionSummary listener's next
// (already-in-flight) re-render.
export function forgetSections(names) {
  names.forEach(name => {
    state.expandedSections.delete(name);
    state.sectionCache.delete(name);
    state.sectionNotes.delete(name);
    if (state.sectionListeners.has(name)) {
      state.sectionListeners.get(name).off('value');
      state.sectionListeners.delete(name);
    }
  });
}

export function loadAndRenderSectionBody(section) {
  ensureSectionLoaded(section).then(entries => renderSectionBodyIfPresent(section, entries));
}

// Called both right after a section's data first arrives and on every later
// live update to it — a no-op if that section isn't currently on screen
// (e.g. it's been filtered out by search, or the view is alpha-grouped).
// Subsections render nested, at the top of their parent's body, ahead of
// that parent's own word cards — a subsection never gets nested further.
export function renderSectionBodyIfPresent(section, entries) {
  const wrapper = state.sectionHeaderDomRefs && state.sectionHeaderDomRefs.get(section);
  if (!wrapper || !dictionaryList.contains(wrapper)) return;
  const body = wrapper.querySelector('.section-body');
  if (!body) return;

  body.innerHTML = '';

  const subsections = isSubsection(section)
    ? []
    : getSubsectionsOf(section).filter(sub => !isSectionHidden(sub));
  subsections.forEach(sub => {
    const subWrapper = buildSectionDetailsShell(sub, state.sectionSummary[sub] || 0);
    state.sectionHeaderDomRefs.set(sub, subWrapper);
    body.appendChild(subWrapper);
    if (state.expandedSections.has(sub)) {
      subWrapper.querySelector('details').open = true;
      loadAndRenderSectionBody(sub);
    }
  });

  // In the hidden pane, a parent that isn't itself hidden can still be
  // shown above purely as a container for the hidden subsections just
  // rendered — its own words are visible in the normal pane already, so
  // there's nothing of its own to show here. While a card is being
  // dragged, EVERY section suppresses its own words too — a word can't
  // be dropped onto another word, so during a drag only section/
  // subsection headers should ever be visible as candidates.
  const suppressOwnEntries = !!state.cardDrag;
  if (!suppressOwnEntries) {
    const ownEntriesContainer = document.createElement('div');
    ownEntriesContainer.className = 'own-entries-container';
    body.appendChild(ownEntriesContainer);
    renderOwnEntriesInto(ownEntriesContainer, section, entries, subsections);
    renderSectionNoteInto(body, section);
  }
}

// Renders a parent's own (not-in-any-subsection) words — either as a flat
// list (the default) or, while one of its subsections is open, tucked
// behind a purely client-side "Unsectioned" group so the open subsection
// isn't crowded by ungrouped words alongside it. Split out from
// renderSectionBodyIfPresent so updateOwnEntriesDisplay can refresh just
// this part without rebuilding (and re-toggling) the subsections above it.
export function renderOwnEntriesInto(container, section, entries, subsections) {
  container.innerHTML = '';
  if (!entries.length) {
    if (!subsections.length) {
      const empty = document.createElement('div');
      empty.className = 'text-xs text-slate-400 dark:text-slate-500 py-1';
      empty.textContent = 'No words yet.';
      container.appendChild(empty);
    }
    return;
  }

  const anySubExpanded = subsections.some(sub => state.expandedSections.has(sub));
  if (subsections.length && anySubExpanded) {
    container.appendChild(buildUnsectionedGroup(section, entries));
    return;
  }

  // A dedicated wrapper (no space-y gap) so entries butt up against each
  // other with just the hairline divider between them, instead of the
  // section-body's normal item spacing (which still applies to the
  // subsection rows above, and between this list and them).
  const wordList = document.createElement('div');
  wordList.className = 'word-list';
  entries.forEach(entry => wordList.appendChild(buildDictionaryCard(entry)));
  container.appendChild(wordList);
}

// A purely on-screen grouping — never written to Firebase, never a real
// section — that a parent's own words collapse into once a real
// subsection is opened alongside them. Collapses back into a flat list
// (see renderOwnEntriesInto) the moment no subsection is expanded.
export function buildUnsectionedGroup(parentSection, entries) {
  const details = document.createElement('details');
  details.className = 'section-group';
  if (state.expandedUnsectionedGroups.has(parentSection)) details.open = true;

  const summary = document.createElement('summary');
  summary.innerHTML = `<span class="section-label">Unsectioned (${entries.length})</span>`;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'section-body';
  const wordList = document.createElement('div');
  wordList.className = 'word-list';
  entries.forEach(entry => wordList.appendChild(buildDictionaryCard(entry)));
  body.appendChild(wordList);
  details.appendChild(body);

  details.addEventListener('toggle', () => {
    if (details.open) state.expandedUnsectionedGroups.add(parentSection);
    else state.expandedUnsectionedGroups.delete(parentSection);
  });

  return details;
}

// Refreshes just a parent's own-entries display in place (flat list <->
// "Unsectioned" group) without touching its subsections' DOM at all — used
// when a subsection opens/closes, so that can't recursively retrigger the
// subsection's own toggle handler via a full parent rebuild.
export function updateOwnEntriesDisplay(section) {
  const wrapper = state.sectionHeaderDomRefs && state.sectionHeaderDomRefs.get(section);
  if (!wrapper) return;
  // A plain '.own-entries-container' lookup would happily match a nested
  // subsection's own container instead of this section's — subsections
  // render before the parent's own words, so theirs comes first in
  // document order. Stepping through direct children only keeps this
  // scoped to section's own body, never descending into a subsection's.
  const ownBody = wrapper.querySelector(':scope > details > .section-body');
  if (!ownBody) return;
  const container = ownBody.querySelector(':scope > .own-entries-container');
  if (!container) return;
  const entries = state.sectionCache.get(section);
  if (!entries) return;
  const subsections = getSubsectionsOf(section).filter(sub => !isSectionHidden(sub));
  renderOwnEntriesInto(container, section, entries, subsections);
}
