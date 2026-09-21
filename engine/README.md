# Playground engine

The logic behind the site's Playground and graded labs, kept here as plain,
testable modules:

| File | What it is |
|---|---|
| `vm.js` | SCL tokenizer, parser and scan-cycle runtime (the teaching subset) |
| `scenes.js` | Machine physics — train (doors, buffers, level crossing), tanks, oven, conveyor |
| `labs.js` | Lab definitions and the headless grader |

## Tests

```sh
node engine/vm.test.js       # language semantics
node engine/labs.test.js     # scenes + grading, incl. deliberately-wrong solutions
node engine/wash.test.js     # verifies the Chapter 21 WASH-3 logic and its claims
node engine/src.test.js      # runs the companion blocks in src/ through the graders
node engine/consistency.js   # chapter numbering, module map, link targets, counts
node engine/smoke.js         # renders index.html in headless Chrome and checks it
```

All of these must pass before publishing. `consistency.js` guards the counts the
dashboard hardcodes (chapters, checkpoints, labs) against what the page actually
contains; `smoke.js` catches what static analysis cannot — a JavaScript exception
on load, or two counters disagreeing (the sidebar once read "11 / 28 chapters"
while the dashboard read 11 / 27). `wash.test.js` is the reason Chapter 21
teaches an edge-triggered pass transition rather than a level test: the level
version silently collapses three passes into one scan when consecutive passes
share a direction, and neither a `stepOld` nor a `passOld` comparison can fix it
from inside the CASE. `src.test.js` grades the files in `src/solutions/` with the
same graders the site uses, each alongside a negative control that deletes the one
line the block turns on — so a companion source cannot drift away from the lab it
claims to solve while every other suite still goes green.

## Relationship to index.html

`index.html` is self-contained — it carries an inlined copy of `vm.js`,
`scenes.js` and `labs.js` in `<script>` blocks. These files are the maintained
source. After changing one:

```sh
node engine/inline.js       # copy engine/*.js into index.html
node engine/check.js        # confirm no drift remains
```

The browser-only UI code — playground widgets, drill deck, dashboard — lives in
`index.html` only. It is DOM-coupled with no standalone module, so `smoke.js` is
what covers it.
