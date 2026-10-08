// Word cards: rendering, the pointer-gesture state machine (double-click
// to edit, click-and-hold to delete, long-press to drag-and-move), inline
// edit mode, and deleting/moving a single word. If you're changing how a
// word card looks or reacts to clicks/taps/holds/drags, it's in this file.
//
// Circular import note: this imports section helpers (isSubsection,
// getSubsectionsOf, renderCurrentView, bumpSectionCount) from sections.js,
// which in turn imports buildDictionaryCard from here to render word lists.
// Safe because nothing in either file runs at module-evaluation time —
// only inside functions invoked later, after both modules have loaded.

import { state } from './state.js';
import { updateJapanData } from './firebase-init.js';
import { containsKanji, escapeHtml, toInitCap } from './utils.js';
import { isSubsection, getSubsectionsOf, renderCurrentView, bumpSectionCount, cacheSectionWords, upsertSectionCacheEntry } from './sections.js';

// Timing for the three pointer gestures on a word card. Kept deliberately
// apart so they can never be mistaken for one another: a real
// double-click always completes both releases well inside
// DOUBLE_CLICK_WINDOW_MS, long before DELETE_HOLD_MS could ever fire.
//  - two releases within DOUBLE_CLICK_WINDOW_MS of each other -> edit.
//  - a second press that ISN'T released within DELETE_HOLD_MS -> delete.
//  - a lone press (no preceding click) held past DRAG_HOLD_MS -> drag.
export const DOUBLE_CLICK_WINDOW_MS = 300;
export const DELETE_HOLD_MS = 1000;
export const DRAG_HOLD_MS = 450;

// Pointer Events unify mouse and touch, so this one state machine drives
// both desktop clicking and mobile tapping/holding without separate code
// paths. Re-attached fresh on every view-mode render (see
// exitCardEditMode) rather than persisted, so there's nothing to leak
// between a card's edit and view states.
export function attachCardInteractions(card, entry) {
  let lastPointerUpAt = 0;
  let secondPressDownAt = 0;
  let holdTimer = null;
  let holdKind = null; // 'delete' | 'drag'
  const overlay = card.querySelector('.card-delete-hold-overlay');

  function cancelHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    holdKind = null;
    if (overlay) overlay.classList.remove('card-delete-hold-active');
  }

  card.addEventListener('pointerdown', (event) => {
    if (!state.isAdmin || card.dataset.editing === '1' || event.button !== 0) return;
    const isSecondPress = (event.timeStamp - lastPointerUpAt) <= DOUBLE_CLICK_WINDOW_MS;
    if (isSecondPress) {
      holdKind = 'delete';
      secondPressDownAt = event.timeStamp;
      if (overlay) overlay.classList.add('card-delete-hold-active');
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (overlay) overlay.classList.remove('card-delete-hold-active');
        deleteWordEntry(entry, { skipConfirm: true });
      }, DELETE_HOLD_MS);
    } else {
      holdKind = 'drag';
      holdTimer = setTimeout(() => {
        holdTimer = null;
        startCardDrag(card, entry, event);
      }, DRAG_HOLD_MS);
    }
  });

  card.addEventListener('pointerup', (event) => {
    lastPointerUpAt = event.timeStamp;
    if (holdKind === 'delete' && holdTimer) {
      // The second press released before the delete hold completed — but
      // only counts as a genuine double-click if THAT release was ALSO
      // fast. Held past the double-click window but released before the
      // delete threshold lands in a deliberate dead zone: not a fast
      // enough double-click to edit, not a long enough hold to delete.
      const heldFor = event.timeStamp - secondPressDownAt;
      cancelHold();
      if (heldFor <= DOUBLE_CLICK_WINDOW_MS) {
        enterCardEditMode(card, entry);
      }
    } else {
      cancelHold();
    }
  });

  // Moving off the card before a hold completes cancels it — a
  // press that started here but drifted off before the threshold
  // shouldn't fire a delete or a drag.
  card.addEventListener('pointerleave', cancelHold);
  card.addEventListener('pointercancel', cancelHold);
}

export function buildDictionaryCardContent(entry) {
  const pronunciation = entry.pronunciation || '';
  const englishMeaning = entry.englishMeaning || '';
  const pronunciationHtml = containsKanji(entry.word) && pronunciation
    ? `<div class="word-field word-field-pronunciation min-w-[80px] truncate text-sm leading-snug">${escapeHtml(pronunciation)}</div>`
    : '';
  return `
    <div class="card-delete-hold-overlay"></div>
    <div class="min-w-0 flex-1 flex items-baseline gap-3" title="${escapeHtml([entry.word, pronunciation, englishMeaning].filter(Boolean).join(' · '))}">
      <div class="word-field word-field-word min-w-[100px] truncate text-sm font-semibold leading-snug">${escapeHtml(entry.word)}</div>
      ${pronunciationHtml}
      <div class="word-field word-field-meaning flex-1 truncate text-sm leading-snug">${escapeHtml(englishMeaning)}</div>
    </div>
  `;
}

export function enterCardEditMode(card, entry) {
  if (card.dataset.editing === '1') return;
  card.dataset.editing = '1';
  renderCardEditFields(card, entry);
}

export const CARD_EDIT_FIELD_ORDER = ['word', 'pronunciation', 'englishMeaning'];

// Turns a card in place into three inline text fields — no buttons at
// all: Enter is the only way through it. Starts on the word field with
// its text pre-selected; each Enter both captures whatever's in the
// current field and steps to the next one (word -> pronunciation ->
// meaning), forward only — there's no going back once you've moved on
// (unlike the quick-add modal's traversal). Enter from the last field
// saves all three. Escape, or a pointerdown anywhere outside the card,
// discards the edit and reverts to the original values (replacing what
// the old Clear button used to do).
export function renderCardEditFields(card, entry) {
  card.innerHTML = `
    <div class="min-w-0 flex-1 flex items-center gap-2">
      <input type="text" data-field="word" value="${escapeHtml(entry.word)}" class="min-w-0 w-[100px] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-sm font-semibold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
      <input type="text" data-field="pronunciation" value="${escapeHtml(entry.pronunciation || '')}" class="min-w-0 w-[80px] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-500 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400" />
      <input type="text" data-field="englishMeaning" value="${escapeHtml(entry.englishMeaning || '')}" class="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300" />
    </div>
  `;

  const inputs = CARD_EDIT_FIELD_ORDER.map(name => card.querySelector(`[data-field="${name}"]`));

  function finish(save) {
    document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    if (save) {
      saveCardEdits(card, entry);
    } else {
      exitCardEditMode(card, entry);
    }
  }

  // Capture phase so this sees the pointerdown before any other card's
  // own gesture handling does.
  function handleOutsidePointerDown(event) {
    if (card.contains(event.target)) return;
    finish(false);
  }
  document.addEventListener('pointerdown', handleOutsidePointerDown, true);

  inputs.forEach((input, index) => {
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const nextInput = inputs[index + 1];
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        } else {
          finish(true);
        }
      } else if (event.key === 'Escape') {
        finish(false);
      }
    });
  });

  inputs[0].focus();
  inputs[0].select();
}

export function exitCardEditMode(card, entry) {
  card.dataset.editing = '';
  card.innerHTML = buildDictionaryCardContent(entry);
  attachCardInteractions(card, entry);
}

export async function saveCardEdits(card, entry) {
  const word = card.querySelector('[data-field="word"]').value.trim();
  const pronunciation = card.querySelector('[data-field="pronunciation"]').value.trim();
  const englishMeaning = toInitCap(card.querySelector('[data-field="englishMeaning"]').value.trim());
  if (!word) {
    window.alert('Word cannot be empty.');
    return;
  }
  try {
    await updateJapanData({
      [`words/${state.language}/${entry.section}/${entry.id}/w`]: word,
      [`words/${state.language}/${entry.section}/${entry.id}/p`]: pronunciation,
      [`words/${state.language}/${entry.section}/${entry.id}/em`]: englishMeaning
    }, {
      [`words/${state.language}/${entry.section}/${entry.id}/w`]: entry.word,
      [`words/${state.language}/${entry.section}/${entry.id}/p`]: entry.pronunciation || '',
      [`words/${state.language}/${entry.section}/${entry.id}/em`]: entry.englishMeaning || ''
    });
  } catch (err) {
    console.error('Failed to save word', err);
    window.alert('Failed to save word. See console for details.');
    return;
  }
  entry.word = word;
  entry.pronunciation = pronunciation;
  entry.englishMeaning = englishMeaning;
  const entries = state.sectionCache.get(entry.section);
  if (entries) {
    const words = Object.fromEntries(entries.map(item => [item.id, {
      w: item.word, p: item.pronunciation || '', em: item.englishMeaning || '', c: item.createdAt || 0
    }]));
    const cached = await cacheSectionWords(state.language, entry.section, words);
    if (!cached.ok) console.warn('Could not cache edited word locally.', cached.error);
  }
  exitCardEditMode(card, entry);
}

// Shared by the drag-and-drop move (below) — moves a word's data to
// targetSection and adjusts both sections' counts.
export async function moveWordEntry(entry, targetSection) {
  try {
    const data = {
      w: entry.word,
      p: entry.pronunciation || '',
      em: entry.englishMeaning || '',
      c: entry.createdAt || 0
    };
    if (data) {
      await updateJapanData({
        [`words/${state.language}/${entry.section}/${entry.id}`]: null,
        [`words/${state.language}/${targetSection}/${entry.id}`]: data
      }, {
        [`words/${state.language}/${entry.section}/${entry.id}`]: data,
        [`words/${state.language}/${targetSection}/${entry.id}`]: null
      });
      await Promise.all([
        bumpSectionCount(state.language, entry.section, -1),
        bumpSectionCount(state.language, targetSection, 1)
      ]);
      for (const section of [entry.section, targetSection]) {
        const entries = state.sectionCache.get(section);
        if (entries) {
          const updatedEntries = section === entry.section
            ? entries.filter(item => item.id !== entry.id)
            : upsertSectionCacheEntry(targetSection, { ...entry, section: targetSection });
          if (section === entry.section) state.sectionCache.set(section, updatedEntries);
          const words = Object.fromEntries(updatedEntries.map(item => [item.id, {
            w: item.word, p: item.pronunciation || '', em: item.englishMeaning || '', c: item.createdAt || 0
          }]));
          const cached = await cacheSectionWords(state.language, section, words);
          if (!cached.ok) console.warn('Could not cache moved word locally.', cached.error);
        }
      }
      entry.section = targetSection;
    }
  } catch (err) {
    console.error('Failed to move word to new section', err);
    window.alert('Failed to move word. See console for details.');
  }
}

export function buildDictionaryCard(entry) {
  const card = document.createElement('article');
  card.className = 'compact-card transition-colors duration-150 flex items-center justify-between gap-2';
  card.innerHTML = buildDictionaryCardContent(entry);
  attachCardInteractions(card, entry);
  return card;
}

// ---- Drag-to-move: long-press a word card and drop it on a section or
// subsection header to move it there. Every section collapses the
// moment the drag starts, so every header is a visible, reachable drop
// target; hovering over a still-collapsed parent for a beat drills into
// it (showing only its subsections, never its own words — you can't
// drop a word onto another word). ----

export function startCardDrag(card, entry, initialEvent) {
  if (state.cardDrag) return;

  state.expandedSections.clear();
  state.expandedUnsectionedGroups.clear();
  renderCurrentView();

  card.classList.add('compact-card-dragging');

  const ghost = document.createElement('div');
  ghost.className = 'card-drag-ghost';
  ghost.innerHTML = `<span>${escapeHtml(entry.word)}</span><span class="card-drag-ghost-meaning">${escapeHtml(entry.englishMeaning || '')}</span>`;
  document.body.appendChild(ghost);

  state.cardDrag = { entry, card, ghost, hoverSection: null, hoverRow: null, hoverTimer: null };
  positionCardDragGhost(initialEvent.clientX, initialEvent.clientY);

  document.addEventListener('pointermove', onCardDragMove);
  document.addEventListener('pointerup', onCardDragEnd);
  document.addEventListener('pointercancel', onCardDragCancel);
}

export function positionCardDragGhost(x, y) {
  if (!state.cardDrag) return;
  // Offset above the point of contact so a finger (or the cursor)
  // doesn't sit directly on top of — and hide — the ghost.
  state.cardDrag.ghost.style.left = `${x}px`;
  state.cardDrag.ghost.style.top = `${y - 28}px`;
}

export function onCardDragMove(event) {
  if (!state.cardDrag) return;
  positionCardDragGhost(event.clientX, event.clientY);

  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const summary = hit && hit.closest('summary');
  const row = summary ? summary.closest('.section-row, .section-row-sub') : null;
  const section = row ? row.dataset.section : null;

  if (section === state.cardDrag.hoverSection) return;

  if (state.cardDrag.hoverRow) {
    state.cardDrag.hoverRow.classList.remove('section-row-drop-hover');
  }
  if (state.cardDrag.hoverTimer) {
    clearTimeout(state.cardDrag.hoverTimer);
    state.cardDrag.hoverTimer = null;
  }

  state.cardDrag.hoverSection = section;
  state.cardDrag.hoverRow = row;
  if (!section) return;

  row.classList.add('section-row-drop-hover');

  const isCollapsedParentWithSubsections = !isSubsection(section)
    && getSubsectionsOf(section).length > 0
    && !state.expandedSections.has(section);
  if (isCollapsedParentWithSubsections) {
    state.cardDrag.hoverTimer = setTimeout(() => {
      state.cardDrag.hoverTimer = null;
      if (!state.cardDrag || state.cardDrag.hoverSection !== section) return;
      state.expandedSections.add(section);
      renderCurrentView();
      // The row was just rebuilt — re-apply the highlight to the fresh one.
      const freshWrapper = state.sectionHeaderDomRefs.get(section);
      if (freshWrapper) {
        freshWrapper.classList.add('section-row-drop-hover');
        state.cardDrag.hoverRow = freshWrapper;
      }
    }, 600);
  }
}

export async function onCardDragEnd() {
  if (!state.cardDrag) return;
  const drag = state.cardDrag;
  stopCardDragTracking();
  const targetSection = drag.hoverSection;
  cleanupCardDrag();
  if (!targetSection || targetSection === drag.entry.section) return;
  await moveWordEntry(drag.entry, targetSection);
}

export function onCardDragCancel() {
  if (!state.cardDrag) return;
  stopCardDragTracking();
  cleanupCardDrag();
}

export function stopCardDragTracking() {
  document.removeEventListener('pointermove', onCardDragMove);
  document.removeEventListener('pointerup', onCardDragEnd);
  document.removeEventListener('pointercancel', onCardDragCancel);
}

export function cleanupCardDrag() {
  const drag = state.cardDrag;
  if (!drag) return;
  if (drag.hoverTimer) clearTimeout(drag.hoverTimer);
  if (drag.hoverRow) drag.hoverRow.classList.remove('section-row-drop-hover');
  drag.ghost.remove();
  drag.card.classList.remove('compact-card-dragging');
  state.cardDrag = null;
  renderCurrentView();
}

export async function deleteWordEntry(entry, options) {
  if (!entry) return;
  const skipConfirm = !!(options && options.skipConfirm);
  if (!skipConfirm && !window.confirm(`Delete "${entry.word}"?`)) return;
  if (!state.isAdmin) {
    window.alert('You are not authorized to delete this entry.');
    return;
  }
  let trashRecord;
  try {
    const archiveWord = window.parent && window.parent.archiveLanguageWordToTrash;
    if (typeof archiveWord !== 'function') {
      throw new Error('The Notes Recently deleted area is unavailable, so this word cannot be safely deleted.');
    }
    trashRecord = await archiveWord({
      language: entry.language,
      section: entry.section,
      id: entry.id,
      data: entry.rawData || {
        w: entry.word,
        p: entry.pronunciation || '',
        em: entry.englishMeaning || '',
        c: entry.createdAt || 0
      }
    });
    await updateJapanData(
      { [`words/${state.language}/${entry.section}/${entry.id}`]: null },
      {
        [`words/${state.language}/${entry.section}/${entry.id}`]: entry.rawData || {
          w: entry.word,
          p: entry.pronunciation || '',
          em: entry.englishMeaning || '',
          c: entry.createdAt || 0
        }
      }
    );
    await bumpSectionCount(state.language, entry.section, -1);
    const entries = state.sectionCache.get(entry.section);
    if (entries) {
      const remaining = entries.filter(item => item.id !== entry.id);
      state.sectionCache.set(entry.section, remaining);
      const words = Object.fromEntries(remaining.map(item => [item.id, {
        w: item.word, p: item.pronunciation || '', em: item.englishMeaning || '', c: item.createdAt || 0
      }]));
      const cached = await cacheSectionWords(state.language, entry.section, words);
      if (!cached.ok) console.warn('Could not cache deleted word locally.', cached.error);
      renderCurrentView();
    }
  } catch (err) {
    if (trashRecord && window.parent && typeof window.parent.removeLanguageWordFromTrash === 'function') {
      try {
        await window.parent.removeLanguageWordFromTrash(trashRecord.path);
      } catch (rollbackError) {
        console.error('Could not remove the archived copy after Language deletion failed.', rollbackError);
      }
    }
    console.error('Failed to delete entry', err);
    window.alert('Failed to delete entry. See console for details.');
  }
}
