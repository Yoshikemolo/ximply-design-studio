"""Enumerate authored files without walking installed dependencies or build outputs."""
from pathlib import Path
import os

IGNORED = {'.git', 'node_modules', '.venv', '__pycache__', '.angular', '.pytest_cache',
           'reports', 'dist', 'build', 'coverage', 'data'}


def source_files(root: Path, suffix: str):
    for directory, children, filenames in os.walk(root):
        children[:] = [name for name in children if name not in IGNORED]
        for name in filenames:
            path = Path(directory)/name
            if path.suffix == suffix:
                yield path
