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

var SCLScenes = { train: createTrainScene, tank: createTankScene, tank2: createDualTankScene };
global.SCLScenes = SCLScenes;
if (typeof module !== "undefined" && module.exports) module.exports = SCLScenes;
})(typeof window !== "undefined" ? window : globalThis);
