"""Meaningful source/evidence and snapshot invariants for the CLI boundary."""
from copy import deepcopy
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_walkthrough import build, prepare, pointer
from capture import record


class BuilderTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name).resolve()
        self.repo = self.base / "repo"
        shutil.copytree(ROOT / "assets" / "example", self.repo)
        self.output = self.base / "output"
        # Use original harness so its skill-relative recorder import remains valid.
        subprocess.run([sys.executable, str(ROOT / "assets/example/make_demo.py"), "--out", str(self.output)], check=True, capture_output=True)
        self.spec = json.loads((self.output / "walkthrough.json").read_text())

    def test_real_trace_roundtrip_and_html_escaping(self):
        self.spec["title"] = '</script><script>alert("source")</script>'
        spec_path = self.output / "walkthrough.json"
        spec_path.write_text(json.dumps(self.spec))
        target = self.output / "index.html"
        build(spec_path,self.repo,target)
        document = target.read_text()
        self.assertNotIn('</script><script>alert("source")',document)
        self.assertIn('\\u003c/script>',document)
        self.assertIn('.code-lines .k {',document)
        self.assertIn(':root[data-theme=dark] .code-lines .k {',document)
        self.assertNotIn("['.code-lines",document)
        prepared = prepare(deepcopy(self.spec),self.repo,self.output)
        self.assertEqual(prepared["scenarios"][0]["steps"][-1]["state"]["total"],285)
        self.assertEqual(prepared["scenarios"][1]["steps"][-1]["state"]["total"],240)
        self.assertEqual(prepared["scenarios"][0]["steps"][0]["state"]["accepted"],[])

    def test_stale_source_rejected(self):
        with (self.repo / "workflow.py").open("a") as f:
            f.write("\n# changed after execution\n")
        with self.assertRaisesRegex(ValueError,"differs from checkpoint"):
            prepare(self.spec,self.repo,self.output)

    def test_bad_source_range_and_focus(self):
        for field,value in [("end",999),("focus",[1])]:
            spec=deepcopy(self.spec)
            spec["scenarios"][0]["steps"][0]["sources"][0][field]=value
            with self.assertRaises(ValueError):
                prepare(spec,self.repo,self.output)

    def test_unsafe_source_and_trace_paths(self):
        for target in ("source","trace"):
            spec=deepcopy(self.spec)
            step=spec["scenarios"][0]["steps"][0]
            if target=="source": step["sources"][0]["path"]="../output/valid.jsonl"
            else: step["evidence"]["record"]["path"]="../repo/workflow.py"
            with self.assertRaisesRegex(ValueError,"inside"):
                prepare(spec,self.repo,self.output)

    def test_unknown_causal_predecessor(self):
        self.spec["scenarios"][0]["steps"][0]["causes"]=["done"]
        with self.assertRaisesRegex(ValueError,"causal"):
            prepare(self.spec,self.repo,self.output)

    def test_checkpoint_must_be_unique(self):
        path=self.output / "valid.jsonl"
        with path.open("a") as stream: stream.write(path.read_text().splitlines()[0]+"\n")
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            prepare(self.spec,self.repo,self.output)

    def test_pointer_semantics_and_invalid_array_index(self):
        self.assertEqual(pointer({"a/b":{"~key":[4]}},"/a~1b/~0key/0"),4)
        for path in ("/-1","/01","/~2"):
            with self.assertRaises(ValueError): pointer([3,4],path)

    def test_inferred_state_and_invalid_pointer(self):
        step=self.spec["scenarios"][0]["steps"][0]
        step["evidence"]={"kind":"inferred","detail":"Source inspection only"}
        step["phase"]="inferred"
        step["state"]={"items":[]}
        step["visuals"]=[{"type":"queue","title":"Items","path":"/items"}]
        step["watch"]=[]
        prepare(deepcopy(self.spec),self.repo,self.output)
        step["visuals"][0]["path"]="/missing"
        with self.assertRaisesRegex(ValueError,"start: missing JSON pointer '/missing'"):
            prepare(self.spec,self.repo,self.output)

    def test_bars_require_numbers_and_watch_line_must_be_displayed(self):
        step=self.spec["scenarios"][0]["steps"][1]
        self.assertEqual([v["type"] for v in step["visuals"]][-1],"bars")
        self.assertEqual(step["watch"][0]["line"],15)
        prepare(deepcopy(self.spec),self.repo,self.output)
        spec=deepcopy(self.spec)
        spec["scenarios"][0]["steps"][1]["watch"][0]["line"]=2
        with self.assertRaisesRegex(ValueError,"Watch line outside"):
            prepare(spec,self.repo,self.output)
        spec=deepcopy(self.spec)
        spec["scenarios"][0]["steps"][1]["visuals"][-1]["path"]="/current"
        with self.assertRaisesRegex(ValueError,"Bars require"):
            prepare(spec,self.repo,self.output)

    def test_capture_is_immutable_and_does_not_coerce_objects(self):
        path=self.output / "capture.jsonl"
        state={"items":[]}
        record(path,"one",state,repo=self.repo,sources=["workflow.py"])
        state["items"].append("later")
        self.assertEqual(json.loads(path.read_text())["state"]["items"],[])
        with self.assertRaises(TypeError):
            record(path,"bad",{"object":object()},repo=self.repo,sources=["workflow.py"])


if __name__ == "__main__":
    unittest.main()
