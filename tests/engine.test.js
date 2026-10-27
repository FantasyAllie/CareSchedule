// Run with: node tests/engine.test.js
// Loads the scheduling engine straight out of CareSchedule.html and checks the rules.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'CareSchedule.html'), 'utf8');
const src = html.slice(html.indexOf('// ===== ENGINE START'), html.indexOf('// ===== ENGINE END'));
const sandbox = { module: { exports: {} } };
vm.runInNewContext(src, sandbox);
const E = sandbox.module.exports;

const WEEK = '2026-11-02'; // a Monday
const ALL = [true, true, true, true, true, true, true];
const carer = (name, gender, driver, days, extra) =>
  Object.assign({ id: name, name, gender, driver, daysPerWeek: days, overtime: false, available: ALL.slice(), leave: [], active: true }, extra || {});
const run = (id, type, gender) => ({ id, name: id, type, gender: gender || 'any', days: ALL.slice() });

function check(state) {
  const week = E.getWeek(state, WEEK);
  const byId = Object.fromEntries(state.carers.map(c => [c.id, c]));
  for (let d = 0; d < 7; d++) {
    const seen = new Set();
    for (const r of state.runs) {
      const cell = E.getCell(week, r, d);
      const ids = cell.slots.map(s => s.c).filter(Boolean);
      for (const id of ids) {
        assert(!seen.has(id), `${id} double booked on day ${d}`);
        seen.add(id);
        const c = byId[id];
        assert(r.gender === 'any' || r.gender === c.gender, `gender rule broken on ${r.id}`);
        assert(!(r.allowed && r.allowed.length) || r.allowed.includes(id), `${id} not allowed on ${r.id}`);
        assert(E.carerStatus(c, WEEK, d).ok, `${id} assigned while unavailable on day ${d}`);
      }
      if (ids.length && r.needsDriver !== false) assert(ids.some(id => byId[id].driver), `${r.id} day ${d} has no driver`);
    }
  }
  const v = E.validate(state, WEEK);
  for (const c of state.carers) assert(v.carers[c.id].count <= E.capacity(c, true), `${c.id} over capacity`);
  return v;
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('fills a fully staffed week with no rule breaks', () => {
  const s = E.newState();
  s.carers = [
    carer('M1', 'M', true, 5), carer('M2', 'M', true, 5), carer('M3', 'M', false, 5),
    carer('F1', 'F', true, 5), carer('F2', 'F', true, 5), carer('F3', 'F', false, 5), carer('F4', 'F', false, 5),
    carer('F5', 'F', true, 5), carer('F6', 'F', false, 5), carer('F7', 'F', true, 5),
  ];
  s.runs = [run('R1', 'double'), run('R2', 'double', 'F'), run('R3', 'single')];
  E.autoFill(s, WEEK);
  const v = check(s);
  assert.strictEqual(v.list.filter(i => i.level === 'error').length, 0, JSON.stringify(v.list));
});

test('single runs only get drivers', () => {
  const s = E.newState();
  s.carers = [carer('N1', 'F', false, 7), carer('N2', 'M', false, 7)];
  s.runs = [run('S', 'single')];
  E.autoFill(s, WEEK);
  check(s);
  assert(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0].c === null);
});

test('double-ups are prioritised over singles', () => {
  const s = E.newState();
  s.carers = [carer('D1', 'F', true, 7), carer('N1', 'F', false, 7)];
  s.runs = [run('S', 'single'), run('D', 'double')];
  E.autoFill(s, WEEK);
  check(s);
  const w = E.getWeek(s, WEEK);
  assert.strictEqual(E.getCell(w, s.runs[1], 0).slots.map(x => x.c).join(), ['D1', 'N1'].join());
  assert.strictEqual(E.getCell(w, s.runs[0], 0).slots[0].c, null);
});

test('leave and sickness are respected; days per week respected', () => {
  const s = E.newState();
  s.carers = [
    carer('A', 'F', true, 3, { leave: [{ type: 'AL', from: '2026-11-02', to: '2026-11-03' }] }),
    carer('B', 'F', true, 2, { leave: [{ type: 'SICK', from: '2026-11-06', to: '2026-11-06' }] }),
  ];
  s.runs = [run('S', 'single')];
  E.autoFill(s, WEEK);
  const v = check(s);
  assert.strictEqual(v.carers.A.count, 3);
  assert.strictEqual(v.carers.B.count, 2);
  assert(!v.carers.A.days[0] && !v.carers.A.days[1] && !v.carers.B.days[4]);
});

test('second pass uses spare drivers in double-up gaps', () => {
  const s = E.newState();
  s.carers = [carer('D1', 'M', true, 7), carer('D2', 'F', true, 7)];
  s.runs = [run('D', 'double')];
  E.autoFill(s, WEEK, { secondPass: false });
  assert.strictEqual(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[1].c, null, 'pass 1 keeps drivers for driver slots');
  E.autoFill(s, WEEK, { secondPass: true });
  check(s);
  assert.strictEqual(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots.map(x => x.c).sort().join(), ['D1', 'D2'].join());
});

test('males are preferred first when both are eligible', () => {
  const s = E.newState();
  s.carers = [carer('F1', 'F', true, 7), carer('M1', 'M', true, 7)];
  s.runs = [run('S', 'single')];
  E.autoFill(s, WEEK);
  assert.strictEqual(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0].c, 'M1');
});

test('overtime day only used in pass 2 when agreed', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 5, { overtime: true }), carer('B', 'F', true, 1)];
  s.runs = [run('S', 'single')];
  E.autoFill(s, WEEK, { useOvertime: false });
  assert.strictEqual(E.validate(s, WEEK).carers.A.count, 5);
  E.autoFill(s, WEEK, { useOvertime: true });
  const v = check(s);
  assert.strictEqual(v.carers.A.count, 6);
});

test('locked manual assignments are kept', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 7), carer('B', 'F', true, 7)];
  s.runs = [run('S', 'single')];
  const cell = E.getCell(E.getWeek(s, WEEK), s.runs[0], 0);
  cell.slots[0] = { c: 'B', locked: true, override: false };
  E.autoFill(s, WEEK);
  assert.strictEqual(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0].c, 'B');
});

test('validation flags double booking and leave override', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 7, { leave: [{ type: 'AL', from: WEEK, to: WEEK }] })];
  s.runs = [run('S1', 'single'), run('S2', 'single')];
  const w = E.getWeek(s, WEEK);
  E.getCell(w, s.runs[0], 0).slots[0] = { c: 'A', locked: true, override: true };
  E.getCell(w, s.runs[1], 0).slots[0] = { c: 'A', locked: true, override: false };
  const msgs = E.validate(s, WEEK).list.map(i => i.level + ':' + i.msg).join('\n');
  assert(/error:.*double booked/.test(msgs));
  assert(/warn:S1 Mon: A: Annual leave \(overridden\)/.test(msgs));
  assert(/error:S2 Mon: A: Annual leave$/m.test(msgs));
});

// --- history-aware rules ---
function seeded(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

function rosterState() {
  const s = E.newState();
  s.carers = [
    carer('M1', 'M', true, 5), carer('M2', 'M', true, 4, { overtime: true }), carer('M3', 'M', false, 5),
    carer('M4', 'M', true, 3), carer('F1', 'F', true, 5), carer('F2', 'F', false, 5), carer('F3', 'F', true, 4),
    carer('F4', 'F', false, 4), carer('F5', 'F', true, 5), carer('F6', 'F', false, 3), carer('F7', 'F', true, 5),
    carer('F8', 'F', false, 5), carer('F9', 'F', true, 4), carer('F10', 'F', true, 5), carer('F11', 'F', false, 4),
  ];
  s.runs = [run('R1', 'double'), run('R2', 'double', 'F'), run('R3', 'double'), run('R4', 'single'), run('R5', 'single', 'F')];
  return s;
}

function placementsOf(s, weeks) {
  const worked = {}, runs = {}; // worked[id] = flat day list; runs[id][weekIndex] = {runId: days}
  for (const c of s.carers) { worked[c.id] = []; runs[c.id] = []; }
  weeks.forEach((w, wi) => {
    const week = E.getWeek(s, w);
    for (const c of s.carers) runs[c.id][wi] = {};
    for (let d = 0; d < 7; d++) {
      const on = {};
      for (const r of s.runs) for (const sl of E.getCell(week, r, d).slots) if (sl.c) on[sl.c] = r.id;
      for (const c of s.carers) {
        worked[c.id].push(!!on[c.id]);
        if (on[c.id]) runs[c.id][wi][on[c.id]] = (runs[c.id][wi][on[c.id]] || 0) + 1;
      }
    }
  });
  return { worked, runs };
}

test('carer who worked the last 2 weekends is kept off this weekend', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 7), carer('B', 'F', true, 7)];
  s.runs = [run('S', 'single')];
  for (let w = 1; w <= 2; w++) E.getCell(E.getWeek(s, E.addDays(WEEK, -7 * w)), s.runs[0], 5).slots[0].c = 'A';
  for (let i = 0; i < 20; i++) {
    E.autoFill(s, WEEK, { random: seeded(i) });
    const w = E.getWeek(s, WEEK);
    assert.notStrictEqual(E.getCell(w, s.runs[0], 5).slots[0].c, 'A');
    assert.notStrictEqual(E.getCell(w, s.runs[0], 6).slots[0].c, 'A');
  }
  assert.strictEqual(E.validate(s, WEEK).carers.A.weekendStreak, 2, 'A is flagged for weekend off priority');
  E.getCell(E.getWeek(s, WEEK), s.runs[0], 6).slots[0] = { c: 'A', locked: true, override: false };
  assert(E.validate(s, WEEK).list.some(i => i.level === 'error' && /3rd weekend in a row/.test(i.msg)));
});

test('person-specific runs only use their carers, need no driver, and are filled first', () => {
  const s = E.newState();
  s.carers = [carer('N1', 'F', false, 3), carer('N2', 'F', false, 3), carer('N3', 'F', false, 3),
    carer('D1', 'F', true, 7), carer('D2', 'F', true, 7)];
  s.runs = [run('D', 'double'), Object.assign(run('R6', 'single'), { needsDriver: false, allowed: ['N1', 'N2', 'N3'] })];
  for (let i = 0; i < 10; i++) {
    const r = E.autoFill(s, WEEK, { random: seeded(i) });
    check(s);
    assert(!r.issues.list.some(x => /^R6/.test(x.msg)), 'run 6 not fully covered');
  }
});

function rosterState() {
  const s = E.newState();
  s.carers = [
    carer('M1', 'M', true, 5), carer('M2', 'M', true, 4, { overtime: true }), carer('M3', 'M', false, 5),
    carer('M4', 'M', true, 3), carer('M5', 'M', true, 5), carer('F1', 'F', true, 5), carer('F2', 'F', false, 5),
    carer('F3', 'F', true, 4), carer('F4', 'F', false, 4), carer('F5', 'F', true, 5),
    carer('F6', 'F', false, 3), carer('F7', 'F', true, 5), carer('F8', 'F', false, 5), carer('F9', 'F', true, 4),
    carer('F10', 'F', true, 5), carer('F11', 'F', false, 4), carer('F12', 'F', false, 5),
  ];
  s.runs = [run('R1', 'double'), run('R2', 'double', 'F'), run('R3', 'double'), run('R4', 'single'), run('R5', 'single', 'F'),
    Object.assign(run('R6', 'single'), { needsDriver: false, allowed: ['F2', 'F8', 'F12'] })];
  return s;
}

test('13 weeks in a row: weekends off, run pairs, days off grouped, full cover', () => {
  const s = rosterState();
  const weeks = [...Array(13)].map((_, i) => E.addDays(WEEK, 7 * i));
  let gaps = 0;
  weeks.forEach((w, i) => {
    gaps += E.autoFill(s, w, { random: seeded(100 + i) }).issues.list.filter(x => /needed/.test(x.msg)).length;
    check(s);
  });
  const { worked, runs } = placementsOf(s, weeks);
  let lone = 0, offDays = 0, windows = 0, windowsOff = 0, weeksWorked = 0, weeksTwoRuns = 0, longest = 0;
  for (const c of s.carers) {
    const days = worked[c.id];
    const wk = weeks.map((_, i) => days[i * 7 + 5] || days[i * 7 + 6]);
    for (let i = 0; i + 2 < wk.length; i++) assert(!(wk[i] && wk[i + 1] && wk[i + 2]), `${c.id} worked 3 weekends in a row`);
    for (let i = 0; i + 1 < wk.length; i++) { windows++; if (!wk[i] || !wk[i + 1]) windowsOff++; }
    for (let i = 1; i + 1 < days.length; i++) if (!days[i]) { offDays++; if (days[i - 1] && days[i + 1]) lone++; }
    let pair = null, streak = 0;
    for (const wr of runs[c.id]) {
      const ids = Object.keys(wr);
      if (!ids.length) continue;
      weeksWorked++; if (ids.length <= 2) weeksTwoRuns++;
      const top = Object.entries(wr).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).sort().join();
      streak = top === pair ? streak + 1 : 1; pair = top; longest = Math.max(longest, streak);
    }
  }
  console.log(`     weekend off in ${windowsOff}/${windows} two-week windows; ${weeksTwoRuns}/${weeksWorked} carer-weeks on <=2 runs;` +
    ` longest same run pair ${longest} weeks; ${lone}/${offDays} single days off; ${gaps} unfilled cells`);
  assert.strictEqual(gaps, 0);
  assert(windowsOff / windows > 0.8, 'weekend off every 2 weeks too rarely');
  assert(weeksTwoRuns / weeksWorked > 0.8, 'too many weeks on 3+ runs');
  assert(lone / offDays < 0.25, 'too many single days off');
});

test('allocation is random, not alphabetical', () => {
  const firstPick = new Set();
  for (let i = 0; i < 30; i++) {
    const s = E.newState();
    s.carers = ['Ann', 'Bea', 'Cat', 'Dee', 'Eve'].map(n => carer(n, 'F', true, 5));
    s.runs = [run('S', 'single')];
    E.autoFill(s, WEEK, { random: seeded(i * 7919) });
    firstPick.add(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0].c);
  }
  assert(firstPick.size >= 4, `Monday always went to ${[...firstPick]}`);
  const a = rosterState(), b = rosterState();
  E.autoFill(a, WEEK, { random: seeded(1) });
  E.autoFill(b, WEEK, { random: seeded(2) });
  assert.notStrictEqual(JSON.stringify(a.weeks), JSON.stringify(b.weeks));
});

console.log(`\n${passed} tests passed`);
