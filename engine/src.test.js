/* Runs the companion source files in src/ through the lab grader.

   The other suites test logic that is typed into the page. These test the
   files Sean actually imports into TIA Portal — so a block can't drift away
   from the lab it claims to solve while everything else still goes green.

   The playground VM speaks a flat subset: no FUNCTION_BLOCK wrapper, no '#'
   prefixes. Translation below is mechanical and deliberately dumb; anything
   beyond stripping the wrapper and renaming the two generic port names is
   listed explicitly, so the test can never quietly "fix" a broken file. */
const fs = require("fs");
const path = require("path");
const VM = require("./vm.js");
const Scenes = require("./scenes.js");
const Labs = require("./labs.js");

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + " :: " + (e && e.message ? e.message : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || "assert"); }
function report(r) {
  if (r.error) return "ERROR: " + r.error;
  return r.results.map(x => (x.pass ? "✓" : "✗") + " " + x.label + (x.msg ? " — " + x.msg : "")).join(" | ");
}

function flatten(file, renames) {
  let src = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
  src = src
    .replace(/^FUNCTION_BLOCK\s+"[^"]+"\s*$/m, "")
    .replace(/^\{[^}]*\}\s*$/m, "")
    .replace(/^END_FUNCTION_BLOCK\s*$/m, "")
    // Only the variable-reference '#'. A naive strip also eats the one in
    // T#18s and turns a Time literal into an identifier.
    .replace(/(?<![A-Za-z0-9_])#/g, "");
  for (const [from, to] of renames || [])
    src = src.replace(new RegExp("\\b" + from + "\\b", "g"), to);
  return src;
}

function grade(labId, src) {
  const lab = Labs.labs.find(l => l.id === labId);
  return Labs.runLab(lab, src, VM, Scenes);
}

/* FB_HeaterPI uses the generic port names a reusable loop should have; the lab
   scene wires up temp/pwr. Only those two names are mapped. */
T("src/solutions/FB_HeaterPI.scl passes Lab 7", () => {
  const r = grade("heater", flatten("solutions/FB_HeaterPI.scl", [["pv", "temp"], ["out", "pwr"]]));
  assert(!r.error, report(r));
  assert(r.passed, report(r));
});

T("src/solutions/FB_HeaterPI.scl really holds the anti-windup guard", () => {
  /* Delete the guard and the same file must overshoot — proof the passing run
     above came from that line and not from gentle gains. */
  const withGuard = flatten("solutions/FB_HeaterPI.scl", [["pv", "temp"], ["out", "pwr"]]);
  const guard = "IF NOT ((raw >= outMax AND err > 0.0) OR (raw <= outMin AND err < 0.0)) THEN";
  assert(withGuard.includes(guard), "the anti-windup guard is no longer in the file");
  const r = grade("heater", withGuard.replace(guard, "IF TRUE THEN"));
  assert(!r.error, report(r));
  const over = r.results.find(x => /overshoot/.test(x.label));
  assert(over && !over.pass, "without the guard the file should overshoot: " + report(r));
});

T("src/solutions/FB_ConveyorJam.scl passes Lab 8", () => {
  const r = grade("conveyor", flatten("solutions/FB_ConveyorJam.scl"));
  assert(!r.error, report(r));
  assert(r.passed, report(r));
});

T("src/solutions/FB_ConveyorJam.scl really latches its alarm", () => {
  const src = flatten("solutions/FB_ConveyorJam.scl");
  const latch = "IF tTravel.Q THEN\n        alarmJam := TRUE;\n    END_IF;";
  assert(src.includes(latch), "the latch is no longer shaped as expected");
  const r = grade("conveyor", src.replace(latch, "alarmJam := tTravel.Q;"));
  assert(!r.error, report(r));
  const lat = r.results.find(x => /latches/.test(x.label));
  assert(lat && !lat.pass, "assigned live, the alarm should fail the latch check: " + report(r));
});

T("every .scl in src/ still carries the optimized-access pragma", () => {
  const dirs = ["src", "src/solutions"];
  const missing = [];
  for (const d of dirs)
    for (const f of fs.readdirSync(path.join(__dirname, "..", d)))
      if (f.endsWith(".scl")) {
        const t = fs.readFileSync(path.join(__dirname, "..", d, f), "utf8");
        if (/^(FUNCTION_BLOCK|FUNCTION)\b/m.test(t) && !/S7_Optimized_Access/.test(t))
          missing.push(d + "/" + f);
      }
  assert(missing.length === 0, "missing the pragma: " + missing.join(", "));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
