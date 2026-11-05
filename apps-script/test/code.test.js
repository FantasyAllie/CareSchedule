// The one-person-at-a-time rules in Code.gs. Run: node apps-script/test/code.test.js
const path = require('path');
const assert = require('assert');
const makeGas = require('./gas-sim');
const root = path.join(__dirname, '..', '..');
let day = '2026-11-05';
const gas = makeGas(path.join(root, 'apps-script', 'Code.gs'), { page: path.join(root, 'CareSchedule.html'), sharedWith: ['sarah@x.uk', 'tom@x.uk'], day: () => day });
let clock = 0;
gas.setNow(() => 1_800_000_000_000 + clock);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const S = (who, fn, ...args) => gas.call(who, fn, args);

check('serves the page with a phone-friendly viewport', () => {
  const out = gas.doGet('sarah@x.uk');
  assert.ok(out.html.includes('<title>CareSchedule</title>'));
  assert.strictEqual(out.meta.viewport, 'width=device-width, initial-scale=1');
});
check('someone the folder is not shared with is refused', () => {
  assert.ok(/don't have access/.test(gas.doGet('eve@x.uk').html));
  assert.throws(() => S('eve@x.uk', 'csOpen', 'e1', 'PC', false), /don't have access/);
});
check('first person in gets an empty rota', () => {
  const r = S('sarah@x.uk', 'csOpen', 's1', 'PC', false);
  assert.deepStrictEqual([r.ok, r.data, r.version, r.me], [true, null, 0, 'Sarah']);
});
check('a second person is kept out and told who has it', () => {
  const r = S('tom@x.uk', 'csOpen', 't1', 'iPhone', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.holder.name, 'Sarah');
  assert.strictEqual(r.holder.mine, false);
});
check('only the page that has it open can save, on the latest version', () => {
  assert.strictEqual(S('tom@x.uk', 'csSave', 't1', 0, '{"carers":[]}').ok, false);
  assert.deepStrictEqual(S('sarah@x.uk', 'csSave', 's1', 0, '{"carers":[1]}'), { ok: true, version: 1 });
  assert.strictEqual(S('sarah@x.uk', 'csSave', 's1', 0, '{"carers":[2]}').reason, 'conflict');
  assert.throws(() => S('sarah@x.uk', 'csSave', 's1', 1, 'not json'));
});
check('asking passes the request on to whoever has it open', () => {
  assert.strictEqual(S('tom@x.uk', 'csAsk', 't1', 'iPhone').holder.asked, true);
  const ping = S('sarah@x.uk', 'csPing', 's1');
  assert.strictEqual(ping.ok, true);
  assert.strictEqual(ping.request.name, 'Tom');
});
check('closing lets the next person in, with the saved rota', () => {
  S('sarah@x.uk', 'csClose', 's1');
  const r = S('tom@x.uk', 'csOpen', 't1', 'iPhone', false);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data, '{"carers":[1]}');
  assert.strictEqual(r.version, 1);
  assert.strictEqual(S('sarah@x.uk', 'csPing', 's1').ok, false);
});
check('a page that stops checking in for 90 seconds is treated as closed', () => {
  clock += 60e3;
  assert.strictEqual(S('sarah@x.uk', 'csOpen', 's2', 'PC', false).ok, false);
  clock += 31e3;
  assert.strictEqual(S('sarah@x.uk', 'csOpen', 's2', 'PC', false).ok, true);
  const late = S('tom@x.uk', 'csSave', 't1', 1, '{"carers":[9]}');
  assert.strictEqual(late.ok, false);
  assert.strictEqual(late.holder.name, 'Sarah');
});
check('the same person can move it to another of their devices', () => {
  const r = S('sarah@x.uk', 'csOpen', 's3', 'iPhone', false);
  assert.strictEqual(r.holder.mine, true);
  assert.strictEqual(S('sarah@x.uk', 'csOpen', 's3', 'iPhone', true).ok, true);
  assert.strictEqual(S('sarah@x.uk', 'csPing', 's2').ok, false);
  assert.strictEqual(S('tom@x.uk', 'csOpen', 't2', 'PC', true).ok, false); // but not someone else
});
check('the first save each day keeps a copy of the day before, 30 at most', () => {
  for (let i = 0; i < 33; i++) {
    day = new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10); // 33 different days from 1 Dec
    const v = Number(gas.props.get('version'));
    assert.strictEqual(S('sarah@x.uk', 'csSave', 's3', v, `{"n":${i}}`).ok, true);
  }
  const backups = gas.root.folders.find(f => f.name === 'backups').files.filter(f => !f.trashed);
  assert.strictEqual(backups.length, 30);
  assert.ok(backups.some(f => f.name === 'careschedule-online-2027-01-02.json'));
});
console.log(`\n${passed} checks passed`);
