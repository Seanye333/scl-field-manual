/* Reports drift between engine/*.js and the copies inlined in index.html. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "index.html"), "utf8");

const TAIL = '})(typeof window !== "undefined" ? window : globalThis);';
let bad = 0;

for (const [file, head] of [
  ["vm.js", "/* SCL playground VM"],
  ["scenes.js", "/* SCL Field Manual — lab scene physics"],
  ["labs.js", "/* SCL Field Manual — graded labs"],
]) {
  const srcText = fs.readFileSync(path.join(__dirname, file), "utf8");
  const a = srcText.indexOf(head);
  const b = srcText.lastIndexOf(TAIL);
  const want = srcText.slice(a, b + TAIL.length).trim();
  const pa = page.indexOf(head);
  if (pa < 0) { console.log(`MISSING in index.html: ${file}`); bad++; continue; }
  const pb = page.indexOf(TAIL, pa);
  const got = page.slice(pa, pb + TAIL.length).trim();
  if (got !== want) {
    console.log(`DRIFT: ${file} differs from the copy inlined in index.html`);
    bad++;
  } else {
    console.log(`ok   ${file} matches index.html`);
  }
}
process.exit(bad ? 1 : 0);
