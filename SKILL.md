---
name: code-walkthrough
description: Build interactive, source-linked visual dry runs of a codebase or feature using synthetic data, with line-by-line explanations and a closing quiz. Use for step-by-step code explanations that show changing values, branches, loops, asynchronous workflows, and outputs beside highlighted real source, then check the reader's understanding with multiple-choice, fill-in-the-blank, code-completion and ordering questions.
---

# Code Walkthrough

Deliver a working, offline dashboard with three sections:

1. **Overview**: what the code does, scenario cards, the codebase map, a chapter-by-chapter learning path, a glossary, and honest coverage.
2. **Walkthrough**: an outline of chapters and steps on the left, real highlighted source in the middle (with numbered line notes, inline values and a call stack), and the dry run on the right. The dry run shows the step story, the branch taken, a line-by-line explanation, the state that changed, and "under the hood" insights.
3. **Quiz**: multiple-choice, fill-in-the-blank, complete-the-code and put-in-order questions. Each is graded with an explanation and links back to the steps that teach it.

Readers move forward and backward, seek, switch scenarios, and see how concrete values become output. Build the artifact; a written plan, a call graph alone, or a debugger transcript is insufficient. **Depth is the point**: explain each focused line with this run's real values and say *why* the code behaves that way, not only what it calls.

Use the bundled browser-native components and Python builder. React is unnecessary for this standalone page; all styles, scripts, highlighted source, and trace values are embedded. Adapt the source components in `assets/` when a feature needs a specific visualization. Preserve the source/evidence checks.

## Understand the repository before authoring slides

1. Read applicable project instructions. Discover runtime, workspace packages, entry points, tests, configuration, persistence, background workers, and external boundaries across the **whole first-party repository**. Start with `rg --files` and the path-only inventory helper:

   ```bash
   python3 <skill>/scripts/inventory.py <repo> --out <output>/inventory.json
   ```

2. Read architecture-bearing files in every first-party subsystem; trace the requested feature from its real entry point through callees, transformations, branches, and output consumers. Resolve dynamic wiring through registries, configuration, imports, and tests. Prefer executable behavior when comments/docs disagree. Read [repository-analysis.md](references/repository-analysis.md) for coverage and scope handling.
3. Keep a coverage ledger distinguishing **read**, **skimmed**, **unread**, and **excluded** paths/subsystems. Inventory is not comprehension. For a large repository, use subsystem chapters and disclose unread areas; never imply exhaustive reading from listings or pretend a bounded feature trace covers all paths.
4. For a whole-codebase request, map every major subsystem and build representative scenarios for distinct runtime entry points. For a feature request, show broader context and go deep on that feature. Do not silently reduce a whole-system request to a convenient utility.

## Produce trustworthy dummy-data runs

Read [execution-and-complexity.md](references/execution-and-complexity.md) before tracing. Choose small synthetic inputs that exercise the real entry point and meaningful transformations. Follow existing fixtures/contracts. Keep entity IDs stable through split, join, deduplication, retries, and persistence. Include the successful path and meaningful alternate/failure paths necessary to explain the requested scope.

Execute actual project functions in an isolated output directory using the project runtime. Reuse debug hooks or a focused harness; avoid modifying production behavior. At selected boundaries, explicitly capture only synthetic values needed for explanation with `scripts/capture.py` or `scripts/capture.mjs`. Other languages can emit the same checkpoint JSONL shape. Preserve reproducible harness, fixtures, and checkpoints with the output.

Every event discloses one evidence mode:

- `observed`: actual selected code ran; values load from its checkpoint.
- `mocked`: surrounding code ran with named external boundaries replaced; disclose what is bypassed.
- `replayed`: code consumed a recorded response; disclose what was not rerun.
- `inferred`: values derived by source inspection, clearly labeled **not executed**.

Use captured state for executed steps, not retyped numbers. If execution is blocked, keep inference explicit and complete the useful visualization. Do not claim runtime coverage or successful effects from inferred states. Synthetic data does not authorize network calls, paid inference, deployments, or production writes; use supported local mocks/replay within task authorization.

## Author the walkthrough

Read [walkthrough-format.md](references/walkthrough-format.md) and [teaching-depth.md](references/teaching-depth.md); the exact contract is `assets/walkthrough.schema.json`. Write `<output>/walkthrough.json` with scope, honest coverage, subsystem graph, chapter intros (`chapters`), a glossary (`concepts`), scenario inputs, ordered steps, and a `quiz`. Use `assets/example/` as an executable format example, not a replacement for the user's codebase. Its harness generates the notes from captured values, which is the recommended pattern.

Each step needs:

- One concrete operation and a plain-language explanation of **why the value changes**, using the captured values. Wrap identifiers in backticks.
- `lineNotes` for every focused line: what that line did in this run, with concrete values. These become numbered markers in the code, linked to a "Line by line" list.
- `insights` where they teach something the reader would miss: language semantics, design reasons, complexity, edge cases, gotchas. Every chapter needs at least one.
- A `callStack` when the step is nested inside calls, loops or callbacks.
- A chapter, execution lane, causal predecessors, and before/after/return phase. Label loop iterations and retry attempts; distinguish recorded order from causation for concurrent work.
- Original source path/range and focused lines. The builder reads/highlights actual source; do not paste paraphrased or invented snippets. Prefer 8–35 lines. Include caller/callee tabs where useful.
- A complete selected state snapshot and **1–3 distinct visuals** bound through JSON Pointers. Show each fact once: a `board` when entities move between collections (it replaces separate queue/table/records views of the same items), metrics for the few numbers that matter, bars only for comparing magnitudes across several items, tables for comparing fields, text for strings, trees for nested structures. Don't pair a count metric with a list that already shows that count. Give entities stable `id`/`name` fields so the dashboard can mark what was added, moved, changed, or removed since the previous step. Domain-specific visuals can replace generic cards when clearer.
- Optional `watch` entries with `line` pin a value inline beside the source line that produced it; use only when that line actually assigned the value in this snapshot.
- An evidence record or explicit inferred state. A condition shows its captured boolean, chosen path, and untaken alternative. Present alternatives as separate recorded scenarios, never imaginary clickable execution.

Preserve initial dummy input throughout navigation. Keep field names that connect to code, with friendly titles/captions explaining them. Avoid raw JSON/logs as the main panel. Explain identity, units, missing vs empty vs null, accumulation, and changes since the previous snapshot. Break long flows into chapters (give each a `chapters` entry with a summary and goals) without hiding consequential branches. Split a decision from its effect where a checkpoint fits between them. Collapsed data must show its full count and remain inspectable.

## Close with a quiz

Read [quiz-design.md](references/quiz-design.md). Author 6–15 questions that cover every chapter, mix formats (at least one `mcq`, one `fill` or `code-fill`, and one `order`), and climb the levels recall → trace → reason → apply. Bind trace answers to checkpoints with `from` so they can't drift from the run. Hide real tokens of logic in `code-fill`. Write distractors from real misconceptions, and explanations that teach the rule with concrete values. Every question needs `refs` to the steps that explain it.

## Build, verify, and open

```bash
uv run <skill>/scripts/build_walkthrough.py <output>/walkthrough.json \
  --repo <repo> --out <output>/index.html
```

The builder needs Python 3.10+, Pygments, and jsonschema. `uv run` installs its declared build dependencies in an isolated cache. Without uv, use an existing suitable interpreter or isolated environment with `python -m pip install 'Pygments>=2.18,<3' 'jsonschema>=4.23,<5'`, then run the script. The HTML has **no runtime dependencies, CDN, backend, or network requirement**.

The builder rejects invalid references, missing checkpoint IDs, stale source hashes, out-of-range highlights and line notes, bad state pointers, causal links to future/unknown steps, and malformed quiz questions (unknown step refs, answer indexes out of range, blank counts, `code-fill` text not on its line, non-scalar `from` bindings). Correct data or rerun the affected bounded fixture; do not disable checks. Building verifies references and structure, not the truth of prose or coverage claims.

It also prints **depth warnings**: steps without line notes, more than three visuals, chapters without insights, and a missing, small or one-format quiz, or one that leaves a chapter untested. Resolve them; pass `--strict` to make them fail the build.

Open `index.html` with the available browser/file preview (`open_in_codex` when available). If HTTP is required, serve the output directory on loopback with `python3 -m http.server 8765 --bind 127.0.0.1 --directory <output>`. Never serve the repository root or publish remotely just to preview. Stop an unneeded server after verification; keep one only to support an active preview.

Exercise the Overview (scenario cards, map nodes, learning path), next/back, scenarios, seeking (outline, chapter timeline, flow strip), source tabs, line-note linking, concept popovers, first/final states, and the whole quiz (each question type, wrong and right answers, results, review links, retry missed). Verify reverse navigation restores exact values, final output matches the run, highlights and change markers correspond to the operation, and there are no JS errors. Check desktop/narrow layouts (outline drawer) in both light and dark themes, keyboard controls (←/→, Space, Home/End, 1/2/3 sections, [ outline, T theme), and screenshots. For complex flows, exercise the swimlane chart and repeated attempts. Do not claim browser verification if only the builder ran.

Return the dashboard link, scope/scenarios, execution modes actually used, quiz size, and material limits. Include reproducible commands when useful. Keep outputs out of unrelated project files. A visual walkthrough implies no live debugger, provider quality claim, or production mutation.
