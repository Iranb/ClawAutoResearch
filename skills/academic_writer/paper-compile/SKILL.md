---
name: paper-compile
description: "Compile a LaTeX paper to PDF with latexmk. Auto-fix common errors."
argument-hint: ""
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
---

# Paper Compile

Compile the LaTeX paper into a PDF.

> **File ownership**: Write ONLY to `{PROJ}/academic_writer/paper/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Process

```bash
cd {PROJ}/academic_writer/paper && latexmk -pdf -interaction=nonstopmode main.tex 2>&1
```

## Auto-fix

Common automatic fixes:

- Missing package → add `\usepackage{...}`
- Undefined reference → recompile (`bibtex` + `2x pdflatex`)
- Missing figure → check the path and try relative / absolute variants

## Checks

- Page count check (typically 8-10 pages of main content for top venues)
- Font check (Type 1 / TrueType only)
- Citation completeness (`\cite` vs `refs.bib`)

## Output

`{PROJ}/academic_writer/paper/main.pdf`
