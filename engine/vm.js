/* SCL playground VM — tokenizer, parser, scan-cycle runtime for a teaching
   subset of Structured Control Language. DOM-free; UI wiring lives elsewhere. */
(function (global) {
'use strict';

var KW = {};
["FUNCTION_BLOCK","END_FUNCTION_BLOCK","FUNCTION","END_FUNCTION",
 "VAR_INPUT","VAR_OUTPUT","VAR_IN_OUT","VAR_TEMP","VAR","END_VAR","CONSTANT","RETAIN",
 "BEGIN","IF","THEN","ELSIF","ELSE","END_IF","CASE","OF","END_CASE",
 "FOR","TO","BY","DO","END_FOR","WHILE","END_WHILE","REPEAT","UNTIL","END_REPEAT",
 "CONTINUE","EXIT","RETURN","AND","OR","XOR","NOT","MOD","TRUE","FALSE",
 "REGION","END_REGION"].forEach(function (k) { KW[k] = 1; });

var DECL_TYPES = {
  BOOL:"B", INT:"I", DINT:"I", SINT:"I", USINT:"I", UINT:"I", UDINT:"I",
  REAL:"R", LREAL:"R", TIME:"T"
};
var INST_TYPES = { TON:1, TOF:1, TP:1, R_TRIG:1, F_TRIG:1, CTU:1, CTD:1 };

var TIME_UNITS = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };

function CompileError(msg, line) {
  this.message = msg; this.line = line; this.isCompile = true;
}
function RuntimeError(msg, line) {
  this.message = msg; this.line = line; this.isRuntime = true;
}

/* ---------------- tokenizer ---------------- */
function tokenize(src) {
  var toks = [], i = 0, line = 1, n = src.length;
  function err(m) { throw new CompileError(m, line); }
  while (i < n) {
    var c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "(" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === ")")) { if (src[i] === "\n") line++; i++; }
      if (i >= n) err("unterminated (* comment");
      i += 2; continue;
    }
    if (c === "'") { err("strings are not supported in the playground (yet)"); }
    // time literal
    if ((c === "T" || c === "t") && src[i + 1] === "#") {
      var j = i + 2, seg = "";
      while (j < n && /[0-9a-zA-Z_.]/.test(src[j])) { seg += src[j]; j++; }
      var ms = 0, re = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/gi, m, consumed = 0;
      var clean = seg.replace(/_/g, "");
      while ((m = re.exec(clean)) !== null) {
        ms += parseFloat(m[1]) * TIME_UNITS[m[2].toLowerCase()];
        consumed += m[0].length;
      }
      if (consumed !== clean.length || clean.length === 0)
        err("bad TIME literal T#" + seg);
      toks.push({ t: "time", v: Math.round(ms), line: line });
      i = j; continue;
    }
    // number (incl. based like 16#FF, 2#1010)
    if (/[0-9]/.test(c)) {
      var j2 = i, txt = "";
      while (j2 < n && /[0-9_]/.test(src[j2])) { txt += src[j2]; j2++; }
      if (src[j2] === "#") { // based literal
        var base = parseInt(txt.replace(/_/g, ""), 10);
        j2++; var digits = "";
        while (j2 < n && /[0-9a-fA-F_]/.test(src[j2])) { digits += src[j2]; j2++; }
        var v = parseInt(digits.replace(/_/g, ""), base);
        if (isNaN(v)) err("bad based literal");
        toks.push({ t: "num", v: v, real: false, line: line });
        i = j2; continue;
      }
      var isReal = false;
      if (src[j2] === "." && /[0-9]/.test(src[j2 + 1] || "")) {
        isReal = true; txt += "."; j2++;
        while (j2 < n && /[0-9_]/.test(src[j2])) { txt += src[j2]; j2++; }
      }
      if (src[j2] === "e" || src[j2] === "E") {
        var k = j2 + 1; if (src[k] === "+" || src[k] === "-") k++;
        if (/[0-9]/.test(src[k] || "")) {
          isReal = true; txt += src.slice(j2, k); j2 = k;
          while (j2 < n && /[0-9]/.test(src[j2])) { txt += src[j2]; j2++; }
        }
      }
      toks.push({ t: "num", v: parseFloat(txt.replace(/_/g, "")), real: isReal, line: line });
      i = j2; continue;
    }
    // identifier / keyword (# and " prefixes tolerated)
    if (/[A-Za-z_#"]/.test(c)) {
      var quoted = c === '"', j3 = i + (c === "#" || quoted ? 1 : 0), name = "";
      while (j3 < n && /[A-Za-z0-9_]/.test(src[j3])) { name += src[j3]; j3++; }
      if (quoted) {
        if (src[j3] !== '"') err('unterminated "name"');
        j3++;
      }
      if (!name) err("stray '" + c + "'");
      var up = name.toUpperCase();
      if (!quoted && KW[up]) toks.push({ t: "kw", v: up, line: line });
      else toks.push({ t: "id", v: name, line: line });
      i = j3; continue;
    }
    // punctuation / operators
    var three = src.substr(i, 2);
    if (three === ":=" || three === "=>" || three === "<>" || three === "<=" ||
        three === ">=" || three === "..") {
      toks.push({ t: "p", v: three, line: line }); i += 2; continue;
    }
    if ("();:,.=<>+-*/[]".indexOf(c) >= 0) {
      toks.push({ t: "p", v: c, line: line }); i++; continue;
    }
    err("unexpected character '" + c + "'");
  }
  toks.push({ t: "eof", v: "", line: line });
  return toks;
}

/* ---------------- parser ---------------- */
function parse(src) {
  var toks = tokenize(src), pos = 0;

  function peek(o) { return toks[pos + (o || 0)]; }
  function next() { return toks[pos++]; }
  function err(m, tok) { throw new CompileError(m, (tok || peek()).line); }
  function isKw(k) { var t = peek(); return t.t === "kw" && t.v === k; }
  function eatKw(k) { if (!isKw(k)) err("expected " + k); return next(); }
  function isP(v) { var t = peek(); return t.t === "p" && t.v === v; }
  function eatP(v) { if (!isP(v)) err("expected '" + v + "'"); return next(); }

  var decls = [], declNames = {};

  // optional block header
  if (isKw("FUNCTION_BLOCK") || isKw("FUNCTION")) {
    next();
    if (peek().t === "id") next();
    if (isP(":")) { next(); if (peek().t === "id") next(); } // FC return type — ignored
  }

  function parseDeclSection(kind) {
    next(); // section keyword
    if (isKw("RETAIN")) next();
    if (isKw("CONSTANT")) { kind = "constant"; next(); }
    while (!isKw("END_VAR")) {
      var names = [];
      if (peek().t !== "id") err("expected a variable name");
      names.push(next().v);
      while (isP(",")) { next(); names.push(next().v); }
      eatP(":");
      if (peek().t !== "id") err("expected a data type");
      var tType = next(), typeName = tType.v.toUpperCase();
      var init = null;
      if (isP(":=")) {
        next();
        var neg = false;
        if (isP("-")) { neg = true; next(); }
        var lit = next();
        if (lit.t === "num") init = { tag: lit.real ? "R" : "I", v: neg ? -lit.v : lit.v };
        else if (lit.t === "time") init = { tag: "T", v: lit.v };
        else if (lit.t === "kw" && lit.v === "TRUE") init = { tag: "B", v: true };
        else if (lit.t === "kw" && lit.v === "FALSE") init = { tag: "B", v: false };
        else err("only simple literals are supported as start values", lit);
      }
      eatP(";");
      names.forEach(function (nm) {
        var key = nm.toLowerCase();
        if (declNames[key]) err("'" + nm + "' declared twice", tType);
        var d;
        if (DECL_TYPES[typeName]) {
          d = { name: nm, kind: kind, tag: DECL_TYPES[typeName], typeName: typeName, init: init };
        } else if (INST_TYPES[typeName]) {
          if (kind !== "static")
            err(typeName + " instances belong in the VAR (Static) section", tType);
          d = { name: nm, kind: "static", inst: typeName };
        } else {
          err("unsupported type '" + tType.v + "' (playground supports Bool, Int, DInt, Real, Time, TON, TOF, TP, R_TRIG, F_TRIG, CTU, CTD)", tType);
        }
        declNames[key] = d;
        decls.push(d);
      });
    }
    next(); // END_VAR
  }

  var sawSection = true;
  while (sawSection) {
    if (isKw("VAR_INPUT")) parseDeclSection("input");
    else if (isKw("VAR_OUTPUT")) parseDeclSection("output");
    else if (isKw("VAR_IN_OUT")) parseDeclSection("input");
    else if (isKw("VAR_TEMP")) parseDeclSection("temp");
    else if (isKw("VAR")) parseDeclSection("static");
    else sawSection = false;
  }
  if (isKw("BEGIN")) next();

  /* ---- expressions ---- */
  function parseExpr() { return parseOr(); }
  function parseOr() {
    var l = parseXor();
    while (isKw("OR")) { var t = next(); l = { k: "bin", op: "OR", l: l, r: parseXor(), line: t.line }; }
    return l;
  }
  function parseXor() {
    var l = parseAnd();
    while (isKw("XOR")) { var t = next(); l = { k: "bin", op: "XOR", l: l, r: parseAnd(), line: t.line }; }
    return l;
  }
  function parseAnd() {
    var l = parseNot();
    while (isKw("AND")) { var t = next(); l = { k: "bin", op: "AND", l: l, r: parseNot(), line: t.line }; }
    return l;
  }
  function parseNot() {
    if (isKw("NOT")) { var t = next(); return { k: "not", e: parseNot(), line: t.line }; }
    return parseCmp();
  }
  function parseCmp() {
    var l = parseAdd();
    var t = peek();
    if (t.t === "p" && ["=", "<>", "<", "<=", ">", ">="].indexOf(t.v) >= 0) {
      next();
      return { k: "bin", op: t.v, l: l, r: parseAdd(), line: t.line };
    }
    return l;
  }
  function parseAdd() {
    var l = parseMul();
    while (isP("+") || isP("-")) {
      var t = next(); l = { k: "bin", op: t.v, l: l, r: parseMul(), line: t.line };
    }
    return l;
  }
  function parseMul() {
    var l = parseUnary();
    while (isP("*") || isP("/") || isKw("MOD")) {
      var t = next(); l = { k: "bin", op: t.v === "MOD" ? "MOD" : t.v, l: l, r: parseUnary(), line: t.line };
    }
    return l;
  }
  function parseUnary() {
    if (isP("-")) { var t = next(); return { k: "neg", e: parseUnary(), line: t.line }; }
    if (isP("+")) { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parseArgs() {
    eatP("(");
    var args = [];
    if (!isP(")")) {
      for (;;) {
        var nm = null;
        if (peek().t === "id" && peek(1).t === "p" && (peek(1).v === ":=" || peek(1).v === "=>")) {
          nm = next().v; var dir = next().v;
          if (dir === "=>") {
            if (peek().t !== "id") err("expected a variable after '=>'");
            args.push({ name: nm, out: next().v });
          } else {
            args.push({ name: nm, e: parseExpr() });
          }
        } else {
          args.push({ name: null, e: parseExpr() });
        }
        if (isP(",")) { next(); continue; }
        break;
      }
    }
    eatP(")");
    return args;
  }
  function parsePrimary() {
    var t = peek();
    if (t.t === "num") { next(); return { k: "lit", tag: t.real ? "R" : "I", v: t.v, line: t.line }; }
    if (t.t === "time") { next(); return { k: "lit", tag: "T", v: t.v, line: t.line }; }
    if (t.t === "kw" && (t.v === "TRUE" || t.v === "FALSE")) {
      next(); return { k: "lit", tag: "B", v: t.v === "TRUE", line: t.line };
    }
    if (isP("(")) { next(); var e = parseExpr(); eatP(")"); return e; }
    if (t.t === "id") {
      next();
      if (isP("(")) return { k: "call", fn: t.v, args: parseArgs(), line: t.line };
      if (isP(".")) {
        next();
        if (peek().t !== "id") err("expected a member name after '.'");
        var mem = next().v;
        return { k: "member", obj: t.v, mem: mem.toUpperCase(), line: t.line };
      }
      return { k: "var", name: t.v, line: t.line };
    }
    err("unexpected '" + (t.v || t.t) + "' in expression", t);
  }

  /* ---- statements ---- */
  function intConst(name) {
    var d = declNames[name.toLowerCase()];
    return (d && d.kind === "constant" && d.tag === "I" && d.init && d.init.tag === "I") ? d : null;
  }
  function looksLikeCaseLabel() {
    var t = peek();
    if (t.t === "num") return true;
    if (t.t === "p" && t.v === "-" && peek(1).t === "num") return true;
    // Named steps: CASE #step OF #IDLE: ... — the style Ch. 11 teaches.
    // A label may be followed by ':' , '..' (range) or ',' (list); a statement
    // beginning with an identifier is always followed by ':=' or '(' instead.
    if (t.t === "id" && peek(1).t === "p" &&
        (peek(1).v === ":" || peek(1).v === ".." || peek(1).v === ",")) {
      return !!intConst(t.v);
    }
    return false;
  }
  function readCaseLabelValue() {
    var neg = false;
    if (isP("-")) { neg = true; next(); }
    var t = peek();
    if (t.t === "num" && !t.real) { next(); return neg ? -t.v : t.v; }
    if (t.t === "id") {
      var d = intConst(t.v);
      if (d) { next(); return neg ? -d.init.v : d.init.v; }
      err("'" + t.v + "' is not an integer constant — a CASE label must be an integer literal or a VAR CONSTANT integer", t);
    }
    err("CASE labels must be integer literals or integer constants", t);
  }
  function parseStatements(stopPred) {
    var list = [];
    for (;;) {
      var t = peek();
      if (t.t === "eof") break;
      if (stopPred && stopPred()) break;
      if (t.t === "p" && t.v === ";") { next(); continue; }
      list.push(parseStatement());
    }
    return list;
  }
  function parseStatement() {
    var t = peek();
    if (t.t === "kw") {
      switch (t.v) {
        case "IF": return parseIf();
        case "CASE": return parseCase();
        case "FOR": return parseFor();
        case "WHILE": return parseWhile();
        case "REPEAT": return parseRepeat();
        case "EXIT": next(); eatP(";"); return { k: "exit", line: t.line };
        case "CONTINUE": next(); eatP(";"); return { k: "continue", line: t.line };
        case "RETURN": next(); eatP(";"); return { k: "return", line: t.line };
        case "REGION":
          next();
          while (peek().t !== "eof" && peek().line === t.line) next(); // region title
          return { k: "nop", line: t.line };
        case "END_REGION": next(); return { k: "nop", line: t.line };
        case "END_FUNCTION_BLOCK": case "END_FUNCTION":
          next(); return { k: "nop", line: t.line };
      }
      err("unexpected " + t.v, t);
    }
    if (t.t === "id") {
      next();
      if (isP("(")) { // instance call
        var args = parseArgs(); eatP(";");
        return { k: "icall", name: t.v, args: args, line: t.line };
      }
      if (isP(":=")) {
        next(); var e = parseExpr(); eatP(";");
        return { k: "assign", name: t.v, e: e, line: t.line };
      }
      err("expected ':=' or '(' after '" + t.v + "'", t);
    }
    err("unexpected '" + (t.v || t.t) + "'", t);
  }
  function parseIf() {
    var t = eatKw("IF");
    var branches = [], elseBody = null;
    var cond = parseExpr(); eatKw("THEN");
    branches.push({ cond: cond, body: parseStatements(function () {
      return isKw("ELSIF") || isKw("ELSE") || isKw("END_IF");
    })});
    while (isKw("ELSIF")) {
      next(); var c2 = parseExpr(); eatKw("THEN");
      branches.push({ cond: c2, body: parseStatements(function () {
        return isKw("ELSIF") || isKw("ELSE") || isKw("END_IF");
      })});
    }
    if (isKw("ELSE")) {
      next();
      elseBody = parseStatements(function () { return isKw("END_IF"); });
    }
    eatKw("END_IF"); if (isP(";")) next();
    return { k: "if", branches: branches, elseBody: elseBody, line: t.line };
  }
  function parseCase() {
    var t = eatKw("CASE");
    var sel = parseExpr(); eatKw("OF");
    var branches = [], elseBody = null;
    function stop() { return isKw("ELSE") || isKw("END_CASE") || looksLikeCaseLabel(); }
    while (!isKw("ELSE") && !isKw("END_CASE")) {
      var labels = [];
      for (;;) {
        var lo = readCaseLabelValue(), hi = lo;
        if (isP("..")) {
          next();
          hi = readCaseLabelValue();
        }
        labels.push([lo, hi]);
        if (isP(",")) { next(); continue; }
        break;
      }
      eatP(":");
      branches.push({ labels: labels, body: parseStatements(stop) });
    }
    if (isKw("ELSE")) {
      next();
      elseBody = parseStatements(function () { return isKw("END_CASE"); });
    }
    eatKw("END_CASE"); if (isP(";")) next();
    return { k: "case", sel: sel, branches: branches, elseBody: elseBody, line: t.line };
  }
  function parseFor() {
    var t = eatKw("FOR");
    if (peek().t !== "id") err("expected a loop variable");
    var v = next().v;
    eatP(":="); var from = parseExpr();
    eatKw("TO"); var to = parseExpr();
    var by = null;
    if (isKw("BY")) { next(); by = parseExpr(); }
    eatKw("DO");
    var body = parseStatements(function () { return isKw("END_FOR"); });
    eatKw("END_FOR"); if (isP(";")) next();
    return { k: "for", v: v, from: from, to: to, by: by, body: body, line: t.line };
  }
  function parseWhile() {
    var t = eatKw("WHILE");
    var cond = parseExpr(); eatKw("DO");
    var body = parseStatements(function () { return isKw("END_WHILE"); });
    eatKw("END_WHILE"); if (isP(";")) next();
    return { k: "while", cond: cond, body: body, line: t.line };
  }
  function parseRepeat() {
    var t = eatKw("REPEAT");
    var body = parseStatements(function () { return isKw("UNTIL"); });
    eatKw("UNTIL");
    var cond = parseExpr();
    eatKw("END_REPEAT"); if (isP(";")) next();
    return { k: "repeat", cond: cond, body: body, line: t.line };
  }

  var body = parseStatements(null);
  if (decls.length === 0)
    throw new CompileError("declare your variables first (VAR_INPUT / VAR_OUTPUT / VAR ... END_VAR)", 1);
  return { decls: decls, body: body };
}

/* ---------------- runtime ---------------- */
function defVal(tag) { return tag === "B" ? false : 0; }

function Runtime(prog) {
  this.prog = prog;
  this.vars = {};
  this.order = [];
  this.timeMs = 0;
  this.scanCount = 0;
  var self = this;
  prog.decls.forEach(function (d) {
    var key = d.name.toLowerCase();
    var v;
    if (d.inst) {
      v = { name: d.name, kind: "static", inst: d.inst,
            st: { q: false, et: 0, cv: 0, prev: false, pulsing: false } };
    } else {
      var val = d.init ? coerceInit(d) : defVal(d.tag);
      v = { name: d.name, kind: d.kind, tag: d.tag, typeName: d.typeName, val: val, initVal: val };
    }
    self.vars[key] = v;
    self.order.push(v);
  });
  function coerceInit(d) {
    var i = d.init;
    if (d.tag === "B") { if (i.tag !== "B") throw new CompileError("start value for '" + d.name + "' must be TRUE/FALSE", 1); return i.v; }
    if (d.tag === "I") { if (i.tag !== "I") throw new CompileError("start value for '" + d.name + "' must be an integer", 1); return i.v; }
    if (d.tag === "R") { if (i.tag !== "I" && i.tag !== "R") throw new CompileError("start value for '" + d.name + "' must be numeric", 1); return i.v; }
    if (d.tag === "T") { if (i.tag !== "T") throw new CompileError("start value for '" + d.name + "' must be a T# literal", 1); return i.v; }
    return i.v;
  }
}

Runtime.prototype.setInput = function (name, v) {
  var rec = this.vars[name.toLowerCase()];
  if (rec && !rec.inst) rec.val = rec.tag === "B" ? !!v : +v;
};

var CTL_EXIT = { ctl: "exit" }, CTL_CONT = { ctl: "continue" }, CTL_RET = { ctl: "return" };

var BUILTINS = {
  ABS:   { params: ["IN"], f: function (a) { return num1(a, "ABS", Math.abs); } },
  SQRT:  { params: ["IN"], f: function (a) { return { tag: "R", v: Math.sqrt(numv(a, "SQRT")) }; } },
  MIN:   { params: ["IN1", "IN2"], f: function (a, b) { return num2(a, b, "MIN", Math.min); } },
  MAX:   { params: ["IN1", "IN2"], f: function (a, b) { return num2(a, b, "MAX", Math.max); } },
  LIMIT: { params: ["MN", "IN", "MX"], f: function (mn, x, mx) {
    var v = Math.min(Math.max(numv(x, "LIMIT"), numv(mn, "LIMIT")), numv(mx, "LIMIT"));
    var tag = (mn.tag === "R" || x.tag === "R" || mx.tag === "R") ? "R" : x.tag;
    return { tag: tag, v: v };
  }},
  SEL:   { params: ["G", "IN0", "IN1"], f: function (g, a, b) {
    if (g.tag !== "B") throw new RuntimeError("SEL: G must be Bool", 0);
    return g.v ? b : a;
  }},
  INT_TO_REAL:  { params: ["IN"], f: function (a) { return { tag: "R", v: numv(a, "INT_TO_REAL") }; } },
  DINT_TO_REAL: { params: ["IN"], f: function (a) { return { tag: "R", v: numv(a, "DINT_TO_REAL") }; } },
  REAL_TO_INT:  { params: ["IN"], f: function (a) { return { tag: "I", v: Math.round(numv(a, "REAL_TO_INT")) }; } },
  REAL_TO_DINT: { params: ["IN"], f: function (a) { return { tag: "I", v: Math.round(numv(a, "REAL_TO_DINT")) }; } },
  TRUNC:        { params: ["IN"], f: function (a) { return { tag: "I", v: Math.trunc(numv(a, "TRUNC")) }; } },
  TIME_TO_DINT: { params: ["IN"], f: function (a) {
    if (a.tag !== "T") throw new RuntimeError("TIME_TO_DINT needs a Time", 0);
    return { tag: "I", v: a.v };
  }}
};
function numv(a, fn) {
  if (a.tag !== "I" && a.tag !== "R") throw new RuntimeError(fn + ": numeric argument expected", 0);
  return a.v;
}
function num1(a, fn, f) { return { tag: a.tag === "R" ? "R" : "I", v: f(numv(a, fn)) }; }
function num2(a, b, fn, f) {
  var tag = (a.tag === "R" || b.tag === "R") ? "R" : "I";
  return { tag: tag, v: f(numv(a, fn), numv(b, fn)) };
}

Runtime.prototype.scan = function (dtMs) {
  var self = this, ops = 0, OPS_MAX = 200000;
  this.dt = dtMs;

  // zero temp vars each scan (teachable behavior: they are NOT retained)
  this.order.forEach(function (v) { if (v.kind === "temp") v.val = defVal(v.tag); });

  function rerr(msg, line) { throw new RuntimeError(msg, line); }
  function tick() { if (++ops > OPS_MAX) rerr("scan aborted: possible endless loop (cycle watchdog)", 0); }

  function getVar(name, line) {
    var rec = self.vars[name.toLowerCase()];
    if (!rec) rerr("'" + name + "' is not declared", line);
    return rec;
  }

  function evalE(n) {
    tick();
    switch (n.k) {
      case "lit": return { tag: n.tag, v: n.v };
      case "var": {
        var rec = getVar(n.name, n.line);
        if (rec.inst) rerr("'" + rec.name + "' is a " + rec.inst + " instance — read its outputs like " + rec.name + ".Q", n.line);
        return { tag: rec.tag, v: rec.val };
      }
      case "member": {
        var rec2 = getVar(n.obj, n.line);
        if (!rec2.inst) rerr("'" + rec2.name + "' has no member ." + n.mem, n.line);
        if (n.mem === "Q") return { tag: "B", v: rec2.st.q };
        if (n.mem === "ET") return { tag: "T", v: Math.round(rec2.st.et) };
        if (n.mem === "CV") return { tag: "I", v: rec2.st.cv };
        rerr("unknown member ." + n.mem + " (playground knows .Q, .ET, .CV)", n.line);
      }
      case "not": {
        var e = evalE(n.e);
        if (e.tag !== "B") rerr("NOT needs a Bool", n.line);
        return { tag: "B", v: !e.v };
      }
      case "neg": {
        var e2 = evalE(n.e);
        if (e2.tag === "B") rerr("cannot negate a Bool", n.line);
        return { tag: e2.tag, v: -e2.v };
      }
      case "call": {
        var fname = n.fn.toUpperCase();
        var bi = BUILTINS[fname];
        if (!bi) {
          if (self.vars[n.fn.toLowerCase()] && self.vars[n.fn.toLowerCase()].inst)
            rerr("instance calls are statements — end the line after the ')' with ';' and read outputs separately", n.line);
          rerr("unknown function '" + n.fn + "'", n.line);
        }
        var vals = new Array(bi.params.length);
        n.args.forEach(function (a, idx) {
          if (a.out) rerr(fname + " has no '=>' outputs", n.line);
          var slot = a.name ? bi.params.indexOf(a.name.toUpperCase()) : idx;
          if (slot < 0 || slot >= bi.params.length)
            rerr(fname + ": unknown parameter '" + (a.name || idx) + "'", n.line);
          vals[slot] = evalE(a.e);
        });
        for (var i = 0; i < vals.length; i++)
          if (vals[i] === undefined) rerr(fname + ": missing parameter " + bi.params[i], n.line);
        try { return bi.f.apply(null, vals); }
        catch (ex) { if (ex.isRuntime) { ex.line = n.line; throw ex; } throw ex; }
      }
      case "bin": return evalBin(n);
    }
    rerr("internal: bad expression node", n.line);
  }

  function evalBin(n) {
    var op = n.op, a = evalE(n.l), b = evalE(n.r);
    function bothNum() {
      if ((a.tag !== "I" && a.tag !== "R") || (b.tag !== "I" && b.tag !== "R"))
        rerr("'" + op + "' needs numeric operands (got " + a.tag + " and " + b.tag + ")", n.line);
    }
    switch (op) {
      case "AND": case "OR": case "XOR": {
        if (a.tag === "B" && b.tag === "B") {
          var r = op === "AND" ? (a.v && b.v) : op === "OR" ? (a.v || b.v) : (a.v !== b.v);
          return { tag: "B", v: r };
        }
        if (a.tag === "I" && b.tag === "I") {
          var ri = op === "AND" ? (a.v & b.v) : op === "OR" ? (a.v | b.v) : (a.v ^ b.v);
          return { tag: "I", v: ri };
        }
        rerr(op + " needs two Bools (or two integers for bitwise)", n.line);
      }
      case "=": case "<>": {
        if (a.tag === "B" || b.tag === "B") {
          if (a.tag !== b.tag) rerr("cannot compare Bool with " + (a.tag === "B" ? b.tag : a.tag), n.line);
          return { tag: "B", v: op === "=" ? a.v === b.v : a.v !== b.v };
        }
        if (a.tag === "T" || b.tag === "T") {
          if (a.tag !== b.tag) rerr("compare Time with Time (use a T# literal)", n.line);
        }
        return { tag: "B", v: op === "=" ? a.v === b.v : a.v !== b.v };
      }
      case "<": case "<=": case ">": case ">=": {
        if (a.tag === "B" || b.tag === "B") rerr("cannot order Bools", n.line);
        if ((a.tag === "T") !== (b.tag === "T")) rerr("compare Time with Time (use a T# literal)", n.line);
        var c = op === "<" ? a.v < b.v : op === "<=" ? a.v <= b.v : op === ">" ? a.v > b.v : a.v >= b.v;
        return { tag: "B", v: c };
      }
      case "+": case "-": {
        if (a.tag === "T" && b.tag === "T")
          return { tag: "T", v: op === "+" ? a.v + b.v : a.v - b.v };
        bothNum();
        var tag = (a.tag === "R" || b.tag === "R") ? "R" : "I";
        return { tag: tag, v: op === "+" ? a.v + b.v : a.v - b.v };
      }
      case "*": {
        bothNum();
        return { tag: (a.tag === "R" || b.tag === "R") ? "R" : "I", v: a.v * b.v };
      }
      case "/": {
        bothNum();
        if (b.v === 0) rerr("division by zero", n.line);
        if (a.tag === "I" && b.tag === "I") return { tag: "I", v: Math.trunc(a.v / b.v) };
        return { tag: "R", v: a.v / b.v };
      }
      case "MOD": {
        if (a.tag !== "I" || b.tag !== "I") rerr("MOD works on integers", n.line);
        if (b.v === 0) rerr("MOD by zero", n.line);
        return { tag: "I", v: a.v % b.v };
      }
    }
    rerr("internal: bad operator " + op, n.line);
  }

  function assign(name, val, line) {
    var rec = getVar(name, line);
    if (rec.inst) rerr("cannot assign to instance '" + rec.name + "'", line);
    if (rec.kind === "constant") rerr("'" + rec.name + "' is a constant", line);
    if (rec.tag === "B") {
      if (val.tag !== "B") rerr("cannot assign " + tagName(val.tag) + " to Bool '" + rec.name + "'", line);
      rec.val = val.v;
    } else if (rec.tag === "I") {
      if (val.tag === "R") rerr("cannot assign Real to " + rec.typeName + " '" + rec.name + "' — use REAL_TO_INT(...)", line);
      if (val.tag !== "I") rerr("cannot assign " + tagName(val.tag) + " to " + rec.typeName + " '" + rec.name + "'", line);
      rec.val = val.v;
    } else if (rec.tag === "R") {
      if (val.tag !== "I" && val.tag !== "R") rerr("cannot assign " + tagName(val.tag) + " to Real '" + rec.name + "'", line);
      rec.val = val.v;
    } else if (rec.tag === "T") {
      if (val.tag !== "T") rerr("cannot assign " + tagName(val.tag) + " to Time '" + rec.name + "' — use a T# literal", line);
      rec.val = val.v;
    }
  }
  function tagName(t) { return t === "B" ? "Bool" : t === "I" ? "Int" : t === "R" ? "Real" : "Time"; }

  function stepInstance(rec, args, line) {
    var byName = {};
    args.forEach(function (a) {
      if (!a.name) rerr("instance calls need named parameters (IN := ..., PT := ...)", line);
      byName[a.name.toUpperCase()] = a;
    });
    function getIn(nm, tag, required) {
      var a = byName[nm];
      if (!a) { if (required) rerr(rec.inst + " call is missing " + nm, line); return null; }
      if (a.out) rerr(nm + " is an input — use ':='", line);
      var v = evalE(a.e);
      if (tag && v.tag !== tag) rerr(rec.inst + "." + nm + " expects " + tagName(tag), line);
      return v.v;
    }
    var st = rec.st, dt = self.dt;
    if (rec.inst === "TON") {
      var IN = getIn("IN", "B", true), PT = getIn("PT", "T", true);
      if (IN) { st.et = Math.min(st.et + dt, PT); st.q = st.et >= PT; }
      else { st.et = 0; st.q = false; }
    } else if (rec.inst === "TOF") {
      var IN2 = getIn("IN", "B", true), PT2 = getIn("PT", "T", true);
      if (IN2) { st.q = true; st.et = 0; }
      else if (st.q) { st.et = Math.min(st.et + dt, PT2); if (st.et >= PT2) st.q = false; }
      else st.et = 0;
    } else if (rec.inst === "TP") {
      var IN3 = getIn("IN", "B", true), PT3 = getIn("PT", "T", true);
      if (st.pulsing) {
        st.et = Math.min(st.et + dt, PT3);
        if (st.et >= PT3) { st.q = false; if (!IN3) { st.pulsing = false; st.et = 0; } }
      } else if (IN3 && !st.prev) {
        st.pulsing = true; st.q = true; st.et = 0;
      }
      st.prev = IN3;
    } else if (rec.inst === "R_TRIG") {
      var CLK = getIn("CLK", "B", true);
      st.q = CLK && !st.prev; st.prev = CLK;
    } else if (rec.inst === "F_TRIG") {
      var CLK2 = getIn("CLK", "B", true);
      st.q = !CLK2 && st.prev; st.prev = CLK2;
    } else if (rec.inst === "CTU" || rec.inst === "CTD") {
      var up = rec.inst === "CTU";
      var C = getIn(up ? "CU" : "CD", "B", true);
      var R = getIn("R", "B", false);
      var PV = getIn("PV", "I", true);
      if (C && !st.prev) st.cv += up ? 1 : -1;
      st.prev = C;
      if (R) st.cv = 0;
      st.q = up ? st.cv >= PV : st.cv <= 0;
    }
    // route "=>" outputs
    args.forEach(function (a) {
      if (!a.out) return;
      var mem = a.name.toUpperCase(), val;
      if (mem === "Q") val = { tag: "B", v: st.q };
      else if (mem === "ET") val = { tag: "T", v: Math.round(st.et) };
      else if (mem === "CV") val = { tag: "I", v: st.cv };
      else rerr("unknown output " + mem, line);
      assign(a.out, val, line);
    });
  }

  function execList(list) {
    for (var i = 0; i < list.length; i++) exec(list[i]);
  }
  function exec(s) {
    tick();
    switch (s.k) {
      case "nop": return;
      case "assign": {
        assign(s.name, evalE(s.e), s.line); return;
      }
      case "icall": {
        var rec = getVar(s.name, s.line);
        if (!rec.inst) rerr("'" + rec.name + "' is not a timer/counter/trigger instance", s.line);
        stepInstance(rec, s.args, s.line); return;
      }
      case "if": {
        for (var i = 0; i < s.branches.length; i++) {
          var c = evalE(s.branches[i].cond);
          if (c.tag !== "B") rerr("IF condition must be Bool", s.line);
          if (c.v) { execList(s.branches[i].body); return; }
        }
        if (s.elseBody) execList(s.elseBody);
        return;
      }
      case "case": {
        var sel = evalE(s.sel);
        if (sel.tag !== "I") rerr("CASE selects on an integer", s.line);
        for (var j = 0; j < s.branches.length; j++) {
          var br = s.branches[j];
          for (var l = 0; l < br.labels.length; l++) {
            if (sel.v >= br.labels[l][0] && sel.v <= br.labels[l][1]) {
              execList(br.body); return;
            }
          }
        }
        if (s.elseBody) execList(s.elseBody);
        return;
      }
      case "for": {
        var from = evalE(s.from), to = evalE(s.to);
        var by = s.by ? evalE(s.by) : { tag: "I", v: 1 };
        if (from.tag !== "I" || to.tag !== "I" || by.tag !== "I")
          rerr("FOR bounds must be integers", s.line);
        if (by.v === 0) rerr("FOR ... BY 0 never ends", s.line);
        var rec2 = getVar(s.v, s.line);
        if (rec2.tag !== "I") rerr("FOR loop variable must be an Int/DInt", s.line);
        for (var x = from.v; by.v > 0 ? x <= to.v : x >= to.v; x += by.v) {
          tick();
          rec2.val = x;
          try { execList(s.body); }
          catch (ex) {
            if (ex === CTL_EXIT) return;
            if (ex === CTL_CONT) continue;
            throw ex;
          }
        }
        return;
      }
      case "while": {
        for (;;) {
          tick();
          var c2 = evalE(s.cond);
          if (c2.tag !== "B") rerr("WHILE condition must be Bool", s.line);
          if (!c2.v) return;
          try { execList(s.body); }
          catch (ex) {
            if (ex === CTL_EXIT) return;
            if (ex === CTL_CONT) continue;
            throw ex;
          }
        }
      }
      case "repeat": {
        for (;;) {
          tick();
          try { execList(s.body); }
          catch (ex) {
            if (ex === CTL_EXIT) return;
            if (ex !== CTL_CONT) throw ex;
          }
          var c3 = evalE(s.cond);
          if (c3.tag !== "B") rerr("UNTIL condition must be Bool", s.line);
          if (c3.v) return;
        }
      }
      case "exit": throw CTL_EXIT;
      case "continue": throw CTL_CONT;
      case "return": throw CTL_RET;
    }
    rerr("internal: bad statement", s.line);
  }

  try { execList(this.prog.body); }
  catch (ex) {
    if (ex !== CTL_RET) throw ex;
  }
  this.timeMs += dtMs;
  this.scanCount++;
};

var SCLVM = {
  compile: function (src) { return parse(src); },
  Runtime: Runtime
};
global.SCLVM = SCLVM;
if (typeof module !== "undefined" && module.exports) module.exports = SCLVM;
})(typeof window !== "undefined" ? window : globalThis);
