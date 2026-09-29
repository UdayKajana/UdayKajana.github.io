// The compact "quick add" modal: space-bar/swipe-triggered word entry with
// live romaji->kana IME conversion (or English-meaning-first translation),
// Enter-driven traversal between word/pronunciation/meaning with full
// back-navigation, duplicate-word handling, and '>' subsection creation.
// If you're changing how a word gets added, or how that popup behaves,
// it's in this file.

import { state, langCodeMap } from './state.js';
import { database, japanRef, wordsRef, updateJapanData } from './firebase-init.js';
import { normalize, escapeHtml, toInitCap } from './utils.js';
import {
  quickAddModal, quickAddModeEn,
  quickAddInput, quickAddBackBtn, quickAddPanel, quickAddPreviewRows
} from './dom.js';
import { translateText, romanizeNativeWord, convertRomajiToHiragana, convertKanaToRomaji } from './translate.js';
import { getSectionDisplayLabel, getSubsectionLabel, isSubsection, findExistingWordLocation, bumpSectionCount, renderCurrentView } from './sections.js';

// Resolves whatever was typed into the word stage into all three fields at
// once — in romaji mode, the typed text IS the word (already converted to
// kana by the live IME binding below) so only pronunciation/meaning are
// derived from it; in meaning mode, the typed text is the English meaning
// and the native word/pronunciation are derived from a translation instead.
export async function resolveQuickAddFields(text) {
  const nativeLang = langCodeMap[state.language] || 'ja';

  if (state.quickAddMeaningMode) {
    const englishMeaning = text;
    const word = (await translateText(text, 'en', nativeLang)) || text;
    const pronunciation = await romanizeNativeWord(word, nativeLang);
    return { word, pronunciation, englishMeaning };
  }

  const word = convertRomajiToHiragana(text);
  const pronunciation = convertKanaToRomaji(word);
  const englishMeaning = await translateText(word, nativeLang, 'en');
  return { word, pronunciation, englishMeaning };
}

export function getQuickAddFieldOrder() {
  return state.quickAddMeaningMode
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
  return state.quickAdd.section ? `Add to "${getSubsectionLabel(state.quickAdd.section)}"` : '';
}

export function updateQuickAddModeUI() {
  quickAddModeEn.classList.toggle('quick-add-mode-btn-active', state.quickAddMeaningMode);
}

// Live-converts the input's own text as you type, the same way a real
// Japanese IME would — only relevant for the "word" stage while in
// romaji mode (typing the English meaning, or reviewing an
// already-resolved word/pronunciation, should never get phonetic
// conversion sprung on it), and NOT while typing a '>subsection name' —
// confirmed by testing that leaving it bound there corrupts the name
// (typed "SNACKS", the live conversion silently turned it into
// "SナCKS"). Re-evaluated on every stage/toggle/keystroke change, so
// it's always bound exactly when it should be and nowhere else.
//
// wanakana.unbind() throws if the element was never bound in the first
// place (rather than a no-op) — quickAddImeBound tracks that ourselves
// so unbind is only ever called on an element we know we bound.
let quickAddImeBound = false;

export function updateQuickAddImeBinding() {
  if (typeof wanakana === 'undefined') return;
  const isSubsectionEntry = quickAddInput.value.trim().startsWith('>');
  const shouldBeBound = !state.quickAddMeaningMode && state.quickAdd.open && state.quickAdd.stageIndex === 0 && !isSubsectionEntry;
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

export function openQuickAdd(section) {
  closeQuickAdd();
  state.quickAdd = { open: true, section, stageIndex: 0, resolved: null, lastCheckedText: null };
  state.lastActiveSection = section;
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
  state.quickAdd = { open: false, section: null, stageIndex: 0, resolved: null, lastCheckedText: null };
  quickAddModal.classList.remove('open');
  quickAddInput.value = '';
  quickAddInput.disabled = false;
  quickAddInput.placeholder = '';
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

export function startQuickAddChecker() {
  if (quickAddCheckTimer) return;
  quickAddCheckTimer = setInterval(checkQuickAddForChanges, 2000);
}

export function stopQuickAddChecker() {
  clearInterval(quickAddCheckTimer);
  quickAddCheckTimer = null;
}

// The 2-second poll: only reacts when the field's text actually differs
// from what it held at the last check.
export async function checkQuickAddForChanges() {
  if (!state.quickAdd.open) return;
  const text = quickAddInput.value.trim();
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
    if (!state.quickAdd.open || state.quickAdd.stageIndex !== 0 || quickAddInput.value.trim() !== text) return;
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
    await japanRef.child(`sectionSummary/${state.language}/${fullName}`).transaction(current => (current === null ? 0 : current));
  } catch (err) {
    console.error('Failed to create subsection', err);
    window.alert('Failed to create subsection. See console for details.');
    return;
  }
  state.expandedSections.add(parentSection);
  state.expandedSections.add(fullName);
  closeQuickAdd();
  renderCurrentView();
  const parentWrapper = state.sectionHeaderDomRefs.get(parentSection);
  if (parentWrapper) parentWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// The Enter handler while composing: advances one stage at a time —
// capturing any manual edit at the current stage before moving to the
// next. After the meaning stage, saves directly into the fixed section
// (no category step to pass through).
export async function advanceQuickAddStage() {
  if (!state.quickAdd.open) return;
  const text = quickAddInput.value.trim();
  if (!text) return;

  const stageIndex = state.quickAdd.stageIndex;

  if (stageIndex === 0 && text.startsWith('>')) {
    await createSubsectionUnder(state.quickAdd.section, text.slice(1));
    return;
  }

  if (stageIndex === 0) {
    // Reuse the poller's resolution if it already caught up with this
    // exact text; otherwise resolve it now rather than make the user wait
    // for the next 2-second tick.
    if (!state.quickAdd.resolved || state.quickAdd.lastCheckedText !== text) {
      quickAddInput.disabled = true;
      quickAddInput.placeholder = state.quickAddMeaningMode ? 'Translating…' : 'Converting…';
      state.quickAdd.resolved = await resolveQuickAddFields(text);
      state.quickAdd.lastCheckedText = text;
      quickAddInput.disabled = false;
      quickAddInput.placeholder = getQuickAddPlaceholder();
    }
  } else {
    const key = getQuickAddFieldOrder()[stageIndex];
    state.quickAdd.resolved[key] = text;
  }
  renderQuickAddPanel();

  if (stageIndex < 2) {
    state.quickAdd.stageIndex = stageIndex + 1;
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
    await wordsRef.child(state.language).child(section).push({ w: resolved.word, p: resolved.pronunciation, em: toInitCap(resolved.englishMeaning), c: Date.now() });
    await bumpSectionCount(state.language, section, 1);
  } catch (err) {
    console.error('Failed to save word', err);
    window.alert('Failed to save word. See console for details.');
  }
  closeQuickAdd();
}
