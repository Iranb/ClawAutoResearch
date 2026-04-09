# Legacy Overview

This file is now a compatibility overview only.

The canonical overview has moved to the new `VitePress` docs portal under `docs/`:

- [Docs Portal Home](../docs/index.md)
- [Architecture Overview](../docs/architecture/index.md)
- [Workflow Control Plane](../docs/architecture/workflow-control-plane.md)
- [Graph & Memory](../docs/architecture/graph-memory.md)

Use `DOC/` only when you need an old link target or a historical snapshot.

For paper ingestion, the workflow stays markdown-first:
`hugging-face-paper-pages` -> `arxiv2md-api` -> `arxiv2md` -> PDF fallback only.
