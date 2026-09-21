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

/* ---------------- Lab 7: heater PI loop ---------------- */
const HEATER_HEAD = `
VAR_INPUT
    temp : Real; sp : Real;
END_VAR
VAR_OUTPUT
    pwr : Real;
END_VAR
VAR
    integ : Real;
END_VAR
VAR_TEMP
    err : Real; raw : Real;
END_VAR
VAR CONSTANT
    KP : Real := 8.0; KI : Real := 0.35; DT : Real := 0.05;
END_VAR
BEGIN
err := sp - temp;
raw := KP * err + integ;
`;
const REF_HEATER = HEATER_HEAD + `
IF NOT ((raw >= 100.0 AND err > 0.0) OR (raw <= 0.0 AND err < 0.0)) THEN
    integ := integ + KI * err * DT;
END_IF;
pwr := LIMIT(MN := 0.0, IN := KP * err + integ, MX := 100.0);
`;

T("Lab heater: reference PI with anti-windup passes all checks", () => {
  const r = grade("heater", REF_HEATER);
  assert(!r.error && r.passed, report(r));
});
T("Lab heater: proportional-only parks below setpoint", () => {
  const r = grade("heater", HEATER_HEAD + "pwr := LIMIT(MN := 0.0, IN := KP * err, MX := 100.0);");
  assert(!r.error && !r.passed, report(r));
  const band = r.results.find(x => /Holds 75/.test(x.label));
  assert(band && !band.pass, "settled-band check should fail: " + report(r));
});
T("Lab heater: integrating while saturated overshoots (the starter's bug)", () => {
  const r = grade("heater", HEATER_HEAD +
    "integ := integ + KI * err * DT;\npwr := LIMIT(MN := 0.0, IN := KP * err + integ, MX := 100.0);");
  assert(!r.error && !r.passed, report(r));
  const over = r.results.filter(x => !x.pass);
  assert(over.length === 1 && /overshoot/.test(over[0].label),
    "windup should fail the overshoot check and nothing else: " + report(r));
});
T("Lab heater: on/off control holds temperature but fails the modulation check", () => {
  const r = grade("heater", HEATER_HEAD + "IF temp < sp THEN pwr := 100.0; ELSE pwr := 0.0; END_IF;");
  assert(!r.error && !r.passed, report(r));
  const mod = r.results.find(x => /modulates/.test(x.label));
  assert(mod && !mod.pass, "modulation check should fail: " + report(r));
});
T("Lab heater: an unclamped output is caught even though the drive clamps it", () => {
  const r = grade("heater", REF_HEATER.replace(
    "pwr := LIMIT(MN := 0.0, IN := KP * err + integ, MX := 100.0);", "pwr := KP * err + integ;"));
  assert(!r.error && !r.passed, report(r));
  const rng = r.results.find(x => /never leaves/.test(x.label));
  assert(rng && !rng.pass, "range check should fail: " + report(r));
});

/* ---------------- Lab 8: conveyor jam & part count ---------------- */
const CONV_HEAD = `
VAR_INPUT
    cmdStart : Bool; cmdReset : Bool; eyeIn : Bool; eyeOut : Bool;
END_VAR
VAR_OUTPUT
    belt : Bool; alarmJam : Bool; count : Int;
END_VAR
VAR
    running : Bool; inFlight : Bool;
    trigIn : R_TRIG; trigOut : R_TRIG; trigRst : R_TRIG; tTravel : TON;
END_VAR
BEGIN
trigIn(CLK := eyeIn);
trigOut(CLK := eyeOut);
trigRst(CLK := cmdReset);
IF cmdStart THEN running := TRUE; END_IF;
`;
const REF_CONVEYOR = CONV_HEAD + `
IF trigOut.Q THEN count := count + 1; END_IF;

IF trigIn.Q  THEN inFlight := TRUE;  END_IF;
IF trigOut.Q THEN inFlight := FALSE; END_IF;

tTravel(IN := inFlight, PT := T#18s);
IF tTravel.Q THEN alarmJam := TRUE; END_IF;

IF trigRst.Q THEN
    alarmJam := FALSE;
    inFlight := FALSE;
END_IF;

belt := running AND NOT alarmJam;
`;

T("Lab conveyor: reference passes all checks", () => {
  const r = grade("conveyor", REF_CONVEYOR);
  assert(!r.error && r.passed, report(r));
});
T("Lab conveyor: counting the beam instead of the edge over-counts 20x", () => {
  const r = grade("conveyor", REF_CONVEYOR
    .replace("IF trigOut.Q THEN count := count + 1; END_IF;", "IF eyeOut THEN count := count + 1; END_IF;"));
  assert(!r.error && !r.passed, report(r));
  const fails = r.results.filter(x => !x.pass);
  assert(fails.length === 1 && /counted once/.test(fails[0].label),
    "only the tally check should fail: " + report(r));
  assert(/over-counted by \d\d\d/.test(fails[0].msg), "message should quantify it: " + fails[0].msg);
});
T("Lab conveyor: an alarm that is not latched lets the belt restart by itself", () => {
  /* The mechanic hands the stuck part through the outfeed eye at t = 160 s, so
     the live condition clears on its own — only a latch survives it. */
  const r = grade("conveyor", REF_CONVEYOR
    .replace("IF tTravel.Q THEN alarmJam := TRUE; END_IF;", "alarmJam := tTravel.Q;")
    .replace("    alarmJam := FALSE;\n", ""));
  assert(!r.error && !r.passed, report(r));
  const latch = r.results.find(x => /latches/.test(x.label));
  assert(latch && !latch.pass, "latch check should fail: " + report(r));
  assert(/restarted on its own/.test(latch.msg), "message should name the failure: " + latch.msg);
});
T("Lab conveyor: supervising the belt instead of the transfer trips a phantom alarm", () => {
  const r = grade("conveyor", REF_CONVEYOR.replace("tTravel(IN := inFlight,", "tTravel(IN := running,"));
  assert(!r.error && !r.passed, report(r));
  const phantom = r.results.find(x => /phantom/.test(x.label));
  assert(phantom && !phantom.pass, "phantom-alarm check should fail: " + report(r));
});
T("Lab conveyor: never clearing inFlight alarms on the first part", () => {
  const r = grade("conveyor", REF_CONVEYOR.replace("IF trigOut.Q THEN inFlight := FALSE; END_IF;", ""));
  assert(!r.error && !r.passed, report(r));
  const det = r.results.find(x => /jam is detected/.test(x.label));
  assert(det && !det.pass, "detection check should fail: " + report(r));
});
T("Lab conveyor: the shipped starter fails, and fails informatively", () => {
  const r = grade("conveyor", Labs.labs.find(l => l.id === "conveyor").starter);
  assert(!r.error, "starter must at least compile and run: " + report(r));
  assert(!r.passed, "the starter must not pass: " + report(r));
  assert(r.results.filter(x => !x.pass).every(x => x.msg), "every failure needs a message: " + report(r));
});
T("Lab heater: the shipped starter compiles, runs, and fails only on overshoot", () => {
  const r = grade("heater", Labs.labs.find(l => l.id === "heater").starter);
  assert(!r.error, "starter must at least compile and run: " + report(r));
  const fails = r.results.filter(x => !x.pass);
  assert(fails.length === 1 && /overshoot/.test(fails[0].label),
    "the starter should teach exactly one lesson: " + report(r));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
