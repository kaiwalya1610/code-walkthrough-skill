# Quiz design

Every walkthrough ends with a quiz that checks understanding of **this run of this code**, not general trivia. Each question links back to the steps that explain it, so a wrong answer is one click from the relevant source and values.

## Structure

- **6–15 questions.** Roughly one or two per chapter, more for dense chapters.
- **Cover every chapter.** A question covers a chapter through its `chapter` field or through a `refs` step in that chapter. The builder warns about uncovered chapters.
- **Mix formats.** Include at least one multiple-choice (`mcq`), one fill-in-the-blank (`fill` or `code-fill`) and one ordering question (`order`).
- **Climb the levels.** Order questions from setup to result, and from recall towards apply.

| Level | Asks the reader to | Target share | Good formats |
|---|---|---|---|
| `recall` | Remember what a line or function does | ~20% | `code-fill`, `fill`, `mcq` |
| `trace` | Predict a value the run produced at a named step | ~40% | `fill` bound to a checkpoint, `mcq`, `order` |
| `reason` | Explain why the code behaved that way (branch, copy vs reference, ordering) | ~25% | `mcq` |
| `apply` | Transfer the logic to an input the run did not use | ~15% | `mcq` |

## Question types

All questions need `id`, `type`, `level`, `prompt`, `explanation` and at least one `refs` entry (`{"scenario", "step"}`). Optional fields: `chapter`, and a display-only `source` snippet (`path`, `start`, `end`, optional `focus`) for `mcq`, `fill` and `order`.

**`mcq`**: `choices` (2–6 strings) and `answer` (an index, or an array of indexes for "select all that apply"; the prompt should say so). Choices are shown in authored order, so vary where the correct one sits.

**`fill`**: put `___` (three or more underscores) in the `prompt` for each blank, and give `blanks` in the same order. Each blank has `answers` (accepted strings), or `from: {"scenario", "step", "path"}`, which binds it to a scalar in that step's checkpoint. Prefer `from` for trace questions: the builder reads the answer from captured state, so it cannot drift from the run, and the feedback tells the reader where it came from. Matching ignores case, surrounding quotes and extra whitespace, and treats equal numbers (`240` and `240.0`) as the same. Optional: `hint`, `caseSensitive`.

**`code-fill`**: `source` (`path`, `start`, `end`) plus `blanks` of `{"line", "text"}`. `text` must appear on that line of the real file. The builder cuts it out and the reader types it back. Whitespace is ignored and case matters by default. Add `answers` for equivalent alternatives and a `hint` per blank. Hide the tokens that carry the logic (operators, method names, conditions), not names the reader can't infer.

**`order`**: `items` (3–8 strings) in the **correct** order. The dashboard shuffles them, and readers drag or use arrow buttons. Use it for execution order, data-flow stages or retry sequences, where the order is the lesson.

## Writing good questions

- Ground every answer in a checkpoint or the source. If an `apply` answer is derived by reading code rather than running it, say so in the `explanation`.
- Write distractors from real misconceptions: the before-vs-after snapshot, the other branch, off-by-one indexing, assuming a copy when it's a reference, the order two callbacks fire.
- Explanations teach. State the rule and the concrete values ("`0 > 0` is False, so…"), not only "B is correct".
- Avoid trick wording, double negatives, "all of the above", and questions answerable from names alone.
- Use backticks for identifiers. Concept popovers are not shown inside quiz answers, so don't rely on them.

## Example

```json
"quiz": {
  "title": "Check your understanding",
  "intro": "Trace questions use captured values; apply questions ask about a new input.",
  "passScore": 0.7,
  "questions": [
    {"id": "mixed-final", "type": "fill", "level": "trace",
     "prompt": "In “A rejected quantity”, the function returns a total of ___ rupees.",
     "blanks": [{"from": {"scenario": "mixed", "step": "done", "path": "/total"}, "hint": "Only tea is accepted."}],
     "explanation": "bread has quantity 0, so only tea's 240 counts.",
     "refs": [{"scenario": "mixed", "step": "done"}]},
    {"id": "complete-loop", "type": "code-fill", "level": "recall",
     "prompt": "Fill in the missing code in the loop body.",
     "source": {"path": "workflow.py", "start": 9, "end": 17},
     "blanks": [{"line": 11, "text": "> 0", "hint": "Which quantities are valid?"}],
     "explanation": "`> 0` rejects zero and negative quantities.",
     "refs": [{"scenario": "valid", "step": "check-1"}]}
  ]
}
```

## What the builder checks

Unknown scenario/step refs, choice indexes out of range, duplicate choices or items, `___` count mismatches, `from` paths that are missing or not scalar, `code-fill` text that isn't on the stated line, and fields used with the wrong type. Readers' best full-quiz score is kept in their own browser only.
