/* Headless browser smoke test: renders index.html in Chrome with seeded
   progress and asserts the page actually works.

   This exists because the static checks cannot see a JavaScript exception or
   two counters disagreeing — the sidebar once said "11 / 28 chapters" while
   the dashboard said 11 / 27, and only a rendered page showed it.

   Requires Google Chrome; skips (exit 0) if it is not installed. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
  console.log("skip — no Chrome/Chromium found; static checks only");
  process.exit(0);
}

/* Seed: 11 chapters read, 2 checkpoints passed (one failed), 3 labs, exam 19.
   Expected completion = (11 + 2 + 3 + 0) / 43 = 37%. */
const SEED = `<script>
try{
 localStorage.clear();
 var p={};for(var i=1;i<=11;i++)p["ch"+i]=true;
 localStorage.setItem("sclfm-progress",JSON.stringify(p));
 localStorage.setItem("sclfm-checkpoints",JSON.stringify({
   1:{taken:true,score:4,total:4,passed:true},
   2:{taken:true,score:3,total:4,passed:true},
   3:{taken:true,score:2,total:4,passed:false}}));
 localStorage.setItem("sclfm-labs",JSON.stringify({guard:true,tanklevel:true,station:true}));
 localStorage.setItem("sclfm-exambest","19");
}catch(e){}
</script>`;

const page = fs.readFileSync(path.join(root, "index.html"), "utf8");
const tmp = path.join(os.tmpdir(), "sclfm-smoke-" + process.pid + ".html");
fs.writeFileSync(tmp, page.replace("<body>", "<body>\n" + SEED, 1));

let dom = "";
try {
  dom = execFileSync(chrome, [
    "--headless", "--disable-gpu", "--no-sandbox",
    "--virtual-time-budget=5000", "--dump-dom", "file://" + tmp,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
} finally {
  fs.unlinkSync(tmp);
}

/* Strip inlined scripts: their source contains template fragments that look
   like rendered markup and would make every assertion below meaningless. */
const rendered = dom.replace(/<script>[\s\S]*?<\/script>/g, "");

let bad = 0;
function check(name, cond, detail) {
  if (cond) console.log("ok   " + name);
  else { console.log("FAIL " + name + " :: " + detail); bad++; }
}
function text(id) {
  const m = rendered.match(new RegExp('id="' + id + '"[^>]*>([^<]*)'));
  return m ? m[1].trim() : null;
}

check("page rendered", rendered.length > 10000, "dom was " + rendered.length + " bytes");

/* --- the dashboard actually computed --- */
check("completion ring shows the expected percentage", text("ring-pct") === "37%",
  "ring shows " + text("ring-pct") + ", expected 37%");
check("chapters read counted", text("stat-ch") === "11 / 27", "got " + text("stat-ch"));
check("checkpoints counted (only passes)", text("stat-cp") === "2 / 7", "got " + text("stat-cp"));
check("labs counted", text("stat-lab") === "3 / 8", "got " + text("stat-lab"));
check("exam best shown", text("stat-exam") === "19 / 26", "got " + text("stat-exam"));

const resume = (rendered.match(/class="pg-btn" href="#(ch\d+)"/) || [])[1];
check("resume points at the first unread chapter", resume === "ch12",
  "resume points at " + resume + ", expected ch12");

const cards = (rendered.match(/class="module[ "]/g) || []).length;
check("one card per module", cards === 7, cards + " module cards rendered");

/* --- the counters must agree with each other --- */
const sidebar = (rendered.match(/id="progline">[^<]*?(\d+)\s*<\/b>\s*\/\s*(\d+)/) ||
                 rendered.match(/id="progline">.*?<b>(\d+)<\/b> \/ (\d+)/) || []);
if (sidebar.length) {
  check("sidebar and dashboard agree on the chapter total",
    sidebar[2] === "27" && sidebar[1] === "11",
    "sidebar reads " + sidebar[1] + " / " + sidebar[2] + ", dashboard reads " + text("stat-ch"));
} else {
  check("sidebar progress line rendered", false, "could not read #progline");
}

/* --- nothing threw: features initialised after the dashboard must be present --- */
check("copy buttons initialised", (rendered.match(/class="copy"/g) || []).length > 20,
  "found " + (rendered.match(/class="copy"/g) || []).length);
check("theme toggle initialised", /id="themebtn"[^>]*>Theme:/.test(rendered), "theme button not labelled");
check("heading anchors initialised", (rendered.match(/class="anchor"/g) || []).length > 20,
  "found " + (rendered.match(/class="anchor"/g) || []).length);
check("playground examples populated", /<option value="0">Blinker/.test(rendered), "example list empty");
check("lab picker populated", /<option value="station">/.test(rendered) ||
  /Lab 3/.test(rendered), "lab options missing");

console.log(`\n${bad ? bad + " FAILED" : "smoke test passed"}`);
process.exit(bad ? 1 : 0);
