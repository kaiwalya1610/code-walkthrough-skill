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


def make_demo(output):
    output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": 1, "title": "From order list to accepted batch", "repoLabel": "Executable format example",
        "summary": "Follow actual Python values through a small batch, one item at a time.",
        "scope": "The bundled prepare_orders function. This is a fixture for the skill, not analysis of another repository.",
        "analysis": {"inventoryCount": 2, "coverage": [
            {"path": "workflow.py", "status": "read", "reason": "Complete demonstrated function"},
            {"path": "make_demo.py", "status": "read", "reason": "Synthetic harness and snapshot adapter"}],
            "entrypoints": ["workflow.py:prepare_orders"],
            "findings": ["Invalid quantities are rejected while valid items accumulate a subtotal."],
            "limitations": ["Single synchronous lane; no external service, tax, shipping or currency conversion."]},
        "graph": {"nodes": [
            {"id": "input", "label": "Read batch", "description": "Start a fresh batch", "x": 20, "y": 20},
            {"id": "validate", "label": "Inspect an item", "description": "Accept or reject quantity", "x": 240, "y": 130},
            {"id": "output", "label": "Return result", "description": "Deliver accumulated values", "x": 460, "y": 240}],
            "edges": [{"from": "input", "to": "validate", "label": "each item"},
                      {"from": "validate", "to": "validate", "label": "next iteration"},
                      {"from": "validate", "to": "output", "label": "all items processed"}]},
        "scenarios": []}
    cases = [("valid", "Two valid items", [{"id": "tea", "quantity": 2, "unit_price": 120},
                                           {"id": "bread", "quantity": 1, "unit_price": 45}]),
             ("mixed", "A rejected quantity", [{"id": "tea", "quantity": 2, "unit_price": 120},
                                               {"id": "bread", "quantity": 0, "unit_price": 45}])]
    for case_id, title, orders in cases:
        trace = output / f"{case_id}.jsonl"
        trace.write_text("", encoding="utf-8")
        steps = []
        def emit(event, **state):
            state["metrics"] = {"Accepted items": len(state["accepted"]),
                                "Rejected items": len(state["rejected"]), "Total (₹)": state["total"]}
            state["subtotals"] = {item["id"]: item["subtotal"] for item in state["accepted"]}
            record(trace, event, state, repo=ROOT, sources=["workflow.py", "make_demo.py"])
            is_item = event.startswith("item-")
            number = int(event.split("-")[1]) if is_item else None
            focus = [11, 13, 14, 15] if is_item and state["valid"] else [11, 17] if is_item else [5, 6, 7] if event == "start" else [20]
            step = {"id": event, "title": f"Inspect {state['current']['id']}" if is_item else "The batch is ready" if event == "start" else "The batch is complete",
                    "chapter": "Process items" if is_item else "Input" if event == "start" else "Result",
                    "explanation": ("A positive quantity adds this item's subtotal to the running total." if state["valid"] else "Zero quantity goes to the rejection list and does not change the total.") if is_item else "The input identities are waiting in order; no results have accumulated." if event == "start" else "All input items have been considered. Accepted and rejected records remain separate.",
                    "node": "validate" if is_item else "input" if event == "start" else "output",
                    "lane": "Batch worker", "causes": [steps[-1]["id"]] if steps else [], "phase": "after",
                    "sources": [{"path": "workflow.py", "start": 4, "end": 21, "focus": focus},
                                {"path": "make_demo.py", "start": 7, "end": 14, "focus": [9, 10]}],
                    "evidence": {"kind": "observed", "detail": "Captured by the actual function's explicit emit callback using only synthetic inputs.", "record": {"path": trace.name, "id": event}},
                    "visuals": [{"type": "metrics", "title": "Batch totals", "path": "/metrics"},
                                {"type": "queue", "title": "Still waiting", "path": "/pending"},
                                {"type": "table", "title": "Accepted items", "path": "/accepted", "columns": ["id", "quantity", "unit_price", "subtotal"]},
                                {"type": "records", "title": "Rejected items", "path": "/rejected"},
                                {"type": "bars", "title": "Subtotal by accepted item (₹)", "path": "/subtotals"}],
                    "watch": [{"label": "Running total", "path": "/total"}]}
            # Pin the value beside the line that last assigned it; omit the pin where no line in view did.
            if event == "start" or (is_item and state["valid"]):
                step["watch"][0]["line"] = 7 if event == "start" else 15
            if is_item:
                step["iteration"] = number
                step["decision"] = {"condition": "Is quantity greater than zero?", "resultPath": "/valid",
                                    "taken": "Accept and accumulate" if state["valid"] else "Record rejection",
                                    "notTaken": "Record rejection" if state["valid"] else "Accept and accumulate"}
            steps.append(step)
        result = prepare_orders(orders, emit)
        manifest["scenarios"].append({"id": case_id, "title": title, "summary": "A synthetic batch with rupee-denominated unit prices.",
                                      "input": orders, "outcome": f"{len(result['accepted'])} accepted, {len(result['rejected'])} rejected; total ₹{result['total']}.", "steps": steps})
    (output / "walkthrough.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    make_demo(args.out)
    print(args.out / "walkthrough.json")
