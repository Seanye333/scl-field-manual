/* Re-inlines engine/{vm,scenes,labs}.js into index.html.
   index.html is self-contained by design (it is served as a single file), so
   the engine modules exist twice: here as the maintained, testable source, and
   inlined in the page. Run this after changing any of them, then check.js to
   confirm, then the test suites.

   Note: the browser-only UI code (playground widgets, drill deck, dashboard)
   lives in index.html only — it is DOM-coupled and has no standalone module. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const pagePath = path.join(root, "index.html");

const TAIL = '})(typeof window !== "undefined" ? window : globalThis);';
const MODULES = [
  ["vm.js", "/* SCL playground VM"],
  ["scenes.js", "/* SCL Field Manual — lab scene physics"],
  ["labs.js", "/* SCL Field Manual — graded labs"],
];

let page = fs.readFileSync(pagePath, "utf8");
let changed = 0;

for (const [file, head] of MODULES) {
  const srcText = fs.readFileSync(path.join(__dirname, file), "utf8");
  const a = srcText.indexOf(head);
  const b = srcText.lastIndexOf(TAIL);
  if (a < 0 || b < 0) { console.error(`cannot find module bounds in ${file}`); process.exit(1); }
  const want = srcText.slice(a, b + TAIL.length);

  const pa = page.indexOf(head);
  if (pa < 0) { console.error(`no inlined copy of ${file} in index.html`); process.exit(1); }
  const pb = page.indexOf(TAIL, pa);
  const got = page.slice(pa, pb + TAIL.length);

  if (got === want) { console.log(`ok      ${file} already current`); continue; }
  page = page.slice(0, pa) + want + page.slice(pb + TAIL.length);
  console.log(`inlined ${file}`);
  changed++;
}

if (changed) {
  fs.writeFileSync(pagePath, page);
  console.log(`\n${changed} module(s) re-inlined into index.html`);
} else {
  console.log("\nnothing to do");
}
