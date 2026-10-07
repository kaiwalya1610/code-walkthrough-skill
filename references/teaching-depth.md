# Teaching depth

A walkthrough is deep when a reader who never opened the repository can answer three questions at any step: **what changed, which line did it, and why does the code do it that way.** A high-level tour that names functions and shows boxes is not enough. Use this contract while authoring and treat the builder's warnings (`--strict` to fail on them) as a floor, not the goal.

## Layers of a walkthrough

| Layer | Field | Purpose |
|---|---|---|
| Orientation | `summary`, `scope`, `graph`, scenario cards | What the system is and which runtime paths the reader will follow. |
| Learning path | top-level `chapters` (`title`, `summary`, `goals`) | One intro card per chapter: what this phase does and what the reader should come away knowing. |
| Step story | `title`, `explanation` | One concrete operation, told with the captured values: "tea leaves `pending`; 2 > 0 → True". |
| Line by line | `lineNotes` | A numbered note for **every focused line**, linked to a marker in the code gutter. Say what the line does *in this run* with real values, not what it does in general. |
| Under the hood | `insights` | Language semantics, design rationale, complexity, edge cases and traps the reader would miss. |
| Context | `callStack`, `decision`, `watch` | Where execution is nested, which branch was taken and why, and the few values to keep an eye on. |
| Vocabulary | top-level `concepts` | Domain or language terms; their first mention in prose becomes a definition popover. |
| Check | top-level `quiz` | See [quiz-design.md](quiz-design.md). |

## Step granularity

- Every function on the requested path gets its own chapter or a contiguous run of steps: entry with parameters, each meaningful transformation, each branch decision, each loop iteration that teaches something new, and the return.
- Split a decision from its effect when the code allows a checkpoint between them. One step shows the condition evaluated (with `decision`); the next shows what the taken branch changed. Readers learn more from "decide, then act" than from a merged step.
- Aim for 3–8 focused lines per step. If a step's notes need more than ~6 entries, split it.
- Loops: show the first iteration in full and every iteration that takes a different path. Summarize identical iterations in prose and say how many were skipped.
- Include setup steps only when they shape later behaviour (configuration, registry wiring, default values).
- A whole-repository walkthrough still goes line-deep on its main path; breadth comes from more scenarios and chapters, not shallower steps.

## Writing line notes

- One note per focused line (the builder warns when a step has none). Notes can point at unfocused lines that matter, such as the checkpoint call or the line that will run next.
- Lead with the concrete effect: ``"`pop(0)` removes the first id; `pending` is now ["bread"]."`` not "Removes an item from the list."
- Mark identifiers with backticks so they render as code. Keep each note to one or two sentences.
- Generate notes from captured state in the harness wherever possible (see `assets/example/make_demo.py`), so numbers can't drift from the checkpoint.

## Writing insights

Each chapter needs at least one insight; good steps often have two. Pick the kind that fits:

| Kind | Use for |
|---|---|
| `why` | The reason the code is written this way, or why this value matters next. |
| `concept` | A language/framework mechanism the step relies on (dict unpacking, async scheduling, closures). |
| `gotcha` | Something that looks one way and behaves another (shared references, off-by-one, mutation). |
| `performance` | Complexity or cost that changes with input size, and the usual alternative. |
| `edge-case` | Inputs this run did not exercise and what the code would do. State whether that is verified or inferred. |
| `design` | Architecture choices: boundaries, injection, ownership, why a callback instead of a return. |

Insights state facts that follow from the source or the run. Don't speculate about intent you can't support, and say "not exercised here" for behaviour you only read.

## Visuals: show each fact once

The visual panel should make the change obvious, not repeat it in several shapes.

- Limit each step to 1–3 visuals. The builder warns above 3.
- Prefer one `board` when entities move between collections (pending → in progress → done/failed). It replaces a queue, a table and a records list showing the same items.
- Use `metrics` for the few numbers that matter, `bars` only for comparing magnitudes across several items, `table` for comparing fields across rows, `tree` for nested structure, and `text` for raw strings.
- Never pair a count metric with a board or list that already shows the same count.
- Add a `caption` for units, identity or provenance. Let `explanation` and `lineNotes` carry the narrative.

## Self-check before building

1. Could a reader predict the next step's main value from this step's notes? If not, the notes are too thin.
2. Does every branch decision show the captured boolean, the taken path and the untaken path?
3. Is each chapter's "why" answered somewhere in its insights?
4. Is any visual redundant with another on the same step?
5. Does every chapter have quiz coverage?
