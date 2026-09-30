# Walkthrough format

The authoritative contract is [../assets/walkthrough.schema.json](../assets/walkthrough.schema.json). Build with `uv run <skill>/scripts/build_walkthrough.py manifest.json --repo /absolute/repo --out index.html`. Checkpoints resolve inside the manifest directory; sources resolve inside the repo, including symlink checks.

## Top-level fields

| Field | Meaning |
|---|---|
| `version` | Exactly `1`. |
| `title`, `summary`, `repoLabel`, `scope` | Reader-facing descriptions of exact scope. |
| `analysis` | `inventoryCount`, `coverage`, `entrypoints`, `findings`, `limitations`. Coverage entries: `path`, `status`, `reason`. Findings/limitations: string arrays. |
| `graph` | `nodes` and `edges`. Nodes: `id`, short `label`, `description`, integer `x`,`y` pixel coordinates. Edges: `from`,`to`,`label`. Use about 220 px horizontal and 110 px vertical spacing; boxes are 160×50. Cycles allowed. The graph also renders as an always-visible minimap beside each step, so prefer a compact grid (roughly ≤16 nodes, ≤4 per row) and labels of ≤15 characters; split larger systems into subsystem-level nodes. |
| `scenarios` | Array of `{id,title,summary,input,outcome,steps}`. Input is synthetic JSON. Each scenario starts independently. |

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
  }
}
```

Required fields are `id,title,chapter,explanation,node,lane,causes,phase,sources,evidence,visuals`. Optional: `iteration,attempt,watch,decision`. Consecutive steps sharing a `chapter` form one segment of the timeline, so keep chapter names short and group steps contiguously. Causes reference earlier steps **in the same scenario**, including cross-lane dependencies. First steps normally have `causes: []`. A graph node can occur repeatedly. Phase is `before`, `after`, `return`, or `inferred`.

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

Use multiple visuals when state contains a queue, current item, and accumulated results. Prose supplies domain meaning; the renderer never guesses money, duration, accuracy, or count.

The dashboard compares each snapshot with the previous step of the same scenario: new records/rows/queue items are marked, changed fields and cells are highlighted, items that left a list or queue appear as struck-through ghosts, and numeric metrics/bars show a neutral `+n`/`−n` delta. Matching uses `id`, then `name`, then `label`; items without any of these match only by exact value, so an edited id-less object appears as one new item plus one departed ghost. Give entities stable identity fields when you want field-level changes tracked.

## Executable example

The sample demonstrates the format and checkpoint semantics, not the user's codebase:

```bash
python3 <skill>/assets/example/make_demo.py --out /tmp/walkthrough-example
uv run <skill>/scripts/build_walkthrough.py /tmp/walkthrough-example/walkthrough.json \
  --repo <skill>/assets/example --out /tmp/walkthrough-example/index.html
```

Builder checks: `uv run --with Pygments --with jsonschema python <skill>/tests/test_builder.py`.

UI checks: use an available browser or `node <skill>/tests/browser_smoke.mjs /absolute/output/index.html` with Playwright resolvable. The runner checks scenarios, steps, tabs, seeking, timeline and minimap jumps, theme toggle, modal, reverse restoration, keyboard controls, and mobile overflow, and writes `desktop.png`, `desktop-dark.png`, and `mobile.png`. Visually review its screenshots as well.
