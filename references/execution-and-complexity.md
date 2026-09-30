# Execution and complex workflows

## Capture selected state

Use the project runtime and actual entry point. Direct calls from a wrapper suit a function/subsystem request; label that scope and do not claim the integrated app ran. For integrated work use its CLI/route/consumer and wiring. Select synthetic values explicitly; never dump environments, connection objects, arbitrary locals, private model reasoning, or real user records.

The recorders serialize JSON snapshots immediately, so later mutations cannot rewrite earlier state, and capture SHA-256 hashes for selected original files. They do not discover checkpoints, mock anything, collect call stacks, or validate application behavior. The agent analyzes the code and writes the feature-specific harness.

Python:

```python
import sys
sys.path.insert(0, str(skill_path / "scripts"))
from capture import record

result = real_function(dummy_input)
record(output / "trace.jsonl", "result-1", {"input": dummy_input, "result": result},
       repo=repo, sources=["src/feature.py"])
```

JavaScript/TypeScript after compilation:

```javascript
import { record } from '/absolute/skill/scripts/capture.mjs';
const result = await realFunction(dummyInput);
record(tracePath, 'result-1', { input: dummyInput, result },
       { repo: repoPath, sources: ['src/feature.ts'] });
```

Both require an existing output directory. Start fresh trace files per run to avoid duplicate IDs. Convert domain types deliberately (Decimal to decimal string, datetime to ISO, model to JSON fields). Preserve units and explain conversions. Avoid `default=str` or repr fallback. JS rejects undefined, nonfinite numbers, functions, and symbols; convert Map/Set/Date deliberately. Python rejects unsupported objects and nonfinite numbers.

For internal statements prefer debug events, test hooks, or debugger callbacks filtered to specific functions/lines. A Python `line` event occurs **before** execution: line N's output appears at the next event, not at N. A return event observes the return value. Never label a before-snapshot as after. A temporary `sys.settrace` harness restores the previous tracer with `finally` even on failure. Handle errors only when demonstrating actual recovery; otherwise propagate them.

Use per-worker files for multiple threads/processes; append helpers do not coordinate concurrent writes. Merge by observed sequence and explicit causal IDs in the manifest. Timestamps do not establish causality. Source hashes verify selected files at capture time, not all dependencies/configuration. Preserve runtime/config differences and fixture provenance in evidence/limitations.

## Complex workflow recipes

| Workflow | Capture and visualize |
|---|---|
| Loops/batching | Iteration, current ID, remaining queue, accumulator. Explain any summarized middle iterations and retain evidence. |
| Fan-out/fan-in | Lanes, task IDs, input split, queued/running/completed sets, outputs, join dependencies in `causes`. Replay order does not imply serial execution. |
| Async/await/callbacks | Scheduling boundary, suspension state, continuation state. Label variable completion order as one observed recording. |
| Retry/backoff | Attempt, actual error classification, scheduled delay separate from elapsed time, committed effects, exhausted outcome. Never invent success. |
| Cache/deduplication | Real key and identity fields, hit/miss boolean, source owner, reused value, lineage for each original entity. |
| Parsing/validation | Raw span → parsed fields → accepted/rejected records; raw text beside normalized form. Actual invalid-input scenario. |
| Storage/event sourcing | Pending vs committed writes, transaction boundaries, emitted events, durable IDs, rollback/partial result. Isolated local storage or supported stubs. |
| React/UI | User action → handler → update → derived/rendered view. Distinguish render from committed effects; evidence stale closures/async changes. |
| LLM/tools | Explicit request fields, synthetic response or supported mock, parsing/validation/repair, public result. Provider behavior/quality unverified in mock/replay; no private reasoning. |
| Recursion/trees | Node ID, depth/stack, frontier/visited sets, returned subtree. Preserve exact return transitions. |
| Distributed services | Correlation IDs, payloads, service lanes, acknowledgement vs persistence, duplicates, causal links. Mark unrunnable boundaries inferred. |

## Teaching steps

A step answers “what changed, where, and why?” rather than covering an arbitrary number of lines. Include setup when it changes behavior. Caller/callee transitions can use source tabs. Group phases into chapters and make scenarios for meaningful branches. Don't create a slide for each import/getter.

Make the domain recognizable: product cards for a cart, waiting jobs for a scheduler, added columns for a join, accepted/rejected fields for a parser. Use built-in views first; add a specific renderer to copied assets when they obscure the concept. Keep visuals bound to snapshots with accessible text/table equivalents.

Controls never execute application code. Play/seek/reverse navigate immutable snapshots. Changing a fixture requires rerunning the harness and rebuilding; editing display data must not imply a new verified result.
