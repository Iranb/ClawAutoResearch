---
name: paper2md
description: Convert PDF papers to Markdown using the Mineru service. Use when the user wants to convert a PDF to markdown or mentions paper2md.
---

# Paper to Markdown Conversion

This skill converts PDF papers to Markdown format using the Mineru service.

## Usage

To convert a PDF file to Markdown, run the python script located in this directory:

```bash
python paper2md.py <path_to_pdf>
```

### Options
- `-o`, `--output`: Output file or directory path (default: current dir, same stem as PDF).

## Dependencies

This script requires the `requests` library.

```bash
pip install -r requirements.txt
```

## Example

```bash
# Convert a paper and get markdown and Specify output directory
python paper2md.py /path/to/paper.pdf -o /path/to/output/dir
```
