# Code Walkthrough Skill

Create an interactive, step-by-step dry run of a codebase or feature, then check your understanding with a quiz. The dashboard puts highlighted source code beside the changing values from a synthetic example and explains every focused line with the values this run produced. The finished HTML works offline.

The page has three sections:

- **Overview**: a summary, scenario cards with progress, a codebase map, a chapter-by-chapter learning path, key concepts, and coverage and limits.
- **Walkthrough**: a chapter/step outline, source with numbered line notes, inline values and a call stack, and a dry-run panel. The panel covers the step story, the branch taken, a line-by-line explanation, a board showing entities moving between collections, and "under the hood" insights (why, gotchas, performance, edge cases).
- **Quiz**: multiple-choice, fill-in-the-blank (answers can be bound to captured checkpoint values), complete-the-real-code, and put-in-order questions. It covers recall, trace, reason and apply levels, explains every answer, and links back to the steps that teach it.

It also supports branches, loops, retries, concurrent lanes, source-hash-checked checkpoints, keyboard navigation, deep links, and light and dark themes.

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
$code-walkthrough Explain the checkout flow with a visual dry run using synthetic data. Show the happy path, a validation failure, and what each step changes, line by line. End with a quiz.
```

For a whole repository, ask for its main runtime paths and name any areas you especially want explained. The skill guides Codex through reading the repository, running bounded examples, recording selected values, and building the dashboard. The renderer does not infer a complete execution trace from source files by itself.

Every step carries an evidence label, so `observed`, `mocked`, `replayed`, and `inferred` states remain distinguishable. Source hashes, line references and quiz answers are checked when the page is built. The builder also warns when a walkthrough is shallow: steps without line notes, crowded visuals, chapters without insights, or a thin quiz. Add `--strict` to fail on those warnings.

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

See [SKILL.md](SKILL.md) for the full workflow and [references](references/) for repository analysis, execution capture, teaching depth, quiz design, and the walkthrough data format.
