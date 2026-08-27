# SCL Field Manual

A practical, single-page course in Structured Control Language (SCL) for Siemens TIA Portal, targeting S7-1200/1500 PLCs.

**Live site:** https://seanye333.github.io/scl-field-manual/

- **27 chapters** in seven parts — foundations, the language, data and patterns, systems, a two-part pattern cookbook, a complete worked plant (spec → architecture → implementation → commissioning), and mastery material.
- **The Playground** — an in-browser SCL scan-cycle simulator with **6 graded labs** on animated machines: a train with doors, buffer stops and a level crossing, and single- and dual-pump tanks including a mid-run pump failure.
- **Self-check quizzes** in every core chapter, a scored **26-question final exam**, and a **spaced-repetition drill deck** for syntax recall.
- **Exercises with fold-out solutions**, a printable quick-reference card, full-text search, a light/dark theme toggle, and per-chapter progress tracking (all stored locally in the browser).
- **`src/`** — every block from the manual as TIA-importable external source files (see `src/README.md`).
- **`engine/`** — the maintained sources for the playground VM, machine physics and lab grader, with their test suites (see `engine/README.md`).

## Working on it

```sh
node engine/vm.test.js && node engine/labs.test.js && node engine/wash.test.js
node engine/check.js     # engine/ vs the copies inlined in index.html
```

Open `index.html` directly, or view the published page above.
