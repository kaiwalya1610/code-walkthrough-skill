# Diagrams

Every diagram in the dashboard is drawn by [Mermaid](https://mermaid.js.org) 11, which the builder inlines with the page, so it still works offline. Some diagrams are generated from data you already author. Others you write yourself where they explain something the step-by-step view cannot.

## Generated for you

| Where | From | Mermaid type |
|---|---|---|
| Overview → Codebase map | `graph.nodes`/`graph.edges`, plus the current scenario and step | `flowchart`: subgraphs from `group`, node shapes from `shape`, current/visited/unused node colours, walked edges highlighted, and the latest edge animated. Nodes are clickable and the map pans and zooms. |
| Walkthrough → Branch | a step's `decision` and its captured boolean | `flowchart`: the result in a hexagon, the taken path solid and green, the other path dashed. |
| Walkthrough → Run lanes & causal links | `lane` and `causes` (shown when a scenario uses 2+ lanes) | `sequenceDiagram`: one participant per lane. A cross-lane cause is an arrow, work inside one lane is a note, and the current step is highlighted. |

Graph node options:

- `shape`: `process` (default box), `entry` (stadium), `decision` (diamond), `store` (cylinder), `external` (subroutine), `queue` (parallelogram), `output` (trapezoid). Pick the shape that matches the code's role, not decoration.
- `group`: nodes with the same group are drawn inside one labelled subgraph. Use it for a package, service, loop body or layer.
- `graph.direction`: `LR` (default) or `TB`. Use `TB` for deep pipelines and `LR` for wide fan-outs.
- `x`/`y` are accepted for older manifests and ignored; Mermaid lays out the graph.

## Authored diagrams

| Field | Shown | Use for |
|---|---|---|
| top-level `diagrams: [{title, code, caption?}]` | Overview → Diagrams, with pan and zoom | Whole-system views: request sequences, class/data models, deployment, job states. |
| `chapters[].diagram: {code, title?, caption?}` | The chapter intro card | The one picture that frames a chapter, such as an entity's state machine or a loop's shape. |
| visual `{"type": "mermaid", "title", "path", "code", "caption?"}` | State at this step | A picture whose labels carry this step's values. `{{/pointer}}` in `code` is replaced with the scalar at that JSON Pointer, relative to the visual's `path`. |

Choose the type by the question the reader has:

| Reader's question | Mermaid type |
|---|---|
| What calls what, in what order, across components/services/threads? | `sequenceDiagram` (use `loop`, `alt`/`else`, `par`, `critical`, `activate`) |
| What states can this entity/job/connection be in, and what moves it? | `stateDiagram-v2` |
| How do these classes/types relate (inheritance, composition, interfaces)? | `classDiagram` |
| What are the persisted tables/records and their keys and cardinalities? | `erDiagram` |
| How does control branch inside one function? | `flowchart` with diamonds and labelled edges |
| How does a value or batch move through stages? | `flowchart LR`, or `block-beta` for layered pipelines |
| How are commits/branches/migrations ordered? | `gitGraph` |
| What happens when, over time (retries, backoff, SLAs)? | `timeline` or `gantt` |
| How does a quantity split across categories? | `pie` (only with captured numbers), `sankey-beta` for flows |
| How are concepts or modules organised? | `mindmap` |

Rules:

- Draw a diagram only when it shows structure the code panel and state visuals do not. One sequence diagram of a request beats a paragraph of "then it calls"; a flowchart that restates five consecutive steps does not.
- Keep diagrams honest. Labels describe real functions, states and edges you read in the source. Mark anything inferred, such as `note right of X: inferred, not executed`.
- Keep them small: about 12 nodes or 15 messages. Split larger ones by chapter.
- Mermaid ids are bare words (`a`, `n1`, `Order`). Put display text in quotes: `a["Read batch"]`.
- Inside labels, write `#quot;` for `"`, `#gt;`/`#lt;` for `>`/`<`, `#35;` for `#`, and `#59;` for `;`. Values substituted through `{{/pointer}}` are escaped automatically.
- Use `{{/pointer}}` only inside label text, never as a node id or keyword. The builder checks that each pointer exists and selects a scalar.
- The builder validates structure, not Mermaid syntax. A diagram that fails to parse shows its error and source on the page, and the browser smoke test fails on it. Run the smoke test or open the page after editing a diagram.
