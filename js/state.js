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
  // current field (ordered by the detected input source) is loaded into
  // quickAddInput as the user steps through them with Enter.
  // lastCheckedText is what the field held at the last live resolution.
  quickAdd: { open: false, section: null, inputMode: 'default', stageIndex: 0, resolved: null, lastCheckedText: null },
  // Persisted across sessions. true (default): translate English input into
  // Japanese. false: treat input as romaji and convert it to hiragana.
  quickAddMeaningMode: localStorage.getItem('quickAddMeaningMode') !== '0',
  // The section a space-bar press or swipe gesture should target: the
  // one last hovered (desktop) or last expanded/added-to (either
  // platform) — never written to Firebase, purely a UI convenience.
  hoveredSection: null,
  lastActiveSection: null,
  // Non-null exactly while a word card is being dragged to move it:
  // {entry, card, ghost, hoverSection, hoverRow, hoverTimer}. Purely a
  // UI-session concern — never persisted, never written to Firebase.
  cardDrag: null,
  // Which section heading has an inline editor open: mode 'closed', 'edge'
  // (triple-click color picker), or 'rename' (long-press operation mode, with
  // op 'rename' / 'move' and the typed draft / moveDraft).
  sectionMenu: { section: null, mode: 'closed' },
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
  discoveredSections: {},
  sectionSummaryRef: null,
  sectionSummaryLoaded: false,
  languageUpdateMarkerRef: null,
  languageUpdateMarker: null,
  languageDataSubscriptionsActive: false,
  // languages/japan/sectionIndex/<language>/sections (see sections.js): undefined until it has
  // loaded, null when there is none (the page then works from sectionSummary)
  sectionIndex: undefined,
  sectionIndexRef: null,
  // SECTION -> true for sections explicitly hidden from the default view.
  hiddenSections: {},
  hiddenSectionsRef: null,
  // SECTION -> edge color key ('red' | 'orange' | 'green' | 'purple');
  // absent = default 'blue'. The color is the section's sort priority.
  sectionEdges: {},
  sectionEdgesRef: null,
  // Legacy SECTION -> true "top 5" stars; read only so they sort as the top
  // edge color until a color is set (setSectionEdge clears them).
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
