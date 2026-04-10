# Experiment Index — [Project Title]

> Maintained by Coder. Update whenever a new experiment bundle is created, renamed, launched, or retired.

**Project**: [project-id]
**Folder contract version**: 2
**Last updated**: YYYY-MM-DD HH:MM

| Experiment ID | Track ID | Folder | Question | Search Spec | Search State | Incumbent Branch | Results | Remote Run | Status |
|---|---|---|---|---|---|---|---|---|---|

## Notes

- One row per experiment bundle.
- `Folder` should be the canonical local path under `coder/`.
- `Search Spec` should point to the approved search-envelope contract when the bundle participates in a coder search loop.
- `Search State` should point to the bundle-local runtime search memory.
- `Incumbent Branch` should name the git branch whose history stores only promoted changes.
- `Results` should point to the main output directory or metrics artifact.
- `Remote Run` should point to `REMOTE_RUN.json` when launched.
- If the experiment is retired, keep the row and mark `Status = retired` rather than deleting history.
