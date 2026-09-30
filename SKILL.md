---
name: code-walkthrough
description: Build interactive, source-linked visual dry runs of a codebase or feature using synthetic data. Use for slide-by-slide code explanations that show changing values, branches, loops, asynchronous workflows, and outputs beside highlighted real source.
---

# Code Walkthrough

Deliver a working, offline dashboard: actual code on the left, an understandable visual dry run on the right. Readers can move forward/backward, seek, select a scenario, inspect the original dummy input, and see how concrete values become output. Build the artifact; a written plan, call graph alone, or debugger transcript is insufficient.

Use the bundled browser-native components and Python builder. React is unnecessary for this standalone page; all styles, scripts, highlighted source, and trace values are embedded. Adapt the source components in `assets/` when a feature needs a specific visualization. Preserve the two-panel experience and source/evidence checks.

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

Read [walkthrough-format.md](references/walkthrough-format.md); the exact contract is `assets/walkthrough.schema.json`. Write `<output>/walkthrough.json` with scope, honest coverage, subsystem graph, scenario inputs, and ordered steps. Use `assets/example/` as an executable format example, not a replacement for the user's codebase.

Each step needs:

- One concrete operation and a plain-language explanation of **why the value changes**.
- A chapter, execution lane, causal predecessors, and before/after/return phase. Label loop iterations and retry attempts; distinguish recorded order from causation for concurrent work.
- Original source path/range and focused lines. The builder reads/highlights actual source; do not paste paraphrased or invented snippets. Prefer 8–35 lines. Include caller/callee tabs where useful.
- A complete selected state snapshot and visuals bound through JSON Pointers. Use records for entities, tables for comparisons, queues for ordered work, metrics for meaningful counts, bars for comparing numeric magnitudes, text for strings, and trees for nested structures. Give entities stable `id`/`name` fields so the dashboard can mark what was added, changed, or removed since the previous step. Domain-specific visuals can replace generic cards when clearer.
- Optional `watch` entries with `line` pin a value inline beside the source line that produced it; use only when that line actually assigned the value in this snapshot.
- An evidence record or explicit inferred state. A condition shows its captured boolean, chosen path, and untaken alternative. Present alternatives as separate recorded scenarios, never imaginary clickable execution.

Preserve initial dummy input throughout navigation. Keep field names that connect to code, with friendly titles/captions explaining them. Avoid raw JSON/logs as the main panel. Explain identity, units, missing vs empty vs null, accumulation, and changes since the previous snapshot. Break long flows into chapters without hiding consequential branches. Collapsed data must show its full count and remain inspectable.

## Build, verify, and open

```bash
uv run <skill>/scripts/build_walkthrough.py <output>/walkthrough.json \
  --repo <repo> --out <output>/index.html
```

The builder needs Python 3.10+, Pygments, and jsonschema. `uv run` installs its declared build dependencies in an isolated cache. Without uv, use an existing suitable interpreter or isolated environment with `python -m pip install 'Pygments>=2.18,<3' 'jsonschema>=4.23,<5'`, then run the script. The HTML has **no runtime dependencies, CDN, backend, or network requirement**.

The builder rejects invalid references, missing checkpoint IDs, stale source hashes, out-of-range highlights, bad state pointers, and causal links to future/unknown steps. Correct data or rerun the affected bounded fixture; do not disable checks. Building verifies references and structure, not the truth of prose or coverage claims.

Open `index.html` with the available browser/file preview (`open_in_codex` when available). If HTTP is required, serve the output directory on loopback with `python3 -m http.server 8765 --bind 127.0.0.1 --directory <output>`. Never serve the repository root or publish remotely just to preview. Stop an unneeded server after verification; keep one only to support an active preview.

Exercise next/back, scenarios, seeking (scrubber, chapter timeline, minimap nodes), source tabs, first/final states, and overview. Verify reverse navigation restores exact values, final output matches the run, highlights and change markers correspond to the operation, and there are no JS errors. Check desktop/narrow layouts in both light and dark themes, keyboard controls (←/→, Space, Home/End, M map, T theme), and screenshots. For complex flows, exercise the swimlane chart and repeated attempts. Do not claim browser verification if only the builder ran.

Return the dashboard link, scope/scenarios, execution modes actually used, and material limits. Include reproducible commands when useful. Keep outputs out of unrelated project files. A visual walkthrough implies no live debugger, provider quality claim, or production mutation.
