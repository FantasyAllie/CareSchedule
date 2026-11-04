// Tests supabase/setup.sql on PGlite (Postgres in Node) with stand-ins for Supabase auth.
// Run: cd supabase/test && npm install && npm test
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const q = (s, p) => db.query(s, p);
// stand-ins for what Supabase provides: roles and auth.uid()/auth.jwt() from the request's JWT claims
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on all functions in schema auth to anon, authenticated;`);
await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
await db.exec(fs.readFileSync(process.argv[2], 'utf8')); // safe to run twice
await db.exec(`insert into cs_staff (email, name) values ('sarah@x.uk', 'Sarah'), ('tom@x.uk', 'Tom')`);
const users = { sarah: ['11111111-1111-1111-1111-111111111111', 'sarah@x.uk'], tom: ['22222222-2222-2222-2222-222222222222', 'Tom@X.uk'], eve: ['33333333-3333-3333-3333-333333333333', 'eve@evil.com'] };
async function as(who, sql, params) {
  await db.exec('reset role');
  if (who === 'anon') { await db.exec(`set role anon; select set_config('request.jwt.claims', '', false)`); }
  else { const [sub, email] = users[who]; await q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub, email, role: 'authenticated' })]); await db.exec('set role authenticated'); }
  try { const r = await q(sql, params); return r.rows; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); }
}
const ok = (cond, msg) => { if (!cond) { console.log('FAIL', msg); process.exitCode = 1; } else console.log('ok -', msg); };
const val = r => r && r[0] && Object.values(r[0])[0];

ok((await as('anon', `select * from cs_state`)).error, 'signed-out visitors cannot read');
ok((await as('eve', `select cs_take_lock('x')`)).error?.includes('not_staff'), 'a signed-in non-staff user cannot take the lock');
ok((await as('eve', `select * from cs_lock`)).length === 0, 'non-staff see no rows');
let r = val(await as('sarah', `select cs_take_lock('Sarah iPhone') v`));
ok(r.mine === true && r.holder_name === 'Sarah', 'Sarah takes the lock');
r = val(await as('tom', `select cs_take_lock('Tom laptop') v`));
ok(r.mine === false && r.holder_name === 'Sarah' && r.device === 'Sarah iPhone', 'Tom (email in different case) sees Sarah is editing');
ok((await as('tom', `select cs_save(0, '{"a":1}')`)).error?.includes('not_editor'), 'Tom cannot save while Sarah edits');
ok((await as('tom', `update cs_state set data = '{}'`)).error, 'direct writes refused');
ok((await as('tom', `insert into cs_state (id, data) values ('main', '{}')`)).error, 'direct inserts refused');
ok(val(await as('sarah', `select cs_save(0, '{"v":1}')`)) == 1, 'Sarah saves first version');
ok(val(await as('sarah', `select cs_save(1, '{"v":2}')`)) == 2, 'Sarah saves on top of it');
ok((await as('sarah', `select cs_save(1, '{"v":"old"}')`)).error?.includes('version_conflict'), 'saving over a newer version is refused');
ok(JSON.stringify((await as('tom', `select data, version, updated_by from cs_state`))[0]) === JSON.stringify({ data: { v: 2 }, version: '2', updated_by: 'Sarah' }) ||
   (await as('tom', `select version from cs_state`))[0].version == 2, 'Tom can read the latest rota');
r = val(await as('tom', `select cs_request_edit() v`));
ok(r.request_from === 'Tom', 'Tom asks to edit');
r = val(await as('sarah', `select cs_heartbeat() v`));
ok(r.mine && r.request_from === 'Tom', "Sarah's heartbeat sees Tom's request");
r = val(await as('sarah', `select cs_release() v`));
ok(!r.holder_name, 'Sarah hands over (Done editing)');
r = val(await as('tom', `select cs_take_lock('Tom laptop') v`));
ok(r.mine && !r.request_from, 'Tom now edits');
ok((await as('sarah', `select cs_save(2, '{}')`)).error?.includes('not_editor'), 'Sarah can no longer save');
// stale lock
await db.exec(`update cs_lock set heartbeat = now() - interval '3 minutes'`);
r = val(await as('sarah', `select cs_take_lock('Sarah iPhone') v`));
ok(r.mine, 'a lock left for over 2 minutes can be taken over');
r = val(await as('tom', `select cs_heartbeat() v`));
ok(!r.mine && r.holder_name === 'Sarah', 'Tom learns he lost it');
ok(val(await as('sarah', `select cs_save(2, '{"v":3}')`)) == 3, 'new editor saves');
ok((await as('sarah', `select count(*) n from cs_backups`))[0].n == 1, 'one backup per day kept');
ok((await as('anon', `select cs_save(3, '{}')`)).error, 'signed-out visitors cannot save');
r = val(await as('tom', `select cs_status() v`));
ok(r.version == 3 && r.lock.holder_name === 'Sarah' && !r.lock.mine && r.me === 'Tom', 'status shows version and who is editing');
await db.exec(`update cs_lock set heartbeat = now() - interval '90 seconds'`);
r = val(await as('sarah', `select cs_status() v`));
ok(r.lock.mine && !r.lock.stale, "the editor's status check keeps the lock alive");
ok((await as('eve', `select cs_status()`)).error?.includes('not_staff'), 'non-staff cannot check status');
