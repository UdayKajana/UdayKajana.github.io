// Single shared mutable state object for the whole app. Every module that
// needs to read or write app-wide state imports `state` from here rather
// than passing it around — this is the one "global" this app allows itself,
// everything else is a plain function taking explicit arguments.
//
// If you're adding a new piece of UI/session state, it goes here.

export const state = {
  language: 'japanese',
  query: '',
  // open: is the quick-add modal up. section: which section it's scoped
  // to (set when opened, via a section's "+", the space-bar shortcut, or
  // a swipe). resolved: {word, pronunciation, englishMeaning}. stageIndex
  // (0/1/2) tracks which of the three resolved fields (in
  // quickAddMeaningMode's display order) is currently loaded into
  // quickAddInput as the user steps through them with Enter.
  // lastCheckedText is what the field held the last time the 2s poller
  // checked it, so it only reacts to genuine edits.
  quickAdd: { open: false, section: null, stageIndex: 0, resolved: null, lastCheckedText: null },
  // Persisted across sessions. false (default): the input is romaji,
  // phonetically converted to kana via wanakana — no network call. true:
  // the input is the English meaning, translated into real Japanese
  // (kanji-capable, since it's an actual translation, not a phonetic
  // conversion).
  quickAddMeaningMode: localStorage.getItem('quickAddMeaningMode') === '1',
  // The section a space-bar press or swipe gesture should target: the
  // one last hovered (desktop) or last expanded/added-to (either
  // platform) — never written to Firebase, purely a UI convenience.
  hoveredSection: null,
  lastActiveSection: null,
  // Non-null exactly while a word card is being dragged to move it:
  // {entry, card, ghost, hoverSection, hoverRow, hoverTimer}. Purely a
  // UI-session concern — never persisted, never written to Firebase.
  cardDrag: null,
  // Which section's kebab dropdown is open, and in what mode: 'closed',
  // the action list ('menu'), or the merge-target picker ('merge').
  sectionMenu: { section: null, mode: 'closed' },
  quizQueue: [],
  quizMissed: [],
  quizCurrent: null,
  quizTotal: 0,
  quizMode: 'idle',
  warOnWrongSet: null,
  quizSectionQueue: [],
  quizSectionIndex: -1,
  quizCurrentSection: null,
  quizRoundResolve: null,
  readingActive: false,
  readingTimeoutId: null,
  readingSectionQueue: [],
  readingSectionIndex: -1,
  // false = show enabled (non-hidden) sections, the default first-load view;
  // true = show only sections that have been explicitly hidden, so they can
  // be found/managed/un-hidden.
  showHidden: false,
  expandedSections: new Set(),
  // Parent-section names whose purely client-side "Unsectioned" grouping
  // (see buildUnsectionedGroup) is currently expanded — never synced to
  // Firebase, and only ever consulted while that grouping is on screen.
  expandedUnsectionedGroups: new Set(),
  // Section headers + live counts for the current language only — this is all
  // that's fetched on page load. Actual word entries are fetched lazily, one
  // section at a time, in sectionCache below.
  sectionSummary: {},
  sectionSummaryRef: null,
  // SECTION -> true for sections explicitly hidden from the default view.
  hiddenSections: {},
  hiddenSectionsRef: null,
  // SECTION -> true for a starred ("top 5") section — capped at
  // MAX_STARRED_SECTIONS, sorted ahead of everything else.
  starredSections: {},
  starredSectionsRef: null,
  sectionCache: new Map(),        // SECTION -> entries[]
  // SECTION -> that section's rich-text note HTML ('' = no note), fetched the
  // first time the section is opened (notes can be long, so not on page load).
  sectionNotes: new Map(),
  noteEditorOpen: false,          // the note editor modal is up (pauses page shortcuts)
  sectionListeners: new Map(),    // SECTION -> firebase ref, so we can .off() on language switch
  sectionHeaderDomRefs: new Map(), // SECTION -> its <details> element, rebuilt on every renderSectionHeaders()
  currentUser: null,
  isAdmin: false
};

// ISO code used by the translation API — this page is Japanese-only.
export const langCodeMap = {
  japanese: 'ja'
};
