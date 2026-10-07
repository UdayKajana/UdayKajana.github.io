// The compact "quick add" modal: space-bar/swipe-triggered word entry with
// live translation/conversion and Enter-driven traversal between
// word/pronunciation/meaning, duplicate-word handling, and '>' subsection creation.
// If you're changing how a word gets added, or how that popup behaves,
// it's in this file.

import { state, langCodeMap } from './state.js';
import { japanRef, wordsRef, updateJapanData, markLanguageUpdated } from './firebase-init.js';
import { containsKanji, normalize, escapeHtml, toInitCap } from './utils.js';
import {
  quickAddModal, quickAddModeToggle,
  quickAddInput, quickAddContext, quickAddBackBtn, quickAddPanel, quickAddPreviewRows
} from './dom.js';
import { translateText, romanizeNativeWord, convertRomajiToHiragana } from './translate.js';
import { getSectionDisplayLabel, getSubsectionLabel, isSubsection, findExistingWordLocation, bumpSectionCount, renderCurrentView, cacheSectionWords, cacheSectionSummary, readCachedSectionWords } from './sections.js';

const JAPANESE_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// Japanese text is accepted directly in either mode. English mode translates
// English into Japanese; romaji mode converts phonetic input into hiragana.
export async function resolveQuickAddFields(text) {
  const nativeLang = langCodeMap[state.language] || 'ja';
  const trimmedText = text.trim();

  if (!navigator.onLine) {
    if (JAPANESE_SCRIPT_PATTERN.test(trimmedText)) {
      return {
        word: trimmedText,
        pronunciation: '',
        englishMeaning: '',
        source: 'native'
      };
    }
    if (state.quickAddMeaningMode) {
      return {
        word: trimmedText,
        pronunciation: '',
        englishMeaning: trimmedText,
        source: 'english',
        needsTranslation: true,
        translationSource: trimmedText
      };
    }
    return {
      word: convertRomajiToHiragana(trimmedText),
      pronunciation: '',
      englishMeaning: '',
      source: 'native'
    };
  }

  if (JAPANESE_SCRIPT_PATTERN.test(trimmedText)) {
    const pronunciation = containsKanji(trimmedText)
      ? await romanizeNativeWord(trimmedText, nativeLang)
      : '';
    const englishMeaning = await translateText(trimmedText, nativeLang, 'en');
    return { word: trimmedText, pronunciation, englishMeaning, source: 'native' };
  }

  if (state.quickAddMeaningMode) {
    const word = await translateText(trimmedText, 'en', nativeLang);
    const pronunciation = word ? await romanizeNativeWord(word, nativeLang) : '';
    return { word, pronunciation, englishMeaning: trimmedText, source: 'english' };
  }

  const word = convertRomajiToHiragana(trimmedText);
  const englishMeaning = await translateText(word, nativeLang, 'en');
  return { word, pronunciation: '', englishMeaning, source: 'native' };
}

export function getQuickAddFieldOrder() {
  return state.quickAdd.resolved?.source === 'english'
    ? ['englishMeaning', 'word', 'pronunciation']
    : ['word', 'pronunciation', 'englishMeaning'];
}

export function buildQuickAddParts(resolved) {
  return getQuickAddFieldOrder().map(key => ({ key, value: resolved[key] }));
}

// The section name (leaf only, never the full "PARENT → CHILD" path — this
// is a compact inline hint, not a place to spell out hierarchy) shown as
// the input's placeholder whenever it's otherwise empty.
export function getQuickAddPlaceholder() {
  if (!state.quickAdd.section) return 'Create new section...';
  const inputHint = state.quickAddMeaningMode
    ? 'English meaning or Japanese word'
    : 'Romaji or Japanese word';
  return `${inputHint} · ${getSubsectionLabel(state.quickAdd.section)}`;
}

export function updateQuickAddModeUI() {
  quickAddModeToggle.setAttribute('aria-pressed', String(state.quickAddMeaningMode));
  quickAddModeToggle.setAttribute('aria-label', state.quickAddMeaningMode
    ? 'English meaning input mode'
    : 'Japanese or Romaji input mode');
  quickAddModeToggle.classList.toggle('hidden', state.quickAdd.inputMode === 'section');
}

// Live-converts only the first word-entry stage when Romaji mode is selected.
// It stays unbound for English input, resolved fields, sections, and
// subsection names; converting subsection names corrupts ordinary text.
//
// wanakana.unbind() throws if the element was never bound in the first
// place (rather than a no-op) — quickAddImeBound tracks that ourselves
// so unbind is only ever called on an element we know we bound.
let quickAddImeBound = false;

export function updateQuickAddImeBinding() {
  if (typeof wanakana === 'undefined') return;
  const input = quickAddInput.value.trim();
  const isSectionNameEntry = input.startsWith('<') || input.startsWith('>');
  const shouldBeBound = state.quickAdd.inputMode !== 'section' &&
    !!state.quickAdd.section &&
    state.quickAdd.open &&
    state.quickAdd.stageIndex === 0 &&
    !isSectionNameEntry &&
    !state.quickAddMeaningMode;
  // Called on every keystroke (see the 'input' listener in main.js) as well
  // as every stage/toggle change, so this has to be a no-op whenever the
  // desired state already matches — actually unbinding+rebinding on every
  // keystroke resets wanakana's internal romaji-buffer, meaning a
  // multi-character syllable (e.g. "toukyou") could never finish
  // composing (confirmed by testing: unconditional rebinding froze
  // conversion entirely, every keystroke just showed raw romaji).
  if (shouldBeBound === quickAddImeBound) return;
  if (quickAddImeBound) {
    wanakana.unbind(quickAddInput);
    quickAddImeBound = false;
  }
  if (shouldBeBound) {
    wanakana.bind(quickAddInput, { IMEMode: true });
    quickAddImeBound = true;
  }
}

export function updateQuickAddBackBtn() {
  quickAddBackBtn.classList.toggle('hidden', !state.quickAdd.open || state.quickAdd.stageIndex === 0);
}

export function openQuickAdd(section, inputMode = section ? 'default' : 'section') {
  closeQuickAdd();
  state.quickAdd = { open: true, section, inputMode, stageIndex: 0, resolved: null, lastCheckedText: null };
  state.lastActiveSection = section;
  if (section) {
    quickAddContext.textContent = `+ Add word to ${getSectionDisplayLabel(section)}`;
    quickAddContext.classList.remove('hidden');
  } else {
    quickAddContext.textContent = '';
    quickAddContext.classList.add('hidden');
  }
  quickAddInput.value = '';
  quickAddInput.disabled = false;
  quickAddInput.placeholder = getQuickAddPlaceholder();
  quickAddPanel.classList.add('hidden');
  quickAddPreviewRows.innerHTML = '';
  updateQuickAddModeUI();
  updateQuickAddImeBinding();
  updateQuickAddBackBtn();
  quickAddModal.classList.add('open');
  startQuickAddChecker();
  quickAddInput.focus();
}

export function closeQuickAdd() {
  stopQuickAddChecker();
  state.quickAdd = { open: false, section: null, inputMode: 'default', stageIndex: 0, resolved: null, lastCheckedText: null };
  quickAddModal.classList.remove('open');
  quickAddInput.value = '';
  quickAddInput.disabled = false;
  quickAddInput.placeholder = '';
  quickAddContext.textContent = '';
  quickAddContext.classList.add('hidden');
  quickAddPanel.classList.add('hidden');
  quickAddPreviewRows.innerHTML = '';
  updateQuickAddImeBinding();
  updateQuickAddBackBtn();
}

export function toggleQuickAdd(section) {
  if (state.quickAdd.open && state.quickAdd.section === section) {
    closeQuickAdd();
    return;
  }
  openQuickAdd(section);
}

// Jumps straight to any of the 3 stages — used by the ‹ back button,
// Shift+Enter, and clicking a field in the preview strip below. Whatever
// was typed at the stage being left is saved into `resolved` first, so
// nothing typed is lost by navigating away from it.
export function goToQuickAddStage(newIndex) {
  if (!state.quickAdd.open || !state.quickAdd.resolved) return;
  if (newIndex < 0 || newIndex > 2 || newIndex === state.quickAdd.stageIndex) return;

  const currentKey = getQuickAddFieldOrder()[state.quickAdd.stageIndex];
  state.quickAdd.resolved[currentKey] = quickAddInput.value.trim();

  state.quickAdd.stageIndex = newIndex;
  const key = getQuickAddFieldOrder()[newIndex];
  const value = state.quickAdd.resolved[key] || '';
  quickAddInput.disabled = false;
  quickAddInput.placeholder = getQuickAddPlaceholder();
  quickAddInput.value = value;
  state.quickAdd.lastCheckedText = value;
  updateQuickAddImeBinding();
  updateQuickAddBackBtn();
  quickAddInput.focus();
  quickAddInput.select();
  renderQuickAddPanel();
}

// One line, no labels — just the typed word, its pronunciation, and the
// translated word, dot-separated, with whichever one is currently loaded
// into the input highlighted. Every field here is clickable — it jumps
// straight to editing that stage, same as the ‹ back button but able to
// reach any of the three directly instead of only the previous one.
export function renderQuickAddPanel() {
  const resolved = state.quickAdd.resolved;
  if (!resolved) {
    quickAddPanel.classList.add('hidden');
    return;
  }
  const parts = buildQuickAddParts(resolved);
  const pieces = parts.map((part, index) => `<button type="button" data-stage-index="${index}" class="rounded px-1 ${
    index === state.quickAdd.stageIndex
      ? 'bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950/40 dark:text-blue-200'
      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
  }">${escapeHtml(part.value || '—')}</button>`);
  quickAddPreviewRows.innerHTML = `
    <div class="flex flex-wrap items-center gap-1.5 px-1 py-1 text-xs">
      ${pieces.join('<span class="text-slate-300 dark:text-slate-600">·</span>')}
    </div>
  `;
  quickAddPanel.classList.remove('hidden');
  quickAddPreviewRows.querySelectorAll('[data-stage-index]').forEach(btn => {
    btn.addEventListener('click', () => goToQuickAddStage(Number(btn.dataset.stageIndex)));
  });
}

let quickAddCheckTimer = null;
let quickAddResolutionToken = 0;

export function startQuickAddChecker() {
  clearTimeout(quickAddCheckTimer);
  quickAddResolutionToken += 1;
  quickAddCheckTimer = setTimeout(() => {
    quickAddCheckTimer = null;
    checkQuickAddForChanges();
  }, 300);
}

export function stopQuickAddChecker() {
  clearTimeout(quickAddCheckTimer);
  quickAddCheckTimer = null;
  quickAddResolutionToken += 1;
}

// Resolve the latest input after a short pause in typing.
export async function checkQuickAddForChanges() {
  if (!state.quickAdd.open) return;
  const token = ++quickAddResolutionToken;
  const text = quickAddInput.value.trim();
  if (!state.quickAdd.section) {
    renderNewSectionHint(text);
    state.quickAdd.lastCheckedText = text;
    return;
  }
  if (text.startsWith('>')) return; // handled instantly by the input handler instead
  if (text === state.quickAdd.lastCheckedText) return;
  if (!text) {
    state.quickAdd.lastCheckedText = text;
    return;
  }

  const stageIndex = state.quickAdd.stageIndex;
  if (stageIndex === 0) {
    const resolved = await resolveQuickAddFields(text);
    // Bail if the field moved on while this was resolving.
    if (token !== quickAddResolutionToken || !state.quickAdd.open ||
        state.quickAdd.stageIndex !== 0 || quickAddInput.value.trim() !== text) return;
    state.quickAdd.resolved = resolved;
  } else if (state.quickAdd.resolved) {
    const key = getQuickAddFieldOrder()[stageIndex];
    state.quickAdd.resolved[key] = text;
  }
  state.quickAdd.lastCheckedText = text;
  renderQuickAddPanel();
}

// A '>' prefix (only meaningful at the very first stage, before any
// resolution has started) means "create a subsection" instead of "add a
// word" — shows a live preview of the name as it's typed, no
// translation/conversion involved.
export function renderSubsectionHint(name) {
  quickAddPreviewRows.innerHTML = `
    <div class="flex flex-wrap items-center gap-1.5 px-1 py-1 text-xs">
      <span class="text-slate-400 dark:text-slate-500">New subsection:</span>
      <span class="rounded bg-blue-50 px-1 font-semibold text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">${escapeHtml(name || '—')}</span>
    </div>
  `;
  quickAddPanel.classList.remove('hidden');
}

export function renderNewSectionHint(name) {
  quickAddPreviewRows.innerHTML = `
    <div class="flex flex-wrap items-center gap-1.5 px-1 py-1 text-xs">
      <span class="text-slate-400 dark:text-slate-500">New section:</span>
      <span class="rounded bg-blue-50 px-1 font-semibold text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">${escapeHtml(name || '—')}</span>
    </div>
  `;
  quickAddPanel.classList.toggle('hidden', !name);
}

export async function createSubsectionUnder(parentSection, rawName) {
  if (isSubsection(parentSection)) {
    window.alert('Subsections can\'t be nested further.');
    closeQuickAdd();
    return;
  }
  const childLabel = rawName.trim().toUpperCase();
  if (!childLabel) {
    window.alert('Type a name for the subsection after ">".');
    return;
  }
  const fullName = `${parentSection}>${childLabel}`;
  if (Object.keys(state.sectionSummary).includes(fullName)) {
    window.alert(`"${childLabel}" already exists under ${parentSection}.`);
    closeQuickAdd();
    return;
  }
  try {
    // Only seed a count if this subsection doesn't already exist — avoids
    // a race clobbering a concurrent admin's count with a stale 0.
    if (!navigator.onLine) {
      await updateJapanData(
        { [`sectionSummary/${state.language}/${fullName}`]: 0 },
        { [`sectionSummary/${state.language}/${fullName}`]: null }
      );
      state.sectionSummary[fullName] = 0;
    } else {
      const result = await japanRef.child(`sectionSummary/${state.language}/${fullName}`).transaction(current => (current === null ? 0 : current));
      if (result.committed) await markLanguageUpdated();
    }
  } catch (err) {
    console.error('Failed to create subsection', err);
    window.alert('Failed to create subsection. See console for details.');
    return;
  }
  const summaryCache = await deviceCache.set(
    `language:${state.currentUser ? state.currentUser.uid : 'anonymous'}:${state.language}`,
    'section-summary',
    state.sectionSummary
  );
  if (!summaryCache.ok) console.warn('Could not cache the new subsection locally.', summaryCache.error);
  state.expandedSections.add(parentSection);
  state.expandedSections.add(fullName);
  closeQuickAdd();
  renderCurrentView();
  const parentWrapper = state.sectionHeaderDomRefs.get(parentSection);
  if (parentWrapper) parentWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function createTopLevelSection(rawName) {
  const newSection = rawName.trim();
  if (!newSection) {
    window.alert('Type a name for the new section after "<".');
    return;
  }
  if (/[.#$\/\[\]>\u0000-\u001f\u007f]/.test(newSection)) {
    window.alert('Section names cannot contain /, ., #, $, [, ], >, or control characters.');
    return;
  }
  if (Object.prototype.hasOwnProperty.call(state.sectionSummary, newSection)) {
    window.alert(`"${newSection}" already exists.`);
    return;
  }

  try {
    if (!navigator.onLine) {
      await updateJapanData(
        { [`sectionSummary/${state.language}/${newSection}`]: 0 },
        { [`sectionSummary/${state.language}/${newSection}`]: null }
      );
      state.sectionSummary[newSection] = 0;
    } else {
      const result = await japanRef.child(`sectionSummary/${state.language}/${newSection}`).transaction(current => {
        if (current !== null) return;
        return 0;
      });
      if (!result.committed) {
        window.alert(`"${newSection}" already exists.`);
        return;
      }
      await markLanguageUpdated();
      state.sectionSummary[newSection] = result.snapshot.val() || 0;
    }

    const cached = await cacheSectionSummary(state.language);
    if (!cached.ok) console.warn('Could not cache the new section locally.', cached.error);
    state.expandedSections.add(newSection);
    closeQuickAdd();
    renderCurrentView();
    const wrapper = state.sectionHeaderDomRefs.get(newSection);
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    console.error('Failed to create section', error);
    window.alert('Failed to create section. See console for details.');
  }
}

// The Enter handler while composing: advances one stage at a time —
// capturing any manual edit at the current stage before moving to the
// next. After the meaning stage, saves directly into the fixed section
// (no category step to pass through).
export async function advanceQuickAddStage() {
  if (!state.quickAdd.open) return;
  const text = quickAddInput.value.trim();
  const stageIndex = state.quickAdd.stageIndex;
  const currentField = state.quickAdd.resolved && getQuickAddFieldOrder()[stageIndex];
  if (!text && currentField !== 'pronunciation' && currentField !== 'englishMeaning') return;

  if (stageIndex === 0 && state.quickAdd.section && text.startsWith('>')) {
    await createSubsectionUnder(state.quickAdd.section, text.slice(1));
    return;
  }

  if (stageIndex === 0 && state.quickAdd.section && text.startsWith('<')) {
    await createTopLevelSection(text.slice(1));
    return;
  }

  if (stageIndex === 0 && !state.quickAdd.section) {
    quickAddInput.disabled = true;
    try {
      await createTopLevelSection(text.startsWith('<') ? text.slice(1) : text);
    } finally {
      quickAddInput.disabled = false;
    }
    return;
  }

  if (stageIndex === 0) {
    stopQuickAddChecker();
    // Reuse the live resolution if it already caught up with this exact
    // text; otherwise resolve now instead of making the user wait.
    if (!state.quickAdd.resolved || state.quickAdd.lastCheckedText !== text) {
      const resolutionToken = ++quickAddResolutionToken;
      quickAddInput.disabled = true;
      quickAddInput.placeholder = state.quickAddMeaningMode ? 'Translating…' : 'Converting…';
      const resolved = await resolveQuickAddFields(text);
      quickAddInput.disabled = false;
      quickAddInput.placeholder = getQuickAddPlaceholder();
      if (resolutionToken !== quickAddResolutionToken || !state.quickAdd.open ||
          state.quickAdd.stageIndex !== 0 || quickAddInput.value.trim() !== text) return;
      state.quickAdd.resolved = resolved;
      state.quickAdd.lastCheckedText = text;
    }
  } else {
    const key = getQuickAddFieldOrder()[stageIndex];
    state.quickAdd.resolved[key] = text;
    if (key === 'word' && state.quickAdd.resolved.needsTranslation &&
        text !== state.quickAdd.resolved.translationSource) {
      delete state.quickAdd.resolved.needsTranslation;
      delete state.quickAdd.resolved.translationSource;
    }
  }
  renderQuickAddPanel();

  if (stageIndex < 2) {
    let nextStage = stageIndex + 1;
    const fields = getQuickAddFieldOrder();
    if (nextStage === 1 &&
        fields[nextStage] === 'pronunciation' &&
        !state.quickAdd.resolved.pronunciation &&
        !containsKanji(state.quickAdd.resolved.word)) {
      nextStage++;
    }
    state.quickAdd.stageIndex = nextStage;
    const nextKey = getQuickAddFieldOrder()[state.quickAdd.stageIndex];
    const nextValue = state.quickAdd.resolved[nextKey] || '';
    quickAddInput.value = nextValue;
    state.quickAdd.lastCheckedText = nextValue;
    updateQuickAddImeBinding();
    updateQuickAddBackBtn();
    quickAddInput.select();
    renderQuickAddPanel();
    return;
  }

  const resolved = state.quickAdd.resolved;
  const section = state.quickAdd.section;
  const existing = await findExistingWordLocation(normalize(resolved.word));

  if (existing) {
    if (existing.section === section) {
      window.alert(`"${resolved.word}" already exists in this section.`);
      closeQuickAdd();
      return;
    }
    // Rather than blocking the add outright, offer to relocate the
    // existing entry here instead of creating a second copy of the same
    // word — Cancel leaves it where it is and aborts adding anything.
    const moveHere = window.confirm(
      `"${resolved.word}" already exists in "${getSectionDisplayLabel(existing.section)}". Move it to "${getSectionDisplayLabel(section)}" instead?\n\nCancel to leave it where it is and abort adding this word.`
    );
    if (!moveHere) {
      closeQuickAdd();
      return;
    }
    try {
      await updateJapanData({
        [`words/${state.language}/${existing.section}/${existing.id}`]: null,
        [`words/${state.language}/${section}/${existing.id}`]: existing.data
      }, {
        [`words/${state.language}/${existing.section}/${existing.id}`]: existing.data,
        [`words/${state.language}/${section}/${existing.id}`]: null
      });
      await Promise.all([
        bumpSectionCount(state.language, existing.section, -1),
        bumpSectionCount(state.language, section, 1)
      ]);
    } catch (err) {
      console.error('Failed to move existing word', err);
      window.alert('Failed to move word. See console for details.');
    }
    closeQuickAdd();
    return;
  }

  try {
    const wordRef = wordsRef.child(state.language).child(section).push();
    const wordPath = `words/${state.language}/${section}/${wordRef.key}`;
    await updateJapanData({
      [wordPath]: {
        w: resolved.word,
        p: resolved.pronunciation,
        em: toInitCap(resolved.englishMeaning),
        c: Date.now(),
        ...(resolved.needsTranslation ? { needsTranslation: true } : {})
      }
    }, { [`${wordPath}`]: null });
    await bumpSectionCount(state.language, section, 1);
    const cachedWords = await readCachedSectionWords(state.language, section);
    if (cachedWords) {
      cachedWords[wordRef.key] = {
        w: resolved.word,
        p: resolved.pronunciation,
        em: toInitCap(resolved.englishMeaning),
        c: Date.now(),
        ...(resolved.needsTranslation ? { needsTranslation: true } : {})
      };
      const cacheResult = await cacheSectionWords(state.language, section, cachedWords);
      if (!cacheResult.ok) console.warn('Could not cache the new word locally.', cacheResult.error);
    }
    if (state.sectionCache.has(section)) {
      state.sectionCache.get(section).unshift({
        id: wordRef.key,
        word: resolved.word,
        pronunciation: resolved.pronunciation,
        englishMeaning: toInitCap(resolved.englishMeaning),
        language: state.language,
        section,
        createdAt: Date.now()
      });
      renderCurrentView();
    }
  } catch (err) {
    console.error('Failed to save word', err);
    window.alert('Failed to save word. See console for details.');
  }
  closeQuickAdd();
}
