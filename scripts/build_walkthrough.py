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
import sys

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


def source_loader(repo, cache):
    def load(name):
        if name not in cache:
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
            cache[name] = {"sha256": sha256(raw).hexdigest(), "code": code.splitlines(),
                           "html": rendered, "language": lexer.name, "lexer": lexer}
        return cache[name]
    return load


def resolve_lines(source, file, context):
    """Attach real, highlighted lines for a source reference after checking its range and hash."""
    name, start, end = source["path"], source["start"], source["end"]
    if not (1 <= start <= end <= len(file["code"])):
        raise ValueError(f"Source range outside {name}: {start}–{end}")
    if end - start > 199:
        raise ValueError(f"Split long snippet into smaller steps: {name}:{start}–{end}")
    if any(not start <= line <= end for line in source.get("focus", [])):
        raise ValueError(f"Focused line outside displayed snippet: {context}")
    expected = source.get("sha256")
    if expected and expected != file["sha256"]:
        raise ValueError(f"Source changed since authoring: {name}")
    source["sha256"] = file["sha256"]
    source["language"] = file["language"]
    source["lines"] = [{"number": i + 1, "text": file["code"][i], "html": file["html"][i]}
                       for i in range(start - 1, end)]


def displayed(step, file, line):
    file = file or step["sources"][0]["path"]
    return any(s["path"] == file and s["start"] <= line <= s["end"] for s in step["sources"])


def scalar_text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def prepare_quiz(spec, load, steps_by_scenario):
    """Every question must point at real steps; checkpoint-bound blanks take their answer from captured state."""
    quiz = spec["quiz"]
    unique([q["id"] for q in quiz["questions"]], "quiz questions")
    chapters = {s["chapter"] for steps in steps_by_scenario.values() for s in steps.values()}
    def step_of(ref, context):
        steps = steps_by_scenario.get(ref["scenario"])
        if steps is None or ref["step"] not in steps:
            raise ValueError(f"{context}: unknown quiz reference {ref['scenario']}/{ref['step']}")
        return steps[ref["step"]]
    for q in quiz["questions"]:
        qid, kind = q["id"], q["type"]
        for ref in q["refs"]:
            step_of(ref, qid)
        if q.get("chapter") and q["chapter"] not in chapters:
            raise ValueError(f"{qid}: quiz chapter is not a step chapter: {q['chapter']}")
        if kind != "mcq" and ("choices" in q or "answer" in q):
            raise ValueError(f"{qid}: choices/answer only apply to mcq")
        if kind != "order" and "items" in q:
            raise ValueError(f"{qid}: items only apply to order questions")
        if kind in {"mcq", "order"} and "blanks" in q:
            raise ValueError(f"{qid}: blanks only apply to fill and code-fill")
        if kind == "mcq":
            answers = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
            unique(q["choices"], f"{qid} choices")
            unique(answers, f"{qid} answers")
            if any(a >= len(q["choices"]) for a in answers):
                raise ValueError(f"{qid}: answer index outside choices")
        if kind == "order":
            unique(q["items"], f"{qid} items")
        if "source" in q:
            resolve_lines(q["source"], load(q["source"]["path"]), qid)
        if kind == "fill":
            markers = len(re.findall(r"_{3,}", q["prompt"]))
            if markers != len(q["blanks"]):
                raise ValueError(f"{qid}: prompt has {markers} ___ markers for {len(q['blanks'])} blanks")
            for blank in q["blanks"]:
                if "line" in blank or "text" in blank:
                    raise ValueError(f"{qid}: line/text only apply to code-fill blanks")
                answers = list(blank.get("answers", []))
                if "from" in blank:
                    origin = blank.pop("from")
                    value = pointer(step_of(origin, qid)["state"], origin["path"], qid)
                    if isinstance(value, (dict, list)):
                        raise ValueError(f"{qid}: a blank must bind to a scalar checkpoint value")
                    blank["verified"] = f"{origin['scenario']}/{origin['step']}{origin['path']}"
                    answers.insert(0, scalar_text(value))
                if not answers:
                    raise ValueError(f"{qid}: each fill blank needs answers or from")
                blank["answers"] = list(dict.fromkeys(answers))
        if kind == "code-fill":
            source = q["source"]
            file = load(source["path"])
            by_line = {}
            for index, blank in enumerate(q["blanks"]):
                if "line" not in blank or "text" not in blank or "from" in blank:
                    raise ValueError(f"{qid}: code-fill blanks need line and text (and no from)")
                if not source["start"] <= blank["line"] <= source["end"]:
                    raise ValueError(f"{qid}: blank line outside displayed snippet")
                if not blank["text"].strip():
                    raise ValueError(f"{qid}: blank text must contain code")
                by_line.setdefault(blank["line"], []).append(index)
                blank["answers"] = list(dict.fromkeys([blank["text"], *blank.get("answers", [])]))
                blank.setdefault("caseSensitive", True)
            # Hidden text is cut out of the real line; neighbouring fragments are highlighted separately.
            for line in source["lines"]:
                if line["number"] not in by_line:
                    continue
                code, cursor, segments = line["text"], 0, []
                for index in by_line[line["number"]]:
                    hidden = q["blanks"][index]["text"]
                    found = code.find(hidden, cursor)
                    if found < 0:
                        raise ValueError(f"{qid}: blank text {hidden!r} not found (in order) on line {line['number']}")
                    segments += [{"html": fragment(code[cursor:found], file["lexer"])}, {"blank": index}]
                    cursor = found + len(hidden)
                segments.append({"html": fragment(code[cursor:], file["lexer"])})
                line["segments"] = segments
                del line["html"], line["text"]
            for blank in q["blanks"]:
                del blank["text"]


def fragment(code, lexer):
    return highlight(code, lexer, HtmlFormatter(nowrap=True)).rstrip("\n") if code else ""


def lint(spec):
    """Depth and quiz-quality warnings; --strict turns them into errors."""
    warnings = []
    steps = [s for scenario in spec["scenarios"] for s in scenario["steps"]]
    bare = [s["id"] for s in steps if not s.get("lineNotes")]
    if bare:
        warnings.append(f"{len(bare)} of {len(steps)} steps have no lineNotes (line-by-line explanation): {bare[:6]}")
    crowded = [s["id"] for s in steps if len(s["visuals"]) > 3]
    if crowded:
        warnings.append(f"Steps with more than 3 visuals; show each fact once: {crowded[:6]}")
    chapters = list(dict.fromkeys(s["chapter"] for s in steps))
    quiet = [c for c in chapters if not any(s.get("insights") for s in steps if s["chapter"] == c)]
    if quiet:
        warnings.append(f"Chapters without any insight: {quiet}")
    quiz = spec.get("quiz")
    if not quiz:
        warnings.append("No quiz authored; add one so readers can check their understanding")
        return warnings
    questions = quiz["questions"]
    if len(questions) < 6:
        warnings.append(f"Quiz has {len(questions)} questions; aim for 6-15")
    types = {q["type"] for q in questions}
    for wanted, label in [({"mcq"}, "multiple-choice"), ({"fill", "code-fill"}, "fill-in-the-blank"), ({"order"}, "ordering")]:
        if not types & wanted:
            warnings.append(f"Quiz has no {label} question")
    if not any(q["level"] == "trace" for q in questions):
        warnings.append("Quiz has no trace question (predicting a captured value)")
    by_step = {(sc["id"], s["id"]): s["chapter"] for sc in spec["scenarios"] for s in sc["steps"]}
    tested = {q.get("chapter") for q in questions} | {by_step[(r["scenario"], r["step"])] for q in questions for r in q["refs"]}
    untested = [c for c in chapters if c not in tested]
    if untested:
        warnings.append(f"Chapters not covered by any quiz question: {untested}")
    return warnings


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
    load = source_loader(repo, source_cache)
    step_chapters = {s["chapter"] for scenario in spec["scenarios"] for s in scenario["steps"]}
    unique([c["title"] for c in spec.get("chapters", [])], "chapters")
    for chapter in spec.get("chapters", []):
        if chapter["title"] not in step_chapters:
            raise ValueError(f"Chapter metadata names no step chapter: {chapter['title']}")
    unique([c["term"].lower() for c in spec.get("concepts", [])], "concepts")
    steps_by_scenario = {}
    for scenario in spec["scenarios"]:
        unique([s["id"] for s in scenario["steps"]], scenario["id"])
        steps_by_scenario[scenario["id"]] = {s["id"]: s for s in scenario["steps"]}
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
                file = load(name)
                resolve_lines(source, file, step["id"])
                if record is not None and record["sources"].get(name) != file["sha256"]:
                    raise ValueError(f"Source differs from checkpoint (or hash missing): {name}")
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
                if kind == "board":
                    if not isinstance(value, dict) or not visual.get("groups"):
                        raise ValueError(f"Board requires an object path and groups: {step['id']} {visual['path']}")
                    for group in visual["groups"]:
                        if not isinstance(pointer(value, group["path"], step["id"]), list):
                            raise ValueError(f"Board group must be an array: {step['id']} {group['path']}")
                elif visual.get("groups"):
                    raise ValueError(f"groups only apply to board visuals: {step['id']}")
                if kind == "bars" and (not isinstance(value, dict) or any(
                        isinstance(v, bool) or not isinstance(v, (int, float)) for v in value.values())):
                    raise ValueError(f"Bars require a label/number object: {step['id']} {visual['path']}")
            for watch in step.get("watch", []):
                pointer(step["state"], watch["path"], step["id"])
                if "line" in watch and not displayed(step, watch.get("file"), watch["line"]):
                    raise ValueError(f"Watch line outside displayed source {watch.get('file', step['sources'][0]['path'])}: {step['id']}")
            for note in step.get("lineNotes", []):
                if not displayed(step, note.get("file"), note["line"]):
                    raise ValueError(f"Line note outside displayed source: {step['id']} line {note['line']}")
            if "decision" in step:
                result = pointer(step["state"], step["decision"]["resultPath"], step["id"])
                if not isinstance(result, bool):
                    raise ValueError(f"Decision result must be a captured boolean: {step['id']}")
    if "quiz" in spec:
        prepare_quiz(spec, load, steps_by_scenario)
    revision = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True)
    status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"], capture_output=True, text=True)
    spec["build"] = {"created": datetime.now(timezone.utc).isoformat(),
                     "commit": revision.stdout.strip() if revision.returncode == 0 else "unversioned",
                     "workingTree": "modified" if status.stdout else "clean" if status.returncode == 0 else "unknown",
                     "sourceCount": len(source_cache), "checkpointFiles": len(record_cache),
                     "coverageCounts": dict(Counter(c["status"] for c in spec["analysis"]["coverage"])),
                     "questionCount": len(spec.get("quiz", {}).get("questions", []))}
    return spec


def build(spec_path, repo, output, strict=False):
    spec_path, repo = spec_path.resolve(), repo.resolve()
    authored = json.loads(spec_path.read_text(encoding="utf-8"))
    spec = prepare(authored, repo, spec_path.parent)
    warnings = lint(spec)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if strict and warnings:
        raise ValueError(f"{len(warnings)} depth/quiz warnings with --strict")
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
          f"{spec['build']['sourceCount']} verified source files, {spec['build']['questionCount']} quiz questions")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--strict", action="store_true", help="fail on depth/quiz warnings")
    args = parser.parse_args()
    build(args.spec, args.repo, args.out, args.strict)
