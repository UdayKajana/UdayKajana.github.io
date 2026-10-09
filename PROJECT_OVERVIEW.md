# Project Overview

## Purpose

Uday's Workbook is a static-hosted web app with a Notes workspace and a Japanese Language Studio. It uses Firebase Authentication and Realtime Database, browser-local IndexedDB caching/offline queues, and a service worker for the app shell. Google sign-ins are audited under `metadata/users` and `metadata/loginHistory` in Realtime Database. The main user journey is login → Notes host → Language Studio or Notes pages; script-practice activities run as a separate page.

## Entry Points

| Path | Responsibility |
|---|---|
| [`index.html`](index.html) | Login UI; Google/access-code authentication; remembers the login method/role and redirects to the requested app path (defaults to `application.html`). |
| [`application.html`](application.html) | Notes host and primary workspace: tree navigation, page editing, Notes trash, auth, Firebase tree index, Language Studio iframe, and cross-frame archive bridge. Most Notes behavior is inline in this file. |
| [`language-studio.html`](language-studio.html) | Language Studio UI shell. Loads [`js/main.js`](js/main.js), the single JS entrypoint for the modular Language Studio feature graph. |
| [`hiragana-karuta.html`](hiragana-karuta.html) | Standalone kana/kanji chart and flashcard/quiz experience, also embedded by script-practice modal. |

## Runtime And Local Development

- No package manifest or build/bundler configuration is present. Pages use browser ES modules, Firebase CDN scripts/modules, Quill, and Tailwind CDN.
- Serve the repository over HTTP (ES modules, Firebase auth redirects, and service workers do not work correctly from `file://`). Use [`dev-server.py`](dev-server.py) (`python3 dev-server.py 8000`); the workspace tasks run it on ports `8000` or `8001`. It is `http.server` plus `Cache-Control: no-cache`. Plain `python3 -m http.server` sends no cache header, so browsers can keep running stale copies of `js/*.js` modules after an edit.
- [`run.sh`](run.sh) starts `dev-server.py` on port 8000 but first kills existing processes on that port; prefer the workspace task or direct Python command when that side effect is undesirable.
- Firebase project settings are in [`firebase-config.js`](firebase-config.js); `index.html` also contains a Firebase config literal. Authentication and database security are enforced by Firebase, not by hiding client config.
- Google login auditing needs Realtime Database Rules that permit an authenticated user to read/write only their own `metadata/users/{uid}` and `metadata/loginHistory/{uid}/{eventId}` records. Rules are managed outside this repository; login is intentionally not blocked if an audit write is denied.
- There is no configured automated test runner. Use editor diagnostics, focused `node --check` for standalone JS modules, `git diff --check`, and browser checks of the touched workflow.

## Architecture At A Glance

```text
index.html (login)
  └─ application.html (Notes host + Firebase tree + iframe integration)
       └─ language-studio.html
            └─ js/main.js → sections / cards / quick-add / notes / reading / speech
       └─ hiragana-karuta.html (script-practice iframe)

Firebase Realtime Database ←→ firebase-init.js / application.html
IndexedDB device cache    ←→ js/device-cache.js
Service-worker shell cache ←→ service-worker.js
```

For exact file ownership, feature routing, data schemas, and cross-surface contracts, use [`ARCHITECTURE.md`](ARCHITECTURE.md). The root [`AGENTS.md`](AGENTS.md) makes updating the relevant blueprint a required completion step for every project-level code change.