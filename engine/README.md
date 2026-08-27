# Playground engine

The logic behind the site's Playground and graded labs, kept here as plain,
testable modules:

| File | What it is |
|---|---|
| `vm.js` | SCL tokenizer, parser and scan-cycle runtime (the teaching subset) |
| `scenes.js` | Machine physics — train (doors, buffers, level crossing) and tanks |
| `labs.js` | Lab definitions and the headless grader |

## Tests

```sh
node engine/vm.test.js      # language semantics
node engine/labs.test.js    # scenes + grading, incl. deliberately-wrong solutions
node engine/wash.test.js    # verifies the Chapter 21 WASH-3 logic and its claims
```

All three must pass before publishing. `wash.test.js` is the reason Chapter 21
teaches an edge-triggered pass transition rather than a level test: the level
version silently collapses three passes into one scan when consecutive passes
share a direction, and neither a `stepOld` nor a `passOld` comparison can fix it
from inside the CASE.

## Relationship to index.html

`index.html` is self-contained — it carries an inlined copy of `vm.js`,
`scenes.js` and `labs.js` in `<script>` blocks, in that order. These files are
the maintained source. After changing one, re-inline it and confirm the page
still parses:

```sh
node engine/check.js        # reports any drift between engine/ and index.html
```
