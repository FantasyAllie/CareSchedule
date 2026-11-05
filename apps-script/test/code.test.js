// The one-person-at-a-time rules in Code.gs. Run: node apps-script/test/code.test.js
const path = require('path');
const assert = require('assert');
const makeGas = require('./gas-sim');
const root = path.join(__dirname, '..', '..');
const gas = makeGas(path.join(root, 'apps-script', 'Code.gs'), { page: path.join(root, 'CareSchedule.html'), sharedWith: ['sarah@x.uk', 'tom@x.uk'] });
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
const copies = () => gas.root.files.filter(f => !f.trashed && f.name.startsWith('CareSchedule data ')).map(f => f.name).sort();
check('every change is saved as a new file next to the page', () => {
  const names = copies();
  assert.strictEqual(names.length, 1);
  assert.ok(/^CareSchedule data \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2} \(change 1\)\.json$/.test(names[0]), names[0]);
  clock += 1000;
  assert.strictEqual(S('sarah@x.uk', 'csSave', 's3', 1, '{"carers":[2]}').ok, true);
  assert.strictEqual(copies().length, 2);
});
check('opening loads the newest copy – deleting it goes back to the one before', () => {
  S('sarah@x.uk', 'csClose', 's3');
  assert.strictEqual(S('tom@x.uk', 'csOpen', 't3', 'PC', false).data, '{"carers":[2]}');
  S('tom@x.uk', 'csClose', 't3');
  gas.root.files.find(f => f.name.endsWith('(change 2).json')).trashed = true;
  assert.strictEqual(S('tom@x.uk', 'csOpen', 't3', 'PC', false).data, '{"carers":[1]}');
  S('tom@x.uk', 'csClose', 't3');
  assert.strictEqual(S('sarah@x.uk', 'csOpen', 's4', 'PC', false).ok, true);
});
check('two changes in the same second are told apart by their change number', () => {
  let v = Number(gas.props.get('version'));
  S('sarah@x.uk', 'csSave', 's4', v, '{"same":"a"}');
  S('sarah@x.uk', 'csSave', 's4', v + 1, '{"same":"b"}');
  S('sarah@x.uk', 'csClose', 's4');
  assert.strictEqual(S('sarah@x.uk', 'csOpen', 's5', 'PC', false).data, '{"same":"b"}');
});
check('keeps the last 200 changes, and the last change of each day for 30 days', () => {
  // 10 changes a day for 60 days
  for (let d = 0; d < 60; d++) {
    clock += 864e5;
    for (let n = 0; n < 10; n++) {
      clock += 60e3;
      const v = Number(gas.props.get('version'));
      assert.strictEqual(S('sarah@x.uk', 'csSave', 's5', v, `{"d":${d},"n":${n}}`).ok, true);
    }
    clock -= 10 * 60e3;
  }
  const names = copies();
  const days = new Set(names.map(n => n.slice(18, 28)));
  assert.ok(names.length >= 200 && names.length <= 200 + 30 + 10, `${names.length} copies`);
  assert.ok(days.size >= 29 && days.size <= 31, `${days.size} days`);
  S('sarah@x.uk', 'csClose', 's5');
  assert.strictEqual(S('tom@x.uk', 'csOpen', 't6', 'PC', false).data, '{"d":59,"n":9}');
});
check("someone else's old copies are left for them to tidy (only the owner can bin a file)", () => {
  const before = copies().length;
  for (let n = 0; n < 20; n++) { clock += 61e3; S('tom@x.uk', 'csSave', 't6', Number(gas.props.get('version')), '{"tom":' + n + '}'); }
  assert.ok(copies().length >= before, 'Sarah\'s files are not binned by Tom');
});
check('still opens a rota saved by the first version of this script', () => {
  const g2 = makeGas(path.join(root, 'apps-script', 'Code.gs'), { page: path.join(root, 'CareSchedule.html'), sharedWith: ['a@x.uk'] });
  g2.root.createFile('careschedule-online.json', '{"old":true}');
  assert.strictEqual(g2.call('a@x.uk', 'csOpen', ['a1', 'PC', false]).data, '{"old":true}');
});
console.log(`\n${passed} checks passed`);
