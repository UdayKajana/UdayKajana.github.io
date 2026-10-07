// Every cached DOM element reference the app uses, looked up once here and
// imported wherever needed. Keeping them in one place makes it obvious which
// ids the HTML must not rename without a matching update here.
//
// Safe to run at module top level: ES modules are deferred by default (like
// a script with the `defer` attribute), so the DOM is already parsed by the
// time this file executes, regardless of where main.js is loaded from.

export const dictionaryList = document.getElementById('dictionary-list');
export const dictionaryCount = document.getElementById('dictionary-count');

export const readingButton = document.getElementById('reading-button');
export const readingModal = document.getElementById('reading-modal');
export const readingClose = document.getElementById('reading-close');
export const readingWord = document.getElementById('reading-word');
export const readingPronunciation = document.getElementById('reading-pronunciation');
export const readingMeaning = document.getElementById('reading-meaning');

export const scriptPracticeModal = document.getElementById('script-practice-modal');
export const scriptPracticeFrame = document.getElementById('script-practice-frame');
export const scriptPracticeTitle = document.getElementById('script-practice-title');
export const scriptPracticeClose = document.getElementById('script-practice-close');

export const themeToggle = document.getElementById('theme-toggle');
export const logoutButton = document.getElementById('logout-button');

export const sectionFilterInput = document.getElementById('section-filter-input');

export const quickAddModal = document.getElementById('quick-add-modal');
export const quickAddClose = document.getElementById('quick-add-close');
export const quickAddModeToggle = document.getElementById('quick-add-mode-toggle');
export const quickAddInput = document.getElementById('quick-add-input');
export const quickAddContext = document.getElementById('quick-add-context');
export const quickAddBackBtn = document.getElementById('quick-add-back-btn');
export const quickAddPanel = document.getElementById('quick-add-panel');
export const quickAddPreviewRows = document.getElementById('quick-add-preview-rows');
export const quickAddClearBtn = document.getElementById('quick-add-clear-btn');
