---
name: citation-preflight
description: "Preflight bibliography and citation integrity before final write/review passes. Use Zotero bot/<project-id> collections, citation-management, and venue-templates to reconcile refs.bib and citation candidates."
argument-hint: "[optional paper scope]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Citation Preflight

Prepare the project bibliography for final writing and review.

## Inputs

- Zotero `bot/<project-id>` project collections
- `citation-management`
- `venue-templates`
- `academic_writer/paper/refs.bib`
- citation candidates and verification packets

## Goals

- reconcile the Zotero-backed shortlist with the current writing scope
- remove unresolved placeholders before review
- keep venue-specific constraints aligned with `venue-templates`
- hand a clean bibliography packet back to `citation-management`

## Notes

- mention the Zotero project or bot collection explicitly in the packet
- do not fabricate metadata
- if uncertainty remains, leave a conservative note for Reviewer instead of guessing
