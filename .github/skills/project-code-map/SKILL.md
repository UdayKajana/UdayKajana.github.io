---
name: project-code-map
description: "Use when making project-level changes in this repository: route a request to the owning file/module, trace related behavior and data contracts, and update the project blueprint before completion."
---

# Project Code Map Workflow

Use this skill for feature work, bug fixes, refactors, storage changes, or cross-page behavior in this repository.

## Required Reading

1. Read [PROJECT_OVERVIEW.md](../../../PROJECT_OVERVIEW.md) for entry points and runtime setup.
2. Read only the matching row(s) in [ARCHITECTURE.md](../../../ARCHITECTURE.md), especially **Task-To-Code Routing** and the relevant data/flow section.
3. Read root [AGENTS.md](../../../AGENTS.md). Its blueprint-update rule is a mandatory completion gate.

## Route Before Searching

- Map the user prompt to a feature row and name the likely owning file/symbol.
- Follow listed callers, dependencies, persistence paths, and iframe/message bridges only as far as needed to test the hypothesis.
- Search the rest of the repository only if the route is missing/stale, a symbol reference leads elsewhere, or focused validation shows another owner.
- For a storage change, trace all reads/writes, counters/indexes, caches, offline queues, restore paths, and expiry behavior that share the data.
- For a host/iframe change, inspect and preserve both sides of the contract.

## Mandatory Blueprint Completion Gate

After changing code and before final validation/final response, update the corresponding entry in `ARCHITECTURE.md` so it describes the implemented behavior, file/symbol ownership, and any changed contract. Update `PROJECT_OVERVIEW.md` when entry points, runtime requirements, or top-level user flows change. Add task-routing rows for new features.

**Do not finish or report a code task as complete until the applicable blueprint update has been made and checked against the source. This requirement is mandatory.** Mention the updated blueprint section in the final summary.

## Finish

- Run a focused test, syntax check, diagnostics, or `git diff --check` as appropriate; this repository has no configured package test runner.
- Review the diff for both source and docs, and state any runtime/Firebase validation that could not be performed.