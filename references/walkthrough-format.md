# Walkthrough format

The authoritative contract is [../assets/walkthrough.schema.json](../assets/walkthrough.schema.json). Build with `uv run <skill>/scripts/build_walkthrough.py manifest.json --repo /absolute/repo --out index.html`. Checkpoints resolve inside the manifest directory; sources resolve inside the repo, including symlink checks.

## Top-level fields

| Field | Meaning |
|---|---|
| `version` | Exactly `1`. |
| `title`, `summary`, `repoLabel`, `scope` | Reader-facing descriptions of exact scope. |
| `analysis` | `inventoryCount`, `coverage`, `entrypoints`, `findings`, `limitations`. Coverage entries: `path`, `status`, `reason`. Findings/limitations: string arrays. |
| `graph` | `nodes`, `edges` and optional `direction` (`LR` default, or `TB`). Nodes: `id`, short `label`, `description`, optional `shape` (`process`, `entry`, `decision`, `store`, `external`, `queue`, `output`) and `group` (nodes sharing a group are drawn in one subgraph). Edges: `from`,`to`,`label`. Mermaid lays the graph out; legacy `x`/`y` are accepted and ignored. Cycles and two-way edges are allowed. The full graph is a pan-and-zoom flowchart on the Overview; each step shows a compact "you are here" strip of the nodes the scenario visits. Prefer roughly ≤16 nodes and labels of ≤15 characters; split larger systems into subsystem-level nodes. |
| `diagrams` | Optional. `[{title?, code, caption?}]` Mermaid diagrams shown on the Overview (sequence, class, ER, state, …). See [diagrams.md](diagrams.md). |
| `scenarios` | Array of `{id,title,summary,input,outcome,steps}`. Input is synthetic JSON. Each scenario starts independently. |
| `chapters` | Optional. `{title, summary, goals?, diagram?}` per step chapter. `diagram` is `{code, title?, caption?}` in Mermaid. Shown as an intro card when a chapter begins and as the Overview's learning path. Titles must match step `chapter` values. |
| `concepts` | Optional. `{term, definition}` glossary. The first mention of a term in each piece of prose becomes a definition popover. |
| `quiz` | Optional in the schema, expected by the skill. `{title?, intro?, passScore?, questions}`. See [quiz-design.md](quiz-design.md). |

IDs contain letters, digits, `.`, `_`, `-`, starting with a letter/digit. Source files must be UTF-8 and at most 2 MB each. Snippets are at most 200 lines; prefer much less. Large values remain inspectable with counted expansion.

## A step

```json
{
  "id": "accepted-1",
  "title": "The first item passes validation",
  "chapter": "Validate items",
  "explanation": "The quantity is positive, so this item enters the accepted list.",
  "node": "validate",
  "lane": "Main worker",
  "causes": ["input-1"],
  "phase": "after",
  "iteration": 1,
  "sources": [{"path":"src/feature.py","start":10,"end":24,"focus":[19,20]}],
  "evidence": {
    "kind": "observed",
    "detail": "Actual function run on synthetic input; captured after append.",
    "record": {"path":"trace.jsonl","id":"accepted-1"}
  },
  "visuals": [
    {"type":"records","title":"Accepted items","path":"/accepted"},
    {"type":"queue","title":"Waiting items","path":"/pending"}
  ],
  "watch": [{"label":"Positive quantity","path":"/quantity_ok"}],
  "decision": {
    "condition":"Is quantity greater than zero?",
    "resultPath":"/quantity_ok",
    "taken":"Append this item",
    "notTaken":"Reject this item"
  },
  "lineNotes": [
    {"line":19,"text":"`2 > 0` is True, so `quantity_ok` is True."},
    {"line":20,"text":"`item-1` joins `accepted`; the list now has 1 entry."}
  ],
  "insights": [
    {"kind":"gotcha","title":"Copy, not reference","text":"`{**item}` builds a new dict, so the caller's input is not modified."}
  ],
  "callStack": ["handle_request()", "prepare(items)", "for loop · item 1"]
}
```

Required fields are `id,title,chapter,explanation,node,lane,causes,phase,sources,evidence,visuals`. Optional: `iteration,attempt,watch,decision,lineNotes,insights,callStack`.

- `lineNotes`: `{line, text, file?}` (file defaults to the first source). Rendered as numbered gutter markers linked to a "Line by line" list. The line must be inside a displayed snippet.
- `insights`: `{kind, text, title?}`, where kind is `why`, `concept`, `gotcha`, `performance`, `edge-case` or `design`. Rendered as "Under the hood" cards.
- `callStack`: outermost-first frame labels shown above the code.
- In `explanation`, notes, insights, captions, summaries and quiz text, backticks mark `code`.

See [teaching-depth.md](teaching-depth.md) for how much of each to write. Consecutive steps sharing a `chapter` form one segment of the timeline, so keep chapter names short and group steps contiguously. Causes reference earlier steps **in the same scenario**, including cross-lane dependencies. First steps normally have `causes: []`. A graph node can occur repeatedly. Phase is `before`, `after`, `return`, or `inferred`.

Source: required `path,start,end,focus` (one-based inclusive); optional `label` and `sha256` (authoring-time full-file hash). Focus must lie within range. Multiple references become file tabs. Phase and prose explain how focused source relates to the snapshot.

Executed modes (`observed`,`mocked`,`replayed`) require `evidence.record` and **prohibit inline state**. Values load from the checkpoint, with matching hashes for every displayed file. `inferred` prohibits a checkpoint, requires inline object `state`, and requires `phase: "inferred"`. `evidence.detail` is always required. Don't change executed events to inferred to bypass stale-source errors; rerun or disclose the real limitation.

The builder adds resolved source `lines`, hashes, language, and `build` metadata. These generated fields must not appear in authored manifests. Do not feed an already prepared payload back into the authoring validator.

## Checkpoints

One object per JSONL line:

```json
{"id":"accepted-1","state":{"accepted":[{"id":"item-1","quantity":2}],"pending":["item-2"],"quantity_ok":true},"sources":{"src/feature.py":"<actual SHA-256 hash>"}}
```

Use supplied recorders to compute actual source hashes. IDs are unique within a file. State is a **full snapshot of selected teaching values**, not a patch or heap dump. Retain relevant values across steps so differences and reverse navigation are meaningful. Distinguish removed fields from present null, empty string, zero, or empty array.

## Visuals and pointers

`path` is an RFC 6901 JSON Pointer: `""` selects whole state, `/accepted` an array, `/items/0/name` a field. Escape `/` in keys as `~1`, and `~` as `~0`. Paths must exist, including for empty results. Watch uses the same pointers. Decisions require a boolean at `resultPath`.

A watch entry may add `line` (and `file`, defaulting to the first source) to pin its value inline beside that source line, like a debugger's inline values. Pin only where that line produced or last assigned the value in this snapshot; omit `line` otherwise. The builder rejects a line outside the displayed range.

All views: `type,title,path`, optional `caption` for units, identity, or provenance.

| Type | Value | Display |
|---|---|---|
| `records` | Object array | Field/value cards identified by id/name/label. Counted expansion after 12. |
| `table` | Object array plus explicit `columns` | Every selected column must exist in every row; use null/empty deliberately. Expansion after 50. |
| `queue` | Array | Ordered positions; nested objects remain inspectable. |
| `metrics` | Object mapping labels to scalars | Counts/totals; supply meaningful units in labels. |
| `text` | Scalar | Preserved whitespace; raw tokens, normalized string, or scalar result. |
| `tree` | Any JSON | Inspectable nesting when structure matters. |
| `bars` | Object mapping labels to finite numbers | Horizontal bars scaled to the largest magnitude; negatives shown distinctly. Use for comparing magnitudes (per-item totals, scores, sizes). |
| `mermaid` | Any JSON, plus `code` (Mermaid text) | A diagram whose labels carry this step's values: `{{/pointer}}` in `code` becomes the scalar at that pointer, relative to `path`. Each pointer must exist and select a scalar. See [diagrams.md](diagrams.md). |
| `board` | Object, plus `groups: [{title, path}]` whose paths (relative to `path`) select arrays | Kanban columns. Entities are matched across columns by `id`/`name`/`label`, or by a bare scalar value, so an id in `pending` and the record `{id: …}` in `accepted` are the same entity. A move shows "from <column>", a new entity is marked new, and one that left every column remains as a ghost. Prefer it whenever items flow between collections. |

Use multiple visuals when state contains a queue, current item, and accumulated results. Prose supplies domain meaning; the renderer never guesses money, duration, accuracy, or count.

The dashboard compares each snapshot with the previous step of the same scenario: new records/rows/queue items are marked, changed fields and cells are highlighted, items that left a list or queue appear as struck-through ghosts, and numeric metrics/bars show a neutral `+n`/`−n` delta. Matching uses `id`, then `name`, then `label`; items without any of these match only by exact value, so an edited id-less object appears as one new item plus one departed ghost. Give entities stable identity fields when you want field-level changes tracked.

## Executable example

The sample demonstrates the format and checkpoint semantics, not the user's codebase:

```bash
python3 <skill>/assets/example/make_demo.py --out /tmp/walkthrough-example
uv run <skill>/scripts/build_walkthrough.py /tmp/walkthrough-example/walkthrough.json \
  --repo <skill>/assets/example --out /tmp/walkthrough-example/index.html
```

Diagrams: the map, branches and run lanes are generated Mermaid diagrams; see [diagrams.md](diagrams.md) for authored ones. The builder checks pointers and structure but cannot parse Mermaid, so a syntax error appears on the page and fails the browser smoke test.

Builder checks: `uv run --with Pygments --with jsonschema python <skill>/tests/test_builder.py`.

Depth/quiz lint: the builder prints warnings for steps without `lineNotes`, steps with more than three visuals, chapters without insights, and a missing, small or one-format quiz, or one that leaves a chapter untested. Add `--strict` to make them errors.

UI checks: use an available browser or `node <skill>/tests/browser_smoke.mjs /absolute/output/index.html` with Playwright resolvable. The runner checks the Overview landing page, every step via the outline, line notes, file tabs, reverse restoration, timeline and flow-strip seeking, map jumps, concept popovers, theme toggle, playback, deep links, keyboard section switching, the full quiz (grading, results, review links, retry missed), the mobile drawer, and overflow in every section. It writes `overview.png`, `desktop.png`, `desktop-dark.png`, `quiz-question.png`, `quiz-results.png` and `mobile.png`. Review the screenshots as well.
