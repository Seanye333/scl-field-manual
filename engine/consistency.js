/* Structural integrity checks for index.html.
   Catches the bug class that silent hardcoded counts create: a dashboard that
   says "27 chapters" after someone adds a 28th, a module map with a gap in it,
   or a link pointing at an anchor that no longer exists. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "index.html"), "utf8");
const Labs = require("./labs.js");

let bad = 0;
function ok(name) { console.log("ok   " + name); }
function fail(name, detail) { console.log("FAIL " + name + " :: " + detail); bad++; }
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }

/* ---- chapters ---- */
const chapterIds = [...page.matchAll(/<section class="ch" id="ch(\d+)">/g)].map(m => +m[1]);
const sorted = [...chapterIds].sort((a, b) => a - b);
const contiguous = sorted.every((n, i) => n === i + 1);
check("chapters are ch1..chN with no gaps or duplicates", contiguous,
  "got " + JSON.stringify(sorted));
const N_CH = sorted.length;

/* ---- dashboard counts match reality ---- */
const totCh = +(page.match(/TOTAL_CH = (\d+)/) || [])[1];
const totCp = +(page.match(/TOTAL_CP = (\d+)/) || [])[1];
const totLab = +(page.match(/TOTAL_LAB = (\d+)/) || [])[1];
const cpBlocks = (page.match(/class="quiz checkpoint"/g) || []).length;

check("dashboard TOTAL_CH matches the chapters present", totCh === N_CH,
  `dashboard says ${totCh}, page has ${N_CH}`);
check("dashboard TOTAL_CP matches the checkpoint blocks present", totCp === cpBlocks,
  `dashboard says ${totCp}, page has ${cpBlocks}`);
check("dashboard TOTAL_LAB matches engine/labs.js", totLab === Labs.labs.length,
  `dashboard says ${totLab}, engine defines ${Labs.labs.length}`);

/* ---- module map covers every chapter exactly once ---- */
const partsBlock = page.slice(page.indexOf("var PARTS = ["), page.indexOf("var TOTAL_CH"));
const chLists = [...partsBlock.matchAll(/chs: \[([\d, ]+)\]/g)]
  .map(m => m[1].split(",").map(s => +s.trim()));
const covered = chLists.flat();
const uniq = new Set(covered);
check("module map covers every chapter exactly once",
  covered.length === uniq.size && uniq.size === N_CH &&
  [...uniq].sort((a, b) => a - b).every((n, i) => n === i + 1),
  `covers ${covered.length} entries (${uniq.size} unique) for ${N_CH} chapters`);

/* ---- every checkpoint referenced by the modules exists ---- */
const cpIds = [...page.matchAll(/class="quiz checkpoint" id="cp(\d+)"/g)].map(m => +m[1]);
const cpRefs = [...partsBlock.matchAll(/cp: (\d+)/g)].map(m => +m[1]);
check("every module's checkpoint exists on the page",
  cpRefs.every(id => cpIds.includes(id)),
  `modules reference ${JSON.stringify(cpRefs)}, page has ${JSON.stringify(cpIds)}`);

/* ---- every internal anchor resolves ----
   Markup only: script bodies build hrefs by concatenation, and matching those
   would report JavaScript fragments as broken links. */
const markup = page.replace(/<script>[\s\S]*?<\/script>/g, "");
const anchors = new Set([...page.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const hrefs = [...markup.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
const dangling = [...new Set(hrefs)].filter(h => !anchors.has(h));
check("every internal link in the markup resolves to an id", dangling.length === 0,
  "dangling: " + dangling.join(", "));

/* ---- exam length matches what the UI claims ---- */
const examBlock = page.slice(page.indexOf('<div class="quiz" id="exam">'));
const examEnd = examBlock.indexOf("</section>");
const examQs = (examBlock.slice(0, examEnd).match(/<div class="q">/g) || []).length;
const claimed = +(page.match(/id="exam-score">0 \/ (\d+)</) || [])[1];
check("final exam question count matches the score display", examQs === claimed,
  `${examQs} questions, display says ${claimed}`);

/* ---- checkpoints are answerable: each question has exactly one correct option ---- */
let cpQ = 0, cpBadQ = 0;
for (const m of page.matchAll(/<div class="quiz checkpoint"[\s\S]*?<div class="cp-foot">/g)) {
  for (const q of m[0].matchAll(/<div class="opts">([\s\S]*?)<\/div>/g)) {
    cpQ++;
    const oks = (q[1].match(/data-ok/g) || []).length;
    if (oks !== 1) cpBadQ++;
  }
}
check("every checkpoint question has exactly one correct answer", cpBadQ === 0,
  `${cpBadQ} of ${cpQ} questions malformed`);
check("checkpoints carry the expected number of questions", cpQ === cpBlocks * 4,
  `${cpQ} questions across ${cpBlocks} checkpoints`);

console.log(`\n${bad ? bad + " FAILED" : "all consistency checks passed"}`);
process.exit(bad ? 1 : 0);
