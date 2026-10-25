# Agent instructions

## Feature specs (top priority)

Feature specs live in the docs repo, mounted here as the `specs/` submodule (run `git submodule update --init --remote specs` first).

1. New work starts only from a feature file in `specs/features/<track>/NNN-*.md` (tracks: voice-pipeline, backend-apis, flutter-app, store-listing). No feature file, no work.
2. Scan in ascending order; skip `Status: completed`; ignore `000-template.md`.
3. Build the first not-completed file whose `Depends on` are completed; set `Status: in-progress`.
4. When done, edit the same file: `Status: completed`, `Completed: YYYY-MM-DD, <commit link>`, and update the track README. The completed line always records the link to the implementing commit SHA (`https://github.com/india-audio-guide/<repo>/commit/<sha>`), never a PR link. Record it in a follow-up commit right after the implementing commit.
5. Never delete, renumber or reopen a completed file; changes are a new file referencing the old.


This repo (website): work the `store-listing` track (and any feature marked `Repo(s): website`).

Spec edits are committed in the docs repo, then the submodule pointer is bumped here.
