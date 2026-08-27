/* Verifies the Chapter 21 WASH-3 sequence logic and the claims made about it.
   The playground VM takes integer CASE labels only, so constants are inlined —
   the logic is otherwise identical to FB_WashSeq.scl. */
const VM = require("./vm.js");

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + " :: " + (e && e.message ? e.message : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || "assert"); }

/* recompute: "" = derived facts computed once before the CASE (stale outputs),
   "fresh"     = recomputed after the CASE for the outputs (correct).
   dirOf: expression giving pass direction — alternating (WASH-3) or all-forward. */
const SEQ = (guard, recompute, dirOf, edge) => `
VAR_INPUT
    start : Bool; reset : Bool;
    interlocksOK : Bool; pressureOK : Bool;
    gantryHome : Bool; gantryFar : Bool; gantryFault : Bool;
END_VAR
VAR_OUTPUT
    gantryFwd : Bool; gantryRev : Bool;
    preRinse : Bool; detergent : Bool; brush : Bool;
    rinse : Bool; blower : Bool;
    lampGreen : Bool; lampRed : Bool;
    stepNo : Int; passNo : Int;
    almPressure : Bool; almCurtain : Bool;
END_VAR
VAR
    step : Int; stepOld : Int; pass : Int; passOld : Int;
    trigStart : R_TRIG; trigDone : R_TRIG; tDone : TON; tPress : TON;
END_VAR
VAR_TEMP
    fwdPass : Bool; wetPass : Bool; passDone : Bool;
END_VAR
BEGIN
trigStart(CLK := start);
fwdPass  := ${dirOf};
wetPass  := pass <= 3;
passDone := SEL(G := fwdPass, IN0 := gantryHome, IN1 := gantryFar);
trigDone(CLK := passDone);

tPress(IN := (step = 10) AND wetPass AND NOT pressureOK, PT := T#3s);
almPressure := tPress.Q;
almCurtain  := (step <> 0) AND NOT interlocksOK;

IF almPressure OR almCurtain OR gantryFault THEN
    step := 90;
END_IF;

CASE step OF
    0:  pass := 0;
        IF trigStart.Q AND interlocksOK AND pressureOK AND gantryHome THEN
            pass := 1; step := 10;
        END_IF;
    10: IF ${edge ? "trigDone.Q" : "passDone"} ${guard} THEN
            IF pass >= 4 THEN step := 20; ELSE pass := pass + 1; END_IF;
        END_IF;
    20: IF tDone.Q THEN step := 0; END_IF;
    90: IF reset AND NOT almPressure AND NOT almCurtain AND NOT gantryFault THEN
            step := 0;
        END_IF;
    ELSE step := 0;
END_CASE;

tDone(IN := (step = stepOld) AND (step = 20), PT := T#10s);
stepOld := step;
passOld := pass;
${recompute ? "fwdPass := " + dirOf + ";   // refresh for the outputs" : ""}

gantryFwd := (step = 10) AND fwdPass;
gantryRev := (step = 10) AND NOT fwdPass;
preRinse  := (step = 10) AND (pass = 1);
detergent := (step = 10) AND (pass = 2);
brush     := (step = 10) AND (pass = 2);
rinse     := (step = 10) AND (pass = 3);
blower    := (step = 10) AND (pass = 4);
lampGreen := step = 20;
lampRed   := step <> 20;
stepNo    := step;
passNo    := pass;
`;

const ALT = "(pass MOD 2) = 1";     // WASH-3: passes alternate direction
const ALLFWD = "TRUE";              // hypothetical: every pass travels forward

const WASH3 = SEQ("", true, ALT);            // shipped design: no mask, fresh outputs
const WASH3_STALE = SEQ("", false, ALT);     // derived facts computed only pre-CASE
const SAMEDIR = SEQ("", true, ALLFWD);       // same-direction passes, no mask
const SAMEDIR_STEPMASK = SEQ("AND (step = stepOld)", true, ALLFWD);   // WRONG guard variable
const SAMEDIR_PASSMASK = SEQ("AND (pass = passOld)", true, ALLFWD);   // guards the thing that changes
const WASH3_EDGE   = SEQ("", true, ALT, true);      // edge-triggered done (shipped)
const SAMEDIR_EDGE = SEQ("", true, ALLFWD, true);   // impossible recipe, edge-triggered

/* Gantry: 0 = Home, 100 = Far, 10 units/s. End switches within 2 units. */
function makeGantry() {
  return { pos: 0,
    step(io, dt) {
      if (io.gantryFwd) this.pos = Math.min(100, this.pos + 10 * dt);
      else if (io.gantryRev) this.pos = Math.max(0, this.pos - 10 * dt);
    },
    sensors() { return { gantryHome: this.pos <= 2, gantryFar: this.pos >= 98 }; }
  };
}

function run(src, seconds, opts) {
  opts = opts || {};
  const rt = new VM.Runtime(VM.compile(src));
  const g = makeGantry();
  const DT = 0.05;
  const log = { passes: [], media: {}, maxPass: 0, faulted: false, everBothMedia: false };
  let prevPass = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    const sen = g.sensors();
    rt.setInput("gantryHome", sen.gantryHome);
    rt.setInput("gantryFar", sen.gantryFar);
    rt.setInput("interlocksOK", opts.curtainBreakAt !== undefined && t >= opts.curtainBreakAt ? false : true);
    rt.setInput("pressureOK", opts.pressureLostAt !== undefined && t >= opts.pressureLostAt ? false : true);
    rt.setInput("gantryFault", false);
    rt.setInput("start", t >= 0.5 && t < 0.9);
    rt.setInput("reset", false);
    rt.scan(DT * 1000);
    const io = {};
    rt.order.forEach(v => { if (v.kind === "output" && !v.inst) io[v.name] = v.val; });
    if (io.passNo !== prevPass) { log.passes.push(io.passNo); prevPass = io.passNo; }
    if (io.passNo > log.maxPass) log.maxPass = io.passNo;
    if (io.stepNo === 90) log.faulted = true;
    // record direction + media actually used per pass
    if (io.stepNo === 10 && io.passNo > 0) {
      const k = io.passNo;
      log.media[k] = log.media[k] || { fwd: false, rev: false, media: new Set() };
      if (io.gantryFwd) log.media[k].fwd = true;
      if (io.gantryRev) log.media[k].rev = true;
      ["preRinse", "detergent", "brush", "rinse", "blower"].forEach(m => { if (io[m]) log.media[k].media.add(m); });
    }
    const nMedia = ["preRinse", "detergent", "rinse", "blower"].filter(m => io[m]).length;
    if (nMedia > 1) log.everBothMedia = true;
    g.step(io, DT);
    log.last = io;
    log.pos = g.pos;
  }
  return log;
}

T("WASH-3: all four passes run in order", () => {
  const r = run(WASH3, 60);
  assert(r.maxPass === 4, "reached pass " + r.maxPass);
  assert(JSON.stringify(r.passes) === JSON.stringify([1, 2, 3, 4, 0]),
    "pass sequence was " + JSON.stringify(r.passes));
});

T("WASH-3: passes alternate direction, odd = forward, no wrong-direction scan", () => {
  const r = run(WASH3, 60);
  assert(r.media[1].fwd && !r.media[1].rev, "pass 1 must travel forward only");
  assert(r.media[2].rev && !r.media[2].fwd, "pass 2 must travel reverse only");
  assert(r.media[3].fwd && !r.media[3].rev, "pass 3 must travel forward only");
  assert(r.media[4].rev && !r.media[4].fwd, "pass 4 must travel reverse only");
});

T("Ch.21 claim: derived facts computed only BEFORE the CASE lag the outputs by one scan", () => {
  const r = run(WASH3_STALE, 60);
  const wrongDir = [1, 2, 3, 4].some(k => r.media[k] && r.media[k].fwd && r.media[k].rev);
  assert(wrongDir, "expected a stale-direction scan with pre-CASE-only temps, but none appeared");
});

T("WASH-3: correct media per pass, never two at once", () => {
  const r = run(WASH3, 60);
  const m = k => [...r.media[k].media].sort().join(",");
  assert(m(1) === "preRinse", "pass 1 media: " + m(1));
  assert(m(2) === "brush,detergent", "pass 2 media: " + m(2));
  assert(m(3) === "rinse", "pass 3 media: " + m(3));
  assert(m(4) === "blower", "pass 4 media: " + m(4));
  assert(!r.everBothMedia, "two media pumps were on simultaneously");
});

T("WASH-3: ends parked Home with the green lamp, then returns to IDLE", () => {
  const r = run(WASH3, 40);
  assert(r.last.stepNo === 20 && r.last.lampGreen, "expected DONE+green, got step " + r.last.stepNo);
  assert(r.pos <= 2, "gantry not parked Home: pos=" + r.pos.toFixed(1));
  const long = run(WASH3, 60);
  assert(long.last.stepNo === 0 && long.last.lampRed, "should fall back to IDLE with red lamp");
});

T("Ch.21 claim: alternating directions make the stale-sensor mask unnecessary", () => {
  const r = run(WASH3, 60);
  assert(JSON.stringify(r.passes) === JSON.stringify([1, 2, 3, 4, 0]),
    "WASH-3 needs no mask, yet the run was not clean: " + JSON.stringify(r.passes));
});

function passTimeline(src, seconds) {
  // when (in seconds) each pass number first appeared
  const rt = new VM.Runtime(VM.compile(src));
  const g = makeGantry();
  const DT = 0.05, when = {};
  let prev = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT, sen = g.sensors();
    rt.setInput("gantryHome", sen.gantryHome);
    rt.setInput("gantryFar", sen.gantryFar);
    rt.setInput("interlocksOK", true);
    rt.setInput("pressureOK", true);
    rt.setInput("gantryFault", false);
    rt.setInput("start", t >= 0.5 && t < 0.9);
    rt.setInput("reset", false);
    rt.scan(DT * 1000);
    const io = {};
    rt.order.forEach(v => { if (v.kind === "output" && !v.inst) io[v.name] = v.val; });
    if (io.passNo !== prev) { if (when[io.passNo] === undefined) when[io.passNo] = t; prev = io.passNo; }
    g.step(io, DT);
  }
  return when;
}

T("Ch.21 claim: SAME-direction consecutive passes collapse without a mask", () => {
  const t = passTimeline(SAMEDIR, 60);
  assert(t[2] !== undefined && t[4] !== undefined, "expected all passes to be reached: " + JSON.stringify(t));
  // passes 2,3,4 all fire within a scan or two of arriving at Far
  assert(t[4] - t[2] < 0.5,
    "expected passes 2-4 to collapse together, timeline " + JSON.stringify(t));
});

T("Ch.21 claim: a stepOld mask does NOT fix it — the step never changes between passes", () => {
  const t = passTimeline(SAMEDIR_STEPMASK, 60);
  assert(t[4] - t[2] < 0.5,
    "stepOld should be powerless here, but the timeline changed: " + JSON.stringify(t));
});

T("Ch.21 claim: a passOld mask does NOT fix it either — it re-equalises each scan", () => {
  const t = passTimeline(SAMEDIR_PASSMASK, 60);
  assert(t[4] - t[2] < 0.5,
    "passOld updated at scan end is powerless here, but the timeline changed: " + JSON.stringify(t));
});

T("Ch.21 fix verified: an EDGE on the done-condition — WASH-3 still runs all four passes", () => {
  const r = run(WASH3_EDGE, 60);
  assert(JSON.stringify(r.passes) === JSON.stringify([1, 2, 3, 4, 0]),
    "edge-triggered WASH-3 pass sequence was " + JSON.stringify(r.passes));
  const m = k => [...r.media[k].media].sort().join(",");
  assert(m(1) === "preRinse" && m(2) === "brush,detergent" && m(3) === "rinse" && m(4) === "blower",
    "media wrong under edge triggering");
});

T("Ch.21 fix verified: with an edge, an impossible same-direction recipe HANGS instead of skipping", () => {
  const t = passTimeline(SAMEDIR_EDGE, 60);
  assert(t[2] !== undefined, "pass 2 should still be entered: " + JSON.stringify(t));
  assert(t[3] === undefined && t[4] === undefined,
    "pass 2 should never complete (gantry parked on its own done-switch), timeline " + JSON.stringify(t));
});

T("WASH-3: losing water pressure mid-wet-pass faults after 3 s", () => {
  const r = run(WASH3, 40, { pressureLostAt: 6 });
  assert(r.faulted, "should have entered FAULTED");
  assert(r.last.stepNo === 90, "should stay FAULTED without reset, got " + r.last.stepNo);
  assert(!r.last.preRinse && !r.last.detergent && !r.last.rinse && !r.last.blower && !r.last.brush,
    "all media must be off in FAULTED");
  assert(!r.last.gantryFwd && !r.last.gantryRev, "gantry must stop in FAULTED");
});

T("WASH-3: light-curtain breach stops the machine immediately", () => {
  const r = run(WASH3, 30, { curtainBreakAt: 5 });
  assert(r.faulted && r.last.stepNo === 90, "expected FAULTED, got " + r.last.stepNo);
  assert(!r.last.gantryFwd && !r.last.gantryRev, "gantry must stop");
});

T("WASH-3: start is refused when the gantry is not Home", () => {
  const rt = new VM.Runtime(VM.compile(WASH3));
  for (let i = 0; i < 60; i++) {
    rt.setInput("gantryHome", false);       // parked mid-track
    rt.setInput("gantryFar", false);
    rt.setInput("interlocksOK", true);
    rt.setInput("pressureOK", true);
    rt.setInput("gantryFault", false);
    rt.setInput("start", i > 5 && i < 12);
    rt.scan(50);
  }
  assert(rt.vars["stepno"].val === 0, "sequence started without the gantry Home");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
