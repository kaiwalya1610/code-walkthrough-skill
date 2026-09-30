#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["Pygments>=2.18,<3", "jsonschema>=4.23,<5"]
# ///
"""Validate an authored walkthrough, resolve real sources, and emit offline HTML."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import html
import json
from pathlib import Path
import re
import subprocess

from jsonschema import Draft202012Validator
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_for_filename
from pygments.lexers.special import TextLexer
from pygments.util import ClassNotFound

ASSETS = Path(__file__).resolve().parents[1] / "assets"
# "friendly" token rules stay active in dark mode; these are the only light properties github-dark leaves in place.
LIGHT_ONLY_RESET = "\nSCOPE .cs { background-color: transparent }\nSCOPE .err { border: 0 }"


def inside(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"Expected an existing file inside {root}: {name}")
    return path


def pointer(value, path, context="state"):
    if path == "":
        return value
    if not path.startswith("/"):
        raise ValueError(f"JSON pointer must start with '/': {path}")
    for raw in path[1:].split("/"):
        if re.search(r"~(?![01])", raw):
            raise ValueError(f"Invalid JSON pointer escape: {path}")
        key = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", key):
                raise ValueError(f"{context}: invalid JSON pointer array index: {path}")
            if int(key) >= len(value):
                raise ValueError(f"{context}: missing JSON pointer {path!r} at index {key}")
            value = value[int(key)]
        elif isinstance(value, dict) and key in value:
            value = value[key]
        else:
            raise ValueError(f"{context}: missing JSON pointer {path!r} at component {key!r}")
    return value


def unique(values, context):
    duplicates = [value for value, count in Counter(values).items() if count > 1]
    if duplicates:
        raise ValueError(f"Duplicate IDs in {context}: {duplicates}")


def load_records(path):
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    unique([r["id"] for r in records], str(path))
    return {r["id"]: r for r in records}


def prepare(spec, repo, directory):
    """The manifest and checkpoint files are public input boundaries; validate here."""
    schema = json.loads((ASSETS / "walkthrough.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(spec)
    unique([s["id"] for s in spec["scenarios"]], "scenarios")
    nodes = spec["graph"]["nodes"]
    unique([n["id"] for n in nodes], "graph nodes")
    node_ids = {n["id"] for n in nodes}
    for edge in spec["graph"]["edges"]:
        if edge["from"] not in node_ids or edge["to"] not in node_ids:
            raise ValueError(f"Unknown graph node: {edge}")
    unique([c["path"] for c in spec["analysis"]["coverage"]], "coverage")
    source_cache, record_cache = {}, {}
    for scenario in spec["scenarios"]:
        unique([s["id"] for s in scenario["steps"]], scenario["id"])
        seen = set()
        for step in scenario["steps"]:
            if step["node"] not in node_ids or any(c not in seen for c in step["causes"]):
                raise ValueError(f"Unknown node or nonpreceding causal event: {step['id']}")
            seen.add(step["id"])
            evidence = step["evidence"]
            record = None
            if "record" in evidence:
                path = inside(directory, evidence["record"]["path"])
                if path not in record_cache:
                    record_cache[path] = load_records(path)
                record_id = evidence["record"]["id"]
                if record_id not in record_cache[path]:
                    raise ValueError(f"{step['id']}: checkpoint {record_id!r} missing in {path.name}")
                record = record_cache[path][record_id]
                if not isinstance(record["state"], dict):
                    raise ValueError(f"Checkpoint state must be an object: {step['id']}")
                step["state"] = record["state"]
            for source in step["sources"]:
                name = source["path"]
                if name not in source_cache:
                    path = inside(repo, name)
                    if path.stat().st_size > 2_000_000:
                        raise ValueError(f"Source exceeds 2 MB; select a smaller original file: {name}")
                    raw = path.read_bytes()
                    code = raw.decode("utf-8")
                    try:
                        lexer = get_lexer_for_filename(path.name, code, stripnl=False, ensurenl=False)
                    except ClassNotFound:
                        # An unknown language remains readable, with an explicit fallback label.
                        lexer = TextLexer(stripnl=False, ensurenl=False)
                    rendered = highlight(code, lexer, HtmlFormatter(nowrap=True)).splitlines()
                    source_cache[name] = {"sha256": sha256(raw).hexdigest(), "code": code.splitlines(),
                                          "html": rendered, "language": lexer.name}
                file = source_cache[name]
                start, end = source["start"], source["end"]
                if not (1 <= start <= end <= len(file["code"])):
                    raise ValueError(f"Source range outside {name}: {start}–{end}")
                if end - start > 199:
                    raise ValueError(f"Split long snippet into smaller steps: {name}:{start}–{end}")
                if any(not start <= line <= end for line in source["focus"]):
                    raise ValueError(f"Focused line outside displayed snippet: {step['id']}")
                expected = source.get("sha256")
                if expected and expected != file["sha256"]:
                    raise ValueError(f"Source changed since authoring: {name}")
                if record is not None and record["sources"].get(name) != file["sha256"]:
                    raise ValueError(f"Source differs from checkpoint (or hash missing): {name}")
                source["sha256"] = file["sha256"]
                source["language"] = file["language"]
                source["lines"] = [{"number": i + 1, "text": file["code"][i], "html": file["html"][i]}
                                   for i in range(start - 1, end)]
            for visual in step["visuals"]:
                value = pointer(step["state"], visual["path"], step["id"])
                kind = visual["type"]
                if kind in {"records", "table", "queue"} and not isinstance(value, list):
                    raise ValueError(f"{kind} requires an array: {step['id']} {visual['path']}")
                if kind in {"records", "table"} and any(not isinstance(v, dict) for v in value):
                    raise ValueError(f"{kind} requires objects: {step['id']} {visual['path']}")
                if kind == "table" and not visual.get("columns"):
                    raise ValueError(f"Table requires explicit columns: {step['id']}")
                if kind == "table" and any(c not in row for row in value for c in visual["columns"]):
                    raise ValueError(f"Table column absent in data: {step['id']}")
                if kind == "metrics" and not isinstance(value, dict):
                    raise ValueError(f"Metrics require a label/value object: {step['id']}")
                if kind == "metrics" and any(isinstance(v, (dict, list)) for v in value.values()):
                    raise ValueError(f"Metrics require scalar values: {step['id']}")
                if kind == "text" and isinstance(value, (dict, list)):
                    raise ValueError(f"Use tree or records for structured values: {step['id']}")
                if kind == "bars" and (not isinstance(value, dict) or any(
                        isinstance(v, bool) or not isinstance(v, (int, float)) for v in value.values())):
                    raise ValueError(f"Bars require a label/number object: {step['id']} {visual['path']}")
            for watch in step.get("watch", []):
                pointer(step["state"], watch["path"], step["id"])
                if "line" in watch:
                    file = watch.get("file", step["sources"][0]["path"])
                    if not any(s["path"] == file and s["start"] <= watch["line"] <= s["end"] for s in step["sources"]):
                        raise ValueError(f"Watch line outside displayed source {file}: {step['id']}")
            if "decision" in step:
                result = pointer(step["state"], step["decision"]["resultPath"], step["id"])
                if not isinstance(result, bool):
                    raise ValueError(f"Decision result must be a captured boolean: {step['id']}")
    revision = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True)
    status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"], capture_output=True, text=True)
    spec["build"] = {"created": datetime.now(timezone.utc).isoformat(),
                     "commit": revision.stdout.strip() if revision.returncode == 0 else "unversioned",
                     "workingTree": "modified" if status.stdout else "clean" if status.returncode == 0 else "unknown",
                     "sourceCount": len(source_cache), "checkpointFiles": len(record_cache),
                     "coverageCounts": dict(Counter(c["status"] for c in spec["analysis"]["coverage"]))}
    return spec


def build(spec_path, repo, output):
    spec_path, repo = spec_path.resolve(), repo.resolve()
    spec = prepare(json.loads(spec_path.read_text(encoding="utf-8")), repo, spec_path.parent)
    serialized = json.dumps(spec, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c")
    document = (ASSETS / "dashboard.html").read_text(encoding="utf-8")
    document = document.replace("__TITLE__", html.escape(spec["title"]))
    document = document.replace("__STYLE__", (ASSETS / "dashboard.css").read_text(encoding="utf-8"))
    # Token colours only; the page's theme variables own backgrounds. Dark is screen-only so print stays light.
    rules = lambda style, scope: "\n".join(HtmlFormatter(style=style).get_token_style_defs(scope))
    dark = lambda scope: rules("github-dark", scope) + LIGHT_ONLY_RESET.replace("SCOPE", scope)
    tokens = (f"{rules('friendly', '.code-lines')}\n@media screen{{\n{dark(':root[data-theme=dark] .code-lines')}\n}}\n"
              f"@media screen and (prefers-color-scheme:dark){{\n{dark(':root:not([data-theme=light]) .code-lines')}\n}}")
    document = document.replace("__TOKENS__", tokens)
    document = document.replace("__SCRIPT__", (ASSETS / "dashboard.js").read_text(encoding="utf-8"))
    document = document.replace("__DATA__", serialized)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
    steps = sum(len(s["steps"]) for s in spec["scenarios"])
    print(f"Built {output}: {len(spec['scenarios'])} scenarios, {steps} steps, "
          f"{spec['build']['sourceCount']} verified source files")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build(args.spec, args.repo, args.out)
