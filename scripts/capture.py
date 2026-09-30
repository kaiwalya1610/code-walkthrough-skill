"""Explicit, JSON-only checkpoints. Use a separate output file per worker/process."""
from hashlib import sha256
from pathlib import Path
import json


def record(path, event_id, state, *, repo, sources):
    """Append selected synthetic state and hashes of the source it illustrates.

    Call at a known before/after boundary in a harness or existing debug hook.
    No locals(), repr fallback, monkey-patching, application calls, or implicit redaction.
    """
    root = Path(repo).resolve()
    hashes = {}
    for name in sources:
        source = (root / name).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError(f"Source must be a file inside repo: {name}")
        hashes[source.relative_to(root).as_posix()] = sha256(source.read_bytes()).hexdigest()
    row = {"id": event_id, "state": state, "sources": hashes}
    serialized = json.dumps(row, ensure_ascii=False, allow_nan=False)
    with Path(path).open("a", encoding="utf-8") as stream:
        stream.write(serialized + "\n")
