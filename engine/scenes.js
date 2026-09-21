/* SCL Field Manual — lab scene physics. Pure state machines, no DOM.
   Contract: create() -> { state, sensors(), step(outputs, dtSeconds) }
   sensors() is read BEFORE the PLC scan; step() runs AFTER it (like a real plant). */
(function (global) {
'use strict';

function createTrainScene() {
  var TRACK = 100, A = 12, B = 88, ZONE = 2.5;
  var CROSS = 50, OCC = 6, APPR = 25, GATE_RATE = 0.5;
  var VMAX = 4.0, ACC = 1.6, BRK = 3.2, DOOR_RATE = 0.4, CRASH_V = 0.5;
  var st = {
    pos: A, v: 0, door: 0, gate: 0,
    crashed: false, doorViolation: false, crossingViolation: false,
    A: A, B: B, ZONE: ZONE, TRACK: TRACK, CROSS: CROSS
  };
  return {
    id: "train",
    state: st,
    sensors: function () {
      return {
        atA: Math.abs(st.pos - A) <= ZONE,
        atB: Math.abs(st.pos - B) <= ZONE,
        doorsClosed: st.door <= 0.05,
        doorsOpen: st.door >= 0.95,
        occupied: Math.abs(st.pos - CROSS) <= OCC,
        approaching: Math.abs(st.pos - CROSS) <= APPR,
        gateClosed: st.gate >= 0.95,
        gateOpen: st.gate <= 0.05,
        speed: st.v
      };
    },
    step: function (out, dt) {
      var fwd = !!out.driveFwd, rev = !!out.driveRev, dcmd = !!out.doorsCmd;
      if (!st.crashed) {
        if (fwd && !rev) st.v = Math.min(st.v + ACC * dt, VMAX);
        else if (rev && !fwd) st.v = Math.max(st.v - ACC * dt, -VMAX);
        else {
          if (st.v > 0) st.v = Math.max(0, st.v - BRK * dt);
          else if (st.v < 0) st.v = Math.min(0, st.v + BRK * dt);
        }
        st.pos += st.v * dt;
        if (st.pos < 0)     { st.pos = 0;     if (Math.abs(st.v) > CRASH_V) st.crashed = true; st.v = 0; }
        if (st.pos > TRACK) { st.pos = TRACK; if (Math.abs(st.v) > CRASH_V) st.crashed = true; st.v = 0; }
      }
      st.door += (dcmd ? DOOR_RATE : -DOOR_RATE) * dt;
      if (st.door < 0) st.door = 0;
      if (st.door > 1) st.door = 1;
      if (st.door > 0.08 && Math.abs(st.v) > 0.2) st.doorViolation = true;
      // level-crossing gate: gateCmd TRUE = close (gate 1 = fully closed)
      st.gate += ((!!out.gateCmd) ? GATE_RATE : -GATE_RATE) * dt;
      if (st.gate < 0) st.gate = 0;
      if (st.gate > 1) st.gate = 1;
      if (Math.abs(st.pos - CROSS) <= OCC && st.gate < 0.95) st.crossingViolation = true;
    }
  };
}

function createDualTankScene() {
  var LMAX = 2.0, PUMP_RATE = 0.09, OUT_RATE = 0.05, FAULT_AT = 100;
  var st = { level: 1.0, t: 0, aFaulted: false, fbA: false, fbB: false,
             overflowed: false, ranDry: false, LMAX: LMAX, FAULT_AT: FAULT_AT };
  return {
    id: "tank2",
    state: st,
    sensors: function () {
      return {
        level: st.level,
        levelLow: st.level <= 0.4,
        levelHigh: st.level >= 1.6,
        fbRunA: st.fbA,
        fbRunB: st.fbB
      };
    },
    step: function (out, dt) {
      st.t += dt;
      if (st.t >= FAULT_AT) st.aFaulted = true;   // pump A trips mid-run
      st.fbA = !!out.pumpA && !st.aFaulted;
      st.fbB = !!out.pumpB;
      var inflow = (st.fbA ? PUMP_RATE : 0) + (st.fbB ? PUMP_RATE : 0);
      var outflow = st.level > 0 ? OUT_RATE : 0;
      st.level += (inflow - outflow) * dt;
      if (st.level >= LMAX) { st.level = LMAX; st.overflowed = true; }
      if (st.level <= 0) { st.level = 0; }
      if (st.level <= 0.02) st.ranDry = true;
    }
  };
}

function createTankScene() {
  var LMAX = 2.0, PUMP_RATE = 0.08, OUT_RATE = 0.035;
  var st = { level: 1.0, overflowed: false, ranDry: false, LMAX: LMAX };
  return {
    id: "tank",
    state: st,
    sensors: function () {
      return {
        level: st.level,
        levelLow: st.level <= 0.4,
        levelHigh: st.level >= 1.6
      };
    },
    step: function (out, dt) {
      var inflow = out.pump ? PUMP_RATE : 0;
      var outflow = st.level > 0 ? OUT_RATE : 0;
      st.level += (inflow - outflow) * dt;
      if (st.level >= LMAX) { st.level = LMAX; st.overflowed = true; }
      if (st.level <= 0) { st.level = 0; }
      if (st.level <= 0.02) st.ranDry = true;
    }
  };
}

function createOvenScene() {
  /* First-order thermal mass. 100 % heater puts 2.6 degC/s into the load; the
     load bleeds K_LOSS of its overtemperature away every second. Holding 75 degC
     therefore needs ~42 % power forever — a proportional-only loop parks about
     5 degC low, which is the whole reason the integral term exists. At t = 200 s
     the door opens and the loss climbs 40 %. */
  var AMB = 20, SP = 75, K_HEAT = 2.6, K_LOSS = 0.020, LOSS_OPEN = 0.028, DOOR_AT = 200;
  var st = { temp: AMB, t: 0, doorOpen: false, pwr: 0, cmd: 0, overRange: false,
             SP: SP, AMB: AMB, DOOR_AT: DOOR_AT };
  return {
    id: "oven",
    state: st,
    sensors: function () {
      return { temp: st.temp, sp: SP, doorOpen: st.doorOpen };
    },
    step: function (out, dt) {
      st.t += dt;
      if (st.t >= DOOR_AT) st.doorOpen = true;
      var p = +out.pwr;
      if (!isFinite(p)) p = 0;
      st.cmd = p;
      // The drive clamps whatever you send it — so an unlimited output looks
      // harmless here. It is not harmless on a real analog card: remember it.
      if (p < -0.01 || p > 100.01) st.overRange = true;
      st.pwr = Math.min(100, Math.max(0, p));
      var loss = st.doorOpen ? LOSS_OPEN : K_LOSS;
      st.temp += (K_HEAT * st.pwr / 100 - loss * (st.temp - AMB)) * dt;
    }
  };
}

function createConveyorScene() {
  /* Parts enter at 0 m and ride to 10 m at 0.6 m/s. Two photo-eyes, infeed at
     1 m and outfeed at 9 m, each +/-0.3 m wide: a part that trips the infeed eye
     trips the outfeed eye 13.3 s later. At t = 120 s the belt seizes — the
     contactor stays energised and nothing moves, with no feedback signal to say
     so. Only travel supervision sees it. Freed again at t = 160 s. */
  var LEN = 10, SPEED = 0.6, EYE_IN = 1.0, EYE_OUT = 9.0, EYE_W = 0.3;
  var SPAWN = 16, JAM_AT = 120, JAM_CLEAR = 160;
  var st = { t: 0, parts: [], passed: 0, jammed: false, freed: false, moving: false, belt: false,
             lastSpawn: -SPAWN, LEN: LEN, SPEED: SPEED, EYE_IN: EYE_IN,
             EYE_OUT: EYE_OUT, EYE_W: EYE_W, JAM_AT: JAM_AT, JAM_CLEAR: JAM_CLEAR };
  function anyAt(eye) {
    for (var i = 0; i < st.parts.length; i++)
      if (Math.abs(st.parts[i] - eye) <= EYE_W) return true;
    return false;
  }
  return {
    id: "conveyor",
    state: st,
    sensors: function () {
      return { eyeIn: anyAt(EYE_IN), eyeOut: anyAt(EYE_OUT) };
    },
    step: function (out, dt) {
      st.t += dt;
      st.jammed = st.t >= JAM_AT && st.t < JAM_CLEAR;
      st.belt = !!out.belt;
      st.moving = st.belt && !st.jammed;
      var wasOut = anyAt(EYE_OUT);
      if (!st.freed && st.t >= JAM_CLEAR) {
        // The mechanic frees the belt and hands the stuck part through the
        // outfeed eye — which is what actually happens, and which is why an
        // alarm must latch: the symptom disappears without anyone acking it.
        st.freed = true;
        var far = -1;
        for (var j = 0; j < st.parts.length; j++) if (st.parts[j] > far) far = st.parts[j];
        if (far >= 0 && far < EYE_OUT)
          for (var k = 0; k < st.parts.length; k++) st.parts[k] += EYE_OUT - far;
      }
      if (st.moving) {
        for (var i = 0; i < st.parts.length; i++) st.parts[i] += SPEED * dt;
        st.parts = st.parts.filter(function (x) { return x <= LEN; });
        if (st.t - st.lastSpawn >= SPAWN) { st.parts.push(0); st.lastSpawn = st.t; }
      }
      // The plant's own tally, taken on exactly the edge the PLC will see, so a
      // correct edge count matches it to within the one scan of transport delay.
      if (!wasOut && anyAt(EYE_OUT)) st.passed++;
    }
  };
}

var SCLScenes = { train: createTrainScene, tank: createTankScene, tank2: createDualTankScene,
                  oven: createOvenScene, conveyor: createConveyorScene };
global.SCLScenes = SCLScenes;
if (typeof module !== "undefined" && module.exports) module.exports = SCLScenes;
})(typeof window !== "undefined" ? window : globalThis);
