/* SCL Field Manual — graded labs. Definitions + headless scenario grader.
   No DOM: runnable in Node against vm.js + scenes.js for verification. */
(function (global) {
'use strict';

var DT = 0.05; // 50 ms scan, same as the live playground

function tagName(t) { return t === "B" ? "Bool" : t === "I" ? "Int" : t === "R" ? "Real" : "Time"; }

/* ---------------- lab definitions ---------------- */
var LABS = [

{
  id: "guard",
  title: "Lab 1 · Pump cooldown guard",
  scene: null,
  duration: 32,
  brief: "<b>Task</b>: the pump may only restart 10 s after it last stopped; stopping is always immediate. " +
    "The grader will command the pump on, off, and on again 2 s later — your logic must hold it off until the cooldown expires. " +
    "One TOF is all you need (Ch. 8, Exercise 1).",
  starter:
"VAR_INPUT\n    cmdRun : Bool;\nEND_VAR\nVAR_OUTPUT\n    pumpOn : Bool;\nEND_VAR\nVAR\n    tCool  : TOF;\nEND_VAR\n\nBEGIN\n// Your logic here. Hints:\n// - tCool.Q should be TRUE during the 10 s after the pump stops.\n// - The lockout must block STARTING, never RUNNING.\npumpOn := cmdRun;   // <- naive version. Make it pass the checks!\n",
  required: { inputs: [["cmdRun", "B"]], outputs: [["pumpOn", "B"]] },
  events: [
    { t: 1.0, name: "cmdRun", v: true },
    { t: 5.0, name: "cmdRun", v: false },
    { t: 7.0, name: "cmdRun", v: true }
  ],
  checks: function () {
    var okStart = false, stoppedFast = true, lockoutHeld = true, restarted = false;
    return [
      { label: "Pump runs while commanded (t = 2 s)",
        onScan: function (t, io) { if (t > 1.9 && t < 2.1 && io.pumpOn) okStart = true; },
        result: function () { return { pass: okStart, msg: okStart ? "" : "pumpOn never came on after cmdRun at t=1s." }; } },
      { label: "Pump stops immediately when command drops",
        onScan: function (t, io) { if (t > 5.2 && t < 5.4 && io.pumpOn) stoppedFast = false; },
        result: function () { return { pass: stoppedFast, msg: stoppedFast ? "" : "pumpOn was still TRUE 0.2 s after cmdRun dropped." }; } },
      { label: "10 s cooldown blocks the restart",
        onScan: function (t, io) { if (t > 5.4 && t < 14.7 && io.pumpOn) lockoutHeld = false; },
        result: function () { return { pass: lockoutHeld, msg: lockoutHeld ? "" : "pumpOn restarted during the cooldown window (before t=15s)." }; } },
      { label: "Pump restarts once the cooldown expires",
        onScan: function (t, io) { if (t > 16 && io.pumpOn) restarted = true; },
        result: function () { return { pass: restarted, msg: restarted ? "" : "pumpOn never restarted although cmdRun stayed TRUE." }; } }
    ];
  }
},

{
  id: "tanklevel",
  title: "Lab 2 · Tank level control",
  scene: "tank",
  duration: 240,
  brief: "<b>Task</b>: the process drains the tank at a constant 0.035 m/s; your pump refills at 0.08 m/s. " +
    "Hold the level in a healthy band with <b>hysteresis</b> (Ch. 6) — e.g. pump ON below 0.6 m, OFF above 1.4 m. " +
    "The grader watches 4 simulated minutes: no overfill above 1.85 m, never below 0.25 m, and no relay chatter " +
    "(a single-threshold comparison will toggle the pump every scan and fail).",
  starter:
"VAR_INPUT\n    level     : Real;   // measured level, m\n    levelLow  : Bool;   // float switch at 0.4 m\n    levelHigh : Bool;   // float switch at 1.6 m\nEND_VAR\nVAR_OUTPUT\n    pump      : Bool;\nEND_VAR\n\nBEGIN\n// Your logic here. Two IFs, no ELSE - the hysteresis pair.\npump := level < 1.0;   // <- single threshold = chatter. Fix it!\n",
  required: { inputs: [["level", "R"]], outputs: [["pump", "B"]] },
  events: [],
  checks: function () {
    var maxL = -1, minL = 99, transitions = 0, last = null;
    return [
      { label: "Never overfills (level stays below 1.85 m)",
        onScan: function (t, io, scene) { if (scene.state.level > maxL) maxL = scene.state.level; },
        result: function () { return { pass: maxL < 1.85, msg: maxL < 1.85 ? "" : "Level reached " + maxL.toFixed(2) + " m." }; } },
      { label: "Never runs low (level stays above 0.25 m)",
        onScan: function (t, io, scene) { if (scene.state.level < minL) minL = scene.state.level; },
        result: function () { return { pass: minL > 0.25, msg: minL > 0.25 ? "" : "Level fell to " + minL.toFixed(2) + " m." }; } },
      { label: "No chatter (pump switches at most 40 times in 4 min)",
        onScan: function (t, io) {
          if (last !== null && io.pump !== last) transitions++;
          last = io.pump;
        },
        result: function () { return { pass: transitions <= 40, msg: transitions <= 40 ? "" : transitions + " pump transitions — that contactor is dead in a week. Use hysteresis." }; } },
      { label: "Ends inside the band (0.3 – 1.8 m)",
        onScan: function () {},
        result: function () { return { pass: maxL >= 0 && minL <= 99 && lastLevelOk(), msg: lastLevelOk() ? "" : "Final level " + lastLevel.toFixed(2) + " m." }; } }
    ];
    function lastLevelOk() { return lastLevel >= 0.3 && lastLevel <= 1.8; }
  },
  finalize: function (scene, acc) { }
},

{
  id: "station",
  title: "Lab 3 · Station stop",
  scene: "train",
  duration: 90,
  brief: "<b>Task</b>: the train waits at Station A. On the <code>btnGo</code> pulse (the grader presses it at t = 2 s), " +
    "drive to Station B, brake to a stop inside the platform zone, open the doors, dwell 5 s, close them. " +
    "Physics: the train accelerates at 1.6 m/s² to 4 m/s and brakes at 3.2 m/s² when you drop the drive — " +
    "braking the moment <code>atB</code> turns TRUE lands you on the platform center. " +
    "Use a CASE step machine (Ch. 11) — and mind the door-safety check: doors must never move while the train does.",
  starter:
"VAR_INPUT\n    atA         : Bool;   // platform detector A\n    atB         : Bool;   // platform detector B\n    doorsClosed : Bool;\n    doorsOpen   : Bool;\n    btnGo       : Bool;   // dispatch button\n    speed       : Real;   // signed, m/s\nEND_VAR\nVAR_OUTPUT\n    driveFwd    : Bool;\n    driveRev    : Bool;\n    doorsCmd    : Bool;   // TRUE = open\nEND_VAR\nVAR\n    step    : Int;\n    stepOld : Int;\n    tDwell  : TON;\n    trigGo  : R_TRIG;\nEND_VAR\n\nBEGIN\ntrigGo(CLK := btnGo);\n\nCASE step OF\n    0:  IF trigGo.Q THEN step := 10; END_IF;   // wait for dispatch\n    10: ;  // TODO drive forward until atB, then brake...\n    ELSE step := 0;\nEND_CASE;\n\ntDwell(IN := (step = stepOld) AND (step = 40), PT := T#5s);\nstepOld := step;\n\ndriveFwd := step = 10;\ndriveRev := FALSE;\ndoorsCmd := FALSE;   // TODO derive from your door steps\n",
  required: {
    inputs: [["atA","B"],["atB","B"],["doorsClosed","B"],["doorsOpen","B"],["btnGo","B"],["speed","R"]],
    outputs: [["driveFwd","B"],["driveRev","B"],["doorsCmd","B"]]
  },
  controls: [{ name: "btnGo", label: "Dispatch (btnGo)" }],
  events: [
    { t: 2.0, name: "btnGo", v: true },
    { t: 2.4, name: "btnGo", v: false }
  ],
  checks: function () {
    var arrived = false, dwell = 0;
    return [
      { label: "Arrives and stops at Station B",
        onScan: function (t, io, scene, sen) { if (sen.atB && Math.abs(scene.state.v) < 0.05) arrived = true; },
        result: function () { return { pass: arrived, msg: arrived ? "" : "The train never came to a stop inside the Station B zone." }; } },
      { label: "No buffer-stop crash",
        onScan: function () {},
        result: function (scene) { return { pass: !scene.state.crashed, msg: scene.state.crashed ? "Hit the end of the track at speed. Brake when atB comes on." : "" }; } },
      { label: "Doors never move while the train moves",
        onScan: function () {},
        result: function (scene) { return { pass: !scene.state.doorViolation, msg: scene.state.doorViolation ? "Doors were open/moving while the train was in motion." : "" }; } },
      { label: "Doors fully open at B for at least 4.5 s",
        onScan: function (t, io, scene, sen) { if (sen.atB && sen.doorsOpen) dwell += DT; },
        result: function () { return { pass: dwell >= 4.5, msg: dwell >= 4.5 ? "" : "Doors-open dwell at B was " + dwell.toFixed(1) + " s." }; } },
      { label: "Doors closed at the end of the run",
        onScan: function () {},
        result: function (scene) { return { pass: scene.state.door <= 0.05, msg: scene.state.door <= 0.05 ? "" : "The run ended with the doors open." }; } }
    ];
  }
},

{
  id: "shuttle",
  title: "Lab 4 · Shuttle service",
  scene: "train",
  duration: 240,
  brief: "<b>Task</b>: continuous service, no button. Shuttle A → B → A → B…: at each station stop, open doors, " +
    "dwell 4 s, close, and depart the other way. The grader wants at least <b>two full door cycles at each station</b> " +
    "within 4 simulated minutes — with every safety rule from Lab 3 still holding. " +
    "This is Lab 3's machine extended with a return leg; remember the shared-timer <code>stepOld</code> trap.",
  starter:
"VAR_INPUT\n    atA         : Bool;\n    atB         : Bool;\n    doorsClosed : Bool;\n    doorsOpen   : Bool;\n    btnGo       : Bool;   // unused in this lab\n    speed       : Real;\nEND_VAR\nVAR_OUTPUT\n    driveFwd    : Bool;\n    driveRev    : Bool;\n    doorsCmd    : Bool;\nEND_VAR\nVAR\n    step    : Int;\n    stepOld : Int;\n    tDwell  : TON;\nEND_VAR\n\nBEGIN\n// TODO: 10 fwd -> 20 brake -> 30 open -> 40 dwell -> 50 close ->\n//       60 rev -> 70 brake -> 80 open -> 90 dwell -> 100 close -> 10\n\ntDwell(IN := (step = stepOld) AND ((step = 40) OR (step = 90)),\n       PT := T#4s);\nstepOld := step;\n\ndriveFwd := FALSE;\ndriveRev := FALSE;\ndoorsCmd := FALSE;\n",
  required: {
    inputs: [["atA","B"],["atB","B"],["doorsClosed","B"],["doorsOpen","B"],["speed","R"]],
    outputs: [["driveFwd","B"],["driveRev","B"],["doorsCmd","B"]]
  },
  events: [],
  checks: function () {
    var cycA = 0, cycB = 0, inA = false, inB = false;
    return [
      { label: "At least 2 door cycles at Station B",
        onScan: function (t, io, scene, sen) {
          var c = sen.atB && sen.doorsOpen && Math.abs(scene.state.v) < 0.1;
          if (c && !inB) cycB++;
          inB = c;
        },
        result: function () { return { pass: cycB >= 2, msg: cycB >= 2 ? "" : "Only " + cycB + " door cycle(s) at B in 4 min." }; } },
      { label: "At least 2 door cycles at Station A",
        onScan: function (t, io, scene, sen) {
          var c = sen.atA && sen.doorsOpen && Math.abs(scene.state.v) < 0.1;
          if (c && !inA) cycA++;
          inA = c;
        },
        result: function () { return { pass: cycA >= 2, msg: cycA >= 2 ? "" : "Only " + cycA + " door cycle(s) at A in 4 min." }; } },
      { label: "No buffer-stop crash",
        onScan: function () {},
        result: function (scene) { return { pass: !scene.state.crashed, msg: scene.state.crashed ? "Hit a buffer stop at speed." : "" }; } },
      { label: "Doors never move while the train moves",
        onScan: function () {},
        result: function (scene) { return { pass: !scene.state.doorViolation, msg: scene.state.doorViolation ? "Door-safety violation." : "" }; } }
    ];
  }
},

{
  id: "crossing",
  title: "Lab 5 · Level crossing",
  scene: "train",
  duration: 90,
  brief: "<b>Task</b>: there is a road crossing the track at the halfway point. Extend your Lab 3 station-stop machine with " +
    "crossing protection: close the gate (<code>gateCmd</code>) and switch on the warning lamps (<code>lampsCmd</code>) " +
    "before the train reaches the crossing, keep them until it has cleared, then release the road. " +
    "Sensors: <code>approaching</code> (±25 m of the crossing) and <code>occupied</code> (±6 m). " +
    "The gate takes 2 s to travel — the grader demands it fully closed at least 0.8 s before the train arrives, " +
    "lamps on whenever the gate is not fully open, and everything released at the end. " +
    "The starter is a working Lab 3 solution: only the crossing logic is missing.",
  starter:
"VAR_INPUT\n    atA         : Bool;\n    atB         : Bool;\n    doorsClosed : Bool;\n    doorsOpen   : Bool;\n    btnGo       : Bool;\n    speed       : Real;\n    approaching : Bool;   // within 25 m of the crossing\n    occupied    : Bool;   // train on the crossing\n    gateClosed  : Bool;\n    gateOpen    : Bool;\nEND_VAR\nVAR_OUTPUT\n    driveFwd    : Bool;\n    driveRev    : Bool;\n    doorsCmd    : Bool;\n    gateCmd     : Bool;   // TRUE = close the gate\n    lampsCmd    : Bool;   // road warning lamps\nEND_VAR\nVAR\n    step    : Int;\n    stepOld : Int;\n    tDwell  : TON;\n    trigGo  : R_TRIG;\nEND_VAR\n\nBEGIN\ntrigGo(CLK := btnGo);\n\nCASE step OF\n    0:  IF trigGo.Q THEN step := 10; END_IF;\n    10: IF atB THEN step := 20; END_IF;\n    20: IF ABS(speed) < 0.05 THEN step := 30; END_IF;\n    30: IF doorsOpen THEN step := 40; END_IF;\n    40: IF tDwell.Q THEN step := 50; END_IF;\n    50: IF doorsClosed THEN step := 60; END_IF;\n    60: ;\n    ELSE step := 0;\nEND_CASE;\n\ntDwell(IN := (step = stepOld) AND (step = 40), PT := T#5s);\nstepOld := step;\n\ndriveFwd := step = 10;\ndriveRev := FALSE;\ndoorsCmd := (step = 30) OR (step = 40);\n\n// TODO crossing protection: derive gateCmd and lampsCmd\n// from approaching / occupied / gateOpen.\ngateCmd  := FALSE;\nlampsCmd := FALSE;\n",
  required: {
    inputs: [["atA","B"],["atB","B"],["doorsClosed","B"],["doorsOpen","B"],["btnGo","B"],["speed","R"],
             ["approaching","B"],["occupied","B"],["gateClosed","B"],["gateOpen","B"]],
    outputs: [["driveFwd","B"],["driveRev","B"],["doorsCmd","B"],["gateCmd","B"],["lampsCmd","B"]]
  },
  controls: [{ name: "btnGo", label: "Dispatch (btnGo)" }],
  events: [
    { t: 2.0, name: "btnGo", v: true },
    { t: 2.4, name: "btnGo", v: false }
  ],
  checks: function () {
    var arrived = false, lampViol = false, gateCloseT = -1, occT = -1, lead = -1;
    var prevClosed = false, prevOcc = false, endGateOpen = false, endLampsOff = false;
    return [
      { label: "Gate is closed whenever the train is on the crossing",
        onScan: function () {},
        result: function (scene) { return { pass: !scene.state.crossingViolation, msg: scene.state.crossingViolation ? "The train entered the crossing with the gate open." : "" }; } },
      { label: "Gate fully closed at least 0.8 s before the train arrives",
        onScan: function (t, io, scene, sen) {
          if (sen.gateClosed && !prevClosed) gateCloseT = t;
          if (sen.occupied && !prevOcc && occT < 0) { occT = t; lead = gateCloseT >= 0 ? t - gateCloseT : -1; }
          prevClosed = sen.gateClosed; prevOcc = sen.occupied;
        },
        result: function () {
          if (occT < 0) return { pass: false, msg: "The train never reached the crossing." };
          return { pass: lead >= 0.8, msg: lead >= 0.8 ? "" : "Gate closed only " + (lead < 0 ? "after arrival" : lead.toFixed(1) + " s before arrival") + "." };
        } },
      { label: "Lamps on whenever the gate is not fully open",
        onScan: function (t, io, scene) { if (scene.state.gate > 0.15 && !io.lampsCmd) lampViol = true; },
        result: function () { return { pass: !lampViol, msg: lampViol ? "Warning lamps were off while the gate was moving or closed." : "" }; } },
      { label: "Road released at the end (gate open, lamps off)",
        onScan: function (t, io, scene, sen) { endGateOpen = sen.gateOpen; endLampsOff = !io.lampsCmd; },
        result: function () { return { pass: endGateOpen && endLampsOff, msg: (endGateOpen && endLampsOff) ? "" : "The run ended with the road still blocked." }; } },
      { label: "Arrives and stops at Station B",
        onScan: function (t, io, scene, sen) { if (sen.atB && Math.abs(scene.state.v) < 0.05) arrived = true; },
        result: function () { return { pass: arrived, msg: arrived ? "" : "The train never stopped at Station B." }; } },
      { label: "No crash, doors never move while moving",
        onScan: function () {},
        result: function (scene) {
          var ok = !scene.state.crashed && !scene.state.doorViolation;
          return { pass: ok, msg: ok ? "" : (scene.state.crashed ? "Buffer collision." : "Door-safety violation.") };
        } }
    ];
  }
},

{
  id: "dutystandby",
  title: "Lab 6 · Duty / standby pumps",
  scene: "tank2",
  duration: 240,
  brief: "<b>Task</b>: two identical pumps (A and B, 0.09 m/s each) feed the tank against a 0.05 m/s process draw. " +
    "Run <b>one pump at a time</b> with your Lab 2 hysteresis, but <b>alternate the duty pump on every new start</b> " +
    "to balance wear. Each pump has a run feedback (<code>fbRunA</code>/<code>fbRunB</code>) — supervise it (Ch. 12): " +
    "commanded but no feedback for 2 s means the pump has failed. " +
    "<b>At t = 100 s the grader kills pump A.</b> Detect it, stop commanding A, and let B carry the load — " +
    "the level must stay in band through the whole 4 minutes.",
  starter:
"VAR_INPUT\n    level    : Real;\n    levelLow : Bool;\n    levelHigh: Bool;\n    fbRunA   : Bool;\n    fbRunB   : Bool;\nEND_VAR\nVAR_OUTPUT\n    pumpA    : Bool;\n    pumpB    : Bool;\nEND_VAR\nVAR\n    demand   : Bool;\n    useA     : Bool;\n    faultA   : Bool;\n    faultB   : Bool;\n    trigDem  : R_TRIG;\n    tFA      : TON;\n    tFB      : TON;\nEND_VAR\n\nBEGIN\n// 1) demand: hysteresis on level (Lab 2)\n// 2) on each rising edge of demand: toggle useA (skip a faulted pump)\n// 3) command exactly one healthy pump while demand is TRUE\n// 4) supervise: commanded AND NOT feedback for 2 s -> fault\npumpA := level < 1.0;   // <- naive. Replace with the duty/standby logic!\npumpB := FALSE;\n",
  required: {
    inputs: [["level","R"],["fbRunA","B"],["fbRunB","B"]],
    outputs: [["pumpA","B"],["pumpB","B"]]
  },
  events: [],
  checks: function () {
    var maxL = -1, minL = 99, minAfter = 99, bRanAfter = false, curA = 0, longA = 0;
    var starts = [], prevA = false, prevB = false, altOK = true;
    return [
      { label: "Level stays in band the whole run (0.22 – 1.88 m)",
        onScan: function (t, io, scene) {
          var L = scene.state.level;
          if (L > maxL) maxL = L;
          if (L < minL) minL = L;
        },
        result: function () {
          var ok = maxL < 1.88 && minL > 0.22;
          return { pass: ok, msg: ok ? "" : "Level range was " + minL.toFixed(2) + " – " + maxL.toFixed(2) + " m." };
        } },
      { label: "Duty alternates between A and B before the fault (≥ 3 starts)",
        onScan: function (t, io) {
          if (t < 100) {
            if (io.pumpA && !prevA) starts.push("A");
            if (io.pumpB && !prevB) starts.push("B");
          }
          prevA = io.pumpA; prevB = io.pumpB;
        },
        result: function () {
          for (var i = 1; i < starts.length; i++) if (starts[i] === starts[i - 1]) altOK = false;
          var ok = starts.length >= 3 && altOK;
          return { pass: ok, msg: ok ? "" : "Starts before the fault: [" + starts.join(", ") + "] — need ≥3, strictly alternating." };
        } },
      { label: "A's failure is supervised: after t = 110 s, A is never commanded more than 2.6 s at a stretch",
        onScan: function (t, io) {
          if (t > 110) {
            if (io.pumpA) { curA += 0.05; if (curA > longA) longA = curA; }
            else curA = 0;
          }
        },
        result: function () { return { pass: longA <= 2.6, msg: longA <= 2.6 ? "" : "pumpA was commanded " + longA.toFixed(1) + " s continuously with no feedback — supervision missing." }; } },
      { label: "Standby B carries the load after the fault",
        onScan: function (t, io, scene, sen) {
          if (t > 105) {
            if (scene.state.level < minAfter) minAfter = scene.state.level;
            if (sen.fbRunB) bRanAfter = true;
          }
        },
        result: function () {
          var ok = bRanAfter && minAfter > 0.25;
          return { pass: ok, msg: ok ? "" : (bRanAfter ? "Level fell to " + minAfter.toFixed(2) + " m after the fault." : "Pump B never ran after the fault.") };
        } }
    ];
  }
},

{
  id: "heater",
  title: "Lab 7 \u00b7 Heater PI loop",
  scene: "oven",
  duration: 320,
  brief: "<b>Task</b>: hold an oven at <b>75 \u00b0C</b> with a continuous 0\u2013100 % heater. " +
    "Full power puts 2.6 \u00b0C/s into the load and the load bleeds off 2 % of its overtemperature per second, " +
    "so holding setpoint needs about <b>42 % forever</b> \u2014 a proportional-only loop parks ~5 \u00b0C low no matter how you tune it. " +
    "You need the integral term (Ch. 13), and you need it to stop integrating while the output is against a limit: " +
    "the climb from ambient takes 25 s at 100 %, and an unguarded accumulator will overshoot by 15 \u00b0C. " +
    "<b>At t = 200 s the door opens</b> and the heat loss jumps 40 % \u2014 recover without an excursion. " +
    "The starter is a textbook PI that is missing exactly one guard.",
  starter: "VAR_INPUT\n    temp : Real;   // measured oven temperature, degC\n    sp   : Real;   // setpoint, held at 75.0 degC\nEND_VAR\nVAR_OUTPUT\n    pwr  : Real;   // heater power command, 0.0 .. 100.0 %\nEND_VAR\nVAR\n    integ : Real;  // the integral accumulator - static, it must survive the scan\nEND_VAR\nVAR_TEMP\n    err : Real;\n    raw : Real;\nEND_VAR\nVAR CONSTANT\n    KP : Real := 8.0;    // % per degC\n    KI : Real := 0.35;   // % per degC per second\n    DT : Real := 0.05;   // this lab scans every 50 ms, like an OB30 at 50 ms\nEND_VAR\n\nBEGIN\nerr := sp - temp;\nraw := KP * err + integ;\n\n// TODO: this integrates unconditionally. During the 25 s climb from ambient\n// the output is already pinned at 100 % and the accumulator keeps growing -\n// it then has to be unwound before the heater backs off, and the oven sails\n// past setpoint. Integrate only when doing so can still change the output.\ninteg := integ + KI * err * DT;\n\npwr := LIMIT(MN := 0.0, IN := KP * err + integ, MX := 100.0);\n",
  required: { inputs: [["temp","R"],["sp","R"]], outputs: [["pwr","R"]] },
  events: [],
  checks: function () {
    var sMin = 999, sMax = -999, peak = -999, mMin = 999, mMax = -999;
    var dMin = 999, lMin = 999, lMax = -999;
    return [
      { label: "Holds 75 \u00b1 2 \u00b0C from t = 120 s until the door opens",
        onScan: function (t, io, scene) {
          if (t >= 120 && t < 200) {
            var T = scene.state.temp;
            if (T < sMin) sMin = T;
            if (T > sMax) sMax = T;
          }
        },
        result: function () {
          var ok = sMin > 73 && sMax < 77;
          return { pass: ok, msg: ok ? "" : "Settled band was " + sMin.toFixed(1) + " \u2013 " + sMax.toFixed(1) +
            " \u00b0C. A P-only loop lands near 70 \u00b0C \u2014 add the integral term." };
        } },
      { label: "No overshoot: the oven never exceeds 80 \u00b0C",
        onScan: function (t, io, scene) { if (scene.state.temp > peak) peak = scene.state.temp; },
        result: function () {
          var ok = peak <= 80;
          return { pass: ok, msg: ok ? "" : "Peaked at " + peak.toFixed(1) +
            " \u00b0C. The accumulator wound up while the output was pinned at 100 % during the climb." };
        } },
      { label: "Commanded power never leaves 0 \u2013 100 %",
        onScan: function () {},
        result: function (scene) {
          return { pass: !scene.state.overRange, msg: scene.state.overRange ?
            "pwr went outside 0\u2013100 %. The drive clamps it here; a real analog card would not be so kind \u2014 use LIMIT." : "" };
        } },
      { label: "The heater modulates (25 \u2013 65 % while settled), it does not slam on and off",
        onScan: function (t, io) {
          if (t >= 150 && t < 199) {
            if (io.pwr < mMin) mMin = io.pwr;
            if (io.pwr > mMax) mMax = io.pwr;
          }
        },
        result: function () {
          var ok = mMin >= 25 && mMax <= 65;
          return { pass: ok, msg: ok ? "" : "Commanded power swung " + mMin.toFixed(0) + " \u2013 " + mMax.toFixed(0) +
            " % while settled. On/off control shortens the contactor's life \u2014 this is a modulating loop." };
        } },
      { label: "Rides out the open door: back to 75 \u00b1 2 \u00b0C by t = 280 s, never below 68 \u00b0C",
        onScan: function (t, io, scene) {
          var T = scene.state.temp;
          if (t >= 200 && T < dMin) dMin = T;
          if (t >= 280) {
            if (T < lMin) lMin = T;
            if (T > lMax) lMax = T;
          }
        },
        result: function () {
          var ok = dMin >= 68 && lMin > 73 && lMax < 77;
          return { pass: ok, msg: ok ? "" : "After the door opened the temperature fell to " + dMin.toFixed(1) +
            " \u00b0C and ended at " + lMin.toFixed(1) + " \u2013 " + lMax.toFixed(1) + " \u00b0C." };
        } }
    ];
  }
},

{
  id: "conveyor",
  title: "Lab 8 \u00b7 Conveyor jam \u0026 part count",
  scene: "conveyor",
  duration: 215,
  brief: "<b>Task</b>: run a 10 m belt at 0.6 m/s, count the parts leaving it, and catch it when it seizes. " +
    "A part trips the infeed eye at 1 m and must trip the outfeed eye at 9 m <b>13.3 s later</b>; " +
    "each beam stays broken for a full second, so twenty scans see the same part. " +
    "<b>At t = 120 s the belt jams.</b> The contactor stays energised, nothing moves, and no feedback signal says so \u2014 " +
    "only travel supervision (Ch. 12, Ch. 18) can tell. Stop the belt, raise <code>alarmJam</code>, and <b>latch it</b>: " +
    "a fault that clears itself when the symptom goes away is a fault nobody ever fixes. " +
    "At t = 160 s the mechanic frees the belt and hands the stuck part through the outfeed eye \u2014 " +
    "the symptom vanishes with nobody having acknowledged anything. Only the reset at t = 165 s may clear your alarm.",
  starter: "VAR_INPUT\n    cmdStart : Bool;\n    cmdReset : Bool;\n    eyeIn    : Bool;   // infeed photo-eye at 1 m\n    eyeOut   : Bool;   // outfeed photo-eye at 9 m\nEND_VAR\nVAR_OUTPUT\n    belt     : Bool;\n    alarmJam : Bool;\n    count    : Int;\nEND_VAR\nVAR\n    running  : Bool;\n    inFlight : Bool;   // a part has passed the infeed eye and has not arrived yet\n    trigIn   : R_TRIG;\n    trigOut  : R_TRIG;\n    trigRst  : R_TRIG;\n    tTravel  : TON;\nEND_VAR\n\nBEGIN\ntrigIn(CLK := eyeIn);\ntrigOut(CLK := eyeOut);\ntrigRst(CLK := cmdReset);\n\nIF cmdStart THEN running := TRUE; END_IF;\n\n// TODO 1: a part sits in the beam for a whole second - twenty scans. This\n//         counts every one of them. Count the edge, not the level.\nIF eyeOut THEN count := count + 1; END_IF;\n\n// TODO 2: travel supervision. Set inFlight on the infeed edge, clear it on\n//         the outfeed edge, and let the timer run only while it is set.\ntTravel(IN := inFlight, PT := T#18s);\n\n// TODO 3: latch the alarm when the timer expires, drop the belt, and clear\n//         it only on cmdReset - an alarm that clears itself tells nobody.\nalarmJam := FALSE;\nbelt := running;\n",
  required: {
    inputs: [["cmdStart","B"],["cmdReset","B"],["eyeIn","B"],["eyeOut","B"]],
    outputs: [["belt","B"],["alarmJam","B"],["count","I"]]
  },
  controls: [{ name: "cmdStart", label: "Start (cmdStart)" }, { name: "cmdReset", label: "Reset (cmdReset)" }],
  events: [
    { t: 0.5,   name: "cmdStart", v: true },
    { t: 0.9,   name: "cmdStart", v: false },
    { t: 165.0, name: "cmdReset", v: true },
    { t: 165.4, name: "cmdReset", v: false }
  ],
  checks: function () {
    var ahead = false, aheadBy = 0, endCount = 0, endPassed = 0, at115 = 0;
    var detectT = -1, beltAfter = false, alarmAt164 = false;
    var runAgain = false, alarmClear = false, countAtReset = -1;
    return [
      { label: "Every part is counted once \u2014 the tally matches the plant's",
        onScan: function (t, io, scene) {
          var c = io.count, p = scene.state.passed;
          if (c > p) { ahead = true; if (c - p > aheadBy) aheadBy = c - p; }
          endCount = c; endPassed = p;
          if (t >= 115 && at115 === 0) at115 = c;
        },
        result: function () {
          var ok = !ahead && (endCount === endPassed || endCount === endPassed - 1);
          return { pass: ok, msg: ok ? "" : "You counted " + endCount + "; " + endPassed +
            " parts actually left the belt" + (ahead ? " (over-counted by " + aheadBy +
            " \u2014 you are counting the beam, not the part)" : "") + "." };
        } },
      { label: "Production runs: at least 6 parts through before the jam",
        onScan: function () {},
        result: function () {
          return { pass: at115 >= 6, msg: at115 >= 6 ? "" : "Only " + at115 + " parts counted by t = 115 s \u2014 was the belt running?" };
        } },
      { label: "The jam is detected within 20 s and the belt is stopped",
        onScan: function (t, io) { if (io.alarmJam && detectT < 0) detectT = t; },
        result: function () {
          if (detectT < 0) return { pass: false, msg: "alarmJam never came on. Supervise the transfer with a TON on inFlight." };
          if (detectT <= 120) return { pass: false, msg: "alarmJam tripped at t = " + detectT.toFixed(1) +
            " s, before the belt jammed \u2014 your supervision timer runs when no part is in transit." };
          var ok = detectT <= 142;
          return { pass: ok, msg: ok ? "" : "alarmJam came on at t = " + detectT.toFixed(1) + " s, over 20 s after the jam." };
        } },
      { label: "The alarm latches \u2014 the belt stays off until someone resets it",
        onScan: function (t, io) {
          if (detectT > 0 && t > detectT + 0.5 && t < 164.9 && io.belt) beltAfter = true;
          if (t >= 164 && t < 164.1) alarmAt164 = io.alarmJam;
        },
        result: function () {
          var ok = !beltAfter && alarmAt164;
          return { pass: ok, msg: ok ? "" : (beltAfter ? "The belt restarted on its own before the reset."
            : "alarmJam had already cleared itself by t = 164 s \u2014 latch it.") };
        } },
      { label: "Reset restarts production: alarm clears, belt runs, parts flow again",
        onScan: function (t, io) {
          if (t >= 165 && countAtReset < 0) countAtReset = io.count;
          if (t > 167) {
            if (io.belt) runAgain = true;
            if (!io.alarmJam) alarmClear = true;
          }
          endCount = io.count;
        },
        result: function () {
          var more = endCount - (countAtReset < 0 ? 0 : countAtReset);
          var ok = runAgain && alarmClear && more >= 2;
          return { pass: ok, msg: ok ? "" : (!alarmClear ? "alarmJam never cleared after cmdReset."
            : (!runAgain ? "The belt never restarted after the reset."
            : "Only " + more + " more part(s) counted after the reset.")) };
        } },
      { label: "No phantom alarm before the jam",
        onScan: function () {},
        result: function () {
          return { pass: detectT < 0 || detectT > 120, msg: detectT >= 0 && detectT <= 120 ?
            "alarmJam tripped at t = " + detectT.toFixed(1) + " s while the belt was running normally." : "" };
        } }
    ];
  }
}
];

/* Tank lab needs the final level for its 4th check — patch via closure state. */
var lastLevel = 1.0;

/* ---------------- grader ---------------- */
function validateInterface(lab, rt) {
  var miss = [];
  lab.required.inputs.forEach(function (r) {
    var rec = rt.vars[r[0].toLowerCase()];
    if (!rec || rec.inst || rec.kind !== "input" || rec.tag !== r[1])
      miss.push("VAR_INPUT must declare  " + r[0] + " : " + tagName(r[1]) + ";");
  });
  lab.required.outputs.forEach(function (r) {
    var rec = rt.vars[r[0].toLowerCase()];
    if (!rec || rec.inst || rec.kind !== "output" || rec.tag !== r[1])
      miss.push("VAR_OUTPUT must declare  " + r[0] + " : " + tagName(r[1]) + ";");
  });
  return miss.length ? "Interface mismatch — the scene can't connect:\n" + miss.join("\n") : null;
}

function runLab(lab, src, VM, Scenes) {
  var prog;
  try { prog = VM.compile(src); }
  catch (e) { return { error: "Compile error" + (e.line ? " (line " + e.line + ")" : "") + ": " + e.message }; }
  var rt;
  try { rt = new VM.Runtime(prog); }
  catch (e) { return { error: "Error: " + e.message }; }

  var ifaceErr = validateInterface(lab, rt);
  if (ifaceErr) return { error: ifaceErr };

  var scene = lab.scene ? Scenes[lab.scene]() : null;
  var checks = lab.checks();
  var events = lab.events.slice();
  var evIdx = 0;

  function outVal(name) {
    var rec = rt.vars[name.toLowerCase()];
    return rec ? rec.val : undefined;
  }

  var steps = Math.round(lab.duration / DT);
  for (var i = 0; i < steps; i++) {
    var t = i * DT;
    while (evIdx < events.length && events[evIdx].t <= t + 1e-9) {
      rt.setInput(events[evIdx].name, events[evIdx].v);
      evIdx++;
    }
    var sen = null;
    if (scene) {
      sen = scene.sensors();
      for (var k in sen) rt.setInput(k, sen[k]);
    }
    try { rt.scan(DT * 1000); }
    catch (e) {
      return { error: "Runtime error at t=" + t.toFixed(1) + "s" + (e.line ? " (line " + e.line + ")" : "") + ": " + e.message };
    }
    var io = {};
    lab.required.outputs.forEach(function (r) { io[r[0]] = outVal(r[0]); });
    lab.required.inputs.forEach(function (r) { io[r[0]] = outVal(r[0]); });
    if (scene) scene.step(io, DT);
    if (scene && scene.id === "tank") lastLevel = scene.state.level;
    for (var c = 0; c < checks.length; c++) checks[c].onScan(t, io, scene, sen);
  }

  var results = checks.map(function (c) {
    var r = c.result(scene);
    return { label: c.label, pass: !!r.pass, msg: r.msg || "" };
  });
  return { results: results, passed: results.every(function (r) { return r.pass; }) };
}

var SCLLabs = { labs: LABS, runLab: runLab, validateInterface: validateInterface, DT: DT };
global.SCLLabs = SCLLabs;
if (typeof module !== "undefined" && module.exports) module.exports = SCLLabs;
})(typeof window !== "undefined" ? window : globalThis);
