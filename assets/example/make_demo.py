#!/usr/bin/env python3
"""Generate a real local execution fixture for builder/UI smoke tests."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1] / "scripts"))
from capture import record
from workflow import prepare_orders

WORKFLOW = (ROOT / "workflow.py").read_text(encoding="utf-8").splitlines()
HARNESS = Path(__file__).read_text(encoding="utf-8").splitlines()


def line(snippet, lines=WORKFLOW):
    """Locate source lines by content so notes stay attached if the fixture is edited."""
    return next(i for i, text in enumerate(lines, 1) if snippet in text)


L = {name: line(snippet) for name, snippet in {
    "def": "def prepare_orders", "pending": "pending = [", "lists": "accepted, rejected = [], []",
    "total0": "total = 0", "start": 'emit("start"', "for": "for index, order", "pop": "pending.pop(0)",
    "valid": "valid = order", "check": 'emit(f"check-', "if": "if valid:", "subtotal": "subtotal = order",
    "append": "accepted.append", "add": "total += subtotal", "reject": "rejected.append",
    "item": 'emit(f"item-', "done": 'emit("done"', "return": "return {"}.items()}
HARNESS_RANGE = (line("def emit(event", HARNESS), line("record(trace, event", HARNESS))

CHAPTERS = [
    {"title": "Set up the batch", "summary": "prepare_orders turns the input into three working collections and a zero total before touching any item.",
     "goals": ["Why pending stores ids rather than whole orders", "What the first checkpoint captures"]},
    {"title": "Process items", "summary": "Each loop iteration removes one id from the front of pending, decides whether its quantity is valid, then either accumulates a subtotal or records a rejection.",
     "goals": ["How the validity check routes an item", "How the running total grows", "Why accepted entries are copies"],
     "diagram": {"title": "Life of one order id", "caption": "Every id makes exactly one trip; the `quantity > 0` check picks the final state.",
                 "code": "stateDiagram-v2\n  direction LR\n  [*] --> Pending: read batch\n  Pending --> Inspecting: pending.pop(0)\n  Inspecting --> Accepted: quantity #gt; 0\n  Inspecting --> Rejected: otherwise\n  Accepted --> [*]: subtotal added\n  Rejected --> [*]: reason recorded"}},
    {"title": "Return the result", "summary": "After the loop, the function emits a final checkpoint and returns the lists it built.",
     "goals": ["What the caller receives", "How to read the final totals"]},
]
CONCEPTS = [
    {"term": "checkpoint", "definition": "A JSON snapshot of selected values that the harness records at a known point in the real run."},
    {"term": "running total", "definition": "The total variable as it accumulates across loop iterations, in rupees."},
    {"term": "subtotal", "definition": "quantity × unit_price for one accepted item, in rupees."},
    {"term": "shallow copy", "definition": "A new outer dict or list whose values are the same objects as the original's."},
]


def money(n):
    return f"₹{n}"


def narrate(event, state, orders):
    """Teaching text for one checkpoint. Values come from the captured state, never retyped."""
    stack = ["make_demo()", "prepare_orders(orders, emit)"]
    if event == "start":
        ids = ", ".join(json.dumps(i) for i in state["pending"])
        return {
            "title": "Three empty collections and a zero total", "chapter": "Set up the batch", "node": "input",
            "explanation": f"Before any item is examined, `pending` lists every id in input order ({ids}). `accepted` and `rejected` start empty and the running total is 0.",
            "focus": [L["pending"], L["lists"], L["total0"], L["start"]], "callStack": stack,
            "lineNotes": [
                {"line": L["pending"], "text": f"A list comprehension keeps only each order's `id`, so `pending` = [{ids}]."},
                {"line": L["lists"], "text": "Tuple unpacking creates two separate empty lists in one statement."},
                {"line": L["total0"], "text": "The running total starts at integer 0 (rupees)."},
                {"line": L["start"], "text": "The `start` checkpoint records this snapshot before the loop runs."}],
            "insights": [
                {"kind": "design", "title": "Ids, not objects", "text": "`pending` only needs to show what is still waiting, so it holds ids. The full order dicts are read from `orders` inside the loop."},
                {"kind": "why", "title": "Why an emit callback?", "text": "The function takes `emit` as a parameter, so a test harness can capture checkpoints without the function knowing about files or JSON."}],
            "watch": [{"label": "total", "path": "/total", "line": L["total0"]}]}
    if event == "done":
        return {
            "title": "The loop is finished; results are returned", "chapter": "Return the result", "node": "output",
            "explanation": f"Every id has left `pending`. {len(state['accepted'])} item(s) were accepted, {len(state['rejected'])} rejected, and the running total is {money(state['total'])}. The same lists are returned to the caller.",
            "focus": [L["done"], L["return"]], "callStack": stack,
            "lineNotes": [
                {"line": L["done"], "text": f"The final checkpoint: `pending` is empty, `total` = {state['total']}."},
                {"line": L["return"], "text": "Returns a dict that references the same `accepted` and `rejected` lists built in the loop."}],
            "insights": [
                {"kind": "gotcha", "title": "References, not copies", "text": "The returned dict holds the very lists the loop appended to. A caller that mutates `result[\"accepted\"]` mutates the only copy."}],
            "watch": [{"label": "total", "path": "/total"}]}
    kind, number = event.split("-")
    order = state["current"]
    name, n = order["id"], int(number)
    stack = [*stack, f"for loop · item {n} ({name})"]
    comparison = f"{order['quantity']} > 0 → {state['valid']}"
    if kind == "check":
        notes = [
            {"line": L["for"], "text": f"`enumerate(orders, 1)` yields index {n} and the `{name}` order."},
            {"line": L["pop"], "text": f"`pop(0)` removes the first id; `pending` is now {json.dumps(state['pending'])}."},
            {"line": L["valid"], "text": f"`{comparison}` stores a boolean in `valid`."},
            {"line": L["check"], "text": "The `check` checkpoint captures the decision before either branch runs."}]
        insights = [{"kind": "performance", "title": "pop(0) shifts the list", "text": "Removing from the front of a Python list is O(n) because every remaining element moves left. For long queues, `collections.deque.popleft()` is O(1)."}]
        if n == 1:
            insights.append({"kind": "gotcha", "title": "Counting from 1", "text": "`enumerate(..., 1)` starts at 1, so checkpoint ids are `check-1`, `item-1` rather than zero-based."})
        return {
            "title": f"Is the quantity of {name} valid?", "chapter": "Process items", "node": "validate",
            "explanation": f"`{name}` leaves the front of `pending`. Its quantity is {order['quantity']}, so `{comparison}`. Nothing has been added to either list yet; the branch runs in the next step.",
            "focus": [L["for"], L["pop"], L["valid"]], "callStack": stack, "lineNotes": notes, "insights": insights,
            "watch": [{"label": "valid", "path": "/valid", "line": L["valid"]}, {"label": "pending", "path": "/pending", "line": L["pop"]}],
            "decision": {"condition": "Is quantity greater than zero?", "resultPath": "/valid",
                         "taken": "Accept: compute the subtotal and add it to the total" if state["valid"] else "Reject: record the reason; the total is untouched",
                         "notTaken": "Reject: record the reason; the total is untouched" if state["valid"] else "Accept: compute the subtotal and add it to the total"},
            "iteration": n}
    if state["valid"]:
        subtotal = state["accepted"][-1]["subtotal"]
        before = state["total"] - subtotal
        return {
            "title": f"{name} is accepted and adds {money(subtotal)}", "chapter": "Process items", "node": "accumulate",
            "explanation": f"The subtotal is {order['quantity']} × {order['unit_price']} = {subtotal}. A copy of the order with that subtotal joins `accepted`, and the running total grows from {before} to {state['total']}.",
            "focus": [L["subtotal"], L["append"], L["add"]], "callStack": stack,
            "lineNotes": [
                {"line": L["subtotal"], "text": f"{order['quantity']} × {order['unit_price']} = {subtotal}."},
                {"line": L["append"], "text": f"`{{**order, \"subtotal\": {subtotal}}}` builds a new dict, so the input order is not modified."},
                {"line": L["add"], "text": f"`total` goes from {before} to {state['total']}."},
                {"line": L["item"], "text": f"The `item-{n}` checkpoint records the result of the branch."}],
            "insights": [{"kind": "concept", "title": "Shallow copy with **", "text": "`{**order, ...}` copies the top-level keys into a new dict. Nested values would still be shared, but these orders hold only strings and numbers."}],
            "watch": [{"label": "subtotal", "path": f"/accepted/{len(state['accepted']) - 1}/subtotal", "line": L["subtotal"]},
                      {"label": "total", "path": "/total", "line": L["add"]}],
            "iteration": n}
    return {
        "title": f"{name} is rejected; the total stays {money(state['total'])}", "chapter": "Process items", "node": "reject",
        "explanation": f"Because `valid` is False, the `else` branch appends `{name}` to `rejected` with a reason. No subtotal is computed, so the running total is still {state['total']}.",
        "focus": [L["reject"]], "callStack": stack,
        "lineNotes": [
            {"line": L["if"], "text": "`valid` is False, so execution skips to `else`."},
            {"line": L["reject"], "text": f"Only the id and a reason are kept for `{name}`; quantity and price are dropped."},
            {"line": L["item"], "text": f"The `item-{n}` checkpoint shows `total` unchanged at {state['total']}."}],
        "insights": [{"kind": "edge-case", "title": "Zero, negative, missing", "text": "`> 0` rejects zero and negative quantities alike. A missing `quantity` key would raise `KeyError` instead; no scenario here exercises that."}],
        "watch": [{"label": "total", "path": "/total"}],
        "iteration": n}


DIAGRAMS = [
    {"title": "Who calls whom", "caption": "The harness passes `emit`, so checkpoints are recorded without `prepare_orders` knowing about files.",
     "code": "sequenceDiagram\n  participant H as make_demo harness\n  participant P as prepare_orders\n  participant R as capture.record\n"
             "  H->>P: orders, emit\n  P->>H: emit(#quot;start#quot;, state)\n  H->>R: write checkpoint\n"
             "  loop each order\n    P->>H: emit(#quot;check-n#quot;)\n    H->>R: write checkpoint\n    P->>H: emit(#quot;item-n#quot;)\n    H->>R: write checkpoint\n  end\n"
             "  P->>H: emit(#quot;done#quot;)\n  P-->>H: accepted, rejected, total"},
    {"title": "Data shapes", "caption": "Accepted entries copy the order and add `subtotal`; rejections keep only the id and a reason.",
     "code": "erDiagram\n  ORDER {\n    string id\n    int quantity\n    int unit_price\n  }\n"
             "  ACCEPTED_ENTRY {\n    string id\n    int quantity\n    int unit_price\n    int subtotal\n  }\n"
             "  REJECTION {\n    string id\n    string reason\n  }\n  RESULT {\n    int total\n  }\n"
             "  ORDER ||--o| ACCEPTED_ENTRY : \"copied when valid\"\n  ORDER ||--o| REJECTION : \"recorded when invalid\"\n"
             "  RESULT ||--o{ ACCEPTED_ENTRY : accepted\n  RESULT ||--o{ REJECTION : rejected"},
]

QUIZ = {
    "title": "Check your understanding",
    "intro": "Ten questions on the batch you just traced. Trace questions use captured values; apply questions ask what the source implies for a new input.",
    "passScore": 0.7,
    "questions": [
        {"id": "start-pending", "type": "mcq", "level": "trace", "chapter": "Set up the batch",
         "prompt": "At the `start` checkpoint of “Two valid items”, what does `pending` contain?",
         "choices": ["`[\"tea\", \"bread\"]`", "The two full order dicts", "An empty list", "`[\"bread\", \"tea\"]`"], "answer": 0,
         "explanation": "The list comprehension keeps only each order's `id`, in input order.",
         "refs": [{"scenario": "valid", "step": "start"}]},
        {"id": "total-after-tea", "type": "mcq", "level": "trace",
         "prompt": "In “Two valid items”, what is `total` immediately after `tea` is accepted?",
         "choices": ["0", "120", "240", "285"], "answer": 2,
         "explanation": "tea has quantity 2 and unit price 120, so its subtotal is 240 and the total goes from 0 to 240. bread's 45 is added in the next iteration.",
         "refs": [{"scenario": "valid", "step": "item-1"}]},
        {"id": "mixed-final", "type": "fill", "level": "trace",
         "prompt": "In “A rejected quantity”, `prepare_orders` returns a total of ___ rupees.",
         "blanks": [{"from": {"scenario": "mixed", "step": "done", "path": "/total"}, "hint": "Only tea is accepted."}],
         "explanation": "bread has quantity 0, so it is rejected and only tea's 240 is counted.",
         "refs": [{"scenario": "mixed", "step": "item-2"}, {"scenario": "mixed", "step": "done"}]},
        {"id": "complete-loop", "type": "code-fill", "level": "recall", "chapter": "Process items",
         "prompt": "Fill in the missing code in the loop body.",
         "source": {"path": "workflow.py", "start": L["for"], "end": L["add"]},
         "blanks": [{"line": L["pop"], "text": "pop(0)", "hint": "Remove the first id."},
                    {"line": L["valid"], "text": "> 0", "hint": "Which quantities are valid?"},
                    {"line": L["add"], "text": "+=", "hint": "Accumulate."}],
         "explanation": "`pop(0)` removes from the front, `> 0` rejects zero and negatives, and `+=` accumulates the running total.",
         "refs": [{"scenario": "valid", "step": "check-1"}, {"scenario": "valid", "step": "item-1"}]},
        {"id": "item-order", "type": "order", "level": "trace",
         "prompt": "Put what happens to one item in execution order.",
         "items": ["Remove its id from the front of `pending`", "Compute `valid` from its quantity", "Emit the `check` checkpoint",
                   "Append it to `accepted` or `rejected`", "Emit the `item` checkpoint"],
         "explanation": "The decision is captured before either branch runs; the branch's effect is captured afterwards.",
         "refs": [{"scenario": "valid", "step": "check-1"}, {"scenario": "valid", "step": "item-1"}]},
        {"id": "why-bread", "type": "mcq", "level": "reason",
         "prompt": "Why does `bread` leave the total unchanged in “A rejected quantity”?",
         "choices": ["Its quantity is 0, so `valid` is False and the `else` branch only records a rejection",
                     "Its unit price is missing", "`pending.pop(0)` skipped it", "The loop stops after the first item"], "answer": 0,
         "explanation": "`0 > 0` is False. The else branch appends to `rejected` and never touches `total`.",
         "refs": [{"scenario": "mixed", "step": "check-2"}, {"scenario": "mixed", "step": "item-2"}]},
        {"id": "pop-front", "type": "fill", "level": "recall",
         "prompt": "`pending.pop(0)` removes from the ___ of the list, so ids leave `pending` in input order.",
         "blanks": [{"answers": ["front", "start", "beginning", "head"]}],
         "explanation": "Index 0 is the first element. `pop()` with no argument would take from the end instead.",
         "refs": [{"scenario": "valid", "step": "check-1"}]},
        {"id": "copy", "type": "mcq", "level": "reason",
         "prompt": "When `tea` is accepted, is the caller's original `order` dict modified?",
         "choices": ["No: `{**order, ...}` builds a new dict for `accepted`", "Yes: `subtotal` is written into it",
                     "Only when quantity is greater than 1"], "answer": 0,
         "explanation": "Dict unpacking creates a new dict. The input still has no `subtotal` key, as the synthetic input panel shows.",
         "refs": [{"scenario": "valid", "step": "item-1"}]},
        {"id": "returned", "type": "mcq", "level": "recall", "chapter": "Return the result",
         "prompt": "Which keys does the dict returned by `prepare_orders` contain? Select all that apply.",
         "choices": ["`accepted`", "`rejected`", "`total`", "`pending`", "`valid`"], "answer": [0, 1, 2],
         "explanation": "The return statement builds `{\"accepted\": ..., \"rejected\": ..., \"total\": ...}`. `pending` and `valid` are local working values.",
         "refs": [{"scenario": "valid", "step": "done"}]},
        {"id": "jam", "type": "mcq", "level": "apply",
         "prompt": "Suppose a third item `{\"id\": \"jam\", \"quantity\": -1, \"unit_price\": 30}` were added to “Two valid items”. What would the final total be?",
         "choices": ["255", "285", "315", "A KeyError is raised"], "answer": 1,
         "explanation": "`-1 > 0` is False, so jam would be rejected and the total would stay at 285. This follows from the source; it was not executed.",
         "refs": [{"scenario": "valid", "step": "done"}, {"scenario": "mixed", "step": "check-2"}]},
    ],
}


def make_demo(output):
    output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1, "title": "From order list to accepted batch", "repoLabel": "Executable format example",
        "summary": "Follow actual Python values through a small batch, one item at a time: how each order is checked, accepted or rejected, and added to a running total.",
        "scope": "The bundled prepare_orders function. This is a fixture for the skill, not analysis of another repository.",
        "analysis": {"inventoryCount": 2, "coverage": [
            {"path": "workflow.py", "status": "read", "reason": "Complete demonstrated function"},
            {"path": "make_demo.py", "status": "read", "reason": "Synthetic harness, snapshot adapter and teaching text"}],
            "entrypoints": ["workflow.py:prepare_orders"],
            "findings": ["Invalid quantities are rejected while valid items accumulate a subtotal.",
                         "Accepted entries are new dicts; the caller's input is not mutated."],
            "limitations": ["Single synchronous lane; no external service, tax, shipping or currency conversion.",
                            "Missing or non-numeric quantities are not exercised."]},
        "chapters": CHAPTERS, "concepts": CONCEPTS, "diagrams": DIAGRAMS,
        "graph": {"nodes": [
            {"id": "input", "label": "Read batch", "description": "Collect ids and reset totals", "shape": "entry"},
            {"id": "validate", "label": "Check quantity", "description": "Pop the next id and test quantity > 0", "shape": "decision", "group": "for each order"},
            {"id": "accumulate", "label": "Accept item", "description": "Compute subtotal and add to total", "group": "for each order"},
            {"id": "reject", "label": "Reject item", "description": "Record the id with a reason", "group": "for each order"},
            {"id": "output", "label": "Return result", "description": "Deliver accumulated values", "shape": "output"}],
            "edges": [{"from": "input", "to": "validate", "label": "each item"},
                      {"from": "validate", "to": "accumulate", "label": "valid"},
                      {"from": "validate", "to": "reject", "label": "invalid"},
                      {"from": "accumulate", "to": "validate", "label": "next item"},
                      {"from": "reject", "to": "validate", "label": "next item"},
                      {"from": "validate", "to": "output", "label": "none left"}]},
        "scenarios": [], "quiz": QUIZ}
    cases = [("valid", "Two valid items", "Both quantities are positive, so every item is accepted.",
              [{"id": "tea", "quantity": 2, "unit_price": 120}, {"id": "bread", "quantity": 1, "unit_price": 45}]),
             ("mixed", "A rejected quantity", "The second item has quantity 0 and takes the rejection branch.",
              [{"id": "tea", "quantity": 2, "unit_price": 120}, {"id": "bread", "quantity": 0, "unit_price": 45}])]
    for case_id, title, summary, orders in cases:
        trace = output / f"{case_id}.jsonl"
        trace.write_text("", encoding="utf-8")
        steps = []
        def emit(event, **state):
            # Derived teaching views are computed from the captured values, inside the checkpoint.
            state["inspecting"] = [state["current"]] if event.startswith("check-") else []
            state["metrics"] = {"Running total (₹)": state["total"]}
            state["subtotals"] = {item["id"]: item["subtotal"] for item in state["accepted"]}
            state["counts"] = {"accepted": len(state["accepted"]), "rejected": len(state["rejected"])}
            record(trace, event, state, repo=ROOT, sources=["workflow.py", "make_demo.py"])
            story = narrate(event, state, orders)
            visuals = [{"type": "board", "title": "Where each order is", "path": "",
                        "groups": [{"title": "Pending", "path": "/pending"}, {"title": "Inspecting", "path": "/inspecting"},
                                   {"title": "Accepted", "path": "/accepted"}, {"title": "Rejected", "path": "/rejected"}],
                        "caption": "Pending holds ids; accepted entries are copies with a subtotal."},
                       {"type": "metrics", "title": "Running total", "path": "/metrics"}]
            if event == "done":
                visuals[1] = {"type": "mermaid", "title": "What the caller receives", "path": "",
                              "code": "flowchart LR\n  r([\"prepare_orders returns\"]) --> a[\"accepted: {{/counts/accepted}} item(s)\"]\n"
                                      "  r --> j[\"rejected: {{/counts/rejected}} item(s)\"]\n  r --> t[\"total: ₹{{/total}}\"]",
                              "caption": "Values are filled in from this checkpoint."}
            if state["accepted"] and not event.startswith("check-"):
                visuals.append({"type": "bars", "title": "Subtotal by accepted item (₹)", "path": "/subtotals"})
            step = {"id": event, "title": story["title"], "chapter": story["chapter"], "explanation": story["explanation"],
                    "node": story["node"], "lane": "Batch worker", "causes": [steps[-1]["id"]] if steps else [], "phase": "after",
                    "sources": [{"path": "workflow.py", "start": L["def"], "end": L["return"], "focus": story["focus"]},
                                {"path": "make_demo.py", "start": HARNESS_RANGE[0], "end": HARNESS_RANGE[1],
                                 "focus": [HARNESS_RANGE[1]], "label": "Checkpoint harness"}],
                    "evidence": {"kind": "observed", "detail": "Captured by the actual function's explicit emit callback using only synthetic inputs.",
                                 "record": {"path": trace.name, "id": event}},
                    "visuals": visuals, "watch": story["watch"], "lineNotes": story["lineNotes"],
                    "insights": story["insights"], "callStack": story["callStack"]}
            for optional in ("decision", "iteration"):
                if optional in story:
                    step[optional] = story[optional]
            steps.append(step)
        result = prepare_orders(orders, emit)
        manifest["scenarios"].append({"id": case_id, "title": title, "summary": summary, "input": orders,
                                      "outcome": f"{len(result['accepted'])} accepted, {len(result['rejected'])} rejected; total ₹{result['total']}.",
                                      "steps": steps})
    (output / "walkthrough.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    make_demo(args.out)
    print(args.out / "walkthrough.json")
