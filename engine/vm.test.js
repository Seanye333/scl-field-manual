const VM = require("./vm.js");
let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + " :: " + (e && e.message ? e.message : e)); }
}
function assert(c, msg) { if (!c) throw new Error(msg || "assert"); }
function mk(src) { return new VM.Runtime(VM.compile(src)); }
function v(rt, name) { const r = rt.vars[name.toLowerCase()]; return r.inst ? r.st : r.val; }

T("blinker flashes with correct period", () => {
  const rt = mk(`
    VAR_INPUT enable : Bool; END_VAR
    VAR_OUTPUT lamp : Bool; END_VAR
    VAR tOn : TON; tOff : TON; END_VAR
    BEGIN
    tOn(IN := enable AND NOT tOff.Q, PT := T#500ms);
    tOff(IN := tOn.Q, PT := T#500ms);
    lamp := enable AND tOn.Q;
  `);
  rt.setInput("enable", true);
  let transitions = 0, prev = false;
  for (let i = 0; i < 100; i++) {          // 5 s at 50 ms
    rt.scan(50);
    if (v(rt, "lamp") !== prev) { transitions++; prev = v(rt, "lamp"); }
  }
  assert(transitions >= 6 && transitions <= 12, "transitions=" + transitions);
  rt.setInput("enable", false);
  rt.scan(50);
  assert(v(rt, "lamp") === false, "lamp must drop with enable");
});

T("TON basic timing", () => {
  const rt = mk(`
    VAR_INPUT run : Bool; END_VAR
    VAR_OUTPUT done : Bool; elapsed : Time; END_VAR
    VAR t1 : TON; END_VAR
    BEGIN
    t1(IN := run, PT := T#1s);
    done := t1.Q;
    elapsed := t1.ET;
  `);
  rt.setInput("run", true);
  for (let i = 0; i < 10; i++) rt.scan(100);
  assert(v(rt, "done") === true, "Q after 1s");
  assert(v(rt, "elapsed") === 1000, "ET clamps at PT, got " + v(rt, "elapsed"));
  rt.setInput("run", false); rt.scan(100);
  assert(v(rt, "done") === false, "Q resets");
});

T("TOF run-on", () => {
  const rt = mk(`
    VAR_INPUT heat : Bool; END_VAR
    VAR_OUTPUT fan : Bool; END_VAR
    VAR t : TOF; END_VAR
    BEGIN
    t(IN := heat, PT := T#300ms);
    fan := t.Q;
  `);
  rt.setInput("heat", true); rt.scan(50);
  assert(v(rt, "fan") === true, "fan with heat");
  rt.setInput("heat", false);
  rt.scan(50); assert(v(rt, "fan") === true, "fan holds");
  for (let i = 0; i < 6; i++) rt.scan(50);
  assert(v(rt, "fan") === false, "fan drops after 300ms");
});

T("TP fixed pulse, not retriggerable", () => {
  const rt = mk(`
    VAR_INPUT go : Bool; END_VAR
    VAR_OUTPUT horn : Bool; END_VAR
    VAR t : TP; END_VAR
    BEGIN
    t(IN := go, PT := T#200ms);
    horn := t.Q;
  `);
  rt.setInput("go", true); rt.scan(50);
  assert(v(rt, "horn") === true, "pulse starts");
  rt.setInput("go", false);
  rt.scan(50); rt.scan(50);
  assert(v(rt, "horn") === true, "pulse continues after IN drops");
  rt.scan(50); rt.scan(50);
  assert(v(rt, "horn") === false, "pulse ends at PT");
});

T("R_TRIG + CTU count edges, => output routing", () => {
  const rt = mk(`
    VAR_INPUT eye : Bool; reset : Bool; END_VAR
    VAR_OUTPUT full : Bool; count : Int; END_VAR
    VAR trig : R_TRIG; c : CTU; END_VAR
    BEGIN
    trig(CLK := eye);
    c(CU := trig.Q, R := reset, PV := 3, Q => full, CV => count);
  `);
  for (let i = 0; i < 4; i++) {
    rt.setInput("eye", true); rt.scan(50); rt.scan(50);
    rt.setInput("eye", false); rt.scan(50);
  }
  assert(v(rt, "count") === 4, "count=" + v(rt, "count"));
  assert(v(rt, "full") === true, "Q at PV");
  rt.setInput("reset", true); rt.scan(50);
  assert(v(rt, "count") === 0 && v(rt, "full") === false, "reset");
});

T("integer vs real division", () => {
  const rt = mk(`
    VAR_OUTPUT a : Int; b : Real; c : Int; END_VAR
    BEGIN
    a := 7 / 2;
    b := 7.0 / 2.0;
    c := 10 MOD 3;
  `);
  rt.scan(50);
  assert(v(rt, "a") === 3, "7/2=3, got " + v(rt, "a"));
  assert(v(rt, "b") === 3.5, "7.0/2.0=3.5");
  assert(v(rt, "c") === 1, "MOD");
});

T("FOR/EXIT/CONTINUE + WHILE + REPEAT", () => {
  const rt = mk(`
    VAR_OUTPUT sum : Int; evens : Int; w : Int; r : Int; END_VAR
    VAR i : Int; END_VAR
    BEGIN
    sum := 0;
    FOR i := 1 TO 10 DO
      IF i = 8 THEN EXIT; END_IF;
      IF i MOD 2 = 1 THEN CONTINUE; END_IF;
      sum := sum + i;
    END_FOR;
    evens := 0;
    FOR i := 10 TO 2 BY -2 DO evens := evens + 1; END_FOR;
    w := 0;
    WHILE w < 5 DO w := w + 1; END_WHILE;
    r := 0;
    REPEAT r := r + 1; UNTIL r >= 3 END_REPEAT;
  `);
  rt.scan(50);
  assert(v(rt, "sum") === 2 + 4 + 6, "sum=" + v(rt, "sum"));
  assert(v(rt, "evens") === 5, "countdown BY -2");
  assert(v(rt, "w") === 5, "while");
  assert(v(rt, "r") === 3, "repeat");
});

T("CASE with lists, ranges, ELSE", () => {
  const rt = mk(`
    VAR_INPUT n : Int; END_VAR
    VAR_OUTPUT r : Int; END_VAR
    BEGIN
    CASE n OF
      1:      r := 100;
      2, 3:   r := 200;
      10..19: r := 300;
      ELSE    r := -1;
    END_CASE;
  `);
  const cases = [[1, 100], [3, 200], [15, 300], [99, -1]];
  for (const [inp, exp] of cases) {
    rt.setInput("n", inp); rt.scan(50);
    assert(v(rt, "r") === exp, "n=" + inp + " r=" + v(rt, "r"));
  }
});

T("state machine: star-delta with stepOld timer reset", () => {
  const rt = mk(`
    VAR_INPUT start : Bool; stop : Bool; END_VAR
    VAR_OUTPUT main : Bool; star : Bool; delta : Bool; stepNo : Int; END_VAR
    VAR step : Int; stepOld : Int; tStep : TON; END_VAR
    BEGIN
    IF stop THEN step := 0; END_IF;
    CASE step OF
      0:  IF start THEN step := 10; END_IF;
      10: IF tStep.Q THEN step := 20; END_IF;
      20: IF tStep.Q THEN step := 30; END_IF;
      30: ;
      ELSE step := 0;
    END_CASE;
    tStep(IN := (step = stepOld) AND ((step = 10) OR (step = 20)),
          PT := SEL(G := step = 10, IN0 := T#100ms, IN1 := T#600ms));
    stepOld := step;
    main  := step >= 10;
    star  := step = 10;
    delta := step = 30;
    stepNo := step;
  `);
  rt.setInput("start", true); rt.scan(50);
  rt.setInput("start", false);
  assert(v(rt, "stepNo") === 10, "in star after start");
  let scans = 0;
  while (v(rt, "stepNo") === 10 && scans < 20) { rt.scan(50); scans++; }
  assert(v(rt, "stepNo") === 20, "reached gap, stepNo=" + v(rt, "stepNo"));
  assert(scans >= 12, "star held ~600ms (" + scans + " scans)");
  assert(v(rt, "star") === false && v(rt, "delta") === false, "gap: both open");
  let gapScans = 0;
  while (v(rt, "stepNo") === 20 && gapScans < 10) { rt.scan(50); gapScans++; }
  assert(v(rt, "stepNo") === 30, "reached delta");
  assert(gapScans >= 2, "gap really lasted ~100ms (" + gapScans + " scans) — timer reset on step change");
  assert(v(rt, "delta") === true && v(rt, "star") === false, "in delta");
  rt.setInput("stop", true); rt.scan(50);
  assert(v(rt, "main") === false, "stop opens all");
});

T("builtins LIMIT/SEL/MIN/MAX/ABS with named and positional args", () => {
  const rt = mk(`
    VAR_OUTPUT a : Int; b : Int; c : Real; d : Int; END_VAR
    BEGIN
    a := LIMIT(MN := 0, IN := 150, MX := 100);
    b := MIN(7, 3);
    c := ABS(-2.5);
    d := SEL(G := TRUE, IN0 := 10, IN1 := 20);
  `);
  rt.scan(50);
  assert(v(rt, "a") === 100 && v(rt, "b") === 3 && v(rt, "c") === 2.5 && v(rt, "d") === 20, "builtins");
});

T("type errors caught", () => {
  const rt = mk(`
    VAR_OUTPUT i : Int; END_VAR
    BEGIN
    i := 1.5;
  `);
  let threw = false;
  try { rt.scan(50); } catch (e) { threw = e.isRuntime && /REAL_TO_INT/.test(e.message); }
  assert(threw, "Real→Int must error with hint");
});

T("endless WHILE hits watchdog", () => {
  const rt = mk(`
    VAR_INPUT sensor : Bool; END_VAR
    VAR_OUTPUT x : Int; END_VAR
    BEGIN
    WHILE NOT sensor DO x := x + 1; END_WHILE;
  `);
  let threw = false;
  try { rt.scan(50); } catch (e) { threw = e.isRuntime && /watchdog/.test(e.message); }
  assert(threw, "watchdog");
});

T("compile errors carry line numbers", () => {
  let line = 0;
  try {
    VM.compile(`VAR_OUTPUT x : Int; END_VAR
BEGIN
x := 1
x := 2;`);
  } catch (e) { line = e.line; }
  assert(line === 4, "missing semicolon reported near line 4, got " + line);
});

T("temp vars zeroed each scan, statics persist", () => {
  const rt = mk(`
    VAR_OUTPUT s : Int; t : Int; END_VAR
    VAR acc : Int; END_VAR
    VAR_TEMP scratch : Int; END_VAR
    BEGIN
    scratch := scratch + 1;
    acc := acc + 1;
    s := acc; t := scratch;
  `);
  rt.scan(50); rt.scan(50); rt.scan(50);
  assert(v(rt, "s") === 3, "static accumulates");
  assert(v(rt, "t") === 1, "temp resets each scan");
});

T("FB wrapper syntax and # prefixes accepted", () => {
  const rt = mk(`FUNCTION_BLOCK "FB_Test"
    VAR_INPUT go : Bool; END_VAR
    VAR_OUTPUT q : Bool; END_VAR
    BEGIN
    #q := #go;
    END_FUNCTION_BLOCK`);
  rt.setInput("go", true); rt.scan(50);
  assert(v(rt, "q") === true, "wrapper + #");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
