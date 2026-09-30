#!/usr/bin/env python3
"""Inventory paths across a repository without reading source, credentials or datasets."""
import argparse
from collections import Counter
from pathlib import Path
import subprocess
import json


def inventory(root):
    git = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True)
    if git.returncode == 0:
        base = Path(git.stdout.strip())
        result = subprocess.run(["git", "-C", str(base), "ls-files", "-z", "--cached",
                                 "--others", "--exclude-standard"], check=True, capture_output=True)
        paths = sorted({Path(p.decode()) for p in result.stdout.split(b"\0") if p})
        paths = [base / p for p in paths if (base / p).is_relative_to(root)]
        method = "git tracked + non-ignored untracked paths"
    else:
        result = subprocess.run(["rg", "--files", "--hidden", "-0", "-g", "!.git", str(root)],
                                capture_output=True)
        if result.returncode not in (0, 1):
            result.check_returncode()
        paths = sorted(Path(p.decode()) for p in result.stdout.split(b"\0") if p)
        method = "rg paths respecting ignore files"
    files = []
    for path in paths:
        relative = path.relative_to(root).as_posix()
        parts = Path(relative).parts
        reason = ""
        if path.is_symlink():
            reason = "symlink; inspect target deliberately"
        elif not path.is_file():
            reason = "missing or non-file"
        elif any(p in {"node_modules", ".venv", "venv", "__pycache__", "vendor", "dist", "build"}
                 for p in parts):
            reason = "dependencies or generated output"
        elif path.name.startswith(".env") or path.suffix in {".pem", ".key", ".p12"}:
            reason = "potential secret; path only"
        size = path.stat().st_size if path.is_file() and not path.is_symlink() else None
        files.append({"path": relative, "bytes": size, "extension": path.suffix,
                      "status": "excluded" if reason else "unread", "reason": reason})
    return {"root": str(root), "method": method,
            "limitations": "Path inventory only. Ignored files are absent; no contents were analyzed.",
            "count": len(files),
            "by_directory": dict(Counter(f["path"].split("/")[0] for f in files)),
            "by_extension": dict(Counter(f["extension"] or "(none)" for f in files)), "files": files}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    data = inventory(args.repo.resolve())
    args.out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Inventoried {data['count']} paths → {args.out}")
