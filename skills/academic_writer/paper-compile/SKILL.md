---
name: paper-compile
description: "Compile LaTeX paper to PDF with latexmk. Auto-fix common errors."
argument-hint: ""
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
---

# Paper Compile

编译 LaTeX 论文为 PDF。

> **File ownership**: Write ONLY to `{PROJ}/academic_writer/paper/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Process

```bash
cd {PROJ}/academic_writer/paper && latexmk -pdf -interaction=nonstopmode main.tex 2>&1
```

## Auto-fix

常见错误自动修复：
- Missing package → `\usepackage{...}`
- Undefined reference → 重新编译（bibtex + 2x pdflatex）
- Missing figure → 检查路径，尝试相对/绝对路径

## Checks

- 页数检查（通常 8-10 页正文 for top venues）
- 字体检查（Type 1/TrueType only）
- 引用完整性（`\cite` vs `refs.bib`）

## Output

`{PROJ}/academic_writer/paper/main.pdf`
