// App bootstrap and global wiring: auth/admin gate, and every top-level
// event listener that isn't owned by a single feature module (section-list
// search, quiz/reading/script-practice open/close buttons, theme/logout,
// the hidden-sections eye toggle, the space-bar/swipe/triple-tap quick-add shortcuts,
// and closing an open section kebab menu on outside click). This is the
// only file loaded directly by language-studio.html — everything else is
// reached through its import graph. See ARCHITECTURE.md for the full
// feature -> file map.

import { state } from './state.js';
import { auth, database } from './firebase-init.js';
import { EYE_ICON_PATHS, EYE_SLASH_ICON_PATHS } from './icons.js';
import {
  sectionFilterInput, quizButton, quizClose, quizStart, quizWrong, quizCorrect,
  quizTogglePronunciation, quizToggleMeaning, readingButton, readingClose,
  scriptPracticeClose, themeToggle, logoutButton,
  hiddenToggle, hiddenToggleIcon, quickAddModal, quickAddClose, quickAddClearBtn,
  quickAddBackBtn, quickAddInput, quickAddPanel, quickAddPreviewRows,
  quickAddModeEn
} from './dom.js';
import { switchLanguage, renderCurrentView, handleSectionFilterEnter, getTopLevelSectionNames, closeSectionMenu } from './sections.js';
import {
  openQuickAdd, closeQuickAdd, goToQuickAddStage, advanceQuickAddStage,
  updateQuickAddImeBinding, updateQuickAddModeUI, getQuickAddPlaceholder, startQuickAddChecker,
  stopQuickAddChecker, renderSubsectionHint
} from './quick-add.js';
import { startAppLevelQuiz, closeQuizModal, restartQuizSequence, handleWrong, handleCorrect, renderQuizCard } from './quiz.js';
import { startAppLevelReading, closeReadingModal } from './reading.js';
import { openScriptPracticeModal, closeScriptPracticeModal } from './script-practice.js';

state.currentUser = null;
state.isAdmin = false;

auth.onAuthStateChanged(async (user) => {
  state.currentUser = user;
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

if (quizButton) quizButton.addEventListener('click', () => startAppLevelQuiz());
if (quizClose) quizClose.addEventListener('click', () => closeQuizModal());
if (quizStart) quizStart.addEventListener('click', () => restartQuizSequence());
if (quizWrong) quizWrong.addEventListener('click', () => handleWrong());
if (quizCorrect) quizCorrect.addEventListener('click', () => handleCorrect());
if (quizTogglePronunciation) quizTogglePronunciation.addEventListener('change', () => { if (state.quizCurrent) renderQuizCard(); });
if (quizToggleMeaning) quizToggleMeaning.addEventListener('change', () => { if (state.quizCurrent) renderQuizCard(); });
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
  // Re-checked on every keystroke (not just stage/toggle changes) so the
  // very first ">" keystroke unbinds live conversion before it can
  // mangle the subsection name that follows.
  if (state.quickAdd.stageIndex === 0) updateQuickAddImeBinding();
  if (state.quickAdd.stageIndex === 0 && text.trim().startsWith('>')) {
    stopQuickAddChecker();
    renderSubsectionHint(text.trim().slice(1).trim());
    return;
  }
  if (state.quickAdd.stageIndex === 0 && !state.quickAdd.resolved) {
    // Clear any subsection hint left over from a moment ago.
    quickAddPanel.classList.add('hidden');
    quickAddPreviewRows.innerHTML = '';
  }
  startQuickAddChecker();
});
// The inline "あ"/"A" buttons set the mode directly (not a toggle) —
// clicking whichever one is already active is just a no-op.
function setQuickAddMeaningMode(meaningMode) {
  if (state.quickAddMeaningMode === meaningMode) return;
  state.quickAddMeaningMode = meaningMode;
  localStorage.setItem('quickAddMeaningMode', state.quickAddMeaningMode ? '1' : '0');
  updateQuickAddModeUI();
  updateQuickAddImeBinding();
  // Whatever was already resolved was resolved under the old mode —
  // clear it so the next Enter re-resolves under the new one instead of
  // silently saving a mismatched result.
  if (state.quickAdd.open) {
    state.quickAdd.resolved = null;
    state.quickAdd.lastCheckedText = null;
    quickAddPanel.classList.add('hidden');
    quickAddInput.placeholder = getQuickAddPlaceholder();
  }
}
quickAddModeEn.addEventListener('click', () => setQuickAddMeaningMode(true));
// Clicking the dimmed backdrop (not the card itself) closes it, same as
// most modal dialogs — the other modals in this app only expose an
// explicit close button, but those are multi-step sessions (quiz/
// reading) where an accidental backdrop tap losing progress would
// actually hurt; this one is just a text box, so the friendlier default
// is worth it here.
quickAddModal.addEventListener('click', (event) => {
  if (event.target === quickAddModal) closeQuickAdd();
});

// Plain eye = showing enabled (non-hidden) sections, the default. Eye with
// a strike = showing only sections that have been explicitly hidden, so
// they can be found again and un-hidden.
function updateHiddenToggleUI() {
  hiddenToggleIcon.innerHTML = state.showHidden ? EYE_SLASH_ICON_PATHS : EYE_ICON_PATHS;
  hiddenToggle.title = state.showHidden
    ? 'Showing hidden sections — click to view enabled ones'
    : 'Showing enabled sections — click to view hidden ones';
}
updateHiddenToggleUI();

hiddenToggle.addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  updateHiddenToggleUI();
  closeQuickAdd();
  state.sectionMenu = { section: null, mode: 'closed' };
  renderCurrentView();
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

// Mobile: a deliberate horizontal swipe does the same thing space-bar
// does on desktop. Requires mostly-horizontal movement (so it can't be
// confused with the section list's normal vertical scroll) past a
// minimum distance and within a short time (so it reads as a swipe, not
// a drag-scroll that happened to drift sideways a little).
let quickAddSwipeStartX = 0;
let quickAddSwipeStartY = 0;
let quickAddSwipeStartTime = 0;
document.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) return;
  quickAddSwipeStartX = event.touches[0].clientX;
  quickAddSwipeStartY = event.touches[0].clientY;
  quickAddSwipeStartTime = Date.now();
}, { passive: true });
document.addEventListener('touchend', (event) => {
  if (state.quickAdd.open || state.noteEditorOpen || !state.isAdmin) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  const dx = touch.clientX - quickAddSwipeStartX;
  const dy = touch.clientY - quickAddSwipeStartY;
  const elapsed = Date.now() - quickAddSwipeStartTime;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || elapsed > 600) return;
  const section = state.lastActiveSection || getTopLevelSectionNames()[0];
  if (!section) return;
  openQuickAdd(section);
}, { passive: true });

// Touch: triple-tap on open space also opens quick-add — the same gesture adds
// an element in Notes (laptops use the space bar for both). Word cards are
// skipped because their own double-tap already edits the card, as are links,
// buttons and inputs.
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
  if (!down || event.pointerType === 'mouse' || state.quickAdd.open || state.noteEditorOpen || !state.isAdmin) return;
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
  quickAddTapTimer = setTimeout(() => { quickAddTaps = 0; }, QUICK_ADD_TAP_MS);
});
