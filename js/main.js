// App bootstrap and global wiring: auth/admin gate, and every top-level
// event listener that isn't owned by a single feature module (section-list
// search, reading/script-practice open/close buttons, theme/logout,
// the space-bar/triple-tap quick-add shortcuts, Shift+Space/double-tap
// note shortcuts, Shift-to-switch-mode forwarding, and closing an open
// section kebab menu on outside click).
// This is the only file loaded directly by language-studio.html — everything
// else is reached through its import graph. See ARCHITECTURE.md for the full
// feature -> file map.

import { state } from './state.js';
import { auth, database, syncPendingLanguageWrites } from './firebase-init.js';
import {
  sectionFilterInput, readingButton, readingClose,
  scriptPracticeClose, themeToggle, logoutButton,
  quickAddModal, quickAddClose, quickAddClearBtn,
  quickAddBackBtn, quickAddInput, quickAddPanel, quickAddPreviewRows,
  quickAddModeToggle
} from './dom.js';
import { switchLanguage, renderCurrentView, handleSectionFilterEnter, getTopLevelSectionNames, closeSectionMenu } from './sections.js';
import {
  openQuickAdd, closeQuickAdd, goToQuickAddStage, advanceQuickAddStage,
  updateQuickAddImeBinding, updateQuickAddModeUI, getQuickAddPlaceholder, startQuickAddChecker,
  stopQuickAddChecker, renderSubsectionHint, renderNewSectionHint
} from './quick-add.js';
import { startAppLevelReading, closeReadingModal } from './reading.js';
import { openScriptPracticeModal, closeScriptPracticeModal } from './script-practice.js';
import { openNoteEditor } from './section-notes.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js')
    .catch(error => console.error('Could not register offline app support.', error));
}

state.currentUser = null;
state.isAdmin = false;

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Shift' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target && target.closest &&
      target.closest('input, textarea, select, [contenteditable="true"], .modal-backdrop.open')) return;
  if (document.querySelector('.modal-backdrop.open')) return;
  event.preventDefault();
  window.parent.postMessage({ type: 'language-studio-mode-shortcut' }, window.location.origin);
});

window.addEventListener('online', syncPendingLanguageWrites);
window.addEventListener('offline-sync-conflict', () => {
  window.alert('An offline Language change conflicts with newer online content. It was kept on this device and not overwritten.');
});

auth.onAuthStateChanged(async (user) => {
  state.currentUser = user;
  if (navigator.onLine) syncPendingLanguageWrites();
  if (!user) {
    // Not signed in — redirect to login, passing this page so login sends us back here
    window.location.href = '/?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
    return;
  }

  // Use the same provider-based admin rule as the main app: access-code and
  // password-provider sign-ins are admin; Google sign-ins remain read-only.
  const loginMethod = localStorage.getItem('loginMethod');
  const hasPasswordProvider = user && user.providerData && user.providerData.some(({ providerId }) => providerId === 'password');
  state.isAdmin = loginMethod === 'access-code' || hasPasswordProvider || localStorage.getItem('userRole') === 'admin';

  // Only load the current language's data once admin status is known, so the
  // very first load already knows whether to run the (admin-only) bootstrap.
  switchLanguage(state.language);
});

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error('Failed to sign out', err);
    }
    window.location.href = '/';
  });
}

sectionFilterInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderCurrentView();
});

sectionFilterInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  handleSectionFilterEnter();
});

if (readingButton) readingButton.addEventListener('click', () => startAppLevelReading());
if (readingClose) readingClose.addEventListener('click', () => closeReadingModal());
if (scriptPracticeClose) scriptPracticeClose.addEventListener('click', () => closeScriptPracticeModal());

const hiddenScriptPracticeButtons = [
  { id: 'script-practice-hiragana', scriptKey: 'hiragana', label: 'Hiragana' },
  { id: 'script-practice-katakana', scriptKey: 'katakana', label: 'Katakana' },
  { id: 'script-practice-kanji', scriptKey: 'kanji', label: 'Kanji' }
];

hiddenScriptPracticeButtons.forEach(({ id, scriptKey, label }) => {
  const button = document.getElementById(id);
  if (!button) return;
  button.addEventListener('click', () => openScriptPracticeModal(scriptKey, label));
});

// Quick add is a real modal now — not embedded in any <summary> — so
// none of the old disclosure-toggle/click-away workarounds are needed at
// all: typing a space is just typing a space, and there's exactly one
// fixed home in the DOM for it, no reattachment dance either.
quickAddClose.addEventListener('click', () => closeQuickAdd());
quickAddClearBtn.addEventListener('click', () => closeQuickAdd());
quickAddBackBtn.addEventListener('click', () => goToQuickAddStage(state.quickAdd.stageIndex - 1));
quickAddInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      goToQuickAddStage(state.quickAdd.stageIndex - 1);
    } else {
      advanceQuickAddStage();
    }
  } else if (event.key === 'Escape') {
    closeQuickAdd();
  }
});
quickAddInput.addEventListener('input', () => {
  const text = quickAddInput.value;
  // Re-evaluated on every keystroke (not just stage/toggle changes) so the
  // very first ">" keystroke unbinds live conversion before it can
  // mangle the subsection name that follows.
  if (state.quickAdd.stageIndex === 0) updateQuickAddImeBinding();
  if (state.quickAdd.stageIndex === 0 && !state.quickAdd.section) {
    stopQuickAddChecker();
    renderNewSectionHint(text.trim());
    return;
  }
  if (state.quickAdd.stageIndex === 0 && text.trim().startsWith('>')) {
    stopQuickAddChecker();
    renderSubsectionHint(text.trim().slice(1).trim());
    return;
  }
  if (state.quickAdd.stageIndex === 0 && text.trim() !== state.quickAdd.lastCheckedText) {
    state.quickAdd.resolved = null;
    quickAddPanel.classList.add('hidden');
    quickAddPreviewRows.innerHTML = '';
  }
  startQuickAddChecker();
});
function setQuickAddMeaningMode(meaningMode) {
  if (state.quickAdd.inputMode !== 'default') return;
  if (state.quickAddMeaningMode === meaningMode) return;
  state.quickAddMeaningMode = meaningMode;
  localStorage.setItem('quickAddMeaningMode', state.quickAddMeaningMode ? '1' : '0');
  updateQuickAddModeUI();
  updateQuickAddImeBinding();
  if (state.quickAdd.open) {
    state.quickAdd.resolved = null;
    state.quickAdd.lastCheckedText = null;
    quickAddPanel.classList.add('hidden');
    quickAddPreviewRows.innerHTML = '';
    quickAddInput.placeholder = getQuickAddPlaceholder();
    startQuickAddChecker();
  }
}
quickAddModeToggle.addEventListener('click', () => setQuickAddMeaningMode(!state.quickAddMeaningMode));
// Clicking the dimmed backdrop (not the card itself) closes it, same as
// most modal dialogs — the other modals in this app only expose an
// explicit close button, but reading is a multi-step session where an
// accidental backdrop tap losing progress would
// actually hurt; this one is just a text box, so the friendlier default
// is worth it here.
quickAddModal.addEventListener('click', (event) => {
  if (event.target === quickAddModal) closeQuickAdd();
});


// Closes an open section kebab menu on any click outside it — the menu
// items themselves stopPropagation, so this only ever sees genuine
// clicks elsewhere on the page.
document.addEventListener('click', () => {
  if (state.sectionMenu.mode === 'closed') return;
  closeSectionMenu();
});

// Desktop: space bar opens quick-add for whichever section is currently
// hovered, or failing that the last one expanded/added to, or failing
// that the first section on screen — a fast alternative to hunting down
// that section's own "+". Guarded to skip while actually typing
// anywhere (this input included, once open — Escape/× close it instead)
// so it can never hijack a real space keystroke.
document.addEventListener('keydown', (event) => {
  if (event.key !== ' ' && event.code !== 'Space') return;
  if (event.shiftKey) return;
  if (state.quickAdd.open || state.noteEditorOpen) return;
  if (!state.isAdmin) return;
  const target = event.target;
  const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (isTyping) return;
  const section = state.hoveredSection || state.lastActiveSection || getTopLevelSectionNames()[0];
  if (!section) return;
  event.preventDefault();
  openQuickAdd(section);
});

// Desktop: Shift+Space opens note editor for the current section
document.addEventListener('keydown', (event) => {
  if ((event.key !== ' ' && event.code !== 'Space') || !event.shiftKey) return;
  if (state.quickAdd.open || state.noteEditorOpen) return;
  if (!state.isAdmin) return;
  const target = event.target;
  const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (isTyping) return;
  const section = state.hoveredSection || state.lastActiveSection || getTopLevelSectionNames()[0];
  if (!section) return;
  event.preventDefault();
  openNoteEditor(section);
});

// Desktop: Double Shift adds a new section at root level
let lastShiftTime = 0;
const DOUBLE_SHIFT_MS = 300;
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Shift') return;
  if (state.quickAdd.open || state.noteEditorOpen) return;
  if (!state.isAdmin) return;
  const now = Date.now();
  if (now - lastShiftTime < DOUBLE_SHIFT_MS) {
    lastShiftTime = 0;
    event.preventDefault();
    openQuickAdd(null);
    return;
  }
  lastShiftTime = now;
});

// Touch: no swipe gestures here — swipes just scroll. Adding words and sections is on the drop
// button in the Notes page (see openNewWord / openNewSection below).

// The drop button in the Notes page calls these while in Languages: one click/tap adds a word to
// the current section (like Space), a long press adds a new top-level section (like Double Shift).
window.openNewWord = () => {
  if (state.quickAdd.open || state.noteEditorOpen || !state.isAdmin) return false;
  const section = state.hoveredSection || state.lastActiveSection || getTopLevelSectionNames()[0];
  if (!section) return false;
  openQuickAdd(section);
  return true;
};
window.openNewSection = () => {
  if (state.quickAdd.open || state.noteEditorOpen || !state.isAdmin) return false;
  openQuickAdd(null, 'section');
  return true;
};

// Touch: triple-tap on open space opens quick-add for new words,
// double-tap opens note editor. Word cards are skipped because their own
// double-tap already edits the card, as are links, buttons and inputs.
const QUICK_ADD_TAP_MS = 300;
let quickAddTaps = 0;
let quickAddTapTimer = null;
let quickAddTapDown = null;
document.addEventListener('pointerdown', (event) => {
  quickAddTapDown = event.isPrimary ? { x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
});
document.addEventListener('pointerup', (event) => {
  const down = quickAddTapDown;
  quickAddTapDown = null;
  if (!down || event.pointerType === 'mouse' || state.quickAdd.open || state.noteEditorOpen || state.readingActive || !state.isAdmin) return;
  const isTap = Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 8 && event.timeStamp - down.time <= QUICK_ADD_TAP_MS;
  if (!isTap || event.target.closest('.compact-card, a, button, input, textarea, select, summary, [contenteditable="true"]')) {
    quickAddTaps = 0;
    return;
  }
  quickAddTaps++;
  clearTimeout(quickAddTapTimer);
  if (quickAddTaps >= 3) {
    quickAddTaps = 0;
    const section = state.hoveredSection || state.lastActiveSection || getTopLevelSectionNames()[0];
    if (!section) return;
    // On touch the browser sends a click right after this tap, which would land
    // on the modal's backdrop and close it again — swallow that one click.
    const swallowClick = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
    document.addEventListener('click', swallowClick, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallowClick, { capture: true }), 600);
    openQuickAdd(section);
    return;
  }
  quickAddTapTimer = setTimeout(() => {
    if (quickAddTaps === 2) {
      quickAddTaps = 0;
      const section = state.hoveredSection || state.lastActiveSection || getTopLevelSectionNames()[0];
      if (!section) return;
      const swallowClick = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
      document.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallowClick, { capture: true }), 600);
      openNoteEditor(section);
    } else {
      quickAddTaps = 0;
    }
  }, QUICK_ADD_TAP_MS);
});
