# Architecture

`language-studio.html` is a static, single-page Japanese vocabulary app with
no build step, deployed as-is to GitHub Pages. Its logic lives in `js/`, as
native ES modules loaded via one `<script type="module" src="./js/main.js">`
tag — the browser resolves `import`/`export` directly, so there's nothing to
bundle or compile. Every other module is reached through `main.js`'s import
graph.

## How to use this file

**Before changing behavior, find the relevant row in the table below and
edit that file.** Most features map to exactly one file. A few span two
(e.g. quiz behavior is quiz.js, but the "Quiz" button in a section's menu
is wired in sections.js) — those are called out explicitly.

## Feature → file map

| If you're changing...                                                    | Edit this file            |
|----------------------------------------------------------------------------|----------------------------|
| Firebase project config, the `database`/`auth`/`wordsRef` handles           | `js/firebase-init.js`      |
| Any piece of shared app/session state (what fields exist on `state`)       | `js/state.js`              |
| Which HTML element id a DOM reference points at                            | `js/dom.js`                |
| Generic text helpers: normalize, init-cap, HTML-escape, shuffle            | `js/utils.js`               |
| An inline SVG icon (eye / eye-slash / trash)                               | `js/icons.js`               |
| Machine translation, romaji↔kana conversion, kana→romaji transliteration   | `js/translate.js`          |
| Voice selection or the actual `speechSynthesis` call                       | `js/speech.js`              |
| Section/subsection naming, sort order, hidden/starred flags, Firebase sync  | `js/sections.js`            |
| The section list UI: headers, counts, the search box, Add/hide buttons     | `js/sections.js`            |
| The kebab (⋮) menu: star, quiz, read, merge, delete                        | `js/sections.js`            |
| The "Unsectioned" client-side grouping when a subsection is expanded       | `js/sections.js`            |
| How a word card looks, or its double-click/hold/drag gesture behavior      | `js/dictionary-cards.js`   |
| Inline card edit mode (the 3-field Enter-to-advance form)                  | `js/dictionary-cards.js`   |
| Deleting a single word, or moving one to another section                   | `js/dictionary-cards.js`   |
| The quick-add popup: layout, romaji/meaning toggle, IME live-conversion    | `js/quick-add.js`          |
| Stage-to-stage navigation (Enter/back) inside quick-add                    | `js/quick-add.js`          |
| Creating a subsection by typing `> NAME` in quick-add                      | `js/quick-add.js`          |
| Duplicate-word handling when adding (offer to move vs. abort)              | `js/quick-add.js`          |
| Quiz modal, round logic, WarOnWrong retry behavior                         | `js/quiz.js`                |
| Which sections a quiz run covers, and in what order                        | `js/quiz.js`                |
| Reading modal, one spoken pass through a section's words                   | `js/reading.js`             |
| Which sections a reading run covers, and in what order                     | `js/reading.js`             |
| The hiragana/katakana practice iframe modal                                | `js/script-practice.js`    |
| Auth/admin bootstrap, or any event listener not owned by one feature above | `js/main.js`                |
| Space-bar / swipe shortcuts that open quick-add                            | `js/main.js`                |
| The global hidden/visible eye toggle, theme toggle, logout                 | `js/main.js`                |
| Page markup, CSS, Tailwind config, the theme-flash-prevention script       | `language-studio.html`     |

## Module map

```
main.js  (bootstrap + global event wiring — the only file the HTML loads)
├── state.js            (shared mutable app state, no dependencies)
├── firebase-init.js    (Firebase handles, no dependencies)
├── icons.js             (SVG path strings, no dependencies)
├── dom.js                (cached element refs, no dependencies)
├── sections.js  ───────┐  (section data model + rendering + kebab menu)
│   ├── state.js        │
│   ├── firebase-init.js│
│   ├── utils.js         │
│   ├── icons.js         │
│   ├── dom.js            │
│   ├── dictionary-cards.js ◄─┘  (circular — see note below)
│   ├── quick-add.js     (for the "+" button and teardown)
│   ├── quiz.js           (for the section menu's Quiz action)
│   └── reading.js        (for the section menu's Read action)
├── dictionary-cards.js  (card rendering, edit mode, gestures, drag-to-move)
│   ├── state.js
│   ├── firebase-init.js
│   ├── utils.js
│   └── sections.js  ◄── circular (see note below)
├── quick-add.js  (the compact add-word modal)
│   ├── state.js, firebase-init.js, utils.js, dom.js
│   ├── translate.js
│   └── sections.js
├── quiz.js
│   ├── state.js, dom.js
│   └── sections.js
├── reading.js
│   ├── state.js, dom.js, utils.js
│   ├── speech.js
│   └── sections.js
├── speech.js
│   └── translate.js
├── translate.js         (pure text transforms + Google Translate calls)
└── script-practice.js
    └── dom.js
```

**Circular import (by design):** `sections.js` and `dictionary-cards.js`
import from each other — `sections.js` needs `buildDictionaryCard` to render
word lists, and `dictionary-cards.js` needs section helpers (`isSubsection`,
`getSubsectionsOf`, `renderCurrentView`, `bumpSectionCount`) for its
drag-to-move feature. This is safe in ES modules because neither file calls
an imported function at module-evaluation time — only from inside functions
invoked later, once both modules have fully loaded. Splitting these two
further (e.g. into a third shared file) would remove the cycle but scatter
tightly-coupled rendering logic across more files for no real benefit — the
current split was chosen deliberately.

## Conventions

- Every module exports its full public function set (not just what's used
  elsewhere today) — cross-module wiring stays simple, and a function
  currently private can be reused later without an export-visibility change.
- `state` (from `state.js`) is the one shared mutable global the app allows
  itself. Everything else takes explicit arguments and returns values —
  no other module-level mutable state, except a few purely-local booleans
  that track one function's own internal bookkeeping (e.g. `quickAddImeBound`
  in `quick-add.js`, `cachedVoicesByLang` in `speech.js`).
- No build step: this must keep working when opened as plain files served
  by any static host (GitHub Pages). Don't introduce bundler-only syntax
  (e.g. bare-specifier imports without a path, JSON imports, etc).
