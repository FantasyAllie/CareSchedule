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
        assert(!c.runTypes || c.runTypes === 'both' || c.runTypes === (r.type === 'double' ? 'double' : 'single'), `${id} on wrong run type ${r.id}`);
        assert(!c.onlyPreferred || (c.preferredRuns || []).includes(r.id), `${id} put on ${r.id} but only works ${c.preferredRuns}`);
        for (const other of ids) if (other !== id) assert(!E.cantPair(c, byId[other]), `${id} and ${other} on ${r.id} together`);
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
    carer('M1', 'M', true, 5, { notWith: ['F1'] }), carer('M2', 'M', true, 5), carer('M3', 'M', false, 5),
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

test('carers set to double-ups only or singles only stay on those runs', () => {
  const s = E.newState();
  s.carers = [carer('DO', 'F', true, 7, { runTypes: 'double' }), carer('SO', 'F', true, 7, { runTypes: 'single' }),
    carer('B1', 'F', true, 7), carer('B2', 'F', false, 7), carer('B3', 'F', true, 7)];
  s.runs = [run('D', 'double'), run('S', 'single')];
  for (let i = 0; i < 10; i++) {
    const r = E.autoFill(s, WEEK, { random: seeded(i) });
    check(s);
    assert.strictEqual(r.issues.list.filter(x => x.level === 'error').length, 0);
  }
  E.getCell(E.getWeek(s, WEEK), s.runs[1], 0).slots[0] = { c: 'DO', locked: true, override: false };
  assert(E.validate(s, WEEK).list.some(i => i.level === 'error' && /double-ups only/.test(i.msg)));
});

test('no more than 5 days in a row, counting last week', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 7), carer('B', 'F', true, 7)];
  s.runs = [run('S', 'single')];
  const last = E.getWeek(s, E.addDays(WEEK, -7));
  for (const d of [2, 3, 4, 5, 6]) E.getCell(last, s.runs[0], d).slots[0].c = 'A'; // Wed-Sun last week
  for (let i = 0; i < 20; i++) {
    E.autoFill(s, WEEK, { random: seeded(i) });
    assert.notStrictEqual(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0].c, 'A', 'A would be on a 6th day in a row');
    for (const c of ['A', 'B']) {
      const days = [2, 3, 4, 5, 6].map(d => E.getCell(last, s.runs[0], d).slots[0].c === c)
        .concat([0, 1, 2, 3, 4, 5, 6].map(d => E.getCell(E.getWeek(s, WEEK), s.runs[0], d).slots[0].c === c));
      let run = 0;
      for (const w of days) { run = w ? run + 1 : 0; assert(run <= 5, `${c} worked ${run} days in a row`); }
    }
  }
  E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0] = { c: 'A', locked: true, override: false };
  assert(E.validate(s, WEEK).list.some(i => i.level === 'error' && /A: 6 days in a row/.test(i.msg)));
});

test('after 6+ days in a row a carer gets 2 days off in a row', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 7), carer('B', 'F', true, 7), carer('C', 'F', true, 7)];
  s.runs = [run('S', 'single')];
  // last week: A worked Mon-Sat (6 days), Sunday off
  const last = E.getWeek(s, E.addDays(WEEK, -7));
  for (const d of [0, 1, 2, 3, 4, 5]) E.getCell(last, s.runs[0], d).slots[0].c = 'A';
  for (let i = 0; i < 20; i++) {
    E.autoFill(s, WEEK, { random: seeded(i) });
    assert.notStrictEqual(E.getCell(E.getWeek(s, WEEK), s.runs[0], 0).slots[0].c, 'A', 'A back on Monday after only 1 day off');
  }

  // this week: A locked on Mon-Sat by hand, so Sunday and next Monday must be off
  const s2 = E.newState();
  s2.carers = s.carers; s2.runs = s.runs;
  const w = E.getWeek(s2, WEEK);
  for (const d of [0, 1, 2, 3, 4, 5]) E.getCell(w, s2.runs[0], d).slots[0] = { c: 'A', locked: true, override: false };
  const next = E.addDays(WEEK, 7);
  for (let i = 0; i < 20; i++) {
    E.autoFill(s2, WEEK, { random: seeded(i) });
    assert.notStrictEqual(E.getCell(w, s2.runs[0], 6).slots[0].c, 'A');
    E.autoFill(s2, next, { random: seeded(i) });
    assert.notStrictEqual(E.getCell(E.getWeek(s2, next), s2.runs[0], 0).slots[0].c, 'A', 'A back next Monday after only 1 day off');
  }
  E.getCell(E.getWeek(s2, next), s2.runs[0], 0).slots[0] = { c: 'A', locked: true, override: false };
  assert(E.validate(s2, next).list.some(i => i.level === 'error' && /A: back on Mon after 6 days in a row/.test(i.msg)));
});

test('carers who must not work together are never put on the same run', () => {
  const s = E.newState();
  // H and W are married: only H has W listed – it must still apply both ways
  s.carers = [carer('H', 'M', true, 5, { notWith: ['W'] }), carer('W', 'F', false, 5),
    carer('D1', 'F', true, 5), carer('N1', 'F', false, 5), carer('D2', 'M', true, 5), carer('D3', 'F', true, 5)];
  s.runs = [run('R1', 'double'), run('R2', 'double')];
  for (let i = 0; i < 20; i++) {
    const r = E.autoFill(s, WEEK, { random: seeded(i) });
    check(s);
    assert(!r.issues.list.some(x => /needed/.test(x.msg)), 'runs left short');
  }
  const cell = E.getCell(E.getWeek(s, WEEK), s.runs[0], 0);
  cell.slots[0] = { c: 'H', locked: true, override: false };
  cell.slots[1] = { c: 'W', locked: true, override: false };
  assert(E.validate(s, WEEK).list.some(i => i.level === 'error' && /H and W can't work together/.test(i.msg)));
  cell.shadow = { c: 'W', override: true }; cell.slots[1] = { c: 'N1', locked: true, override: false };
  assert(E.validate(s, WEEK).list.some(i => i.level === 'warn' && /H and W can't work together \(overridden\)/.test(i.msg)));
});

test('no overtime while someone else is short of their days, and short carers are flagged', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 4, { overtime: true }), carer('B', 'F', true, 4, { overtime: true })];
  s.runs = [run('S', 'single')];
  for (let i = 0; i < 20; i++) {
    const v = E.autoFill(s, WEEK, { random: seeded(i) }).issues;
    assert(v.carers.A.count <= 4 && v.carers.B.count <= 4, `overtime given: A ${v.carers.A.count}, B ${v.carers.B.count}`);
  }
  // A is due 5 days but the only run operates Mon-Wed; C is marked unavailable all week
  const s2 = E.newState();
  s2.carers = [carer('A', 'F', true, 5), carer('C', 'F', true, 5, { available: [false, false, false, false, false, false, false] })];
  s2.runs = [Object.assign(run('S', 'single'), { days: [true, true, true, false, false, false, false] })];
  E.autoFill(s2, WEEK, { random: seeded(1) });
  const msgs = E.validate(s2, WEEK).list.map(i => i.msg).join('\n');
  assert(/A: 4 days off – profile allows 2 \(2 day\(s\) short\)/.test(msgs), msgs);
  assert(!/C: .*days off/.test(msgs), 'C is marked unavailable, so days off are expected');
});

test('weekends are staggered so a short-staffed roster never loses a whole weekend', () => {
  let worst = 0;
  for (let k = 0; k < 4; k++) {
  const s = rosterState();
  s.carers = s.carers.filter(c => !['M5', 'F7', 'F10', 'F11', 'F12'].includes(c.id));
  s.runs = s.runs.filter(r => r.id !== 'R6');
  for (let i = 0; i < 9; i++) {
    const w = E.addDays(WEEK, 7 * i);
    E.autoFill(s, w, { random: seeded(300 + 50 * k + i) });
    const week = E.getWeek(s, w);
    let empty = 0;
    for (const r of s.runs) for (const d of [5, 6]) empty += E.getCell(week, r, d).slots.filter(x => !x.c).length;
    worst = Math.max(worst, empty);
  }
  }
  console.log(`     (worst weekend: ${worst} of 18 weekend shifts unfilled)`);
  assert(worst <= 8, `${worst} weekend shifts unfilled in one week`);
});

test('preferred runs: "only these runs" is never broken, a preference is mostly kept', () => {
  const s = E.newState();
  s.carers = [carer('O', 'F', true, 5, { preferredRuns: ['R1'], onlyPreferred: true }), carer('P', 'F', true, 5, { preferredRuns: ['R2'] }),
    carer('A', 'F', true, 5), carer('B', 'F', true, 3), carer('C', 'F', true, 3)];
  s.runs = [run('R1', 'single'), run('R2', 'single'), run('R3', 'single')];
  let pDays = 0, pOnR2 = 0, oDays = 0;
  for (let i = 0; i < 8; i++) {
    const w = E.addDays(WEEK, 7 * i);
    const v = E.autoFill(s, w, { random: seeded(500 + i) }).issues;
    check(s);
    oDays += v.carers.O.count;
    for (let d = 0; d < 7; d++) {
      const onR2 = E.getCell(E.getWeek(s, w), s.runs[1], d).slots[0].c === 'P';
      if (v.carers.P.days[d]) { pDays++; if (onR2) pOnR2++; }
    }
  }
  console.log(`     (O worked ${oDays} of 40 contracted days, all on R1; P was on their preferred run ${pOnR2} of ${pDays} days)`);
  assert(oDays >= 34, `O only got ${oDays} of 40 days`);
  assert(pOnR2 / pDays >= 0.9, 'preferred run not kept');
  const cell = E.getCell(E.getWeek(s, WEEK), s.runs[2], 0);
  cell.slots[0] = { c: 'O', locked: true, override: false };
  assert(E.validate(s, WEEK).list.some(i => i.level === 'error' && /O: only works R1/.test(i.msg)));
  cell.slots[0].override = true;
  assert(E.validate(s, WEEK).list.some(i => i.level === 'warn' && /O: only works R1 \(overridden\)/.test(i.msg)));
});

test('agency staff only fill gaps and never change the regular carers\' shifts', () => {
  const regulars = () => [carer('A', 'F', true, 5), carer('B', 'F', true, 5), carer('C', 'M', true, 4), carer('N', 'F', false, 5)];
  const runs = () => [run('R1', 'double'), run('R2', 'single')];
  for (let i = 0; i < 10; i++) {
    const without = E.newState(); without.carers = regulars(); without.runs = runs();
    const withAg = E.newState(); withAg.runs = runs();
    withAg.carers = regulars().concat([carer('AG1', 'M', true, 5, { agency: true }), carer('AG2', 'F', false, 5, { agency: true })]);
    const r1 = E.autoFill(without, WEEK, { random: seeded(700 + i) });
    const r2 = E.autoFill(withAg, WEEK, { random: seeded(700 + i) });
    check(withAg);
    const gaps = r1.issues.list.filter(x => /needed/.test(x.msg)).length;
    const gapsAfter = r2.issues.list.filter(x => /needed/.test(x.msg)).length;
    assert(gaps > 0 && gapsAfter < gaps, `agency should fill some gaps (${gaps} -> ${gapsAfter})`);
    for (const r of runs()) for (let d = 0; d < 7; d++) {
      const a = E.getCell(E.getWeek(without, WEEK), r, d).slots.map(x => x.c);
      const b = E.getCell(E.getWeek(withAg, WEEK), r, d).slots.map(x => x.c);
      a.forEach((id, k) => assert(id ? b[k] === id : (b[k] === null || /^AG/.test(b[k])), `${r.id} day ${d}: ${id} became ${b[k]}`));
    }
    assert(!r2.issues.list.some(x => /^AG\d: .*days off/.test(x.msg)), 'agency staff should not get days-off warnings');
  }
  // with enough regular staff, agency staff are not used at all
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 5), carer('B', 'F', true, 5), carer('C', 'F', true, 4), carer('AG', 'F', true, 5, { agency: true })];
  s.runs = [run('R', 'single')];
  for (let i = 0; i < 10; i++) assert.strictEqual(E.autoFill(s, WEEK, { random: seeded(i) }).issues.carers.AG.count, 0);
});

test('sickness: carer is taken off their shifts and cover suggestions follow the rules', () => {
  const s = E.newState();
  s.carers = [carer('SICK', 'F', true, 5), carer('ND', 'F', false, 5), carer('D1', 'F', true, 5), carer('D2', 'F', true, 5),
    carer('MAN', 'M', true, 5), carer('BUSY', 'F', true, 5), carer('AG', 'F', true, 5, { agency: true }),
    carer('NOTWITH', 'F', true, 5, { notWith: ['ND'] })];
  s.runs = [run('R1', 'double', 'F'), run('R2', 'single')];
  const w = E.getWeek(s, WEEK);
  const put = (r, d, i, c) => { E.getCell(w, s.runs[r], d).slots[i] = { c, locked: true, override: false }; };
  put(0, 2, 0, 'SICK'); put(0, 2, 1, 'ND');   // Wed R1: SICK (driver) + ND
  put(1, 2, 0, 'BUSY');                       // BUSY already working Wed
  put(1, 0, 0, 'D1'); put(1, 1, 0, 'D1'); put(1, 3, 0, 'D1'); put(1, 4, 0, 'D1'); put(1, 5, 0, 'D1'); // D1 on 5 days already
  put(1, 6, 0, 'D2');                         // D2 one day in

  const emptied = E.reportSickness(s, 'SICK', E.addDays(WEEK, 2), E.addDays(WEEK, 2));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(emptied)), [{ week: WEEK, runId: 'R1', d: 2, idx: 0 }]);
  assert(s.carers[0].leave.some(l => l.type === 'SICK'));

  const { ok, no } = E.suggestCover(s, WEEK, 'R1', 2, 0);
  const okIds = ok.map(x => x.carer.id), why = Object.fromEntries(no.map(x => [x.carer.id, x.reason]));
  assert(!okIds.includes('SICK') && /Sickness/.test(why.SICK), why.SICK);
  assert(!okIds.includes('ND') && !okIds.includes('BUSY'), 'already working that day');
  assert(!okIds.includes('MAN') && /female only/.test(why.MAN), why.MAN);
  assert(!okIds.includes('NOTWITH') && /can't work together/.test(why.NOTWITH), why.NOTWITH);
  assert(!okIds.includes('D1') && /days in a row/.test(why.D1), why.D1);   // would be a 6th day in a row
  assert.strictEqual(okIds[0], 'D2', `best cover should be D2, got ${okIds}`);
  assert.strictEqual(okIds[okIds.length - 1], 'AG', 'agency last');
  assert(ok[0].notes.some(n => /short/.test(n)));
});

test('fill gaps only: empty slots are filled and nobody already placed is moved', () => {
  for (let i = 0; i < 10; i++) {
    const s = rosterState();
    E.autoFill(s, WEEK, { random: seeded(900 + i) });
    const week = E.getWeek(s, WEEK);
    // empty a few slots, as if people were taken off by hand
    const emptied = [[0, 1, 0], [3, 4, 0], [1, 6, 1], [2, 2, 1]];
    for (const [r, d, k] of emptied) E.getCell(week, s.runs[r], d).slots[k] = { c: null, locked: false, override: false };
    const before = JSON.stringify(s.runs.map(r => [0, 1, 2, 3, 4, 5, 6].map(d => E.getCell(week, r, d).slots.map(x => [x.c, x.locked]))));
    const res = E.fillGaps(s, WEEK, { random: seeded(950 + i) });
    check(s);
    s.runs.forEach((r, ri) => [0, 1, 2, 3, 4, 5, 6].forEach(d => E.getCell(week, r, d).slots.forEach((x, k) => {
      const was = JSON.parse(before)[ri][d][k];
      if (was[0]) assert.deepStrictEqual([x.c, x.locked], was, `${r.id} day ${d} slot ${k} changed`);
    })));
    assert.strictEqual(res.filled, emptied.length, `filled ${res.filled}`);
    assert(/Filled \d+ of 4 empty slot/.test(res.log[0]), res.log[0]);
  }
});

test('a finalised week is never changed by auto-fill or fill gaps', () => {
  const s = rosterState();
  E.autoFill(s, WEEK, { random: seeded(1) });
  const week = E.getWeek(s, WEEK);
  E.getCell(week, s.runs[0], 0).slots[0] = { c: null, locked: false, override: false };
  week.final = true;
  const before = JSON.stringify(week);
  assert(E.autoFill(s, WEEK, { random: seeded(2) }).finalised);
  assert.strictEqual(E.fillGaps(s, WEEK, { random: seeded(3) }).filled, 0);
  assert.strictEqual(JSON.stringify(week), before);
});

test('carer spreadsheet: import adds, updates, skips examples and explains bad rows; export round-trips', () => {
  const s = E.newState();
  s.runs = [run('R1', 'double'), Object.assign(run('R2', 'single'), { name: 'Run 2' })];
  s.carers = [carer('A', 'F', true, 5, { name: 'Amy Old' })];
  const H = E.CARER_COLUMNS.map(c => c.head);
  const rows = [H,
    ['Example: Jane Smith', 'F', 'Yes', 5, 'No', 'Both', 'All', 'No', '', 'No', '', ''],
    ['amy old', '', 'No', 4, '', 'Doubles', 'Mon-Thu', '', 'Run 2; Run 9', 'Yes', 'Bob New', 'updated'],
    ['Bob New', 'Male', 'yes', '5', 'Y', '', 'Sat Sun Mon', 'no', '', '', '', ''],
    ['Bad Gender', 'X', 'Yes', 5, '', '', '', '', '', '', '', ''],
    ['Bad Days', 'F', 'Yes', 9, '', '', 'Funday', '', '', '', '', ''],
    ['No Gender', '', 'Yes', 5, '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const plan = E.planCarerImport(s, rows);
  assert.strictEqual(plan.skipped, 1);
  assert.strictEqual(plan.add.map(c => c.name).join(), 'Bob New');
  assert.strictEqual(plan.update.map(u => u.name).join(), 'Amy Old');
  assert(/driver.*days per week.*can go on/.test(plan.update[0].labels.join()), plan.update[0].labels.join());
  assert.strictEqual(plan.errors.length, 3, plan.errors.join('\n'));
  assert(/Row 5 \(Bad Gender\): Gender must be M or F/.test(plan.errors[0]));
  assert(/Row 6 \(Bad Days\): Days per week must be a whole number 0–7.*Days they can work not understood/.test(plan.errors[1]), plan.errors[1]);
  assert(/Row 7 \(No Gender\): Gender is needed/.test(plan.errors[2]));
  assert(plan.warnings.some(w => /Row 3: no run called "Run 9"/.test(w)), plan.warnings.join('\n'));
  E.applyCarerImport(s, plan);
  const amy = s.carers.find(c => c.id === 'A'), bob = s.carers.find(c => c.name === 'Bob New');
  assert.strictEqual(amy.gender, 'F', 'blank cell keeps the current value');
  assert(!amy.driver && amy.daysPerWeek === 4 && amy.runTypes === 'double' && amy.onlyPreferred && amy.notes === 'updated');
  assert.strictEqual(amy.available.join(), [true, true, true, true, false, false, false].join());
  assert.strictEqual(amy.preferredRuns.join(), 'R2');
  assert(bob.gender === 'M' && bob.driver && bob.overtime && !bob.agency);
  assert.strictEqual(bob.available.join(), [true, false, false, false, false, true, true].join());
  assert(E.cantPair(amy, bob) && E.cantPair(bob, amy), "can't work with applies both ways");
  // export then re-import: only updates, and nothing changes
  const snapshot = JSON.stringify(E.carersToRows(s));
  const again = E.planCarerImport(s, E.carersToRows(s));
  assert.strictEqual(again.add.length + again.update.length + again.errors.length + again.warnings.length, 0, JSON.stringify(again));
  assert.strictEqual(again.unchanged, 2);
  E.applyCarerImport(s, again);
  assert.strictEqual(s.carers.length, 2);
  assert.strictEqual(JSON.stringify(E.carersToRows(s)), snapshot);
});

test('trainees only shadow experienced carers until their date, then work normally', () => {
  for (let i = 0; i < 8; i++) {
    const s = rosterState();
    const wed = E.addDays(WEEK, 2);
    s.carers.push(carer('T', 'F', true, 5, { traineeUntil: wed }));
    E.autoFill(s, WEEK, { random: seeded(1100 + i) });
    check(s);
    const week = E.getWeek(s, WEEK);
    let shadowDays = 0, normalDays = 0;
    for (const r of s.runs) for (let d = 0; d < 7; d++) {
      const cell = E.getCell(week, r, d);
      if (cell.slots.some(x => x.c === 'T')) { normalDays++; assert(d > 2, `trainee in a normal slot on day ${d}`); }
      if (cell.shadow.c === 'T') {
        shadowDays++;
        assert(d <= 2, `trainee still shadowing after their date (day ${d})`);
        assert(cell.slots.some(x => x.c && x.c !== 'T' && !s.carers.find(c => c.id === x.c).traineeUntil), 'shadowing with no experienced carer');
        assert(cell.shadow.auto);
      }
    }
    assert(shadowDays >= 1, 'trainee was never put on a shadow shift');
    assert(shadowDays + normalDays <= 5);
    // re-running auto-fill replaces auto shadows, but keeps one chosen by hand
    const manual = E.getCell(week, s.runs[0], 6);
    manual.shadow = { c: 'M3', override: false };
    E.autoFill(s, WEEK, { random: seeded(1200 + i) });
    assert.strictEqual(E.getCell(week, s.runs[0], 6).shadow.c, 'M3');
  }
});

test('plan several weeks: fills in order and skips finalised weeks', () => {
  const s = rosterState();
  E.autoFill(s, E.addDays(WEEK, 7), { random: seeded(5) });
  E.getWeek(s, E.addDays(WEEK, 7)).final = true;
  const before = JSON.stringify(E.getWeek(s, E.addDays(WEEK, 7)));
  const res = E.autoFillWeeks(s, WEEK, 4, { random: seeded(6) });
  assert.strictEqual(res.map(r => r.finalised ? 'F' : 'x').join(''), 'xFxx');
  assert.strictEqual(JSON.stringify(E.getWeek(s, E.addDays(WEEK, 7))), before);
  for (const k of [0, 2, 3]) assert(Object.keys(E.getWeek(s, E.addDays(WEEK, 7 * k)).cells).length > 0);
  check(s);
});

test('leave planner warns when leave would leave too few carers, drivers or women', () => {
  const s = E.newState();
  s.carers = [carer('D1', 'F', true, 7), carer('D2', 'M', true, 7), carer('N1', 'F', false, 7), carer('N2', 'F', false, 7)];
  s.runs = [run('R1', 'double', 'F'), run('R2', 'single')];
  const ok = E.leaveImpact(s, 'N2', WEEK, WEEK);           // N2 off: 3 people for 3 shifts, D2 still drives R2
  assert.strictEqual(ok.problemDays, 0, JSON.stringify(ok.days));
  const bad = E.leaveImpact(s, 'D1', WEEK, E.addDays(WEEK, 1)); // D1 off: one driver left for two runs
  assert.strictEqual(bad.days.length, 2);
  assert.strictEqual(bad.problemDays, 2);
  const msgs = bad.days[0].short.join(' | ');
  assert.strictEqual(msgs, 'about 1 drivers for 2 runs needing one');
  assert.strictEqual(s.carers[0].leave.length, 0, 'checking leave must not add it');
});

test('fairness report counts days, weekends, overtime, shortfalls and leave', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 3, { leave: [{ type: 'SICK', from: E.addDays(WEEK, 7), to: E.addDays(WEEK, 8) }] }), carer('B', 'F', true, 2)];
  s.runs = [run('S', 'single')];
  const put = (wk, d, c) => { E.getCell(E.getWeek(s, E.addDays(WEEK, 7 * wk)), s.runs[0], d).slots[0] = { c, locked: true, override: false }; };
  [0, 1, 5, 6].forEach(d => put(0, d, 'A'));    // week 1: A 4 days (1 overtime), weekend
  [2, 3].forEach(d => put(0, d, 'B'));
  [5].forEach(d => put(1, d, 'A'));             // week 2: A 1 day (sick Mon-Tue, due 3 -> 2 short), weekend
  [0, 1].forEach(d => put(1, d, 'B'));
  const rep = E.fairnessReport(s, E.addDays(WEEK, 7), 4);
  assert.strictEqual(rep.weeks.length, 2);
  const a = rep.rows.find(r => r.carer.id === 'A'), b = rep.rows.find(r => r.carer.id === 'B');
  assert.deepStrictEqual([a.days, a.overtime, a.short, a.weekendsWorked, a.longestWeekendRun, a.sickDays], [5, 1, 2, 2, 2, 2]);
  assert.deepStrictEqual([b.days, b.short, b.weekendsWorked], [4, 0, 0]);
});

test('day-off requests are honoured when cover allows, and flagged when not', () => {
  const wed = E.addDays(WEEK, 2);
  for (let i = 0; i < 10; i++) {
    const s = rosterState();
    s.carers.find(c => c.id === 'F1').leave = [{ type: 'REQ', from: wed, to: wed }];
    E.autoFill(s, WEEK, { random: seeded(1300 + i) });
    check(s);
    const v = E.validate(s, WEEK);
    assert(!v.carers.F1.days[2], 'request ignored although others could cover');
    assert(E.carerStatus(s.carers.find(c => c.id === 'F1'), WEEK, 2).ok, 'a request is not leave');
  }
  // only one carer can cover: the request has to give way, and says so
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 3, { leave: [{ type: 'REQ', from: wed, to: wed }] })];
  s.runs = [Object.assign(run('S', 'single'), { days: [false, false, true, false, false, false, false] })]; // Wednesdays only
  const r = E.autoFill(s, WEEK, { random: seeded(1) });
  assert(r.log.some(l => /1 day-off request\(s\) couldn't be met/.test(l)), r.log.join('\n'));
  assert(r.issues.list.some(x => x.level === 'warn' && /A: asked for Wed/.test(x.msg)));
});

test('regular patterns: carers mostly work their usual days, weekly or every other week', () => {
  let onDays = 0, total = 0;
  for (let i = 0; i < 10; i++) {
    const s = rosterState();
    const p = s.carers.find(c => c.id === 'F5');
    p.daysPerWeek = 3; p.pattern = { days: [true, true, true, false, false, false, false], every: 1 };
    E.autoFill(s, WEEK, { random: seeded(1400 + i) });
    check(s);
    const v = E.validate(s, WEEK).carers.F5;
    total += v.count; onDays += v.days.slice(0, 3).filter(Boolean).length;
  }
  console.log(`     (weekly Mon-Wed pattern: ${onDays} of ${total} days worked were pattern days)`);
  assert(onDays / total >= 0.9);
  // every other weekend
  const s = rosterState();
  const q = s.carers.find(c => c.id === 'F7');
  q.pattern = { days: [false, false, false, false, false, true, true], every: 2, from: WEEK };
  let onWk = 0, offWk = 0;
  for (let w = 0; w < 6; w++) {
    E.autoFill(s, E.addDays(WEEK, 7 * w), { random: seeded(1500 + w) });
    const days = E.validate(s, E.addDays(WEEK, 7 * w)).carers.F7.days;
    if (days[5] && days[6]) { if (w % 2 === 0) onWk++; else offWk++; }
  }
  console.log(`     (every-other-weekend pattern: worked ${onWk} of 3 pattern weekends, ${offWk} of 3 others)`);
  assert(onWk >= 2 && offWk <= 1);
});

test('what changed since the rota was shared', () => {
  const s = rosterState();
  E.autoFill(s, WEEK, { random: seeded(3) });
  assert.strictEqual(E.changesSinceShared(s, WEEK), null);
  E.markShared(s, WEEK);
  assert.strictEqual(E.changesSinceShared(s, WEEK).length, 0);
  const cell = E.getCell(E.getWeek(s, WEEK), s.runs[3], 3);   // R4 Thursday
  const was = cell.slots[0].c;
  const other = s.carers.find(c => c.driver && c.id !== was && !E.validate(s, WEEK).carers[c.id].days[3]).id;
  cell.slots[0].c = other;
  const ch = E.changesSinceShared(s, WEEK);
  const text = ch.map(x => `${x.carer.id} ${x.d} ${x.was} -> ${x.now}`).sort().join(' | ');
  assert.strictEqual(text, [`${other} 3 Day off -> R4`, `${was} 3 R4 -> Day off`].sort().join(' | '));
});

test('swap shifts: same day, different days, giving a shift away, and rule problems', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 5), carer('B', 'F', true, 5), carer('C', 'F', true, 5, { leave: [{ type: 'AL', from: WEEK, to: WEEK }] }), carer('M', 'M', true, 5)];
  s.runs = [run('R1', 'single', 'F'), run('R2', 'single', 'F')];
  const w = E.getWeek(s, WEEK);
  const put = (r, d, c) => { E.getCell(w, s.runs[r], d).slots[0] = { c, locked: false, override: false }; };
  put(0, 0, 'A'); put(1, 0, 'B'); put(0, 1, 'B'); put(1, 2, 'A');
  const at = (r, d) => E.getCell(w, s.runs[r], d).slots[0].c;
  let p = E.planSwap(s, WEEK, 'A', 0, 'B', 0);                       // same day: swap runs
  assert.strictEqual(p.problems.length, 0); p.apply(s);
  assert.strictEqual(at(0, 0) + at(1, 0), 'BA');
  p = E.planSwap(s, WEEK, 'A', 2, 'B', 1);                           // A's Wed <-> B's Tue
  assert.strictEqual(p.problems.length, 0, p.problems.join()); p.apply(s);
  assert.strictEqual(at(1, 2) + at(0, 1), 'BA');
  assert(/takes A's Wed/.test(p.text), p.text);
  p = E.planSwap(s, WEEK, 'A', 1, 'C', 0);                           // C is on leave Monday
  assert(/C isn't working Mon/.test(p.error));
  p = E.planSwap(s, WEEK, 'A', 0, 'C', null);                        // give A's Monday to C (on leave)
  assert(p.problems.some(m => /C: Annual leave/.test(m)), p.problems.join());
  p = E.planSwap(s, WEEK, 'A', 0, 'M', null);                        // a man on a female-only run
  assert(p.problems.some(m => /female only/.test(m)), p.problems.join());
  assert.strictEqual(at(1, 0), 'A', 'checking a swap must not change anything');
});

test('half days: split places with their own times, drivers per half, double booking by time, half counts', () => {
  const s = E.newState();
  s.carers = [carer('D1', 'F', true, 5), carer('D2', 'F', true, 5), carer('N1', 'F', false, 5, { notWith: ['N3'] }), carer('N2', 'F', false, 5), carer('N3', 'F', false, 5)];
  s.runs = [run('R1', 'double'), run('R2', 'single')];
  const w = E.getWeek(s, WEEK);
  const cell = E.getCell(w, s.runs[0], 0);
  cell.slots[0] = { c: null, locked: true, override: false, parts: [{ c: 'D1', from: '07:00', to: '14:00' }, { c: 'N1', from: '14:00', to: '21:00' }] };
  cell.slots[1] = { c: 'N2', locked: true, override: false };
  let msgs = E.validate(s, WEEK).list.filter(i => /^R1 Mon/.test(i.msg)).map(i => i.msg).join(' | ');
  assert(/No driver 14:00–21:00/.test(msgs) && !/No driver 07:00/.test(msgs), msgs);
  cell.slots[0].parts[1].c = 'D2';
  msgs = E.validate(s, WEEK).list.filter(i => /^R1 Mon/.test(i.msg)).map(i => i.msg).join(' | ');
  assert(!/No driver/.test(msgs), msgs);
  // morning on R1, afternoon on R2 is fine; overlapping times are double booked
  const c2 = E.getCell(w, s.runs[1], 0);
  c2.slots[0] = { c: null, locked: true, override: false, parts: [{ c: 'D2', from: '07:00', to: '13:00' }, { c: 'D1', from: '14:00', to: '21:00' }] };
  msgs = E.validate(s, WEEK).list.map(i => i.msg).join(' | ');
  assert(!/D1.*double booked/.test(msgs), 'AM on one run + PM on another should be fine: ' + msgs);
  assert(!/D2.*double booked/.test(msgs), 'D2 works 14:00–21:00 on R1 and 07:00–13:00 on R2 – no overlap: ' + msgs);
  c2.slots[0].parts[0].to = '15:00';                               // now overlaps D2's afternoon on R1
  msgs = E.validate(s, WEEK).list.map(i => i.msg).join(' | ');
  assert(/D2 \(07:00–15:00\): double booked/.test(msgs), msgs);
  c2.slots[0].parts[0].to = '13:00';
  // half days count as half towards days per week, but as a day worked for the other rules
  const v = E.validate(s, WEEK).carers;
  assert.strictEqual(v.D1.count, 1, 'two halves on one day = 1 day');
  assert.strictEqual(v.N2.count, 1);
  cell.slots[0].parts[1].c = 'N3'; cell.slots[0].parts[0].c = 'D1';
  assert.strictEqual(E.validate(s, WEEK).carers.N3.count, 0.5);
  assert.strictEqual(E.validate(s, WEEK).carers.N3.days[0], true);
  // can't-work-with only applies when the times overlap: N3 (PM) and N1 (not on) / N2 (whole day) etc.
  cell.slots[1].c = 'N1';                                           // N1 whole day, N3 in the afternoon -> clash
  assert(E.validate(s, WEEK).list.some(i => /N1 and N3 can't work together|N3 and N1 can't work together/.test(i.msg)));
  cell.slots[0].parts = [{ c: 'N3', from: '07:00', to: '12:00' }, { c: 'D2', from: '12:00', to: '21:00' }];
  cell.slots[1] = { c: null, locked: true, override: false, parts: [{ c: 'D1', from: '07:00', to: '12:00' }, { c: 'N1', from: '12:00', to: '21:00' }] };
  assert(!E.validate(s, WEEK).list.some(i => /can't work together/.test(i.msg)), 'N3 morning and N1 afternoon never overlap');
  // auto-fill leaves split places alone and fills around them
  const before = JSON.stringify(E.getCell(w, s.runs[0], 0));
  E.autoFill(s, WEEK, { random: seeded(9) });
  assert.strictEqual(JSON.stringify(E.getCell(w, s.runs[0], 0)), before);
  check(s);
  // what was shared includes the times
  E.markShared(s, WEEK);
  E.getCell(w, s.runs[0], 0).slots[0].parts[0].from = '08:00';
  const ch = E.changesSinceShared(s, WEEK).map(x => `${x.carer.id}: ${x.was} -> ${x.now}`).join(' | ');
  assert(/N3: R1 07:00–12:00 -> R1 08:00–12:00/.test(ch), ch);
});

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
    carer('F6', 'F', false, 3, { runTypes: 'double' }), carer('F7', 'F', true, 5), carer('F8', 'F', false, 5), carer('F9', 'F', true, 4, { runTypes: 'single' }),
    carer('F10', 'F', true, 5), carer('F11', 'F', false, 4), carer('F12', 'F', false, 5),
  ];
  s.runs = [run('R1', 'double'), run('R2', 'double', 'F'), run('R3', 'double'), run('R4', 'single'), run('R5', 'single', 'F'),
    Object.assign(run('R6', 'single'), { needsDriver: false, allowed: ['F2', 'F8', 'F12'] })];
  return s;
}

test('carers are kept on the same run all week when that is possible', () => {
  let perfect = 0;
  for (let i = 0; i < 20; i++) {
    const s = E.newState();
    // each run can be covered all week by two carers (4 days + 3 days), so nobody needs a second run
    s.carers = [carer('A', 'F', true, 4), carer('B', 'F', true, 3), carer('C', 'M', true, 4), carer('D', 'M', true, 3)];
    s.runs = [run('R1', 'single'), run('R2', 'single')];
    const r = E.autoFill(s, WEEK, { random: seeded(i * 31 + 7) });
    assert.strictEqual(r.issues.list.filter(x => /needed/.test(x.msg)).length, 0);
    check(s);
    const runsOf = id => new Set(s.runs.filter(rn => [0, 1, 2, 3, 4, 5, 6].some(d => E.getCell(E.getWeek(s, WEEK), rn, d).slots.some(sl => sl.c === id))).map(rn => rn.id));
    if (s.carers.every(c => runsOf(c.id).size === 1)) perfect++;
  }
  assert(perfect >= 18, `everyone on one run in only ${perfect}/20 weeks`);
});

test('a carer stays on one run for 3 weeks, then moves to another', () => {
  const s = E.newState();
  s.carers = [carer('A', 'F', true, 7), carer('B', 'F', true, 7)];
  s.runs = [run('R1', 'single'), run('R2', 'single')];
  // A has done 3 weeks on R1, B 3 weeks on R2
  for (let w = 1; w <= 3; w++) for (let d = 0; d < 5; d++) {
    const wk = E.getWeek(s, E.addDays(WEEK, -7 * w));
    E.getCell(wk, s.runs[0], d).slots[0].c = 'A';
    E.getCell(wk, s.runs[1], d).slots[0].c = 'B';
  }
  const rot = E.rotation(E.history(s, WEEK).A);
  assert.strictEqual(JSON.stringify([rot.runs, rot.streak]), JSON.stringify([['R1'], 3]));
  let moved = 0;
  for (let i = 0; i < 10; i++) {
    E.autoFill(s, WEEK, { random: seeded(i + 500) });
    const wk = E.getWeek(s, WEEK);
    const aDays = [0, 1, 2, 3, 4].filter(d => E.getCell(wk, s.runs[1], d).slots[0].c === 'A').length;
    if (aDays >= 4) moved++;
  }
  assert(moved >= 8, `A moved to R2 in only ${moved}/10 weeks`);
});

test('13 weeks in a row: weekends off, same run all week, days off grouped, full cover', () => {
  const s = rosterState();
  const weeks = [...Array(13)].map((_, i) => E.addDays(WEEK, 7 * i));
  let gaps = 0;
  weeks.forEach((w, i) => {
    gaps += E.autoFill(s, w, { random: seeded(100 + i) }).issues.list.filter(x => /needed/.test(x.msg)).length;
    check(s);
  });
  const { worked, runs } = placementsOf(s, weeks);
  let lone = 0, offDays = 0, windows = 0, windowsOff = 0, weeksWorked = 0, weeksOneRun = 0, daysAll = 0, daysOnMain = 0;
  for (const c of s.carers) {
    const days = worked[c.id];
    const wk = weeks.map((_, i) => days[i * 7 + 5] || days[i * 7 + 6]);
    for (let i = 0; i + 2 < wk.length; i++) assert(!(wk[i] && wk[i + 1] && wk[i + 2]), `${c.id} worked 3 weekends in a row`);
    for (let i = 0; i + 1 < wk.length; i++) { windows++; if (!wk[i] || !wk[i + 1]) windowsOff++; }
    let inARow = 0;
    for (const w of days) { inARow = w ? inARow + 1 : 0; assert(inARow <= 5, `${c.id} worked ${inARow} days in a row`); }
    assert.strictEqual(E.restBreaches(d => !!days[d], 0, days.length - 1).length, 0);
    for (let i = 1; i + 1 < days.length; i++) if (!days[i]) { offDays++; if (days[i - 1] && days[i + 1]) lone++; }
    for (const wr of runs[c.id]) {
      const counts = Object.values(wr);
      if (!counts.length) continue;
      weeksWorked++; if (counts.length === 1) weeksOneRun++;
      daysAll += counts.reduce((a, b) => a + b, 0); daysOnMain += Math.max(...counts);
    }
  }
  console.log(`     weekend off in ${windowsOff}/${windows} two-week windows; ${weeksOneRun}/${weeksWorked} carer-weeks all on one run,` +
    ` ${daysOnMain}/${daysAll} shifts on the week's main run; ${lone}/${offDays} single days off; ${gaps} unfilled cells`);
  assert.strictEqual(gaps, 0);
  assert(windowsOff / windows > 0.8, 'weekend off every 2 weeks too rarely');
  assert(daysOnMain / daysAll > 0.88, 'carers moved between runs too often within a week');
  assert(weeksOneRun / weeksWorked > 0.65, 'too few weeks spent on a single run');
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
