# Repository Agent Instructions

## Mandatory project-map workflow

Before a project-level change, read [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md), then open only the relevant feature section in [ARCHITECTURE.md](ARCHITECTURE.md). Use its task-to-code map to choose the owning page, module, and cross-module contracts before searching source files.

**Do not consider a code task complete until the relevant architecture blueprint entry has been updated in the same work session and checked against the implementation. This is a mandatory completion gate, not optional documentation.** Update the affected file/symbol map, behavior flow, storage contract, or integration contract in `ARCHITECTURE.md` whenever implementation or behavior changes. Update `PROJECT_OVERVIEW.md` when an entry point, user-facing surface, major dependency, or project workflow changes. If the change introduces a new feature, add its routing entry so future work can find it directly.

Before the final response:

1. Verify the changed code and the corresponding blueprint describe the same behavior and paths.
2. Run the narrowest relevant checks available; this repository currently has no package manifest or configured test runner.
3. State which blueprint section was updated. If source behavior changed but no blueprint entry needed adjustment, update the relevant entry anyway to record the verified current contract.

## Change boundaries

- Prefer the smallest owning module identified by the blueprint; follow its existing patterns and public APIs.
- Preserve the separation between the Notes host (`application.html`) and Language Studio (`language-studio.html` plus `js/`). Document any change to their iframe, `postMessage`, Firebase, or cache contracts.
- Treat Firebase Realtime Database paths and offline queue operations as shared contracts. Trace writers, readers, restore paths, and cache/index effects before changing a schema.
- Do not put credentials, access codes, or user data into docs. The client Firebase configuration is configuration, not authorization; security rules must enforce access.
- Do not scan every file by default. Expand exploration only when the blueprint, symbol references, or a failing check show the owning path is incomplete.
