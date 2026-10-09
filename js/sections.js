// Everything about sections and subsections: the data model (naming,
// sorting, hidden flags, edge colors, parent/child relationships), Firebase
// sync, and the entire section-list UI — headers, row actions, merge,
// delete, edge colors. If you're changing how sections are organized, sorted,
// hidden, colored, merged, or deleted, or how the section list/row actions
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
import { renderSectionNoteInto, openNoteEditor, hasSectionNote, buildNoteTag } from './section-notes.js';

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
  const priorityDiff = getSectionEdgePriority(a) - getSectionEdgePriority(b);
  if (priorityDiff) return priorityDiff;
  if (a === 'UNCATEGORIZED') return 1;
  if (b === 'UNCATEGORIZED') return -1;
  return a.localeCompare(b);
}

export function getSortedSectionNames() {
  const sections = new Set(Object.keys(state.sectionSummary));
  if (isUsableSectionIndex(state.sectionIndex)) {
    Object.entries(state.sectionIndex.sections).forEach(([section, entry]) => {
      sections.add(section);
      Object.values(entry.children || {}).forEach(child => sections.add(child.key));
    });
  }
  sections.forEach(section => {
    const parent = getParentSectionName(section);
    if (parent) sections.add(parent);
  });
  return [...sections].sort(sectionSort);
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


// Section edges: a thin colored line on each row's left edge. Each color is a
// priority level, and sectionSort groups same-colored sections together in this
// order. Blue is the default (stored as no entry) and the lowest priority.
export const SECTION_EDGE_COLORS = [
  { key: 'red', label: 'Red' },
  { key: 'orange', label: 'Orange' },
  { key: 'green', label: 'Green' },
  { key: 'purple', label: 'Purple' },
  { key: 'blue', label: 'Blue (default)' }
];
export const DEFAULT_SECTION_EDGE = 'blue';

export function getSectionEdge(section) {
  const stored = state.sectionEdges[section];
  if (SECTION_EDGE_COLORS.some(color => color.key === stored)) return stored;
  // A legacy "top 5" star reads as the top priority until it's given a color.
  return state.starredSections[section] ? SECTION_EDGE_COLORS[0].key : DEFAULT_SECTION_EDGE;
}

// 1 (highest) … 5 (default blue).
export function getSectionEdgePriority(section) {
  const edge = getSectionEdge(section);
  return SECTION_EDGE_COLORS.findIndex(color => color.key === edge) + 1;
}

// Sets a section's edge color, also clearing its legacy star so the color wins.
export async function setSectionEdge(section, color) {
  if (!SECTION_EDGE_COLORS.some(entry => entry.key === color)) return;
  const edgePath = `sectionEdges/${state.language}/${section}`;
  const starPath = `starredSections/${state.language}/${section}`;
  try {
    await updateJapanData(
      { [edgePath]: color === DEFAULT_SECTION_EDGE ? null : color, [starPath]: null },
      { [edgePath]: state.sectionEdges[section] || null, [starPath]: state.starredSections[section] ? true : null }
    );
    if (color === DEFAULT_SECTION_EDGE) delete state.sectionEdges[section];
    else state.sectionEdges[section] = color;
    delete state.starredSections[section];
    await Promise.all([
      writeLanguageCache(state.language, 'section-edges', state.sectionEdges),
      writeLanguageCache(state.language, 'starred-sections', state.starredSections)
    ]);
    renderCurrentView();
  } catch (err) {
    console.error('Failed to set section edge color', err);
    window.alert('Failed to update the section color. See console for details.');
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
  delete state.discoveredSections[section];
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
    const remote = snapshot.val() || {};
    // Sections found by scanning words only fill gaps: once the live summary has a
    // key, its value wins (a stale discovered count would freeze the header and
    // bring a deleted section back).
    Object.keys(state.discoveredSections).forEach(section => {
      if (Object.prototype.hasOwnProperty.call(remote, section)) delete state.discoveredSections[section];
    });
    state.sectionSummary = { ...state.discoveredSections, ...remote };
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

function isUsableSectionIndex(index) {
  if (!index || typeof index !== 'object' ||
      (index.version != null && index.version !== SECTION_INDEX_VERSION) ||
      !index.sections || typeof index.sections !== 'object' || Array.isArray(index.sections)) {
    return false;
  }
  return Object.values(index.sections).every(section =>
    section && typeof section.path === 'string' &&
    Number.isFinite(Number(section.words)) &&
    (!section.children || (typeof section.children === 'object' && !Array.isArray(section.children) &&
      Object.values(section.children).every(child =>
        child && typeof child.key === 'string' && typeof child.path === 'string' &&
        Number.isFinite(Number(child.words))
      )))
  );
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
    if (isUsableSectionIndex(stored)) {
      state.sectionIndex = stored.sections || {};
      if (!state.isAdmin && !state.sectionSummaryLoaded) {
        state.sectionSummary = { ...state.discoveredSections, ...summaryFromIndex(state.sectionIndex) };
      }
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
      if (isUsableSectionIndex(cached) && language === state.language) {
        state.sectionIndex = cached.sections || {};
        if (!state.isAdmin && !state.sectionSummaryLoaded) {
          state.sectionSummary = { ...state.discoveredSections, ...summaryFromIndex(state.sectionIndex) };
        }
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

export function upsertSectionCacheEntry(section, entry) {
  const entries = state.sectionCache.get(section);
  if (!entries) return null;
  const updated = [
    { ...entry, section },
    ...entries.filter(item => item.id !== entry.id)
  ].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  state.sectionCache.set(section, updated);
  return updated;
}

let backgroundLanguageDownload = null;

function waitForBackgroundDownloadPace() {
  return new Promise(resolve => setTimeout(resolve, 250));
}

async function fetchLanguageSectionKeys(language) {
  const user = state.currentUser;
  if (!user || !navigator.onLine) return [];
  const token = await user.getIdToken();
  const url = new URL(`${firebaseConfig.databaseURL}/languages/japan/words/${encodeURIComponent(language)}.json`);
  url.searchParams.set('shallow', 'true');
  url.searchParams.set('auth', token);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not list "${language}" sections (${response.status}).`);
  const keys = await response.json();
  return Object.keys(keys || {});
}

export function downloadLanguageContentInBackground(language = state.language) {
  if (backgroundLanguageDownload || !navigator.onLine || language !== state.language || !state.currentUser) return;
  backgroundLanguageDownload = (async () => {
    const userId = state.currentUser.uid;
    const scope = `language:${userId}:${language}`;
    const summaryAtStart = { ...state.sectionSummary };
    const startedAt = Date.now();
    try {
      const sections = await fetchLanguageSectionKeys(language);
      let marker = 0;
      try {
        const markerSnapshot = await database.ref('contentUpdateMarkers/language').once('value');
        marker = Number(markerSnapshot.val()) || 0;
      } catch (error) {
        console.warn('Language update marker is unavailable; refreshing cached sections without version checks.', error);
      }
      const results = [];
      let nextSectionIndex = 0;
      let cacheFull = false;
      const worker = async () => {
        while (nextSectionIndex < sections.length && Date.now() - startedAt < 10 * 60 * 1000) {
          const section = sections[nextSectionIndex++];
          if (!navigator.onLine || language !== state.language ||
            state.currentUser?.uid !== userId || cacheFull) return;
          await waitForBackgroundDownloadPace();
          const cacheKey = `words:${section}`;
          const existing = await deviceCache.get(scope, cacheKey);
          const cachedMarker = await deviceCache.getMeta(`${scope}:${cacheKey}:marker`);
          if (existing.ok && existing.found && marker && cachedMarker.ok &&
            cachedMarker.found && cachedMarker.value === marker) {
            results.push([section, Object.keys(existing.value || {}).length, 'cached']);
            continue;
          }

          const snapshot = await wordsRef.child(language).child(section).once('value');
          const words = snapshot.val() || {};
          const stored = await deviceCache.set(scope, cacheKey, words);
          if (!stored.ok) {
            if (stored.error.code === 'CONTENT_CAP_EXCEEDED') {
              console.warn('Background Language download stopped: the 100 MiB device cache is full.', stored.error);
              cacheFull = true;
              return;
            }
            console.warn(`Could not cache Language section "${section}".`, stored.error);
            continue;
          }
          if (marker) {
            const savedMarker = await deviceCache.setMeta(`${scope}:${cacheKey}:marker`, marker);
            if (!savedMarker.ok) console.warn(`Could not record the cache version for "${section}".`, savedMarker.error);
          }
          results.push([section, Object.keys(words).length, 'downloaded']);
        }
      };
      await Promise.all([worker(), worker()]);

      const updates = Object.fromEntries(results.map(([section, count]) => [section, count]));
      const contextStillCurrent = language === state.language && state.currentUser?.uid === userId;
      // Only sections the live summary doesn't list are new here; the rest already
      // have a live count, which these download-time counts must not override.
      const missing = Object.fromEntries(Object.entries(updates).filter(([section]) =>
        !Object.prototype.hasOwnProperty.call(state.sectionSummary, section)));
      if (contextStillCurrent && Object.keys(missing).length) {
        state.discoveredSections = { ...state.discoveredSections, ...missing };
        state.sectionSummary = { ...state.sectionSummary, ...missing };
        state.sectionSummaryLoaded = true;
        renderCurrentView();
        const summaryCache = await writeLanguageCache(language, 'section-summary', state.sectionSummary);
        if (!summaryCache.ok) console.warn('Could not cache the downloaded Language section list.', summaryCache.error);
      }
      if (cacheFull) return;
      if (nextSectionIndex < sections.length) {
        console.warn('Background Language download did not finish within 10 minutes. It will resume the next time the app opens online.');
        return;
      }

      const index = buildSectionIndex(language, { ...summaryAtStart, ...updates });
      const cachedIndex = await deviceCache.set(scope, 'section-index', {
        version: SECTION_INDEX_VERSION,
        updatedAt: marker,
        sections: index
      });
      if (!cachedIndex.ok) console.warn('Could not cache the downloaded Language section index.', cachedIndex.error);
      if (marker) {
        const savedMarker = await deviceCache.setMeta(`${scope}:marker`, marker);
        if (!savedMarker.ok) console.warn('Could not cache the Language update marker.', savedMarker.error);
      }
    } catch (error) {
      console.error('Background Language download failed.', error);
    } finally {
      backgroundLanguageDownload = null;
      if (navigator.onLine && state.currentUser?.uid === userId && state.language !== language) {
        setTimeout(() => downloadLanguageContentInBackground(state.language), 0);
      }
    }

    window.addEventListener('online', () => {
      setTimeout(() => downloadLanguageContentInBackground(state.language), 1000);
    });
  })();
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

export function subscribeSectionEdges(language) {
  const ref = japanRef.child(`sectionEdges/${language}`);
  ref.on('value', (snapshot) => {
    state.sectionEdges = snapshot.val() || {};
    writeLanguageCache(language, 'section-edges', state.sectionEdges);
    persistLanguageMarker(language);
    renderCurrentView();
  }, (err) => {
    console.error('Failed to subscribe to section edges', err);
    readLanguageCache(language, 'section-edges').then(value => {
      if (!value || language !== state.language) return;
      state.sectionEdges = value;
      renderCurrentView();
    });
  });
  return ref;
}

// Legacy "top 5" stars, still read so they sort as the top edge color.
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
  if (state.sectionEdgesRef) {
    state.sectionEdgesRef.off('value');
    state.sectionEdgesRef = null;
  }
  state.sectionListeners.forEach(ref => ref.off('value'));
  state.sectionListeners.clear();
  state.sectionCache.clear();
  state.sectionNotes.clear();
  state.sectionSummary = {};
  state.discoveredSections = {};
  state.hiddenSections = {};
  state.starredSections = {};
  state.sectionEdges = {};
  state.expandedSections.clear();
  state.expandedUnsectionedGroups.clear();
  state.expandedNotes.clear();
}

export async function switchLanguage(language) {
  teardownLanguageData();
  state.language = language;
  const [cachedIndex, cachedSummary, cachedHidden, cachedStarred, cachedEdges] = await Promise.all([
    readLanguageCache(language, 'section-index'),
    readLanguageCache(language, 'section-summary'),
    readLanguageCache(language, 'hidden-sections'),
    readLanguageCache(language, 'starred-sections'),
    readLanguageCache(language, 'section-edges')
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
  if (isUsableSectionIndex(cachedIndex)) {
    state.sectionIndex = cachedIndex.sections || {};
    state.sectionSummary = cachedSummary || summaryFromIndex(state.sectionIndex);
  } else if (cachedSummary) {
    state.sectionIndex = null;
    state.sectionSummary = cachedSummary;
  }
  if (cachedHidden) state.hiddenSections = cachedHidden;
  if (cachedStarred) state.starredSections = cachedStarred;
  if (cachedEdges) state.sectionEdges = cachedEdges;
  if (cachedIndex || cachedSummary) state.sectionSummaryLoaded = true;
  renderCurrentView();
  if (navigator.onLine) {
    setTimeout(() => downloadLanguageContentInBackground(language), 0);
  }

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
  state.sectionEdgesRef = subscribeSectionEdges(language);
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

// Returns a wrapper <div> containing the <details> plus a sibling actions
// bar — the actions bar can't live inside the <details> at all (not even
// as a sibling of <summary>): Chromium refuses to render or hit-test any
// non-summary child of a closed <details>, and that isn't something CSS
// can override (display/content-visibility overrides had no effect). It
// also can't live inside <summary> — interactive controls nested there
// aren't reliably reachable by keyboard/assistive tech. A true sibling of
// <details> itself is unaffected by any of that.
// Header count: "26 · 649" (subsections · words, its own plus all of theirs) for a section
// with subsections, just the word count otherwise. Computed from sectionSummary, so it
// updates live with every count change.
function sectionCountLabel(section, count) {
  // The index can lag behind (only an admin session rewrites it), so it's used only
  // until the live sectionSummary has loaded.
  const indexed = !state.sectionSummaryLoaded && !isSubsection(section) && sectionIndexEntry(section);
  if (indexed) return indexed.subsections ? `${indexed.subsections} · ${indexed.totalWords}` : String(count);
  const subs = isSubsection(section) ? [] : getSubsectionsOf(section);
  if (!subs.length) return String(count);
  const words = subs.reduce((sum, sub) => sum + (state.sectionSummary[sub] || 0), count);
  return `${subs.length} · ${words}`;
}

// The count badge after a heading's name; the tooltip spells out what the numbers are.
function sectionCountBadge(text) {
  const [subs, words] = text.includes(' · ') ? text.split(' · ') : [null, text];
  const title = subs ? `${subs} subsections · ${words} words` : `${words} words`;
  return `<span class="section-count" title="${title}">${text}</span>`;
}

export function buildSectionDetailsShell(section, count) {
  const sub = isSubsection(section);

  const wrapper = document.createElement('div');
  wrapper.className = sub ? 'section-row section-row-sub' : 'section-row';
  // Lets a card drag's hit-testing (elementFromPoint + closest) read back
  // which section a given row is, without needing a separate DOM->name
  // reverse lookup.
  wrapper.dataset.section = section;
  // Thin colored line on the row's left edge (see SECTION_EDGE_COLORS).
  wrapper.dataset.edge = getSectionEdge(section);
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
  const editing = state.isAdmin && state.sectionMenu.section === section;
  if (editing && state.sectionMenu.mode === 'rename') {
    summary.appendChild(buildInlineRenameEditor(section));
  } else if (editing && state.sectionMenu.mode === 'edge') {
    summary.appendChild(buildInlineEdgePicker(section));
  } else {
    // The count badge is pushed to the heading's right edge; the NOTE tag stays right after the name.
    summary.innerHTML = `<span class="section-label">${escapeHtml(label)}</span>${sectionCountBadge(sectionCountLabel(section, count))}`;
    if (hasSectionNote(section)) summary.querySelector('.section-label').after(buildNoteTag(section));
  }
  details.appendChild(summary);
  attachHeadingGestures(summary, section);

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

  // Heading gestures (attachHeadingGestures): double-click starts the reading player;
  // admins tap-then-hold for the note, triple-click for the edge color and long-press for
  // operation mode (rename/move/merge/delete).
  return wrapper;
}

export function closeSectionMenu() {
  state.sectionMenu = { section: null, mode: 'closed' };
  renderCurrentView();
}

// Move/merge targets: every known section and subsection (the same list the page
// renders: sectionSummary, the section index, and their parents), minus the source
// and its own subsections.
function getMoveTargetCandidates(section) {
  return getSortedSectionNames().filter(name =>
    name !== section && name !== 'UNCATEGORIZED' && getParentSectionName(name) !== section);
}

// Typed text and section keys are compared case-insensitively: headings are shown in
// capitals by CSS, but older keys can be stored in any case ("Family"), and the
// stored key is what's returned.
const comparableSectionName = (text) => (text || '').trim().toUpperCase().replace(/\s*(?:→|>)\s*/g, '>');

// Typed target → section key, or null when there's no such section. Accepts the key
// ("TOP>SUB"), the display form ("TOP → SUB") and, when only one section has it, a
// bare subsection name.
export function resolveSectionTarget(rawTarget) {
  const typed = comparableSectionName(rawTarget);
  if (!typed) return null;
  const known = getSortedSectionNames();
  const exact = known.find(name => comparableSectionName(name) === typed);
  if (exact) return exact;
  const bySubsectionName = known.filter(name => isSubsection(name) && comparableSectionName(getSubsectionLabel(name)) === typed);
  return bySubsectionName.length === 1 ? bySubsectionName[0] : null;
}

// Suggestions for what's typed so far: none for an empty field; names starting with it
// first (the section or subsection name), then names containing it. The list scrolls,
// so the cap only guards against a one-letter query listing everything at once.
const MOVE_SUGGESTION_LIMIT = 30;
function matchMoveTargets(section, rawQuery) {
  const query = comparableSectionName(rawQuery);
  if (!query) return [];
  const ranked = [];
  getMoveTargetCandidates(section).forEach(name => {
    const key = comparableSectionName(name);
    const label = isSubsection(name) ? comparableSectionName(getSubsectionLabel(name)) : key;
    const rank = key.startsWith(query) || label.startsWith(query) ? 0 : key.includes(query) ? 1 : -1;
    if (rank >= 0) ranked.push({ name, rank });
  });
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, MOVE_SUGGESTION_LIMIT).map(entry => entry.name);
}

const EDGE_TAP_GAP_MS = 300;
const NOTE_HOLD_MS = 500;
const OPS_LONG_PRESS_MS = 3000;
const LONG_PRESS_MOVE_PX = 10;
let lastHeadingTap = { section: null, time: 0, count: 0 };
let longPressFired = false;
let pendingDoubleTap = null;

// Swallows the click that follows the current press at the document (capture), so
// it neither toggles the <details> nor reaches js/main.js's close-on-outside-click
// handler. A mouse press whose heading re-rendered under it gets no click at all, so
// the guard also ends at the next press (or after 600 ms) rather than eat a real click.
function swallowNextClick() {
  const swallow = (clickEvent) => {
    clickEvent.stopPropagation();
    clickEvent.preventDefault();
    stop();
  };
  const stop = () => {
    document.removeEventListener('click', swallow, { capture: true });
    document.removeEventListener('pointerdown', stop, { capture: true });
  };
  document.addEventListener('click', swallow, { capture: true });
  document.addEventListener('pointerdown', stop, { capture: true });
  setTimeout(stop, 600);
}

// Heading gestures:
//  - double-click/tap (second tap within EDGE_TAP_GAP_MS) starts the reading player.
//    The two clicks open+close the section, leaving it as it was. For an admin the
//    start waits EDGE_TAP_GAP_MS more, so a third tap can turn it into a triple tap.
//  - admin fast triple-click/tap (each tap within EDGE_TAP_GAP_MS of the last) opens the
//    edge color picker. Taps are tracked by section name, since opening a section can
//    rebuild this heading between taps; the third tap's click is swallowed, so the
//    first two taps' open+close leave the section as it was.
//  - admin tap-then-hold: a press that starts within EDGE_TAP_GAP_MS of a tap and is held
//    NOTE_HOLD_MS opens the note editor (add, or edit the existing note). The tap's toggle
//    is undone, so the section stays as it was.
//  - admin: holding OPS_LONG_PRESS_MS without moving opens operation mode.
function attachHeadingGestures(summary, section) {
  const admin = state.isAdmin;
  let pressTimer = null;
  let noteTimer = null;
  let pressOrigin = null;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    clearTimeout(noteTimer);
    pressTimer = null;
    noteTimer = null;
    summary.classList.remove('section-long-pressing');
  };
  const insideEditor = (event) => event.target.closest('.section-rename-inline, .section-edge-picker, .section-note-tag');

  // Ends a hold gesture: forgets the taps, swallows the click that follows the
  // release, then runs the gesture's action.
  const fireHold = (action) => {
    cancelPress();
    longPressFired = true;
    lastHeadingTap = { section: null, time: 0, count: 0 };
    document.addEventListener('pointerup', () => {
      swallowNextClick();
      setTimeout(() => { longPressFired = false; }, 0);
    }, { capture: true, once: true });
    action();
  };

  summary.addEventListener('pointerdown', (event) => {
    if (!admin || event.button > 0 || insideEditor(event)) return;
    pressOrigin = { x: event.clientX, y: event.clientY };
    summary.classList.add('section-long-pressing');
    const afterOneTap = lastHeadingTap.section === section && lastHeadingTap.count === 1
      && event.timeStamp - lastHeadingTap.time <= EDGE_TAP_GAP_MS;
    if (afterOneTap) {
      noteTimer = setTimeout(() => fireHold(() => {
        // Undo the first tap's open/close (the heading may have re-rendered since).
        const details = state.sectionHeaderDomRefs.get(section)?.querySelector(':scope > details');
        if (details) details.open = !details.open;
        openNoteEditor(section);
      }), NOTE_HOLD_MS);
    }
    pressTimer = setTimeout(() => fireHold(() => openSectionRename(section)), OPS_LONG_PRESS_MS);
  });
  summary.addEventListener('pointermove', (event) => {
    if (!pressTimer || !pressOrigin) return;
    if (Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > LONG_PRESS_MOVE_PX) cancelPress();
  });
  summary.addEventListener('pointercancel', cancelPress);
  summary.addEventListener('pointerleave', cancelPress);
  // Keep a touch long-press from opening the browser's context menu.
  summary.addEventListener('contextmenu', (event) => {
    if (pressTimer || longPressFired) event.preventDefault();
  });

  summary.addEventListener('pointerup', (event) => {
    cancelPress();
    if (longPressFired) return; // The release that ends a long press isn't a tap
    if (event.button > 0 || insideEditor(event)) return;
    const continues = lastHeadingTap.section === section && event.timeStamp - lastHeadingTap.time <= EDGE_TAP_GAP_MS;
    const count = continues ? lastHeadingTap.count + 1 : 1;
    const isTripleTap = admin && count >= 3;
    const isDoubleTap = count === 2;
    lastHeadingTap = isTripleTap || (isDoubleTap && !admin) ? { section: null, time: 0, count: 0 } : { section, time: event.timeStamp, count };
    clearTimeout(pendingDoubleTap);
    pendingDoubleTap = null;
    if (isDoubleTap) {
      if (admin) pendingDoubleTap = setTimeout(() => { pendingDoubleTap = null; startSectionReading(section); }, EDGE_TAP_GAP_MS);
      else startSectionReading(section);
      return;
    }
    if (!isTripleTap) return;
    swallowNextClick();
    openSectionEdgePicker(section);
  });
}

export function openSectionEdgePicker(section) {
  if (!state.isAdmin) return;
  state.sectionMenu = { section, mode: 'edge' };
  renderCurrentView();
}

// The heading's inline edge color picker: one swatch per color, numbered by
// priority (1 = top), the current one ringed, then ✕. Picking one saves and closes.
function buildInlineEdgePicker(section) {
  const current = getSectionEdge(section);
  const picker = document.createElement('span');
  picker.className = 'section-edge-picker';
  picker.innerHTML = `
    ${SECTION_EDGE_COLORS.map((color, index) => `
      <button type="button" class="section-edge-swatch${color.key === current ? ' is-current' : ''}" data-edge="${color.key}" data-edge-pick="${color.key}" title="Priority ${index + 1}: ${escapeHtml(color.label)}" aria-label="Priority ${index + 1}: ${escapeHtml(color.label)}" aria-pressed="${color.key === current}">${index + 1}</button>
    `).join('')}
    <button type="button" class="section-menu-sym-btn" data-edge-cancel title="Cancel" aria-label="Cancel">✕</button>
  `;
  picker.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const swatch = event.target.closest('[data-edge-pick]');
    if (swatch) {
      const color = swatch.dataset.edgePick;
      closeSectionMenu();
      if (color !== current) setSectionEdge(section, color);
    } else if (event.target.closest('[data-edge-cancel]')) {
      closeSectionMenu();
    }
  });
  return picker;
}

// Puts the section's heading into operation mode (3-second long press on the heading):
// an inline rename field followed by move/merge and delete actions.
export function openSectionRename(section) {
  if (!state.isAdmin) return;
  state.sectionMenu = { section, mode: 'rename' };
  renderCurrentView();
}

// The heading's inline operation-mode editor. It lives inside <summary>, so its clicks
// preventDefault (no open/close toggle) and stopPropagation (the document click handler
// would cancel the edit). Two rows share the spot, switched by state.sectionMenu.op:
//  - rename (default): name field, ✓ save, ⤷ move/merge, 🗑 delete, ✕ cancel.
//  - move: target field, ↳ make child, ⊕ merge words, ✕ back to rename.
// Typed text is kept in state.sectionMenu.draft / .moveDraft so a live re-render doesn't drop it.
function buildInlineRenameEditor(section) {
  const editor = document.createElement('span');
  editor.className = 'section-rename-inline';
  editor.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  if (state.sectionMenu.op === 'move') {
    fillInlineMoveEditor(editor, section);
    return editor;
  }

  const currentLabel = getSubsectionLabel(section);
  const firstOpen = state.sectionMenu.draft === undefined;
  const deleteTitle = isSubsection(section) ? 'Delete this subsection' : 'Delete this section';
  editor.innerHTML = `
    <input type="text" class="section-rename-input" value="${escapeHtml(firstOpen ? currentLabel : state.sectionMenu.draft)}" aria-label="New section name" />
    <button type="button" class="section-menu-sym-btn section-menu-sym-primary" data-rename-confirm title="Save name" aria-label="Save name">✓</button>
    <button type="button" class="section-menu-sym-btn" data-ops-move title="Move / merge into…" aria-label="Move or merge into another section">⤷</button>
    <button type="button" class="section-menu-sym-btn section-menu-icon-danger" data-ops-delete title="${escapeHtml(deleteTitle)}" aria-label="${escapeHtml(deleteTitle)}"><svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">${TRASH_ICON_PATHS}</svg></button>
    <button type="button" class="section-menu-sym-btn" data-rename-cancel title="Cancel" aria-label="Cancel">✕</button>
  `;

  const input = editor.querySelector('.section-rename-input');
  const sizeToText = () => { input.size = Math.max(4, Math.min(input.value.length + 1, 40)); };
  sizeToText();
  let saving = false;
  const submit = async () => {
    if (saving) return;
    saving = true;
    if (await renameSection(section, input.value)) closeSectionMenu();
    else input.focus(); // Name refused: keep editing (Esc still cancels)
    saving = false;
  };
  input.addEventListener('input', () => {
    state.sectionMenu.draft = input.value;
    sizeToText();
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSectionMenu();
    }
  });
  input.addEventListener('keyup', (event) => {
    // Keep space/Enter in the field from toggling the surrounding <summary>
    event.stopPropagation();
    if (event.key === ' ') event.preventDefault();
  });
  editor.querySelector('[data-rename-confirm]').addEventListener('click', submit);
  editor.querySelector('[data-rename-cancel]').addEventListener('click', () => closeSectionMenu());
  editor.querySelector('[data-ops-move]').addEventListener('click', () => {
    state.sectionMenu.op = 'move';
    renderCurrentView();
  });
  editor.querySelector('[data-ops-delete]').addEventListener('click', () => {
    closeSectionMenu();
    deleteSectionEntirely(section);
  });
  requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus();
    if (firstOpen) {
      input.select();
      state.sectionMenu.draft = input.value;
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  return editor;
}

// Operation mode's move row symbols (bare, colored strokes; see .section-rename-inline in
// language-studio.html): + make child, and a branching merge mark.
const OP_ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const OP_ICON_MERGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/></svg>';

// Operation mode's move row: pick a target section, then make child (+) or merge words.
function fillInlineMoveEditor(editor, section) {
  const canNest = getSubsectionsOf(section).length === 0;
  const childTitle = canNest
    ? 'Make child: move it under the target as a subsection'
    : "Make child unavailable: it has subsections, which can't be nested further";
  editor.innerHTML = `
    <input type="text" class="section-rename-input" placeholder="Target section…" value="${escapeHtml(state.sectionMenu.moveDraft || '')}" aria-label="Target section" autocomplete="off" autocapitalize="characters" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" />
    <button type="button" class="section-menu-sym-btn section-op-child" data-merge-child title="${escapeHtml(childTitle)}" aria-label="Make child"${canNest ? '' : ' disabled'}>${OP_ICON_PLUS}</button>
    <button type="button" class="section-menu-sym-btn section-op-merge" data-merge-confirm title="Merge words into the target" aria-label="Merge words">${OP_ICON_MERGE}</button>
    <button type="button" class="section-menu-sym-btn" data-move-back title="Back to rename" aria-label="Back to rename">✕</button>
    <span class="section-move-suggestions" role="listbox" aria-label="Matching sections" hidden></span>
  `;

  const input = editor.querySelector('.section-rename-input');
  const list = editor.querySelector('.section-move-suggestions');
  const sizeToText = () => { input.size = Math.max(12, Math.min(input.value.length + 1, 40)); };
  sizeToText();
  const backToRename = () => {
    state.sectionMenu.op = 'rename';
    renderCurrentView();
  };

  // The suggestion list under the field: hidden while the field is empty (or already
  // holds exactly the one match); tap a row, or ↑/↓ then Enter, to fill the field.
  let matches = [];
  let active = -1;
  const showSuggestions = () => {
    matches = matchMoveTargets(section, input.value);
    if (matches.length === 1 && comparableSectionName(matches[0]) === comparableSectionName(input.value)) matches = [];
    active = Math.min(active, matches.length - 1);
    list.hidden = matches.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    list.innerHTML = matches.map((name, index) => `
      <button type="button" class="section-move-suggestion${index === active ? ' is-active' : ''}" role="option" aria-selected="${index === active}" data-target="${escapeHtml(name)}">${escapeHtml(getSectionDisplayLabel(name))}</button>
    `).join('');
  };
  const pick = (name) => {
    input.value = name;
    state.sectionMenu.moveDraft = name;
    sizeToText();
    active = -1;
    showSuggestions();
    input.focus();
  };
  // pointerdown, so the field keeps focus (and the list stays) until the pick lands
  list.addEventListener('pointerdown', (event) => {
    const option = event.target.closest('[data-target]');
    if (!option) return;
    event.preventDefault();
    pick(option.dataset.target);
  });

  input.addEventListener('input', () => {
    state.sectionMenu.moveDraft = input.value;
    sizeToText();
    active = -1;
    showSuggestions();
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault();
      // Cycles through the rows and back to "none" (-1), which leaves Enter to merge
      const last = matches.length - 1;
      if (event.key === 'ArrowDown') active = active >= last ? -1 : active + 1;
      else active = active === -1 ? last : active - 1;
      showSuggestions();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && matches[active]) pick(matches[active]);
      else confirmSectionMerge(section, input.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (!list.hidden) {
        matches = [];
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      } else {
        backToRename();
      }
    }
  });
  input.addEventListener('keyup', (event) => {
    event.stopPropagation();
    if (event.key === ' ') event.preventDefault();
  });
  editor.querySelector('[data-merge-child]').addEventListener('click', () => confirmSectionNest(section, input.value));
  editor.querySelector('[data-merge-confirm]').addEventListener('click', () => confirmSectionMerge(section, input.value));
  editor.querySelector('[data-move-back]').addEventListener('click', backToRename);
  requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    showSuggestions(); // A live re-render rebuilt the field mid-typing: bring the list back
  });
}

// Renames a section (or subsection) in place: its words, word count, hidden and
// edge color (and legacy star), and — for a top-level section — its subsections all move to the
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
    for (const [from, to] of moves) await addSectionKeyMoveUpdates(updates, from, to);
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

// Moves one section key to an unused key as-is: words, word count, hidden
// flag, edge color (and legacy star), and note. Shared by rename and make-child.
async function addSectionKeyMoveUpdates(updates, from, to) {
  const words = (await wordsRef.child(state.language).child(from).once('value')).val();
  updates[`words/${state.language}/${to}`] = words || null;
  updates[`words/${state.language}/${from}`] = null;
  updates[`sectionSummary/${state.language}/${to}`] = state.sectionSummary[from] || 0;
  updates[`sectionSummary/${state.language}/${from}`] = null;
  updates[`hiddenSections/${state.language}/${to}`] = isSectionHidden(from) ? true : null;
  updates[`hiddenSections/${state.language}/${from}`] = null;
  updates[`starredSections/${state.language}/${to}`] = state.starredSections[from] ? true : null;
  updates[`starredSections/${state.language}/${from}`] = null;
  updates[`sectionEdges/${state.language}/${to}`] = state.sectionEdges[from] || null;
  updates[`sectionEdges/${state.language}/${from}`] = null;
  const note = (await japanRef.child(`sectionNotes/${state.language}/${from}`).once('value')).val();
  updates[`sectionNotes/${state.language}/${to}`] = note || null;
  updates[`sectionNotes/${state.language}/${from}`] = null;
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
  if (!(rawTarget || '').trim()) return;
  const target = resolveSectionTarget(rawTarget);
  if (!target) {
    window.alert(`"${rawTarget.trim().toUpperCase()}" doesn't exist. Pick a section from the suggestions.`);
    return;
  }
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
  if (await mergeSectionInto(section, target)) closeSectionMenu();
}

// The merge writes themselves, without prompts. Returns true on success.
async function mergeSectionInto(section, target) {
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
    updates[`sectionEdges/${state.language}/${section}`] = null;
    updates[`starredSections/${state.language}/${section}`] = null;
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
      if (state.sectionEdges[sub] && !state.sectionEdges[newSubKey]) updates[`sectionEdges/${state.language}/${newSubKey}`] = state.sectionEdges[sub];
      updates[`sectionEdges/${state.language}/${sub}`] = null;
      updates[`starredSections/${state.language}/${sub}`] = null;
      await addNoteMergeUpdates(updates, sub, newSubKey);

      removedKeys.push(sub);
    }

    await updateJapanData(updates);
  } catch (err) {
    console.error('Failed to merge section', err);
    window.alert('Failed to merge section. See console for details.');
    return false;
  }

  forgetSections(removedKeys);
  state.sectionNotes.clear(); // The target's note may now include the merged one
  return true;
}

// Make child: keeps `section` intact (words, count, hidden flag, edge color,
// note) and re-parents it under the top-level `rawTarget` as TARGET>NAME.
// If the target already has a same-named subsection, offers to merge into
// it instead. Only one nesting level exists, so a section that has
// subsections of its own can't become a child.
export async function confirmSectionNest(section, rawTarget) {
  if (!(rawTarget || '').trim()) return;
  const target = resolveSectionTarget(rawTarget);
  if (!target) {
    window.alert(`"${rawTarget.trim().toUpperCase()}" doesn't exist. Pick a section from the suggestions.`);
    return;
  }
  if (target === section || target === getParentSectionName(section)) {
    closeSectionMenu();
    return;
  }
  if (isSubsection(target)) {
    window.alert("A subsection can't have children. Pick a top-level section.");
    return;
  }
  if (getSubsectionsOf(section).length) {
    window.alert("This section has subsections, which can't be nested further. Merge it instead.");
    return;
  }

  const newKey = `${target}>${getSubsectionLabel(section)}`;
  const sourceLabel = getSectionDisplayLabel(section);
  const targetLabel = getSectionDisplayLabel(target);
  const exists = Object.prototype.hasOwnProperty.call(state.sectionSummary, newKey);
  const message = exists
    ? `"${targetLabel}" already has a subsection "${getSectionDisplayLabel(newKey)}". Merge "${sourceLabel}" into it? This can't be undone.`
    : `Move "${sourceLabel}" under "${targetLabel}" as a subsection?`;
  if (!window.confirm(message)) return;
  if (!state.isAdmin) {
    window.alert('You are not authorized to move sections.');
    return;
  }

  const wasExpanded = state.expandedSections.has(section);
  if (exists) {
    if (!(await mergeSectionInto(section, newKey))) return;
  } else {
    try {
      const updates = {};
      await addSectionKeyMoveUpdates(updates, section, newKey);
      await updateJapanData(updates);
    } catch (err) {
      console.error('Failed to move section', err);
      window.alert('Failed to move section. See console for details.');
      return;
    }
    if (state.lastActiveSection === section) state.lastActiveSection = newKey;
    if (state.hoveredSection === section) state.hoveredSection = newKey;
    forgetSections([section]);
  }
  // Show it in its new place
  state.expandedSections.add(target);
  if (wasExpanded) state.expandedSections.add(newKey);
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

  const archivedNotes = [];
  try {
    const updates = {};
    const archiveNote = window.parent && window.parent.archiveLanguageSectionNoteToTrash;
    for (const name of [section, ...subs]) {
      const note = (await japanRef.child(`sectionNotes/${state.language}/${name}`).once('value')).val();
      if (note && note.html) {
        if (typeof archiveNote !== 'function') {
          throw new Error('The Notes Recently deleted area is unavailable, so section notes cannot be safely deleted.');
        }
        const archived = await archiveNote({ language: state.language, section: name, note });
        if (archived) archivedNotes.push(archived);
      }
    }
    updates[`words/${state.language}/${section}`] = null;
    updates[`sectionSummary/${state.language}/${section}`] = null;
    updates[`hiddenSections/${state.language}/${section}`] = null;
    updates[`sectionEdges/${state.language}/${section}`] = null;
    updates[`starredSections/${state.language}/${section}`] = null;
    updates[`sectionNotes/${state.language}/${section}`] = null;
    subs.forEach(name => {
      updates[`words/${state.language}/${name}`] = null;
      updates[`sectionSummary/${state.language}/${name}`] = null;
      updates[`hiddenSections/${state.language}/${name}`] = null;
      updates[`sectionEdges/${state.language}/${name}`] = null;
      updates[`starredSections/${state.language}/${name}`] = null;
      updates[`sectionNotes/${state.language}/${name}`] = null;
    });
    await updateJapanData(updates);
  } catch (err) {
    const removeArchived = window.parent && window.parent.removeLanguageWordFromTrash;
    if (typeof removeArchived === 'function') {
      for (const archived of archivedNotes) {
        try {
          await removeArchived(archived.path);
        } catch (rollbackError) {
          console.error('Could not remove an archived note after section deletion failed.', rollbackError);
        }
      }
    }
    console.error('Failed to delete section', err);
    window.alert('Failed to delete section. See console for details.');
    return;
  }

  forgetSections([section, ...subs]);
  [section, ...subs].forEach(name => { delete state.sectionSummary[name]; });
  renderCurrentView();
}

// Common cleanup after a section key stops existing (deleted, or merged
// away): drops its local caches and detaches its live listener, so nothing
// stale lingers between now and the sectionSummary listener's next
// (already-in-flight) re-render.
export function forgetSections(names) {
  names.forEach(name => {
    delete state.discoveredSections[name];
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
  summary.innerHTML = `<span class="section-label">Unsectioned ${sectionCountBadge(String(entries.length))}</span>`;
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
