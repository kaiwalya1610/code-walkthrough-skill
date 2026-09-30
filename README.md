# Code Walkthrough Skill

Create an interactive, step-by-step dry run of a codebase or feature. The dashboard puts highlighted source code beside the changing values from a synthetic example. It supports scenarios, branches, loops, retries, concurrent lanes, source-linked checkpoints, a codebase map, and light and dark themes. The finished HTML works offline.

## Install

Clone this repository into your Codex skills directory:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
git clone https://github.com/kaiwalya1610/code-walkthrough-skill.git "${CODEX_HOME:-$HOME/.codex}/skills/code-walkthrough"
```

If you already installed this skill from this repository, update it with:

```bash
git -C "${CODEX_HOME:-$HOME/.codex}/skills/code-walkthrough" pull --ff-only
```

If `code-walkthrough` already exists as a directory that is not a clone of this repository, preserve or move that directory before cloning. Start a new Codex chat if the skill does not appear immediately after installation.

## Use

From the codebase you want to explain, ask Codex:

```text
$code-walkthrough Explain the checkout flow with a visual dry run using synthetic data. Show the happy path, a validation failure, and what each step changes.
```

For a whole repository, ask for its main runtime paths and name any areas you especially want explained. The skill guides Codex through reading the repository, running bounded examples, recording selected values, and building the dashboard. The renderer does not infer a complete execution trace from source files by itself.

The generated page has a source panel, a visual state panel, chapter and step controls, a workflow map, and an evidence label on every step. `observed`, `mocked`, `replayed`, and `inferred` states remain distinguishable. Source hashes and line references are checked when the page is built.

## Build an example manually

The skill includes a small executable example. Python 3.10+ and [uv](https://docs.astral.sh/uv/) are required for these commands; `uv` installs the builder's Python dependencies in an isolated cache.

```bash
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/code-walkthrough"
python3 "$SKILL_DIR/assets/example/make_demo.py" --out /tmp/code-walkthrough-example
uv run "$SKILL_DIR/scripts/build_walkthrough.py" /tmp/code-walkthrough-example/walkthrough.json \
  --repo "$SKILL_DIR/assets/example" \
  --out /tmp/code-walkthrough-example/index.html
```

Open `/tmp/code-walkthrough-example/index.html` in a browser. No server, CDN, or network connection is needed to view the generated page. The [format reference](references/walkthrough-format.md) describes the manifest and checkpoint files if you want to author them directly.

## Verify the skill

```bash
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/code-walkthrough"
uv run --with Pygments --with jsonschema python "$SKILL_DIR/tests/test_builder.py"
```

The optional browser test uses Playwright and its Chromium browser:

```bash
node "$SKILL_DIR/tests/browser_smoke.mjs" /tmp/code-walkthrough-example/index.html
```

See [SKILL.md](SKILL.md) for the full workflow and [references](references/) for repository analysis, execution capture, and the walkthrough data format.
