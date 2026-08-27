const VM = require("./vm.js");
const Scenes = require("./scenes.js");
const Labs = require("./labs.js");

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + " :: " + (e && e.message ? e.message : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || "assert"); }
function lab(id) { return Labs.labs.find(l => l.id === id); }
function grade(id, src) { return Labs.runLab(lab(id), src, VM, Scenes); }
function report(r) {
  if (r.error) return "ERROR: " + r.error;
  return r.results.map(x => (x.pass ? "✓" : "✗") + " " + x.label + (x.msg ? " — " + x.msg : "")).join(" | ");
}

/* ---------------- reference solutions ---------------- */
const REF_GUARD = `
VAR_INPUT
    cmdRun : Bool;
END_VAR
VAR_OUTPUT
    pumpOn : Bool;
END_VAR
VAR
    tCool  : TOF;
END_VAR
BEGIN
tCool(IN := pumpOn, PT := T#10s);
pumpOn := cmdRun AND (pumpOn OR NOT tCool.Q);
`;

const REF_TANK = `
VAR_INPUT
    level     : Real;
    levelLow  : Bool;
    levelHigh : Bool;
END_VAR
VAR_OUTPUT
    pump      : Bool;
END_VAR
BEGIN
IF level < 0.6 THEN pump := TRUE;  END_IF;
IF level > 1.4 THEN pump := FALSE; END_IF;
`;

const REF_STATION = `
VAR_INPUT
    atA : Bool; atB : Bool;
    doorsClosed : Bool; doorsOpen : Bool;
    btnGo : Bool; speed : Real;
END_VAR
VAR_OUTPUT
    driveFwd : Bool; driveRev : Bool; doorsCmd : Bool;
END_VAR
VAR
    step : Int; stepOld : Int; tDwell : TON; trigGo : R_TRIG;
END_VAR
BEGIN
trigGo(CLK := btnGo);
CASE step OF
    0:  IF trigGo.Q THEN step := 10; END_IF;
    10: IF atB THEN step := 20; END_IF;
    20: IF ABS(speed) < 0.05 THEN step := 30; END_IF;
    30: IF doorsOpen THEN step := 40; END_IF;
    40: IF tDwell.Q THEN step := 50; END_IF;
    50: IF doorsClosed THEN step := 60; END_IF;
    60: ;
    ELSE step := 0;
END_CASE;
tDwell(IN := (step = stepOld) AND (step = 40), PT := T#5s);
stepOld := step;
driveFwd := step = 10;
driveRev := FALSE;
doorsCmd := (step = 30) OR (step = 40);
`;

const REF_SHUTTLE = `
VAR_INPUT
    atA : Bool; atB : Bool;
    doorsClosed : Bool; doorsOpen : Bool;
    btnGo : Bool; speed : Real;
END_VAR
VAR_OUTPUT
    driveFwd : Bool; driveRev : Bool; doorsCmd : Bool;
END_VAR
VAR
    step : Int; stepOld : Int; tDwell : TON;
END_VAR
BEGIN
CASE step OF
    0:   step := 10;
    10:  IF atB THEN step := 20; END_IF;          // forward leg
    20:  IF ABS(speed) < 0.05 THEN step := 30; END_IF;
    30:  IF doorsOpen THEN step := 40; END_IF;
    40:  IF tDwell.Q THEN step := 50; END_IF;
    50:  IF doorsClosed THEN step := 60; END_IF;
    60:  IF atA THEN step := 70; END_IF;          // return leg
    70:  IF ABS(speed) < 0.05 THEN step := 80; END_IF;
    80:  IF doorsOpen THEN step := 90; END_IF;
    90:  IF tDwell.Q THEN step := 100; END_IF;
    100: IF doorsClosed THEN step := 10; END_IF;
    ELSE step := 0;
END_CASE;
tDwell(IN := (step = stepOld) AND ((step = 40) OR (step = 90)),
       PT := T#4s);
stepOld := step;
driveFwd := step = 10;
driveRev := step = 60;
doorsCmd := (step = 30) OR (step = 40) OR (step = 80) OR (step = 90);
`;

/* ---------------- tests ---------------- */
T("Lab guard: reference passes all checks", () => {
  const r = grade("guard", REF_GUARD);
  assert(!r.error && r.passed, report(r));
});
T("Lab guard: naive pass-through fails the lockout check", () => {
  const r = grade("guard", "VAR_INPUT cmdRun:Bool; END_VAR VAR_OUTPUT pumpOn:Bool; END_VAR BEGIN pumpOn := cmdRun;");
  assert(!r.error && !r.passed, report(r));
  const lock = r.results.find(x => /cooldown blocks/.test(x.label));
  assert(lock && !lock.pass, "lockout check should fail");
});
T("Lab guard: missing interface reported clearly", () => {
  const r = grade("guard", "VAR_OUTPUT pumpOn:Bool; END_VAR BEGIN pumpOn := TRUE;");
  assert(r.error && /cmdRun : Bool/.test(r.error), r.error || "no error");
});

T("Lab tank: reference hysteresis passes", () => {
  const r = grade("tanklevel", REF_TANK);
  assert(!r.error && r.passed, report(r));
});
T("Lab tank: single-threshold chatter fails anti-chatter check", () => {
  const r = grade("tanklevel",
    "VAR_INPUT level:Real; levelLow:Bool; levelHigh:Bool; END_VAR VAR_OUTPUT pump:Bool; END_VAR BEGIN pump := level < 1.0;");
  assert(!r.error && !r.passed, report(r));
  const ch = r.results.find(x => /chatter/i.test(x.label));
  assert(ch && !ch.pass, "chatter check should fail: " + report(r));
});
T("Lab tank: pump always on fails overfill", () => {
  const r = grade("tanklevel",
    "VAR_INPUT level:Real; levelLow:Bool; levelHigh:Bool; END_VAR VAR_OUTPUT pump:Bool; END_VAR BEGIN pump := TRUE;");
  assert(!r.error && !r.passed, report(r));
  const ov = r.results.find(x => /overfill/i.test(x.label));
  assert(ov && !ov.pass, "overfill check should fail: " + report(r));
});

T("Lab station: reference passes all checks", () => {
  const r = grade("station", REF_STATION);
  assert(!r.error && r.passed, report(r));
});
T("Lab station: full-throttle-forever crashes into the buffer", () => {
  const r = grade("station",
    REF_STATION.replace("driveFwd := step = 10;", "driveFwd := TRUE;"));
  assert(!r.error && !r.passed, report(r));
  const cr = r.results.find(x => /crash/i.test(x.label));
  assert(cr && !cr.pass, "crash check should fail: " + report(r));
});
T("Lab station: doors while moving is caught", () => {
  const r = grade("station",
    REF_STATION.replace("doorsCmd := (step = 30) OR (step = 40);", "doorsCmd := TRUE;"));
  assert(!r.error && !r.passed, report(r));
  const dv = r.results.find(x => /never move/i.test(x.label));
  assert(dv && !dv.pass, "door-safety check should fail: " + report(r));
});
T("Lab station: without stepOld the dwell still holds (single timed step) — but removing dwell fails", () => {
  const r = grade("station",
    REF_STATION.replace("40: IF tDwell.Q THEN step := 50; END_IF;", "40: step := 50;"));
  assert(!r.error && !r.passed, report(r));
  const dw = r.results.find(x => /4.5 s/.test(x.label));
  assert(dw && !dw.pass, "dwell check should fail: " + report(r));
});

T("Lab shuttle: reference passes all checks", () => {
  const r = grade("shuttle", REF_SHUTTLE);
  assert(!r.error && r.passed, report(r));
});
T("Lab shuttle: skipping the Station A door cycle is caught", () => {
  const noADoors = REF_SHUTTLE.replace(
    "70:  IF ABS(speed) < 0.05 THEN step := 80; END_IF;",
    "70:  IF ABS(speed) < 0.05 THEN step := 10; END_IF;");
  const r = grade("shuttle", noADoors);
  assert(!r.error && !r.passed, report(r));
  const a = r.results.find(x => /Station A/.test(x.label));
  assert(a && !a.pass, "A-cycle check should fail: " + report(r));
});

const REF_CROSSING = `
VAR_INPUT
    atA : Bool; atB : Bool;
    doorsClosed : Bool; doorsOpen : Bool;
    btnGo : Bool; speed : Real;
    approaching : Bool; occupied : Bool;
    gateClosed : Bool; gateOpen : Bool;
END_VAR
VAR_OUTPUT
    driveFwd : Bool; driveRev : Bool; doorsCmd : Bool;
    gateCmd : Bool; lampsCmd : Bool;
END_VAR
VAR
    step : Int; stepOld : Int; tDwell : TON; trigGo : R_TRIG;
END_VAR
BEGIN
trigGo(CLK := btnGo);
CASE step OF
    0:  IF trigGo.Q THEN step := 10; END_IF;
    10: IF atB THEN step := 20; END_IF;
    20: IF ABS(speed) < 0.05 THEN step := 30; END_IF;
    30: IF doorsOpen THEN step := 40; END_IF;
    40: IF tDwell.Q THEN step := 50; END_IF;
    50: IF doorsClosed THEN step := 60; END_IF;
    60: ;
    ELSE step := 0;
END_CASE;
tDwell(IN := (step = stepOld) AND (step = 40), PT := T#5s);
stepOld := step;
driveFwd := step = 10;
driveRev := FALSE;
doorsCmd := (step = 30) OR (step = 40);
gateCmd  := approaching OR occupied;
lampsCmd := gateCmd OR NOT gateOpen;
`;

const REF_DUTY = `
VAR_INPUT
    level : Real; levelLow : Bool; levelHigh : Bool;
    fbRunA : Bool; fbRunB : Bool;
END_VAR
VAR_OUTPUT
    pumpA : Bool; pumpB : Bool;
END_VAR
VAR
    demand : Bool; useA : Bool; faultA : Bool; faultB : Bool;
    trigDem : R_TRIG; tFA : TON; tFB : TON;
END_VAR
BEGIN
IF level < 0.6 THEN demand := TRUE;  END_IF;
IF level > 1.4 THEN demand := FALSE; END_IF;
trigDem(CLK := demand);
IF trigDem.Q THEN
    IF faultA THEN useA := FALSE;
    ELSIF faultB THEN useA := TRUE;
    ELSE useA := NOT useA;
    END_IF;
END_IF;
IF demand AND useA AND faultA THEN useA := FALSE; END_IF;
IF demand AND NOT useA AND faultB THEN useA := TRUE; END_IF;
pumpA := demand AND useA AND NOT faultA;
pumpB := demand AND NOT useA AND NOT faultB;
tFA(IN := pumpA AND NOT fbRunA, PT := T#2s);
tFB(IN := pumpB AND NOT fbRunB, PT := T#2s);
IF tFA.Q THEN faultA := TRUE; END_IF;
IF tFB.Q THEN faultB := TRUE; END_IF;
`;

T("Lab crossing: reference passes all checks", () => {
  const r = grade("crossing", REF_CROSSING);
  assert(!r.error && r.passed, report(r));
});
T("Lab crossing: no gate logic fails the crossing-violation check", () => {
  const r = grade("crossing", REF_CROSSING
    .replace("gateCmd  := approaching OR occupied;", "gateCmd  := FALSE;"));
  assert(!r.error && !r.passed, report(r));
  const v = r.results.find(x => /on the crossing/.test(x.label));
  assert(v && !v.pass, "crossing violation should fail: " + report(r));
});
T("Lab crossing: closing only on 'occupied' is too late", () => {
  const r = grade("crossing", REF_CROSSING
    .replace("gateCmd  := approaching OR occupied;", "gateCmd  := occupied;"));
  assert(!r.error && !r.passed, report(r));
  const lead = r.results.find(x => /0.8 s before/.test(x.label));
  assert(lead && !lead.pass, "lead-time check should fail: " + report(r));
});
T("Lab crossing: forgetting to reopen blocks the road forever", () => {
  const r = grade("crossing", REF_CROSSING
    .replace("gateCmd  := approaching OR occupied;", "gateCmd  := approaching OR occupied OR gateClosed;"));
  assert(!r.error && !r.passed, report(r));
  const rel = r.results.find(x => /released at the end/.test(x.label));
  assert(rel && !rel.pass, "release check should fail: " + report(r));
});
T("Lab crossing: station/shuttle labs unaffected by the new gate (regression)", () => {
  const r1 = grade("station", REF_STATION);
  const r2 = grade("shuttle", REF_SHUTTLE);
  assert(!r1.error && r1.passed, "station regressed: " + report(r1));
  assert(!r2.error && r2.passed, "shuttle regressed: " + report(r2));
});

T("Lab duty/standby: reference passes all checks", () => {
  const r = grade("dutystandby", REF_DUTY);
  assert(!r.error && r.passed, report(r));
});
T("Lab duty/standby: A-only control fails alternation and recovery", () => {
  const r = grade("dutystandby",
    "VAR_INPUT level:Real; levelLow:Bool; levelHigh:Bool; fbRunA:Bool; fbRunB:Bool; END_VAR " +
    "VAR_OUTPUT pumpA:Bool; pumpB:Bool; END_VAR VAR d:Bool; END_VAR BEGIN " +
    "IF level < 0.6 THEN d := TRUE; END_IF; IF level > 1.4 THEN d := FALSE; END_IF; " +
    "pumpA := d; pumpB := FALSE;");
  assert(!r.error && !r.passed, report(r));
  const alt = r.results.find(x => /alternates/i.test(x.label));
  const sup = r.results.find(x => /supervised/i.test(x.label));
  assert(alt && !alt.pass, "alternation should fail: " + report(r));
  assert(sup && !sup.pass, "supervision should fail: " + report(r));
});
T("Lab duty/standby: no supervision means the level collapses after the fault", () => {
  const noSup = REF_DUTY
    .replace("IF tFA.Q THEN faultA := TRUE; END_IF;", "")
    .replace("IF tFB.Q THEN faultB := TRUE; END_IF;", "");
  const r = grade("dutystandby", noSup);
  assert(!r.error && !r.passed, report(r));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
