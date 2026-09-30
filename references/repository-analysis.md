# Repository analysis and coverage

Start broad, then trace deeply. Explain this implementation, not a generic diagram of a similar system.

## Repository-wide reconnaissance

Inspect root/workspace manifests, launchers, build files, routes/commands, package boundaries, schemas/models, registries/plugins, persistence, workers, infrastructure definitions, and tests. Read first-party architecture-bearing files in every subsystem before selecting a flow. Use the inventory to notice unfamiliar directories. Generated clients, vendor dependencies, binary assets, datasets, lockfiles, and secrets need different treatment from authored source; record exclusions and reasons. The inventory never reads contents and honors Git/rg ignore rules. Explicitly inspect relevant ignored configuration without revealing secrets when it changes execution.

For each subsystem record purpose, entry points, inputs/outputs, callers/callees, mutable state, and external dependencies. Distinguish build/boot wiring from request-time work. Read important callees and tests rather than guessing from names. Follow both sides of relevant conditions. Record verified documentation discrepancies in findings.

Search targets: CLI registration, HTTP routers, queue consumers, scheduled jobs, hooks, event subscribers, storage adapters, state stores, middleware, dispatch tables, migrations, feature flags, retries, transaction commit/rollback, cancellation, cache identity, resume markers, validation, serializers.

## Scope without false exhaustiveness

A feature request gets whole-repository orientation, then a detailed feature trace. A whole-repository request needs multiple scenarios for distinct entry points (such as ingestion, serving, and training). One execution cannot cover an entire nontrivial codebase. Teach the shared path once and make mode-specific chapters explicit.

Maintain `analysis.coverage` with file paths or clearly identified subsystem directories, `read`, `skimmed`, `unread`, or `excluded`, and a concrete reason. Directory-level `read` means relevant architecture-bearing files were actually read, not every file; name the files in its reason. Keep the full inventory separately and its count in `inventoryCount`; the dashboard distinguishes inventory from review.

When context is tight, save a short analysis ledger of verified call edges, source references, unresolved questions, and remaining subsystems. Continue from it rather than treating a context reset as completion. Don't dump every source file into context or claim a static tool automatically understood the repository.

## Analysis questions to resolve

1. What starts the work, under which configuration?
2. Which input fields influence each meaningful decision?
3. Where do entities change identity, cardinality, representation, or ownership?
4. What happens on failure, retry, cancellation, cache hit, or partial output?
5. What is the final observable result and where does it become durable?
6. Which parts are verified by source, tests, actual run, mock, or inference?

The graph navigates relationships; it does not prove every edge executed. Architecture cycles are allowed. Causal predecessors among concrete events always reference earlier events; each selected loop iteration gets a new event ID.
