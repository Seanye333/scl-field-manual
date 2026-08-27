# SCL Field Manual

A self-paced programme in Structured Control Language (SCL) for Siemens TIA Portal, targeting S7-1200/1500 PLCs.

**Live site:** https://seanye333.github.io/scl-field-manual/

- **A dashboard** — seven modules, 41 milestones, unified progress across chapters, checkpoints, labs and the exam, with a resume-where-you-left-off action and a printable personal study record.
- **27 chapters** in seven parts — foundations, the language, data and patterns, systems, a two-part pattern cookbook, a complete worked plant (spec → architecture → implementation → commissioning), and mastery material.
- **7 module checkpoints** (four questions each, three to pass) plus per-chapter quizzes and a scored **26-question final exam**.
- **The Playground** — an in-browser SCL scan-cycle simulator with **6 graded labs** on animated machines: a train with doors, buffer stops and a level crossing, and single- and dual-pump tanks including a mid-run pump failure.
- **A spaced-repetition drill deck** (43 cards) for syntax recall, plus exercises with fold-out solutions, a printable quick-reference card, full-text search and a light/dark theme toggle.
- **`src/`** — every block from the manual as TIA-importable external source files (see `src/README.md`).
- **`engine/`** — the maintained sources for the playground VM, machine physics and lab grader, with tests (see `engine/README.md`).

All progress is stored in the reader's own browser. Nothing is uploaded anywhere, and the study record is self-issued — it is not a qualification or a certification.

## Working on it

```sh
node engine/vm.test.js && node engine/labs.test.js && node engine/wash.test.js
node engine/check.js         # engine/ vs the copies inlined in index.html
node engine/consistency.js   # chapter numbering, module map, links, counts
node engine/smoke.js         # renders the page in headless Chrome and checks it
```
