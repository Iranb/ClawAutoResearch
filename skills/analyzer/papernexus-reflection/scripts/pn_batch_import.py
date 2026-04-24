#!/usr/bin/env python3
from pathlib import Path
import runpy
import sys


def _resolve_papernexus_script(script_name: str) -> Path:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "papernexus" / "scripts" / script_name,
        here.parents[3] / "researcher" / "papernexus" / "scripts" / script_name if len(here.parents) > 3 else None,
        here.parents[3].parent / "workspace-researcher" / "skills" / "papernexus" / "scripts" / script_name if len(here.parents) > 3 else None,
    ]
    for candidate in candidates:
        if candidate and candidate.exists() and candidate.resolve() != here:
            return candidate
    raise FileNotFoundError(f"Could not locate PaperNexus script: {script_name}")


TARGET = _resolve_papernexus_script("pn_batch_import.py")
sys.path.insert(0, str(TARGET.parent))
runpy.run_path(str(TARGET), run_name="__main__")
